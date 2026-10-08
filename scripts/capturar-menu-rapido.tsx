/** @jsxRuntime classic */
/** @jsx React.createElement */
/**
 * Capturas 1440x900 del menú rápido de cobertura (clic derecho en la grilla).
 * Antes: cd apps/web2 && npm run build
 *   npx tsx --tsconfig apps/web2/tsconfig.json scripts/capturar-menu-rapido.tsx
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import MenuRapidoCobertura, { CeldaMarcaMenuRapido } from '../apps/web2/src/components/planificacion/MenuRapidoCobertura';
import { opcionesMenuRapido, textoMarcaMenuRapido } from '../apps/web2/src/lib/planificacion/menuRapidoCobertura';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const require = createRequire(join(root, 'apps/web2/package.json'));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const outDir = join(root, 'docs/capturas-cobertura');
mkdirSync(outDir, { recursive: true });
const cssDir = join(root, 'apps/web2/out/_next/static/css');
if (!existsSync(cssDir)) throw new Error('Falta el CSS del export. Corré npm run build en apps/web2.');
const css = readdirSync(cssDir).filter((n) => n.endsWith('.css')).map((n) => readFileSync(join(cssDir, n), 'utf8')).join('\n');

function chromium(): string {
  if (process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  const base = join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  if (!existsSync(base)) throw new Error('No encuentro Chromium: definí CHROME_BIN.');
  const dirs = readdirSync(base).filter((d) => d.startsWith('chromium_headless_shell-') || d.startsWith('chromium-')).sort().reverse();
  for (const d of dirs) {
    for (const exe of ['chrome-win/headless_shell.exe', 'chrome-win/chrome.exe', 'chrome-win64/headless_shell.exe', 'chrome-win64/chrome.exe']) {
      const p = join(base, d, exe);
      if (existsSync(p)) return p;
    }
  }
  throw new Error('No encuentro Chromium en ms-playwright: definí CHROME_BIN.');
}

const noop = () => {};
const cubrir = opcionesMenuRapido({ esAusente: true, esHueco: false, cubiertoPorOps: false, puedeEditar: true });
const cronograma = [
  { id: 'ret', nombre: 'GUERRERO, Marcos', detalle: 'Retén', tag: 'Retén' },
  { id: 'esc', nombre: 'BOSIO, Ana', detalle: 'ESC', tag: 'ESC' },
  { id: 'ref', nombre: 'RIOS, Nicolás', detalle: 'REF', tag: 'REF' },
  { id: 'libre', nombre: 'FERRERO, Juan', detalle: 'Libre', tag: 'Libre' },
];
const fuera = [{ id: 'gale', nombre: 'GALEANO, Marta', detalle: 'Libre', tag: 'Libre' }];
const ext = [
  { id: 'gale', nombre: 'GALEANO, Marta', detalle: 'N · Puesto 1', tag: 'N' },
  { id: 'font', nombre: 'FONTANA, Luis', detalle: 'N · Puesto 2', tag: 'N' },
];
const adel = [
  { id: 'barr', nombre: 'BARROS, Luis', detalle: 'Elegido para adelantar', tag: 'T' },
  { id: 'rios', nombre: 'RIOS, Nicolás', detalle: 'T · Puesto 1', tag: 'T' },
];

function pagina(body: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body class="bg-slate-100">${body}</body></html>`;
}

const base = { x: 48, y: 48, opciones: cubrir, busqueda: '', onBusqueda: noop, onAsignar: noop, onExtAdel: noop, onAbrir: noop, onElegir: noop, onVolver: noop, onAplicar: noop, onClose: noop };

const shots: { file: string; html: string }[] = [
  {
    file: 'menu-rapido-asignar.png',
    html: pagina(renderToStaticMarkup(React.createElement(MenuRapidoCobertura, { ...base, paso: 'asignar', filas: cronograma, fuera }))),
  },
  {
    file: 'menu-rapido-ext-1.png',
    html: pagina(renderToStaticMarkup(React.createElement(MenuRapidoCobertura, { ...base, paso: 'ext', filas: ext, fuera: [] }))),
  },
  {
    file: 'menu-rapido-ext-2.png',
    html: pagina(renderToStaticMarkup(React.createElement(MenuRapidoCobertura, { ...base, paso: 'adel', filas: adel, fuera: [], extNombre: 'GALEANO, Marta', puedeAplicar: true }))),
  },
  {
    file: 'menu-rapido-celda.png',
    html: pagina(`<div class="p-16">${renderToStaticMarkup(React.createElement(CeldaMarcaMenuRapido, {
      codigo: 'AA',
      tooltip: textoMarcaMenuRapido({ modo: 'asignar', cubreA: 'ROSS, Carlos', tipo: 'RET', actor: 'Mauro', cuando: '08/10 09:30' }),
    }))}</div>`),
  },
];

const chrome = chromium();
for (const shot of shots) {
  const htmlPath = join(outDir, shot.file.replace(/\.png$/, '.html'));
  const pngPath = join(outDir, shot.file);
  writeFileSync(htmlPath, shot.html);
  execFileSync(chrome, ['--headless=new', '--disable-gpu', '--window-size=1440,900', '--screenshot=' + pngPath, htmlPath], { stdio: 'inherit' });
  console.log(pngPath);
}
