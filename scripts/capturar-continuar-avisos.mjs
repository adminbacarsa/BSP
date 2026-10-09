/**
 * Captura del modal «Continuar desde octubre» con los avisos juntos.
 *   PLANIF_EMU_PORTS=8080:8291,9099:9291 node scripts/capturar-continuar-avisos.mjs
 */
import { readFileSync } from 'node:fs';
import { abrirPlanificacion, sleep } from './planif-cdp-lib.mjs';

const m = JSON.parse(readFileSync(new URL('./continuar-mes/.manifest.json', import.meta.url), 'utf8'));
const [year, month] = m.mes.split('-').map(Number);

const { evaluate, waitFor, click, shot, cerrar } = await abrirPlanificacion({
  objectiveId: m.objectiveId,
  clientId: m.clientId,
  year,
  month,
  prefijo: 'continuar-mes',
  port: Number(process.env.CAPTURA_PORT || 3047),
  devtoolsPort: Number(process.env.CAPTURA_DEVTOOLS || 9381),
});

try {
  await waitFor(`document.querySelector('td[data-testid=grilla-celda]')`, 120000, 'grilla');
  await waitFor(`document.querySelector('[data-continuar-mes]') && !document.querySelector('[data-continuar-mes]').disabled`, 60000, 'botón habilitado');
  await sleep(1500);
  await click(`document.querySelector('[data-continuar-mes]')`);
  await waitFor(`document.querySelector('[data-continuar-mes-modal]')`, 90000, 'vista previa');
  await sleep(800);
  const texto = await evaluate(`document.querySelector('[data-continuar-avisos]')?.innerText || document.querySelector('[data-continuar-alertas]')?.innerText || ''`);
  console.log('AVISOS', texto);
  const ciclo = await evaluate(`[...document.querySelectorAll('[data-continuar-guardia]')].map((tr) => tr.innerText.replace(/\\s+/g,' ').slice(0, 180)).join('\\n')`);
  console.log('CICLOS', ciclo);
  await evaluate(`document.querySelector('[data-continuar-avisos]')?.scrollIntoView({ block: 'center' })`);
  await sleep(300);
  await shot('avisos');
} finally {
  await cerrar();
}
process.exit(0);
