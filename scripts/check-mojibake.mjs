/**
 * Detecta textos con codificación rota (UTF-8 leído como cp1252/Latin-1: «Ã³», «Ãš», «Â·», «â‰¥», «â"€»…)
 * en el código fuente. Sale con código 1 si encuentra alguno.
 *
 *   node scripts/check-mojibake.mjs            (npm run check:mojibake)
 *   node scripts/check-mojibake.mjs --fix      repara lo reparable (cp1252 → UTF-8) y vuelve a chequear
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['apps/functions/src', 'apps/web2/src', 'packages'];
const EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.css', '.html', '.md']);
const SKIP = new Set(['node_modules', 'lib', 'dist', 'dist-web', '.next', 'out', 'vendor', 'eventuales-shared']);
const fix = process.argv.includes('--fix');

// Segundo byte de una secuencia UTF-8 visto a través de cp1252 (0x80–0xBF): Latin-1 suplemento + los símbolos de cp1252.
const C2 = '[\\u0080-\\u00BF\\u20AC\\u201A\\u0192\\u201E\\u2026\\u2020\\u2021\\u02C6\\u2030\\u0160\\u2039\\u0152\\u017D\\u2018\\u2019\\u201C\\u201D\\u2022\\u2013\\u2014\\u02DC\\u2122\\u0161\\u203A\\u0153\\u017E\\u0178]';
const PATTERN = new RegExp(`(?:\\u00C3${C2}|[\\u00C2\\u00C5-\\u00DF]${C2}|[\\u00E0-\\u00EF]${C2}{2}|[\\u00F0-\\u00F7]${C2}{3})+`, 'g');
// Variantes ya «asciificadas» por algún editor (comillas tipográficas → ASCII) y UTF-8 leído como CP437 (consola Windows).
const LITERALS = [
  ['â"€', '─'], ["Ã'A", 'ÑA'],
  ['├í', 'á'], ['├®', 'é'], ['├¡', 'í'], ['├│', 'ó'], ['├║', 'ú'], ['├▒', 'ñ'], ['├ü', 'Á'], ['├ë', 'É'], ['├ì', 'Í'], ['├ô', 'Ó'], ['├Ü', 'Ú'], ['├æ', 'Ñ'],
  ['┬┐', '¿'], ['┬í', '¡'], ['┬À', '·'], ['ÔÇª', '…'], ['ÔÇö', '—'], ['ÔÇô', '–'], ['ÔÇ£', '“'], ['ÔÇØ', '”'], ['ÔåÆ', '→'],
];

const CP1252 = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87],
  [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91],
  [0x2019, 0x92], [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97], [0x02dc, 0x98],
  [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
]);

function repair(s) {
  const bytes = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    const b = CP1252.get(cp) ?? (cp < 0x100 ? cp : -1);
    if (b < 0) return s;
    bytes.push(b);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return s;
  }
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (EXT.has(path.extname(entry.name))) yield full;
  }
}

let total = 0;
const files = [];
for (const dir of DIRS) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) continue;
  for (const file of walk(abs)) {
    let text = fs.readFileSync(file, 'utf8');
    if (fix) {
      let fixed = text.replace(PATTERN, (m) => repair(m));
      for (const [bad, good] of LITERALS) fixed = fixed.split(bad).join(good);
      if (fixed !== text) {
        fs.writeFileSync(file, fixed);
        text = fixed;
      }
    }
    const hits = [];
    text.split('\n').forEach((line, i) => {
      PATTERN.lastIndex = 0;
      const m = PATTERN.exec(line) || LITERALS.map(([bad]) => (line.includes(bad) ? [bad] : null)).find(Boolean);
      if (m) hits.push(`${i + 1}: ${m[0]}  →  ${line.trim().slice(0, 100)}`);
    });
    if (hits.length) {
      total += hits.length;
      files.push(path.relative(ROOT, file));
      console.log(`${path.relative(ROOT, file)} (${hits.length})`);
      for (const h of hits.slice(0, 5)) console.log(`   ${h}`);
    }
  }
}

if (total > 0) {
  console.error(`\n✗ ${total} texto(s) con codificación rota en ${files.length} archivo(s). Reparar con: node scripts/check-mojibake.mjs --fix`);
  process.exit(1);
}
console.log('✓ Sin mojibake en', DIRS.join(', '));
