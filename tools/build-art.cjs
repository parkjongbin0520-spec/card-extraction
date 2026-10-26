/* Slice generated sheets, preserve alpha and encode web-ready assets. Requires ImageMagick. */
"use strict";
const fs = require("node:fs"), path = require("node:path"), { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, ".."), target = path.join(root, "assets/generated");
const sourceDir = process.argv[2];
if (!sourceDir) throw Error("Usage: node tools/build-art.cjs /path/to/original-generated-pngs");
const sources = require("./art-sources.json");
const source = (key) => path.join(sourceDir, sources[key]);
const magick = (...args) => execFileSync("magick", args.map(String), { stdio: "pipe" });
const output = (name) => path.join(target, name + ".webp");
// Measure the opaque silhouette rather than nearly invisible alpha noise in a sheet.
// Only its crop rectangle is used; the original antialiased image pixels are retained.
const silhouette = (file, crop) => magick(file, "-crop", crop, "+repage", "-alpha", "extract", "-threshold", "12%", "-format", "%@", "info:").toString().trim();
for (const dir of ["", "cards", "items", "actors", "props"]) fs.mkdirSync(path.join(target, dir), { recursive: true });
for (const key of ["menu", "base", "environment-0", "environment-1", "environment-2"])
  magick(source(key), "-strip", "-quality", 84, output(key));
const cards = ["shot", "burst", "guard", "scan", "heal", "pierce", "grenade", "surge", "suppress", "breach", "fieldAid", "bulwark"];
// The generated row divisions were inspected; the second row is slightly shorter.
const cardRows = [0, 341, 666, 1024];
cards.forEach((name, i) => {
  const row = Math.floor(i / 4), col = i % 4;
  magick(source("cards"), "-crop", `384x${cardRows[row + 1] - cardRows[row]}+${col * 384}+${cardRows[row]}`, "+repage", "-strip", "-quality", 86, output("cards/" + name));
});
const items = ["rifle", "carbine", "pistol", "vest", "heavyVest", "backpack", "largePack", "scrap", "circuit", "medkit", "grenade", "cash"];
items.forEach((name, i) => {
  const row = Math.floor(i / 4), col = i % 4, y = Math.round(row * 1024 / 3), next = Math.round((row + 1) * 1024 / 3);
  const crop = `384x${next - y}+${col * 384}+${y}`;
  magick(source("items"), "-crop", crop, "+repage", "-crop", silhouette(source("items"), crop), "+repage", "-resize", "240x204>", "-gravity", "center", "-background", "none", "-extent", "256x224", "-strip", "-quality", 88, output("items/" + name));
});
const plates = [
  { name: "actors/soldier", crop: "512x512+0+0", size: "232x354>" },
  { name: "actors/armored", crop: "488x512+512+0", size: "232x354>" },
  { name: "actors/drone", crop: "536x512+1000+0", size: "238x190>", hover: true },
  { name: "props/crate", crop: "512x512+0+512", size: "232x210>" },
  { name: "props/column", crop: "512x512+512+512", size: "230x366>" },
  { name: "props/terminal", crop: "512x512+1024+512", size: "232x245>" },
];
for (const plate of plates) {
  const args = [source("field-plates"), "-crop", plate.crop, "+repage", "-crop", silhouette(source("field-plates"), plate.crop), "+repage", "-resize", plate.size, "-background", "none"];
  if (plate.hover) args.push("-gravity", "center", "-extent", "256x336", "-gravity", "north", "-extent", "256x384");
  else args.push("-gravity", "south", "-extent", "256x370", "-gravity", "north", "-extent", "256x384");
  magick(...args, "-strip", "-quality", 90, output(plate.name));
}
magick(...plates.map((p) => output(p.name)), "+append", "-strip", "-quality", 90, output("field-plates"));
magick(source("weapon"), "-resize", "640x500!", "-strip", "-quality", 88, output("weapon"));
magick(source("field-plates"), "-crop", "280x260+130+0", "+repage", "-resize", "128x128^", "-gravity", "center", "-extent", "128x128", "-strip", "-quality", 88, output("operator"));
const inventory = [];
function walk(dir) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, entry.name); if (entry.isDirectory()) walk(p); else if (entry.name.endsWith(".webp")) inventory.push({ path: path.relative(root, p).replaceAll("\\", "/"), bytes: fs.statSync(p).size }); } }
walk(target);
const vectorFiles = fs.readdirSync(path.join(root, "assets/ui")).filter((name) => name.endsWith(".svg")).sort().map((name) => ({ path: "assets/ui/" + name, bytes: fs.statSync(path.join(root, "assets/ui", name)).size }));
fs.writeFileSync(path.join(root, "assets/art-manifest.json"), JSON.stringify({ version: 9, provenance: "Original images generated with imagegen; custom SVG UI authored for Cardkov. WebP derivatives encoded with ImageMagick.", files: inventory, vectorFiles }, null, 2) + "\n");
console.log(`Built ${inventory.length} WebP assets, ${(inventory.reduce((n, x) => n + x.bytes, 0) / 1024 / 1024).toFixed(2)} MiB.`);
