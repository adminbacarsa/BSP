/**
 * Panel «Leído con IA» con A. TADICOR OCTUBRE.xlsx.
 * La captura usa la lectura simulada (localStorage) porque el build de emulador no llama a Gemini.
 * PLANIF_EMU_PORTS=8080:8291,9099:9291
 */
import { readFileSync } from 'node:fs';
import { abrirPlanificacion, root, sleep } from './planif-cdp-lib.mjs';
import { join } from 'node:path';

const archivo = 'C:/Users/Mauro/OneDrive/Desktop/2026/10 - Octubre/A. TADICOR OCTUBRE.xlsx';
const fixture = readFileSync(join(root, 'scripts/planilla-ia/tadicor-simulada.json'), 'utf8');
const { send, evaluate, waitFor, shot, cerrar } = await abrirPlanificacion({
  objectiveId: 'FA0p5IQ7ythf1GYpDJ58',
  clientId: 'fnIyU012zjkKEampkgGb',
  year: 2026,
  month: 10,
  prefijo: 'planilla-ia',
  port: 3042,
  devtoolsPort: 9382,
  scriptInicial: `localStorage.setItem('cosp-planilla-ia-fixture', ${JSON.stringify(fixture)});`,
});

try {
  await waitFor(`document.querySelector('[data-servicio-planilla]') && /Puesto 1/.test(document.body.innerText)`, 90000, 'grilla');
  await evaluate(`document.querySelector('[data-servicio-planilla]').click()`);
  await waitFor(`document.querySelector('[data-servicio-planilla-modal]')`, 20000, 'modal');
  const doc = await send('DOM.getDocument', { depth: -1 });
  const input = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[data-servicio-archivo]' });
  if (!input.nodeId) throw new Error('No está el input de la planilla');
  await send('DOM.setFileInputFiles', { files: [archivo], nodeId: input.nodeId });
  await waitFor(`document.querySelector('[data-planilla-ia-leer]')`, 30000, 'botón IA');
  await evaluate(`document.querySelector('[data-planilla-ia-leer]').click()`);
  await waitFor(`document.querySelector('[data-planilla-ia-resultado]')`, 20000, 'panel');
  await evaluate(`document.querySelector('[data-planilla-ia-resultado]').scrollIntoView({ block: 'start' })`);
  await sleep(400);
  const texto = await evaluate(`document.querySelector('[data-planilla-ia-resultado]').innerText`);
  console.log(String(texto).slice(0, 2500));
  if (!/Leído con IA/.test(String(texto))) throw new Error('no apareció el panel');
  if (!/coincidencia/.test(String(texto))) throw new Error('no marcó coincidencias');
  if (!/08:00/.test(String(texto))) throw new Error('no mostró el horario de Puesto 1');
  await shot('panel');
  await evaluate(`document.querySelector('[data-planilla-ia-aceptar-todas]')?.click()`);
  await sleep(300);
  await shot('aceptadas');
} finally {
  await cerrar();
}
console.log('listo');
