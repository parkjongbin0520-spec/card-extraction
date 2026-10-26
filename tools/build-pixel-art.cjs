/* Export newly drawn pixel sheets at their actual working resolution. Requires ImageMagick. */
"use strict";
const fs = require("node:fs"), path = require("node:path"), {execFileSync} = require("node:child_process");
const root = path.resolve(__dirname, ".."), target = path.join(root, "assets/pixel"), sourceDir = process.argv[2];
if (!sourceDir) throw Error("Usage: node tools/build-pixel-art.cjs /path/to/generated_images [--prototype]");
const sources = require("./pixel-sources.json"), prototype = process.argv.includes("--prototype");
const palette = ["#111719","#1c2527","#2b3536","#414c4b","#59645f","#798479","#9da899","#c4c9ad","#e6ddbc","#303a2d","#46523b","#64724b","#899763","#b1b87c","#433e32","#635744","#8b7655","#b29a70","#4b3431","#785047","#a66b50","#d69a58","#efd18b","#63848b"];
for (const dir of ["", "actors", "props", "items", "cards"]) fs.mkdirSync(path.join(target, dir), {recursive:true});
fs.writeFileSync(path.join(target, "palette.json"), JSON.stringify(palette, null, 2) + "\n");
const magick = (...args) => execFileSync("magick", args.map(String), {stdio:"pipe"});
const source = (key) => sources[key] && path.join(sourceDir, sources[key]);
const output = (name) => path.join(target, name + ".png");
const palettePath = path.join(require("node:os").tmpdir(), "cardkov-pixel-palette.png");
magick(...palette.flatMap(color => ["-size", "1x1", "xc:" + color]), "+append", "PNG8:" + palettePath);
const encode = (args, name, colors = 24) => magick(...args, "-write", "mpr:original", "-alpha", "off", "-channel", "RGB", "-dither", "None", "-colors", colors, "-remap", palettePath, "+channel", "(", "mpr:original", "-alpha", "extract", ")", "-compose", "CopyOpacity", "-composite", "-strip", "-define", "png:compression-level=9", "PNG32:" + output(name));
const dimensions = (file) => magick("identify", "-format", "%w %h", file).toString().trim().split(" ").map(Number);
const cell = (file, column, row, columns, rows) => {
  const [w,h] = dimensions(file), x = Math.round(column*w/columns), y = Math.round(row*h/rows);
  return `${Math.round((column+1)*w/columns)-x}x${Math.round((row+1)*h/rows)-y}+${x}+${y}`;
};
const cutout = (file, crop, fit, extent) => [file, "-crop", crop, "+repage", "-channel", "A", "-threshold", "50%", "+channel", "-trim", "+repage", "-filter", "point", "-resize", fit, "-background", "none", ...extent];
for (const name of ["menu", "base", "environment-0", "environment-1", "environment-2"]) {
  if (!source(name)) { if (prototype) continue; throw Error("Missing source: " + name); }
  encode([source(name), "-filter", "point", "-resize", "480x270^", "-gravity", "center", "-extent", "480x270"], name);
}
const plates = [
  {name:"actors/soldier",fit:"44x66>"}, {name:"actors/armored",fit:"44x66>"},
  {name:"actors/drone",fit:"44x32>",hover:true}, {name:"props/crate",fit:"44x36>"},
  {name:"props/column",fit:"34x68>"}, {name:"props/terminal",fit:"44x46>"},
];
if (source("plates")) {
  plates.forEach((plate, i) => {
    const extent = plate.hover ? ["-gravity","center","-extent","48x66","-gravity","north","-extent","48x72"] : ["-gravity","south","-extent","48x69","-gravity","north","-extent","48x72"];
    encode(cutout(source("plates"), sources.plateCrops?.[i] || cell(source("plates"), i%3, Math.floor(i/3), 3, 2), plate.fit, extent), plate.name, 12);
  });
  magick(...plates.map(p=>output(p.name)), "+append", "-strip", "PNG8:" + output("field-plates"));
  encode([output("actors/soldier"), "-crop", "32x32+8+0", "+repage"], "operator", 12);
}
const items = ["rifle","carbine","pistol","vest","heavyVest","backpack","largePack","scrap","circuit","medkit","grenade","cash"];
if (source("items")) items.forEach((name,i)=>encode(cutout(source("items"),sources.itemCrops?.[i] || cell(source("items"),i%4,Math.floor(i/4),4,3),"28x28>",["-gravity","center","-extent","32x32"]),"items/"+name,12));
const cards = ["shot","burst","guard","scan","heal","pierce","grenade","surge","suppress","breach","fieldAid","bulwark"];
if (source("cards")) cards.forEach((name,i)=>encode([source("cards"),"-crop",sources.cardCrops?.[i] || cell(source("cards"),i%4,Math.floor(i/4),4,3),"+repage","-filter","point","-resize","96x64","-gravity","center","-background","#1c2527","-extent","96x64"],"cards/"+name));
if (source("weapon")) encode([source("weapon"),"-channel","A","-threshold","50%","+channel","-filter","point","-resize","160x125!"],"weapon",16);
const files=[];
function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);else if(entry.name.endsWith(".png")){const [width,height]=dimensions(file);files.push({path:path.relative(root,file).replaceAll("\\","/"),width,height,bytes:fs.statSync(file).size});}}}
walk(target);
if (!prototype && files.length !== 38) throw Error(`Expected 38 PNG assets; got ${files.length}`);
const vectorFiles=fs.readdirSync(path.join(root,"assets/ui")).filter(name=>name.endsWith(".svg")).sort().map(name=>({path:"assets/ui/"+name,bytes:fs.statSync(path.join(root,"assets/ui",name)).size}));
fs.writeFileSync(path.join(root,"assets/art-manifest.json"),JSON.stringify({version:10,style:"simplified-military-pixel",provenance:"New pixel artwork generated with imagegen, exported at native pixel resolution with a common24-color palette. Existing photographic artwork is not used as input.",palette,units:{actor:[48,72],foot:69,item:[32,32],card:[96,64],background:[480,270],weapon:[160,125],portrait:[32,32]},files,vectorFiles},null,2)+"\n");
console.log(`Built ${files.length} native PNG assets, ${(files.reduce((n,x)=>n+x.bytes,0)/1024).toFixed(1)} KiB.`);
