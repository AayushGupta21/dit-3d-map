// Production build: bundles js/ + three.js into one minified, tree-shaken file and writes a
// deployable site to dist/. Upload dist/ to any static host (Netlify, Vercel, GitHub Pages).
//   npm install && npm run build
import * as esbuild from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

const OUT = "dist";
rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}/assets`, { recursive: true });
mkdirSync(`${OUT}/data`, { recursive: true });

const hash = (buf) => createHash("sha1").update(buf).digest("hex").slice(0, 10);

// 1) bundle the app (source imports carry ?v= cache-busters; strip them)
const stripQuery = {
  name: "strip-query",
  setup(b) {
    b.onResolve({ filter: /\?v=/ }, (a) => b.resolve(a.path.replace(/\?.*$/, ""), { kind: a.kind, resolveDir: a.resolveDir }));
    b.onResolve({ filter: /^three\/addons\// }, (a) => b.resolve(a.path.replace("three/addons/", "three/examples/jsm/"), { kind: a.kind, resolveDir: a.resolveDir }));
  },
};
const res = await esbuild.build({
  entryPoints: ["js/main.js"], bundle: true, minify: true, format: "esm", target: "es2020",
  write: false, plugins: [stripQuery], legalComments: "none",
});
const js = res.outputFiles[0].contents;
const jsName = `app.${hash(js)}.js`;
writeFileSync(`${OUT}/${jsName}`, js);

// 2) styles and data, content-hashed so they can be cached forever
const css = (await esbuild.build({ entryPoints: ["css/map.css"], bundle: true, minify: true, write: false, external: ["*.jpg", "*.svg"] })).outputFiles[0].contents;
const cssName = `map.${hash(css)}.css`;
writeFileSync(`${OUT}/${cssName}`, css);

const dataSrc = readFileSync("data/campus.js", "utf8");
const obj = JSON.parse(dataSrc.slice(dataSrc.indexOf("{"), dataSrc.lastIndexOf("}") + 1));
const data = Buffer.from("window.CAMPUS_DATA=" + JSON.stringify(obj) + ";");
const dataName = `data/campus.${hash(data)}.js`;
writeFileSync(`${OUT}/${dataName}`, data);

// 3) static files
for (const f of ["assets/ground.jpg", "assets/icon.svg", "manifest.json", "photo3d.html", "photo3d.css", "photo3d.js", "places.js", "config.example.js"]) {
  if (existsSync(f)) cpSync(f, `${OUT}/${f}`);
}
if (existsSync("config.js")) cpSync("config.js", `${OUT}/config.js`);

// 4) index.html: one CSS, one data file, one script; preload what the first frame needs
let html = readFileSync("index.html", "utf8");
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, "");
html = html.replace(/<link rel="stylesheet" href="css\/map\.css[^"]*" \/>/, `<link rel="stylesheet" href="${cssName}" />`);
html = html.replace(/<script src="data\/campus\.js[^"]*"><\/script>/, `<script src="${dataName}" defer></script>`);
html = html.replace(/<script type="module" src="js\/main\.js[^"]*"><\/script>/, `<script type="module" src="${jsName}"></script>`);
html = html.replace(/<script src="config\.js"><\/script>/, `<script src="config.js" defer></script>`);
// fonts: don't block first paint on Google Fonts
html = html.replace(/<link rel="stylesheet" href="(https:\/\/fonts\.googleapis\.com[^"]+)" \/>/,
  `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />\n  <link rel="stylesheet" href="$1" media="print" onload="this.media='all'" />`);
html = html.replace("</title>", `</title>\n  <link rel="modulepreload" href="${jsName}" />\n  <link rel="preload" href="${dataName}" as="script" />\n  <link rel="preload" href="assets/ground.jpg" as="image" />`);
writeFileSync(`${OUT}/index.html`, html);

// 5) host config: long cache for hashed files, revalidate the HTML
const immutable = "public, max-age=31536000, immutable";
writeFileSync(`${OUT}/_headers`, `/*.js\n  Cache-Control: ${immutable}\n/*.css\n  Cache-Control: ${immutable}\n/data/*\n  Cache-Control: ${immutable}\n/assets/*\n  Cache-Control: public, max-age=604800\n/config.js\n  Cache-Control: no-cache\n/index.html\n  Cache-Control: no-cache\n`);
writeFileSync(`${OUT}/vercel.json`, JSON.stringify({
  headers: [
    { source: "/(app\\..*\\.js|map\\..*\\.css|data/.*)", headers: [{ key: "Cache-Control", value: immutable }] },
    { source: "/assets/(.*)", headers: [{ key: "Cache-Control", value: "public, max-age=604800" }] },
    { source: "/config.js", headers: [{ key: "Cache-Control", value: "no-cache" }] },
  ],
}, null, 2));

const kb = (f) => (statSync(`${OUT}/${f}`).size / 1024).toFixed(0);
const gz = (f) => (gzipSync(readFileSync(`${OUT}/${f}`)).length / 1024).toFixed(0);
for (const f of [jsName, cssName, dataName, "assets/ground.jpg"]) console.log(`${f.padEnd(34)} ${kb(f).padStart(5)} KB  (${gz(f)} KB gzipped)`);
console.log(`\nBuilt ${OUT}/. Upload that folder to any static host.`);
