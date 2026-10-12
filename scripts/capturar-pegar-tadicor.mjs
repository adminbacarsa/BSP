/**
 * Pegado de A. TADICOR OCTUBRE.xlsx en el cronograma de Tadicor (modo rápido).
 * P1 M / P2 T se resuelven al puesto del servicio; no preguntan otro objetivo.
 * PLANIF_EMU_PORTS=8080:8291,9099:9291
 */
import { createRequire } from 'node:module';
import { abrirPlanificacion } from './planif-cdp-lib.mjs';

const require = createRequire(new URL('../apps/web2/package.json', import.meta.url));
const XLSX = require('xlsx');
const wb = XLSX.readFile('C:/Users/Mauro/OneDrive/Desktop/2026/10 - Octubre/A. TADICOR OCTUBRE.xlsx');
const rows = XLSX.utils.sheet_to_json(wb.Sheets.Hoja1, { header: 1, raw: false, defval: '' });
const tsv = rows.map((r) => r.join('\t')).join('\n');

const sesion = await abrirPlanificacion({
  objectiveId: 'FA0p5IQ7ythf1GYpDJ58',
  clientId: 'fnIyU012zjkKEampkgGb',
  year: 2026,
  month: 10,
  prefijo: 'pegar-tadicor',
  port: 3039,
  devtoolsPort: 9379,
});
const { evaluate, waitFor, click, shot, cerrar } = sesion;

try {
  await waitFor(`document.querySelector('[data-modo-rapido-toggle]') && /Puesto 1/.test(document.body.innerText)`, 90000, 'servicio del mes');
  if (await evaluate(`document.querySelector('[data-modo-rapido-toggle]')?.getAttribute('data-modo-rapido-toggle') !== '1'`)) {
    await evaluate(`document.querySelector('[data-modo-rapido-toggle]')?.click()`);
  }
  await waitFor(`document.querySelector('[data-modo-rapido-capa]')`, 15000, 'capa');
  await evaluate(`document.querySelector('[data-pegar-excel-abrir]')?.click()`);
  await waitFor(`document.querySelector('[data-pegar-texto]')`, 10000, 'pegar');
  await evaluate(`(() => {
    const el = document.querySelector('[data-pegar-texto]');
    const d = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    d.set.call(el, ${JSON.stringify(tsv)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await evaluate(`document.querySelector('[data-pegar-revisar]')?.click()`);
  await waitFor(`document.querySelector('[data-pegar-excel]') && /Pegadas/.test(document.querySelector('[data-pegar-excel]').innerText)`, 30000, 'resumen');
  const texto = await evaluate(`document.querySelector('[data-pegar-excel]')?.innerText || ''`);
  const filas = await evaluate(`[...document.querySelectorAll('[data-pegar-ajeno-fila]')].map((el) => el.getAttribute('data-pegar-ajeno-fila'))`);
  console.log('filas ajenas', filas);
  console.log(texto.slice(0, 2500));
  const mal = (filas || []).filter((m) => /^(P\d+|PL)\b/i.test(String(m || '')));
  if (mal.length) throw new Error(`P1/P2/PL siguen como otro objetivo: ${mal.join(', ')}`);
  const desconocidos = (texto.match(/códigos desconocidos \(([^)]*)\)/) || [])[1] || '';
  if (/\bP\d+\s*[MTN]\b|\bPL\s*[MTN]\b|\bP\d+[MTN]\b/.test(desconocidos)) {
    throw new Error(`P1/P2 siguen desconocidos: ${desconocidos}`);
  }
  await shot('puestos');
} finally {
  await cerrar();
}
console.log('listo');
