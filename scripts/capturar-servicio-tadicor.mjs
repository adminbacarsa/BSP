/**
 * Modal «Servicio desde la planilla» con A. TADICOR OCTUBRE.xlsx.
 * No guarda el servicio. PLANIF_EMU_PORTS=8080:8291,9099:9291
 */
import { abrirPlanificacion, sleep } from './planif-cdp-lib.mjs';

const archivo = 'C:/Users/Mauro/OneDrive/Desktop/2026/10 - Octubre/A. TADICOR OCTUBRE.xlsx';
const { send, evaluate, waitFor, shot, cerrar } = await abrirPlanificacion({
  objectiveId: 'FA0p5IQ7ythf1GYpDJ58',
  clientId: 'fnIyU012zjkKEampkgGb',
  year: 2026,
  month: 10,
  prefijo: 'servicio-tadicor',
  port: 3041,
  devtoolsPort: 9381,
});

try {
  await waitFor(`document.querySelector('[data-servicio-planilla]') && /Puesto 1/.test(document.body.innerText)`, 90000, 'grilla');
  await evaluate(`document.querySelector('[data-servicio-planilla]').click()`);
  await waitFor(`document.querySelector('[data-servicio-planilla-modal]')`, 20000, 'modal');
  const doc = await send('DOM.getDocument', { depth: -1 });
  const input = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[data-servicio-archivo]' });
  if (!input.nodeId) throw new Error('No está el input de la planilla');
  await send('DOM.setFileInputFiles', { files: [archivo], nodeId: input.nodeId });
  await waitFor(`document.querySelector('[data-servicio-propuesta]')`, 30000, 'propuesta');
  await sleep(500);
  const texto = await evaluate(`(() => {
    const modal = document.querySelector('[data-servicio-planilla-modal]');
    const inputs = [...modal.querySelectorAll('input')].map((el) => el.value).join(' ');
    return (modal.innerText || '') + '\\n' + inputs;
  })()`);
  console.log(String(texto).slice(0, 4000));
  if (/RELEVANTE ·/.test(String(texto))) throw new Error('RELEVANTE sigue como puesto');
  if (!/08:00/.test(String(texto)) || !/10:00/.test(String(texto))) throw new Error('no tomó el horario de la referencia');
  await shot('propuesta');
} finally {
  await cerrar();
}
console.log('listo');
