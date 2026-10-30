# Prix Pillule

Carte citoyenne des prix des pilules contraceptives non remboursées, pharmacie par pharmacie.
Outil d'information neutre : aucune pharmacie mise en avant, aucun lien commercial, contributions anonymes.

- Site : GitHub Pages (fichiers statiques)
- Prix partagés : Supabase (fonctions SQL avec modération et anti-abus)
- Pharmacies : répertoire officiel FINESS (data.gouv.fr)

## Contenu

| Chemin | Rôle |
|---|---|
| `prix-pillule.html` | Le site (source à modifier). |
| `index.html` | Page complète générée par `node outils/build.js` : c'est elle que sert GitHub Pages. |
| `data/pharmacies/` | Les 20 003 officines FINESS, en tuiles d'1° (`lat_lon.json`). |
| `supabase/schema.sql` | Tables et fonctions Supabase (`get_reports`, `add_report`, `vote`). |
| `supabase/pharmacies.sql` | Liste des n° FINESS acceptés par la base. |
| `serveur/server.js` | Serveur local de test (site + API des prix), sans dépendance. |
| `outils/finess2json.py` | Régénère `data/pharmacies/` depuis un nouveau fichier FINESS. |
| `outils/build.js` | Régénère `index.html` depuis `prix-pillule.html`. |

## Mise en ligne

### 1. Supabase (une seule fois)

1. Dans votre projet Supabase : **SQL Editor > New query**, coller le contenu de `supabase/schema.sql`, **Run**.
2. Nouvelle requête : coller `supabase/pharmacies.sql`, **Run**.
3. **Project Settings > API** : copier l'URL du projet et la clé publique (`anon` ou `publishable`),
   puis les renseigner dans `prix-pillule.html` (`CONFIG.supabaseUrl` et `CONFIG.supabaseKey`)
   et lancer `node outils/build.js`.

La clé publique peut figurer dans le code : les tables sont fermées à tout accès direct,
seules les trois fonctions sont appelables. Ne jamais mettre la clé `service_role` / `secret` dans le site.

### 2. GitHub Pages (une seule fois)

Dépôt GitHub > **Settings > Pages** > Source : *Deploy from a branch*, branche `main`, dossier `/ (root)`.
Le site est publié sur https://pannacottafactory.github.io/Prix-Pillule/

### Ensuite

Modifier `prix-pillule.html`, lancer `node outils/build.js`, puis commit et push : GitHub Pages se met à jour en une minute environ.

## Tester en local

```
node serveur/server.js
```

Puis ouvrir http://localhost:8080/. Si Supabase est configuré, le site l'utilise ; sinon il utilise
le serveur local (prix enregistrés dans `serveur/donnees/reports.json`, hors du dépôt).

## Mettre à jour les pharmacies

```
python outils/finess2json.py etalab-cs1100507-stock-AAAAMMJJ-HHMM.csv data/pharmacies
```

Fichier « Extraction Finess des Etablissements géolocalisés » :
https://www.data.gouv.fr/fr/datasets/finess-extraction-du-fichier-des-etablissements/
Puis régénérer `supabase/pharmacies.sql` et l'exécuter dans Supabase.

## Liste des pilules

Elle figure à trois endroits qui doivent rester identiques pour les pilules à prix libre :
`PILULES` dans `prix-pillule.html`, `PILLS` dans `serveur/server.js`, la table `pills` dans `supabase/schema.sql`.
