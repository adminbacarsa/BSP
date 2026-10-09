/**
 * Tooltip único de la celda EV (el de 2 s, sin title nativo).
 *   PLANIF_EMU_PORTS=8080:8190,9099:9199 node scripts/capturar-tooltip-evento.mjs
 */
import { abrirPlanificacion, sleep } from './planif-cdp-lib.mjs';

const { evaluate, waitFor, hover, shot, cerrar, celda } = await abrirPlanificacion({
  objectiveId: 'oo_ninos',
  clientId: 'oo_cli',
  year: 2026,
  month: 10,
  prefijo: 'tooltip',
  port: Number(process.env.CAPTURA_PORT || 3035),
  devtoolsPort: Number(process.env.CAPTURA_DEVTOOLS || 9367),
});

const celdaEv = celda('oo_capdevila', 3);
await waitFor(`document.getElementById('plan-emp-oo_capdevila')`, 90000, 'grilla');
await waitFor(celdaEv, 20000, 'celda EV');
await sleep(400);
const titulo = await evaluate(`(() => { const el = ${celdaEv}; return el ? (el.getAttribute('title') || '') : 'NO'; })()`);
console.log('title nativo:', JSON.stringify(titulo));
await hover(celdaEv, 2600);
await waitFor(`document.querySelector('[data-tooltip-celda]')`, 4000, 'tooltip');
const texto = await evaluate(`document.querySelector('[data-tooltip-celda]')?.innerText || ''`);
console.log('tooltip:', texto);
await shot('evento');
await cerrar();
