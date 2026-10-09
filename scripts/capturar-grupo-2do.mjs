/**
 * Lista mezclada del 2.º tramo y el contador 2/2 después de aplicar.
 *   PLANIF_EMU_PORTS=8080:8190,9099:9199 node scripts/capturar-grupo-2do.mjs
 */
import { abrirPlanificacion, sleep } from './planif-cdp-lib.mjs';

const { evaluate, waitFor, click, shot, cerrar, celda } = await abrirPlanificacion({
  objectiveId: 'g2_ninos',
  clientId: 'g2_cli',
  year: 2026,
  month: 10,
  prefijo: 'grupo-2do-tramo',
  port: Number(process.env.CAPTURA_PORT || 3043),
  devtoolsPort: Number(process.env.CAPTURA_DEVTOOLS || 9377),
});

await waitFor(`document.getElementById('plan-emp-g2_escobar')`, 90000, 'grilla');
await sleep(600);
await click(`[...document.querySelectorAll('button')].find((b) => /h\\. de niños|h\\. de ninos/i.test(b.textContent || ''))`);
await waitFor(`[...document.querySelectorAll('button')].some((b) => /casa 2do/i.test(b.textContent || ''))`, 8000, 'menú del grupo');
await click(`[...document.querySelectorAll('button')].find((b) => /casa 2do/i.test(b.textContent || ''))`);
await waitFor(`document.querySelector('[data-cobertura-dia="2026-10-09"]')`, 15000, 'fila cobertura');
await sleep(400);
const antes = await evaluate(`document.querySelector('[data-cobertura-dia="2026-10-09"]')?.textContent || ''`);
console.log('contador antes', JSON.stringify(antes));

await click(celda('g2_escobar', 9));
await waitFor(`[...document.querySelectorAll('button')].some((b) => (b.textContent || '').trim().toLowerCase() === 'cambiar')`, 8000, 'preview de la celda');
await click(`[...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim().toLowerCase() === 'cambiar')`);
await waitFor(`document.querySelector('[data-extender-jornada]')`, 8000, 'extender jornada');
await click(`document.querySelector('[data-extender-jornada]')`);
await waitFor(`document.querySelector('[data-lista-segundo]')`, 8000, 'lista 2.º');
await sleep(400);
const filas = await evaluate(`JSON.stringify([...document.querySelectorAll('[data-segundo-guardia]')].map((b) => b.textContent.trim()))`);
console.log('lista', filas);
const nombres = JSON.parse(filas);
if (!nombres.some((t) => /niños|ninos/i.test(t)) || !nombres.some((t) => /casa/i.test(t))) {
  throw new Error(`La lista no mezcla los dos objetivos: ${filas}`);
}
if (nombres.some((t) => /ajeno/i.test(t))) throw new Error('Entró un guardia de afuera del grupo');
await evaluate(`document.querySelector('[data-lista-segundo]')?.scrollIntoView({block:'center'})`);
await shot('lista');

await click(`document.querySelector('[data-segundo-guardia="g2_navarro"]')`);
await click(`[...document.querySelectorAll('button')].find((b) => /cerrar banda/i.test(b.textContent || ''))`);
await waitFor(`(document.querySelector('[data-cobertura-dia="2026-10-09"]')?.textContent || '').includes('2/2')`, 8000, 'contador 2/2');
await evaluate(`(() => {
  const el = document.querySelector('[data-cobertura-dia="2026-10-09"]');
  const scroller = document.querySelector('[data-plan-grilla]');
  if (!el || !scroller) return;
  const sticky = scroller.querySelector('.planning-dotacion');
  const borde = sticky ? sticky.getBoundingClientRect().right + 24 : 280;
  scroller.scrollLeft += el.getBoundingClientRect().left - borde;
})()`);
await shot('aplicado');
const despues = await evaluate(`document.querySelector('[data-cobertura-dia="2026-10-09"]')?.textContent || ''`);
console.log('contador despues', JSON.stringify(despues));
await cerrar();
