/**
 * Vista agrupada: bandas abiertas de cada objetivo, y el contador después de cerrar una.
 *   PLANIF_EMU_PORTS=8080:8190,9099:9199 node scripts/capturar-grupo-cerrar.mjs
 *   PLANIF_EMU_PORTS=8080:8190,9099:9199 node scripts/capturar-grupo-cerrar.mjs --cerrado
 */
import { abrirPlanificacion, sleep } from './planif-cdp-lib.mjs';

const cerrado = process.argv.includes('--cerrado');
const { evaluate, waitFor, click, shot, cerrar } = await abrirPlanificacion({
  objectiveId: 'gc_ninos',
  clientId: 'gc_cli',
  year: 2026,
  month: 10,
  prefijo: 'grupo-cerrar',
  port: Number(process.env.CAPTURA_PORT || 3037),
  devtoolsPort: Number(process.env.CAPTURA_DEVTOOLS || 9369),
});

await waitFor(`document.getElementById('plan-emp-gc_benitez')`, 90000, 'grilla');
await sleep(600);
await click(`[...document.querySelectorAll('button')].find((b) => /niños|ninos|h\\. de/i.test(b.textContent || ''))`);
await waitFor(`[...document.querySelectorAll('button')].some((b) => /casa cerrar/i.test(b.textContent || ''))`, 8000, 'menú del grupo');
await click(`[...document.querySelectorAll('button')].find((b) => /casa cerrar/i.test(b.textContent || ''))`);
await waitFor(`document.querySelector('[data-cobertura-dia="2026-10-09"]')`, 15000, 'fila cobertura');
await sleep(500);
const celda = `document.querySelector('[data-cobertura-dia="2026-10-09"]')`;
const cuenta = await evaluate(`${celda}?.textContent || ''`);
console.log('contador', JSON.stringify(cuenta));
await evaluate(`${celda}?.scrollIntoView({inline:'center', block:'end'})`);
await click(celda);
await waitFor(`document.querySelector('[data-puestos-sin-cerrar]')`, 8000, 'puestos sin cerrar');
const bandas = await evaluate(`JSON.stringify([...document.querySelectorAll('[data-banda-abierta]')].map((el) => el.getAttribute('data-banda-abierta')))`);
console.log('bandas', bandas);
if (!cerrado) {
  await shot('bandas');
  await click(`[...document.querySelectorAll('button')].find((b) => /cerrar banda/i.test(b.textContent || ''))`);
  await waitFor(`document.querySelector('[data-selector-banda-grupo]')`, 8000, 'selector');
  await evaluate(`(() => { const s = document.querySelector('[data-selector-banda-grupo]'); s.size = s.options.length; return JSON.stringify([...s.options].map((o) => o.textContent)); })()`);
  await sleep(300);
  await shot('selector');
} else {
  await shot('contador');
}
await cerrar();
