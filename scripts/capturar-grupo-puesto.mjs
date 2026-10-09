/**
 * Vista agrupada: cada fila muestra puesto y objetivo.
 *   PLANIF_EMU_PORTS=8080:8190,9099:9199 node scripts/capturar-grupo-puesto.mjs
 */
import { abrirPlanificacion, sleep } from './planif-cdp-lib.mjs';

const { evaluate, waitFor, click, shot, cerrar } = await abrirPlanificacion({
  objectiveId: 'gp_ninos',
  clientId: 'gp_cli',
  year: 2026,
  month: 10,
  prefijo: 'grupo',
  port: Number(process.env.CAPTURA_PORT || 3031),
  devtoolsPort: Number(process.env.CAPTURA_DEVTOOLS || 9363),
});

await waitFor(`document.getElementById('plan-emp-gp_internado')`, 90000, 'grilla');
await sleep(800);
await click(`[...document.querySelectorAll('button')].find((b) => /niños|ninos|h\\. de/i.test(b.textContent || ''))`);
await waitFor(`[...document.querySelectorAll('button')].some((b) => /casa ronald/i.test(b.textContent || ''))`, 8000, 'menú del grupo');
await click(`[...document.querySelectorAll('button')].find((b) => /casa ronald/i.test(b.textContent || ''))`);
await waitFor(`document.querySelector('[data-fila-puesto]')`, 15000, 'chip de puesto');
await sleep(600);
const filas = await evaluate(`JSON.stringify([...document.querySelectorAll('[data-fila-puesto]')].map((el) => ({ puesto: el.getAttribute('data-fila-puesto'), objetivo: el.getAttribute('data-fila-objetivo'), title: el.getAttribute('title') })))`);
console.log(filas);
await shot('puesto');
await cerrar();
