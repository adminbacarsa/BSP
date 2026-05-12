#!/usr/bin/env node
/**
 * Genera un PDF de informe ejecutivo a partir de JSON.
 * Uso:
 *   npm install
 *   node generate.mjs
 *   node generate.mjs --input ruta/al/informe.json --out salida.pdf
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildPdf } from "./render/buildPdf.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--input" && argv[i + 1]) {
      out.input = argv[++i];
    } else if (argv[i] === "--out" && argv[i + 1]) {
      out.out = argv[++i];
    }
  }
  return out;
}

const args = parseArgs(process.argv);
const inputPath = path.resolve(args.input || path.join(__dirname, "data", "informe-sample.json"));
const outPath = path.resolve(args.out || path.join(__dirname, "out", "Informe_Directorio_moderno.pdf"));

if (!fs.existsSync(inputPath)) {
  console.error(`No se encontró: ${inputPath}`);
  process.exit(1);
}

const dir = path.dirname(outPath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const data = JSON.parse(fs.readFileSync(inputPath, "utf8"));
/** Carpetas donde buscar `coverImage`, `logo`, etc.: primero el proyecto pdf-elaborador, luego la carpeta del JSON. */
const toolRoot = __dirname;
const jsonDir = path.dirname(inputPath);

const roots = [toolRoot, jsonDir];
let coverFound = null;
for (const rel of [data.meta?.coverImage, "assets/cover-hero.png"].filter(Boolean)) {
  for (const root of roots) {
    const p = path.isAbsolute(rel) ? rel : path.resolve(root, rel);
    if (fs.existsSync(p)) {
      coverFound = p;
      break;
    }
  }
  if (coverFound) break;
}

buildPdf(data, outPath, { assetRoots: roots })
  .then((p) => {
    console.log(`PDF generado: ${p}`);
    console.log(`Búsqueda de recursos en: ${toolRoot} y en la carpeta del JSON.`);
    console.log(`Portada con imagen: ${coverFound ? `sí (${coverFound})` : "no — sólo arte vectorial (revisá coverImage / assets/cover-hero.png)"}`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
