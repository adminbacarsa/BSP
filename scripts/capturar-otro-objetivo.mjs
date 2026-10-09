/**
 * Vista agrupada: celda oscura de un objetivo que no es del grupo, y el aviso al asignar.
 *   PLANIF_EMU_PORTS=8080:8190,9099:9199 node scripts/capturar-otro-objetivo.mjs
 */
import { abrirPlanificacion, sleep } from './planif-cdp-lib.mjs';

const { evaluate, waitFor, click, shot, cerrar } = await abrirPlanificacion({
  objectiveId: 'oo_ninos',
  clientId: 'oo_cli',
  year: 2026,
  month: 10,
  prefijo: 'otro-objetivo',
  port: Number(process.env.CAPTURA_PORT || 3033),
  devtoolsPort: Number(process.env.CAPTURA_DEVTOOLS || 9365),
});

await waitFor(`document.getElementById('plan-emp-oo_capdevila')`, 90000, 'grilla');
await sleep(800);
await click(`[...document.querySelectorAll('button')].find((b) => /niños oo|ninos oo|h\\. de niños oo/i.test(b.textContent || ''))`);
await waitFor(`[...document.querySelectorAll('button')].some((b) => /casa ronald oo/i.test(b.textContent || ''))`, 8000, 'menú del grupo');
await click(`[...document.querySelectorAll('button')].find((b) => /casa ronald oo/i.test(b.textContent || ''))`);
await waitFor(`document.querySelector('#plan-emp-oo_capdevila')?.closest('tr')?.querySelector('td[title*="Turno en"]')`, 15000, 'celda de otro objetivo');
await sleep(500);
const celdas = await evaluate(`JSON.stringify([...document.querySelectorAll('#plan-emp-oo_capdevila')].flatMap((el) => [...(el.closest('tr')?.querySelectorAll('td[title]') || [])]).map((td) => td.getAttribute('title')).filter(Boolean).slice(0, 8))`);
console.log(celdas);
await shot('grilla');
await click(`document.querySelector('#plan-emp-oo_capdevila')?.closest('tr')?.querySelector('td[title*="Turno en"]')`);
await waitFor(`[...document.querySelectorAll('[data-sonner-toast]')].some((t) => /tiene turno en/i.test(t.textContent || ''))`, 8000, 'aviso');
await shot('aviso');
await cerrar();
