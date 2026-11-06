// Génère index.html (page complète servie par GitHub Pages et serveur/server.js)
// à partir de prix-pilule.html (contenu de la page, aussi publié en aperçu sur claude.ai).
// Les balises <title>, <meta> et <link> du début de prix-pilule.html sont remontées dans le <head>,
// avec les balises de référencement (SEO) ci-dessous.
// Usage : node outils/build.js
const fs = require("fs"), path = require("path");
const root = path.resolve(__dirname, "..");
const SITE = "https://pannacottafactory.github.io/Prix-Pilule/";

let body = fs.readFileSync(path.join(root, "prix-pilule.html"), "utf8");
const lead = body.match(/^(?:\s*<(?:title|meta|link)\b[^>]*>(?:[^<]*<\/title>)?)+/i)[0];
body = body.slice(lead.length).replace(/^\s+/, "");
const title = (lead.match(/<title>([^<]*)<\/title>/i) || [, "Prix Pilule"])[1];
const desc = (lead.match(/<meta name="description" content="([^"]*)"/i) || [, ""])[1];

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite", "@id": SITE + "#site", url: SITE, name: "Prix Pilule",
      inLanguage: "fr-FR", description: desc, publisher: { "@id": SITE + "#editeur" }
    },
    {
      "@type": "WebApplication", "@id": SITE + "#app", url: SITE, name: "Prix Pilule",
      applicationCategory: "HealthApplication", operatingSystem: "Tous (navigateur web)",
      inLanguage: "fr-FR", isAccessibleForFree: true, areaServed: { "@type": "Country", name: "France" },
      offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
      description: desc, publisher: { "@id": SITE + "#editeur" }
    },
    {
      "@type": "Organization", "@id": SITE + "#editeur", name: "Panna Cotta Factory",
      email: "thepannacottafactory@gmail.com", url: SITE,
      sameAs: ["https://github.com/PannacottaFactory/Prix-Pilule"]
    }
  ]
};

const seo = [
  // Preuve de propriété pour Google Search Console : ne pas supprimer
  '<meta name="google-site-verification" content="-UEHVb87Ptt4ctwCaY-khcHoxZH4W4uGsPKeg71xpuc">',
  '<meta name="robots" content="index,follow,max-image-preview:large">',
  `<link rel="canonical" href="${SITE}">`,
  '<link rel="icon" href="favicon.svg" type="image/svg+xml">',
  '<link rel="apple-touch-icon" href="apple-touch-icon.png">',
  '<meta name="theme-color" content="#B0546A">',
  '<meta property="og:type" content="website">',
  '<meta property="og:locale" content="fr_FR">',
  '<meta property="og:site_name" content="Prix Pilule">',
  `<meta property="og:url" content="${SITE}">`,
  `<meta property="og:title" content="${title}">`,
  `<meta property="og:description" content="${desc}">`,
  `<meta property="og:image" content="${SITE}og-image.png">`,
  '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">',
  '<meta property="og:image:alt" content="Prix Pilule : carte des prix des pilules contraceptives en pharmacie">',
  '<meta name="twitter:card" content="summary_large_image">',
  `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`
].join("\n");

const head = '<!doctype html>\n<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
  + lead.trim() + "\n" + seo + "\n"
  + '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style></head><body>\n';
fs.writeFileSync(path.join(root, "index.html"), head + body + "\n</body></html>\n");

// Plan du site pour les moteurs de recherche (date du jour)
const today = new Date().toISOString().slice(0, 10);
fs.writeFileSync(path.join(root, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${SITE}</loc><lastmod>${today}</lastmod></url>\n</urlset>\n`);
console.log("index.html et sitemap.xml générés");
