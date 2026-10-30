/* Prix Pilule : serveur (Node.js ≥ 18, aucune dépendance)
   - sert le site (index.html, data/…)
   - API des prix partagés :
       GET  /api/health
       POST /api/reports/query      {ids:[finess…]}            → {reports:[…]}
       POST /api/reports            {finess,pilule,format,prix} → {report}
       POST /api/reports/:id/confirm                          → {report}
       POST /api/reports/:id/outdated                         → {report}
   Données : serveur/donnees/reports.json (aucune donnée personnelle).
   Anti-abus : limites par adresse IP, gardées en mémoire uniquement, sous forme hachée,
   jamais écrites sur disque.
   Lancer : node serveur/server.js   (port : variable PORT, 8080 par défaut)
*/
"use strict";
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "donnees");
const DB_FILE = path.join(DATA_DIR, "reports.json");
const PORT = +process.env.PORT || 8080;
const HOST = process.env.HOST || "127.0.0.1";

/* Pilules à prix libre acceptées et formats de boîte vendus.
   À garder synchronisé avec PILULES dans prix-pilule.html (remboursable:false). */
const PILLS = {
  varnoline:[1,3], mercilon:[1,3], desobel:[3], minesse:[1,3], perleane:[1,3], carlin:[3], triafemi:[3], optikinzy:[3],
  jasmine:[3], jasminelle:[3], yaz:[3], drospibel:[3], phizoe:[1,3], belara:[3], qlaira:[3], zoely:[1,3], slinda:[1,3], cerazette:[1,3]
};
// Bornes absolues par format (équivalent 1 à 40 € par mois)
const BOUNDS = { 1:[1, 40], 3:[3, 100] };

/* ---------- Pharmacies connues (FINESS) ---------- */
const FINESS = new Set();
try {
  const dir = path.join(ROOT, "data", "pharmacies");
  for (const f of fs.readdirSync(dir)) if (f.endsWith(".json") && f !== "index.json")
    for (const row of JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))) FINESS.add(row[0]);
  console.log(`${FINESS.size} pharmacies FINESS chargées`);
} catch (e) { console.warn("Liste FINESS introuvable : toutes les pharmacies seront refusées.", e.message); }

/* ---------- Stockage ---------- */
let reports = [];
try { reports = JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } catch (e) { reports = []; }
const byId = new Map(reports.map(r => [r.id, r]));
let saveTimer = null;
function save(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DB_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(reports));
    fs.renameSync(tmp, DB_FILE);
  }, 200);
}

/* ---------- Anti-abus (mémoire uniquement) ---------- */
const SALT = crypto.randomBytes(16).toString("hex"); // change à chaque redémarrage
const hits = new Map(); // clé → [horodatages]
function ipKey(req){
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "";
  return crypto.createHash("sha256").update(SALT + ip).digest("hex").slice(0, 16);
}
function limited(key, max, windowMs){
  const now = Date.now(), list = (hits.get(key) || []).filter(t => now - t < windowMs);
  if (list.length >= max) { hits.set(key, list); return true; }
  list.push(now); hits.set(key, list); return false;
}
// Nettoyage : rien n'est gardé plus de 7 jours
setInterval(() => { const now = Date.now(); for (const [k, l] of hits) if (!l.some(t => now - t < 7 * 86400000)) hits.delete(k); }, 3600000).unref();

/* ---------- Utilitaires HTTP ---------- */
function send(res, code, obj){ res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(obj)); }
function fail(res, code, message){ send(res, code, { error: message }); }
function readJson(req){
  return new Promise((resolve, reject) => {
    let size = 0, chunks = [];
    req.on("data", c => { size += c.length; if (size > 64 * 1024) { reject(new Error("too_big")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}
const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const publicReport = r => ({ id:r.id, finess:r.finess, pilule:r.pilule, format:r.format, prix:r.prix, date:r.date,
  confirmations:r.confirmations, lastConfirmed:r.lastConfirmed || null, outdated:r.outdated || 0, lastOutdated:r.lastOutdated || null });

/* ---------- API ---------- */
async function api(req, res, url){
  const p = url.pathname;
  if (p === "/api/health" && req.method === "GET") return send(res, 200, { ok: true, reports: reports.length });

  if (p === "/api/reports/query" && req.method === "POST") {
    const body = await readJson(req);
    const ids = Array.isArray(body.ids) ? body.ids.slice(0, 1000).map(String) : [];
    const set = new Set(ids);
    return send(res, 200, { reports: reports.filter(r => set.has(r.finess)).map(publicReport) });
  }

  if (p === "/api/reports" && req.method === "POST") {
    const ip = ipKey(req);
    if (limited("post:" + ip, 20, 3600000)) return fail(res, 429, "Vous avez partagé beaucoup de prix en peu de temps. Réessayez dans une heure.");
    const b = await readJson(req);
    const finess = String(b.finess || ""), pilule = String(b.pilule || ""), format = +b.format, prix = Math.round(+b.prix * 100) / 100;
    if (!FINESS.has(finess)) return fail(res, 400, "Pharmacie inconnue.");
    if (!PILLS[pilule]) return fail(res, 400, "Cette pilule n'est pas comparée sur le site (prix fixé ou inconnue).");
    if (!PILLS[pilule].includes(format)) return fail(res, 400, "Ce format de boîte n'existe pas pour cette pilule.");
    const [min, max] = BOUNDS[format];
    if (!isFinite(prix) || prix < min || prix > max) return fail(res, 400, `Le prix doit être compris entre ${min} € et ${max} € pour une boîte de ${format} mois.`);
    // Prix inhabituel : comparé à la médiane des prix déjà partagés pour cette pilule et ce format
    const same = reports.filter(r => r.pilule === pilule && r.format === format).map(r => r.prix);
    if (same.length >= 3) { const m = median(same); if (prix < m * 0.4 || prix > m * 2.5) return fail(res, 422, "Ce prix est très différent des autres prix partagés pour cette pilule. Vérifiez le montant et le format de boîte."); }
    if (limited(`dup:${ip}:${finess}:${pilule}:${format}`, 1, 86400000)) return fail(res, 429, "Vous avez déjà partagé un prix pour cette pilule dans cette pharmacie aujourd'hui. Merci !");
    const r = { id: crypto.randomUUID(), finess, pilule, format, prix, date: new Date().toISOString(), confirmations: 1, outdated: 0 };
    reports.push(r); byId.set(r.id, r); save();
    return send(res, 201, { report: publicReport(r) });
  }

  const m = p.match(/^\/api\/reports\/([\w-]{8,64})\/(confirm|outdated)$/);
  if (m && req.method === "POST") {
    const r = byId.get(m[1]);
    if (!r) return fail(res, 404, "Ce prix n'existe plus.");
    const ip = ipKey(req);
    if (limited(`vote:${ip}:${r.id}`, 1, 7 * 86400000)) return fail(res, 429, "Vous avez déjà donné votre avis sur ce prix. Merci !");
    if (limited("votes:" + ip, 60, 3600000)) return fail(res, 429, "Trop d'actions en peu de temps. Réessayez plus tard.");
    const now = new Date().toISOString();
    if (m[2] === "confirm") { r.confirmations = (r.confirmations || 1) + 1; r.lastConfirmed = now; }
    else { r.outdated = (r.outdated || 0) + 1; r.lastOutdated = now; }
    save();
    return send(res, 200, { report: publicReport(r) });
  }
  return fail(res, 404, "Route inconnue.");
}

/* ---------- Fichiers statiques ---------- */
const TYPES = { ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".css":"text/css; charset=utf-8", ".json":"application/json; charset=utf-8", ".png":"image/png", ".svg":"image/svg+xml", ".ico":"image/x-icon" };
const PUBLIC = [path.join(ROOT, "index.html"), path.join(ROOT, "data") + path.sep];
function serveStatic(req, res, url){
  let p = decodeURIComponent(url.pathname); if (p === "/") p = "/index.html";
  const f = path.resolve(ROOT, "." + path.posix.normalize(p));
  if (!PUBLIC.some(allowed => f === allowed || f.startsWith(allowed))) { res.writeHead(404); return res.end("404"); }
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); return res.end("404"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream", "Cache-Control": f.endsWith(".html") ? "no-cache" : "public, max-age=86400" });
    res.end(d);
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname.startsWith("/api/")) await api(req, res, url);
    else serveStatic(req, res, url);
  } catch (e) { fail(res, 400, "Requête invalide."); }
}).listen(PORT, HOST, () => console.log(`Prix Pilule : http://localhost:${PORT}/`));
