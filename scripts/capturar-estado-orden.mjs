/**
 * Captura 1440x900 de Estado de cronogramas ordenado por Últ. modificación.
 *   PLANIF_EMU_PORTS=8080:8190,9099:9199 node scripts/capturar-estado-orden.mjs
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { abrirPlanificacion, shotsDir, sleep } from './planif-cdp-lib.mjs';

const { send, evaluate, waitFor, cerrar } = await abrirPlanificacion({
  objectiveId: '31DrJvGnD2pRSFiusxUf',
  clientId: '99yqpqc4ppY9rVXymWhx',
  year: 2026,
  month: 10,
  prefijo: 'estado-orden',
  port: Number(process.env.CAPTURA_PORT || 3014),
  devtoolsPort: Number(process.env.CAPTURA_DEVTOOLS || 9337),
  scriptInicial: `try { localStorage.removeItem('cosp-planif-cronogramas-orden'); } catch (e) {}`,
});

try {
  await waitFor(`(() => { const el = document.querySelector('button[aria-label="Cronogramas"]'); return el && Object.keys(el).some((k) => k.startsWith('__reactProps')); })()`, 90000, 'cronogramas hidratado');
  await sleep(400);
  await evaluate(`(() => {
    const el = document.querySelector('button[aria-label="Cronogramas"]');
    const key = Object.keys(el).find((k) => k.startsWith('__reactProps'));
    el[key].onClick();
  })()`);
  await waitFor(`(() => { const el = document.querySelector('[data-ordenar=modificacion]'); return el && Object.keys(el).some((k) => k.startsWith('__reactProps')) && !document.body.textContent.includes('Consultando Firestore'); })()`, 90000, 'tabla cargada');
  await sleep(400);
  const filas = await evaluate(`document.querySelectorAll('table[data-orden] tbody tr').length`);
  console.log('filas', filas);
  await evaluate(`(() => {
    const el = document.querySelector('[data-ordenar=modificacion]');
    const key = Object.keys(el).find((k) => k.startsWith('__reactProps'));
    el[key].onClick();
  })()`);
  await sleep(500);
  const orden = await evaluate(`document.querySelector('table[data-orden]')?.getAttribute('data-orden')`);
  const cabe = await evaluate(`document.querySelector('[data-ordenar=modificacion]')?.textContent`);
  const aria = await evaluate(`document.querySelector('[data-ordenar=modificacion]')?.closest('th')?.getAttribute('aria-sort')`);
  const rowspan = await evaluate(`document.querySelector('table[data-orden] tbody td[rowspan]') ? 'si' : 'no'`);
  console.log({ orden, cabe, aria, rowspan });
  if (orden !== 'modificacion:desc') throw new Error(`Orden ${orden}`);
  if (aria !== 'descending') throw new Error(`aria-sort ${aria}`);
  if (rowspan === 'si') throw new Error('Sigue combinando el cliente');
  await sleep(300);
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1440, height: 900, scale: 1 } });
  const file = join(shotsDir, 'estado-orden.png');
  writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.log('✓', file);
} finally {
  await cerrar();
}
