/**
 * Captura 1440x900 del chip de armado y de la columna (vista SuperAdmin).
 * Solo emulador. PLANIF_EMU_PORTS=8080:8190,9099:9199 node scripts/capturar-cronometro.mjs
 */
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { abrirPlanificacion, root, shotsDir, sleep } from './planif-cdp-lib.mjs';

const EMU = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8190';
if (EMU !== '127.0.0.1:8190') throw new Error(`Este script solo escribe en el emulador aislado, no en ${EMU}`);
process.env.FIRESTORE_EMULATOR_HOST = EMU;

const require = createRequire(join(root, 'apps/functions/package.json'));
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
if (!getApps().length) initializeApp({ projectId: 'comtroldata' });

const empresaId = 'pruebas_sa';
const objectiveId = '31DrJvGnD2pRSFiusxUf';
const docId = `${empresaId}_${objectiveId}_2026_10`;
const armado = {
  iniciadoAt: '2026-10-01T13:00:00.000Z',
  completadoAt: '2026-10-04T13:00:00.000Z',
  publicadoAt: '2026-10-03T16:00:00.000Z',
  minutosActivos: 42,
  minutosTranscurridos: 3 * 24 * 60,
  cambios: 12,
  usuarios: [{ uid: 'seed-admin', nombre: 'Admin' }],
  origen: 'MANUAL',
  correccionesPostPublicacion: 1,
  ultimaAccionAt: '2026-10-04T13:00:00.000Z',
};
await getFirestore().doc(`planificacion_estados/${docId}`).set({
  empresaId,
  objectiveId,
  objetivoId: objectiveId,
  year: 2026,
  month: 10,
  armado,
}, { merge: true });
console.log('armado en', docId);

const { send, evaluate, waitFor, cerrar } = await abrirPlanificacion({
  objectiveId,
  clientId: '99yqpqc4ppY9rVXymWhx',
  year: 2026,
  month: 10,
  prefijo: 'cronometro',
  port: Number(process.env.CAPTURA_PORT || 3022),
  devtoolsPort: Number(process.env.CAPTURA_DEVTOOLS || 9352),
  scriptInicial: `try { localStorage.removeItem('cosp-planif-cronogramas-orden'); } catch (e) {}`,
});

try {
  await waitFor(`(() => { const el = document.querySelector('[data-armado-chip]'); return el && el.textContent.includes('42 min activos'); })()`, 90000, 'chip de armado');
  await sleep(400);
  const chip = await evaluate(`document.querySelector('[data-armado-chip]')?.textContent`);
  console.log('chip', chip);
  if (!String(chip).includes('Armado:') || !String(chip).includes('3 días')) throw new Error(`Chip inesperado: ${chip}`);
  const shotChip = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1440, height: 900, scale: 1 } });
  const fileChip = join(shotsDir, 'cronometro-chip.png');
  writeFileSync(fileChip, Buffer.from(shotChip.data, 'base64'));
  console.log('✓', fileChip);

  await waitFor(`(() => { const el = document.querySelector('button[aria-label="Cronogramas"]'); return el && Object.keys(el).some((k) => k.startsWith('__reactProps')); })()`, 30000, 'botón cronogramas');
  await evaluate(`(() => {
    const el = document.querySelector('button[aria-label="Cronogramas"]');
    const key = Object.keys(el).find((k) => k.startsWith('__reactProps'));
    el[key].onClick();
  })()`);
  await waitFor(`(() => { const el = document.querySelector('[data-ordenar=armado]'); return el && !document.body.textContent.includes('Consultando Firestore'); })()`, 90000, 'columna Armado');
  await sleep(500);
  const cabe = await evaluate(`document.querySelector('[data-ordenar=armado]')?.textContent`);
  const fila = await evaluate(`document.querySelector('[data-armado-fila]')?.textContent`);
  console.log({ cabe, fila });
  if (!String(cabe).includes('Armado')) throw new Error(`Sin columna: ${cabe}`);
  if (!String(fila).includes('42 min activos')) throw new Error(`Fila sin armado: ${fila}`);
  const shotCol = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1440, height: 900, scale: 1 } });
  const fileCol = join(shotsDir, 'cronometro-columna.png');
  writeFileSync(fileCol, Buffer.from(shotCol.data, 'base64'));
  console.log('✓', fileCol);
} finally {
  await cerrar();
}
