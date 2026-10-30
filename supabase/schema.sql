-- =====================================================================
-- Prix Pillule : base Supabase des prix partagés
-- À exécuter une fois dans Supabase > SQL Editor (peut être relancé sans risque).
-- Puis exécuter supabase/pharmacies.sql (liste des officines FINESS).
--
-- Principe : les tables ne sont PAS accessibles directement depuis le site.
-- Le site appelle seulement trois fonctions : get_reports, add_report, vote.
-- Ces fonctions font la modération (bornes, prix inhabituels) et l'anti-abus
-- (empreinte hachée de l'adresse IP, effacée après 7 jours).
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;   -- schéma non exposé par l'API

-- ---------- Tables ----------
create table if not exists public.pharmacies (
  finess text primary key
);

-- Pilules à prix libre acceptées et formats de boîte vendus (1 = 1 mois, 3 = 3 mois).
-- À garder identique à PILULES (remboursable:false) dans prix-pillule.html.
create table if not exists public.pills (
  id text primary key,
  formats smallint[] not null
);
insert into public.pills (id, formats) values
  ('varnoline','{1,3}'), ('mercilon','{1,3}'), ('desobel','{3}'), ('minesse','{1,3}'), ('perleane','{1,3}'),
  ('carlin','{3}'), ('triafemi','{3}'), ('optikinzy','{3}'), ('jasmine','{3}'), ('jasminelle','{3}'),
  ('yaz','{3}'), ('drospibel','{3}'), ('phizoe','{1,3}'), ('belara','{3}'), ('qlaira','{3}'),
  ('zoely','{1,3}'), ('slinda','{1,3}'), ('cerazette','{1,3}')
on conflict (id) do update set formats = excluded.formats;

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  finess text not null references public.pharmacies(finess),
  pilule text not null references public.pills(id),
  format smallint not null check (format in (1, 3)),
  prix numeric(6,2) not null,
  date timestamptz not null default now(),
  confirmations integer not null default 1,
  last_confirmed timestamptz,
  outdated integer not null default 0,
  last_outdated timestamptz
);
create index if not exists reports_finess_idx on public.reports (finess);
create index if not exists reports_pill_idx on public.reports (pilule, format);

create table if not exists private.settings (k text primary key, v text not null);
insert into private.settings (k, v) values ('salt', encode(extensions.gen_random_bytes(16), 'hex'))
on conflict (k) do nothing;

create table if not exists private.rate_events (
  key text not null,
  at timestamptz not null default now()
);
create index if not exists rate_events_key_idx on private.rate_events (key, at);
create index if not exists rate_events_at_idx on private.rate_events (at);

-- ---------- Verrouillage : aucun accès direct aux tables ----------
alter table public.pharmacies enable row level security;
alter table public.pills      enable row level security;
alter table public.reports    enable row level security;
revoke all on public.pharmacies, public.pills, public.reports from anon, authenticated;
revoke all on all tables in schema private from anon, authenticated;
revoke usage on schema private from anon, authenticated;

-- ---------- Outils internes ----------
-- Empreinte de la personne : hash(sel secret + adresse IP). L'adresse elle-même n'est jamais stockée.
create or replace function private.client_key() returns text
language sql stable security definer set search_path = '' as $$
  select encode(extensions.digest(
    (select v from private.settings where k = 'salt') ||
    coalesce(
      nullif(current_setting('request.headers', true)::json ->> 'cf-connecting-ip', ''),
      nullif(split_part(coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1), ''),
      'inconnu'),
    'sha256'), 'hex');
$$;

-- Renvoie true si la limite est atteinte, sinon enregistre l'action et renvoie false.
create or replace function private.hit(p_key text, p_max integer, p_window interval) returns boolean
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  select count(*) into n from private.rate_events where key = p_key and at > now() - p_window;
  if n >= p_max then return true; end if;
  insert into private.rate_events (key) values (p_key);
  return false;
end $$;

revoke all on function private.client_key() from public, anon, authenticated;
revoke all on function private.hit(text, integer, interval) from public, anon, authenticated;

-- ---------- Fonctions appelées par le site ----------
-- Lecture des prix d'une liste de pharmacies (1000 au plus)
create or replace function public.get_reports(ids text[])
returns table (id uuid, finess text, pilule text, format smallint, prix numeric, date timestamptz,
               confirmations integer, "lastConfirmed" timestamptz, outdated integer, "lastOutdated" timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.id, r.finess, r.pilule, r.format, r.prix, r.date, r.confirmations, r.last_confirmed, r.outdated, r.last_outdated
  from public.reports r
  where r.finess = any (ids[1:1000]);
$$;

-- Ajout d'un prix, avec modération et anti-abus
create or replace function public.add_report(p_finess text, p_pilule text, p_format integer, p_prix numeric)
returns json
language plpgsql volatile security definer set search_path = '' as $$
declare
  ip text := private.client_key();
  v_prix numeric := round(p_prix, 2);
  v_min numeric; v_max numeric; v_formats smallint[]; v_count integer; v_median numeric;
  r public.reports;
begin
  delete from private.rate_events where at < now() - interval '7 days';   -- effacement des empreintes
  if private.hit('post:' || ip, 20, interval '1 hour') then
    raise exception 'Vous avez partagé beaucoup de prix en peu de temps. Réessayez dans une heure.';
  end if;
  if not exists (select 1 from public.pharmacies where finess = p_finess) then
    raise exception 'Pharmacie inconnue.';
  end if;
  select formats into v_formats from public.pills where id = p_pilule;
  if v_formats is null then
    raise exception 'Cette pilule n''est pas comparée sur le site (prix fixé ou inconnue).';
  end if;
  if not (p_format = any (v_formats)) then
    raise exception 'Ce format de boîte n''existe pas pour cette pilule.';
  end if;
  if p_format = 1 then v_min := 1; v_max := 40; else v_min := 3; v_max := 100; end if;
  if v_prix is null or v_prix < v_min or v_prix > v_max then
    raise exception 'Le prix doit être compris entre % € et % € pour une boîte de % mois.', v_min, v_max, p_format;
  end if;
  select count(*), percentile_cont(0.5) within group (order by prix) into v_count, v_median
  from public.reports where pilule = p_pilule and format = p_format;
  if v_count >= 3 and (v_prix < v_median * 0.4 or v_prix > v_median * 2.5) then
    raise exception 'Ce prix est très différent des autres prix partagés pour cette pilule. Vérifiez le montant et le format de boîte.';
  end if;
  if private.hit('dup:' || ip || ':' || p_finess || ':' || p_pilule || ':' || p_format, 1, interval '1 day') then
    raise exception 'Vous avez déjà partagé un prix pour cette pilule dans cette pharmacie aujourd''hui. Merci !';
  end if;
  insert into public.reports (finess, pilule, format, prix) values (p_finess, p_pilule, p_format, v_prix)
  returning * into r;
  return json_build_object('id', r.id, 'finess', r.finess, 'pilule', r.pilule, 'format', r.format, 'prix', r.prix,
    'date', r.date, 'confirmations', r.confirmations, 'lastConfirmed', null, 'outdated', 0, 'lastOutdated', null);
end $$;

-- « Ce prix est toujours bon » (confirm) ou « Ce prix n'est plus bon » (outdated)
create or replace function public.vote(p_id uuid, p_kind text)
returns json
language plpgsql volatile security definer set search_path = '' as $$
declare
  ip text := private.client_key();
  r public.reports;
begin
  if p_kind not in ('confirm', 'outdated') then raise exception 'Action inconnue.'; end if;
  select * into r from public.reports where id = p_id;
  if r.id is null then raise exception 'Ce prix n''existe plus.'; end if;
  if private.hit('vote:' || ip || ':' || p_id, 1, interval '7 days') then
    raise exception 'Vous avez déjà donné votre avis sur ce prix. Merci !';
  end if;
  if private.hit('votes:' || ip, 60, interval '1 hour') then
    raise exception 'Trop d''actions en peu de temps. Réessayez plus tard.';
  end if;
  if p_kind = 'confirm' then
    update public.reports set confirmations = confirmations + 1, last_confirmed = now() where id = p_id returning * into r;
  else
    update public.reports set outdated = outdated + 1, last_outdated = now() where id = p_id returning * into r;
  end if;
  return json_build_object('id', r.id, 'confirmations', r.confirmations, 'lastConfirmed', r.last_confirmed,
    'outdated', r.outdated, 'lastOutdated', r.last_outdated);
end $$;

revoke all on function public.get_reports(text[]) from public;
revoke all on function public.add_report(text, text, integer, numeric) from public;
revoke all on function public.vote(uuid, text) from public;
grant execute on function public.get_reports(text[]) to anon, authenticated;
grant execute on function public.add_report(text, text, integer, numeric) to anon, authenticated;
grant execute on function public.vote(uuid, text) to anon, authenticated;
