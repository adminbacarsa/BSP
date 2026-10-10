/**
 * Capturas 1440x900 del asistente, con el objetivo sintético del emulador (nombres de prueba).
 *   node scripts/importar-excel/preparar-emulator.mjs
 *   PLANIF_EMU_PORTS=8080:8291,9099:9291 node scripts/capturar-importar-excel.mjs
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { abrirPlanificacion, sleep } from './planif-cdp-lib.mjs';

const require = createRequire(fileURLToPath(new URL('../apps/web2/package.json', import.meta.url)));
const XLSX = require('xlsx');
const m = JSON.parse(readFileSync(new URL('./importar-excel/.manifest-captura.json', import.meta.url), 'utf8'));

const letras = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const dow = new Date(Date.UTC(2026, 9, 1)).getUTCDay();
const vacio = () => Array(6).fill('');
const filaDias = (valor) => {
  const row = vacio();
  for (let d = 1; d <= 31; d++) row.push(valor(d));
  return row;
};
const ciclo = ['M', 'M', 'M', 'M', 'M', 'F', 'F', 'T', 'T', 'T', 'T', 'T', 'F', 'F', 'N', 'N', 'N', 'N', 'N', 'F', 'F'];
const aoa = [
  [],
  [],
  [],
  ['BACAR', '', '', '', '', '', 'Objetivo Prueba'],
  [],
  filaDias((d) => letras[(dow + d - 1) % 7]),
  filaDias((d) => d),
  ['PEREZ JUAN', '', '', '', 1001, 'Puesto 1', ...ciclo.slice(0, 31).concat(Array(31).fill('M')).slice(0, 31)],
  ['GOMEZ ANA', '', '', '', 1002, 'Puesto 1', ...Array.from({ length: 31 }, (_, i) => ciclo[(i + 7) % ciclo.length])],
  ['NADIE AUSENTE', '', '', '', 9999, 'Puesto 1', ...Array.from({ length: 31 }, (_, i) => (i < 3 ? 'ART' : 'F'))],
  [],
  ['REFERENCIAS', '', '', '', '', '', '', '', 'M', 'Mañana', '', '', 'T', 'Tarde', '', '', 'N', 'Noche', '', '', 'F', 'Franco'],
  ['', '', '', '', '', '', '', '', '', '07 a 15 hs', '', '', '', '15 a 23 hs', '', '', '', '23 a 07 hs'],
  ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'OCTUBRE 2026'],
];
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Hoja1');
const xlsxPath = join(tmpdir(), 'planilla-prueba-octubre.xlsx');
XLSX.writeFile(wb, xlsxPath);

const { send, evaluate, waitFor, click, shot, cerrar } = await abrirPlanificacion({
  objectiveId: m.objectiveId,
  clientId: m.clientId,
  year: m.year,
  month: m.month,
  prefijo: 'importar-excel',
  port: Number(process.env.CAPTURA_PORT || 3025),
  devtoolsPort: Number(process.env.CAPTURA_DEVTOOLS || 9345),
});

try {
  await waitFor(`document.querySelector('[data-importar-excel]') && !document.querySelector('[data-importar-excel]').disabled`, 120000, 'botón importar');
  await evaluate(`document.querySelector('[data-importar-excel]').click()`);
  await waitFor(`document.querySelector('[data-importar-excel-modal]')`, 20000, 'modal');
  const doc = await send('DOM.getDocument', { depth: -1 });
  const input = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[data-importar-archivo]' });
  if (!input.nodeId) throw new Error('No está el input de archivo');
  await send('DOM.setFileInputFiles', { files: [xlsxPath], nodeId: input.nodeId });
  await waitFor(`document.querySelector('[data-import-paso="1"] input[type=checkbox]')`, 20000, 'cuadro detectado');
  await sleep(600);
  await shot('1-archivo');
  const seguir = async (hasta, nombre) => {
    await evaluate(`document.querySelector('[data-importar-siguiente]').click()`);
    await waitFor(hasta, 15000, nombre);
    await shot(nombre);
  };
  await seguir(`document.querySelector('[data-import-paso="2"]')`, '2-servicio');
  await seguir(`document.querySelector('[data-import-paso="3"]')`, '3-guardias');
  await seguir(`document.querySelector('[data-import-paso="4"]')`, '4-codigos');
  await seguir(`document.querySelector('[data-importar-resumen]')`, '5-vista');
  console.log(await evaluate(`document.querySelector('[data-importar-resumen]').innerText`));
  await evaluate(`document.querySelector('[data-importar-aplicar]').click()`);
  await waitFor(`!document.querySelector('[data-importar-excel-modal]')`, 15000, 'modal cerrado');
  await sleep(1500);
  await shot('6-borrador');
} finally {
  await cerrar();
}
process.exit(0);
