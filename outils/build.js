// Génère index.html (page complète servie par GitHub Pages et serveur/server.js)
// à partir de prix-pilule.html (contenu de la page, aussi publié en aperçu sur claude.ai).
// Usage : node outils/build.js
const fs = require("fs"), path = require("path");
const root = path.resolve(__dirname, "..");
const body = fs.readFileSync(path.join(root, "prix-pilule.html"), "utf8");
const head = '<!doctype html>\n<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style></head><body>\n';
fs.writeFileSync(path.join(root, "index.html"), head + body + "\n</body></html>\n");
console.log("index.html généré");
