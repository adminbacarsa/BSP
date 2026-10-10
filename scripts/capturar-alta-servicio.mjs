/**
 * Alta desde padrón (pegado) y activar el servicio al continuar oct → nov.
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8291 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9291 node scripts/seed-alta-servicio-emu.mjs
 *   NEXT_PUBLIC_USE_EMULATOR=true npm --prefix apps/web2 run build
 *   PLANIF_EMU_PORTS=8080:8291,9099:9291 node scripts/capturar-alta-servicio.mjs
 * → docs/capturas-cobertura/alta-desde-padron.png y continuar-activa-servicio.png
 */
import { createRequire } from 'node:module';
import { renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirPlanificacion, shotsDir, sleep } from './planif-cdp-lib.mjs';

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8291';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9291';

const require = createRequire(fileURLToPath(new URL('../apps/web2/package.json', import.meta.url)));
const XLSX = require('xlsx');
const { initializeApp, getApps } = createRequire(fileURLToPath(new URL('../apps/functions/package.json', import.meta.url)))('firebase-admin/app');
const { getFirestore } = createRequire(fileURLToPath(new URL('../apps/functions/package.json', import.meta.url)))('firebase-admin/firestore');
if (!getApps().length) initializeApp({ projectId: 'comtroldata' });
const db = getFirestore();

function cuil(base10) {
  const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 10; i += 1) sum += Number(base10[i]) * w[i];
  const mod = sum % 11;
  const dig = mod === 0 ? '0' : mod === 1 ? '9' : String(11 - mod);
  return base10 + dig;
}

const fila = ['8801', 'QUIROGA', 'FABIAN', '30111222', cuil('2030111222'), 'fabian@ejemplo.test', '3510001111', 'Calle Falsa 123', 'Planta', 'Ops', 'Vigilador', 'Objetivo Norte', '02/01/1990', 'M', '', '', '01/03/2020', '', 'Activo'];
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([fila]), 'SP');
const padron = join(tmpdir(), 'padron-sintetico-cosp.xlsx');
XLSX.writeFile(wb, padron);

const { send, evaluate, waitFor, click, shot, cerrar } = await abrirPlanificacion({
  objectiveId: 'obj_alta',
  clientId: 'cli_alta',
  year: 2026,
  month: 10,
  prefijo: 'alta',
  port: Number(process.env.CAPTURA_PORT || 3024),
  devtoolsPort: Number(process.env.CAPTURA_DEVTOOLS || 9344),
});

const tsv = [
  'APELLIDO\tLEGAJO\t1\t2\t3',
  'SOSA PEDRO\t1001\tM\tM\tF',
  'QUIROGA FABIAN\t8801\tM\tT\tF',
].join('\n');

try {
  await waitFor(`document.querySelector('td[data-testid=grilla-celda]')`, 120000, 'grilla');
  await waitFor(`document.querySelector('[data-modo-rapido-toggle]')`, 30000, 'modo rápido');
  const ya = await evaluate(`document.querySelector('[data-modo-rapido-toggle]')?.getAttribute('data-modo-rapido-toggle') === '1'`);
  if (!ya) {
    await click(`document.querySelector('[data-modo-rapido-toggle]')`);
    await waitFor(`document.querySelector('[data-modo-rapido-capa]')`, 8000, 'modo rápido');
  }
  await evaluate(`document.querySelector('[data-plan-grilla]')?.focus()`);
  await sleep(300);
  await evaluate(`(() => { const dt = new DataTransfer(); dt.setData('text/plain', ${JSON.stringify(tsv)}); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
  await waitFor(`document.querySelector('[data-pegar-resumen]')`, 15000, 'resumen de pegado');
  await waitFor(`[...document.querySelectorAll('[data-pegar-alta]')].some((b) => (b.closest('li')?.innerText || '').includes('QUIROGA'))`, 20000, 'Dar de alta');
  await click(`[...document.querySelectorAll('[data-pegar-alta]')].find((b) => (b.closest('li')?.innerText || '').includes('QUIROGA'))`);
  await waitFor(`document.querySelector('[data-alta-archivo]')`, 15000, 'pedir padrón');
  const doc = await send('DOM.getDocument', { depth: 0 });
  const found = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '[data-alta-archivo]' });
  await send('DOM.setFileInputFiles', { nodeId: found.nodeId, files: [padron] });
  await waitFor(`document.querySelector('[data-alta-en-padron="1"]')`, 20000, 'encontrado en el padrón');
  await waitFor(`document.querySelector('[data-alta-confirmar]') && !document.querySelector('[data-alta-confirmar]').disabled`, 20000, 'confirmar habilitado');
  await shot('desde-padron');
  await click(`document.querySelector('[data-alta-confirmar]')`);
  await waitFor(`!document.querySelector('[data-alta-padron]') && ![...document.querySelectorAll('[data-pegar-alta]')].some((b) => (b.closest('li')?.innerText || '').includes('QUIROGA'))`, 25000, 'fila emparejada');
  const emp = await db.collection('empleados').where('fileNumber', '==', '8801').limit(1).get();
  if (emp.empty) throw new Error('El legajo 8801 no se escribió');
  const data = emp.docs[0].data();
  if (data.preferredObjectiveId !== 'obj_alta') throw new Error('El alta no quedó en el objetivo');
  if (String(data.cuil || '').length !== 11) throw new Error('CUIL incompleto');
  console.log('✓ emparejado', data.name, emp.docs[0].id);

  await click(`document.querySelector('[data-pegar-cancelar]')`);
  await waitFor(`!document.querySelector('[data-pegar-excel]')`, 10000, 'cerrar pegado');
  await click(`document.querySelector('[aria-label="Mes siguiente"]')`);
  await waitFor(`[...document.querySelectorAll('[title]')].some((el) => /noviembre/i.test(el.getAttribute('title') || ''))`, 20000, 'mes noviembre');
  await waitFor(`document.querySelector('[data-continuar-mes]') && !document.querySelector('[data-continuar-mes]').disabled`, 60000, 'continuar noviembre');
  await click(`document.querySelector('[data-continuar-mes]')`);
  await waitFor(`document.querySelector('[data-continuar-activar-check]')`, 60000, 'casilla activar');
  const tildada = await evaluate(`!!document.querySelector('[data-continuar-activar-check]')?.checked`);
  if (!tildada) throw new Error('La casilla de noviembre no arrancó tildada');
  await shot('tmp-activar');
  renameSync(join(shotsDir, 'alta-tmp-activar.png'), join(shotsDir, 'continuar-activa-servicio.png'));
  console.log('✓', join(shotsDir, 'continuar-activa-servicio.png'));
  await click(`document.querySelector('[data-continuar-aplicar]')`);
  await waitFor(`!document.querySelector('[data-continuar-mes-modal]')`, 30000, 'modal cerrado');
  let fin = '';
  for (let i = 0; i < 20; i += 1) {
    const sla = await db.collection('servicios_sla').doc('sla_alta').get();
    fin = String(sla.data()?.endDate || '').slice(0, 10);
    if (fin === '2026-11-30') break;
    await sleep(500);
  }
  if (fin !== '2026-11-30') throw new Error(`El SLA no se extendió a noviembre (fin ${fin})`);
  console.log('✓ SLA extendido hasta', fin);
} finally {
  await cerrar();
}

writeFileSync(new URL('./alta-servicio/.ok', import.meta.url), 'ok');
process.exit(0);
