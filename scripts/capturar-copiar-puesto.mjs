/**
 * Capturas del copiado con puesto y de la ventana externa.
 * Emulador del padrón (8391/9391) y next build previo.
 * PLANIF_EMU_PORTS=8080:8391,9099:9391
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { abrirPlanificacion, root, shotsDir, sleep } from './planif-cdp-lib.mjs';

const sesion = await abrirPlanificacion({
  objectiveId: 'obj_padron',
  clientId: 'cli_padron',
  year: 2026,
  month: 10,
  prefijo: 'modo-rapido',
  port: 3034,
  devtoolsPort: 9364,
  scriptInicial: `try {
    localStorage.setItem('planif_emp_order', JSON.stringify({ obj_padron: ['emp_regalo', 'emp_perez', 'emp_sosa'] }));
    localStorage.setItem('cosp-planif-avisos-abierto', '1');
  } catch (e) {}`,
});

const { send, evaluate, waitFor, click, shot, cerrar } = sesion;

try {
  await waitFor(`document.querySelector('td[data-rc="0:0"]')`, 90000, 'celda de la grilla');
  for (let i = 0; i < 8; i++) {
    if (await evaluate(`!!document.querySelector('[data-modo-rapido-capa]')`)) break;
    await evaluate(`document.querySelector('[data-modo-rapido-toggle]')?.click()`);
    await sleep(500);
  }
  await waitFor(`document.querySelector('[data-modo-rapido-capa]')`, 10000, 'capa modo rápido');
  const nombres = await evaluate(`JSON.stringify([...document.querySelectorAll('tr')].map((tr) => (tr.innerText || '').split('\\n')[0]).filter((t) => /PEREZ|SOSA|REGALO/.test(t)))`);
  console.log('filas', nombres);
  await click(`document.querySelector('td[data-rc="1:0"]')`);
  const tsv = await evaluate(`(() => {
    const dt = new DataTransfer();
    document.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: dt }));
    return dt.getData('text/plain');
  })()`);
  console.log('tsv', tsv);
  await click(`document.querySelector('td[data-rc="0:6"]')`);
  await evaluate(`(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'M');
    document.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
  })()`);
  await waitFor(`/tomó un turno de Puesto 2/i.test(document.body.innerText)`, 15000, 'aviso de puesto');
  const celda = await evaluate(`(document.querySelector('td[data-rc="0:6"]')?.innerText || '').trim()`);
  console.log('celda destino', celda);
  if (!/M/.test(celda)) throw new Error(`La celda no quedó en M: ${celda}`);
  await shot('copiar-puesto');

  await send('Page.navigate', { url: 'http://127.0.0.1:3034/admin/planificacion/crono-popout/?client=cli_padron&objective=obj_padron&month=2026-10&main=obj_padron' });
  await waitFor(`document.querySelector('[data-ventana-grilla]')`, 90000, 'grilla de la ventana');
  await waitFor(`/sin turno en este mes/i.test(document.body.innerText)`, 20000, 'colapsados sin turno');
  const orden = await evaluate(`JSON.stringify([...document.querySelectorAll('[data-ventana-fila]')].map((tr) => tr.getAttribute('data-ventana-fila')))`);
  console.log('orden ventana', orden);
  if (orden !== '["emp_perez","emp_sosa"]') throw new Error(`Orden inesperado: ${orden}`);
  await evaluate(`document.querySelector('[data-alineacion-opcion="semana"]')?.click()`);
  await sleep(400);
  await click(`document.querySelector('[data-ventana-celda="0:0"]')`);
  await sleep(300);
  const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1440, height: 900, scale: 1 } });
  const file = join(shotsDir, 'ventana-externa.png');
  writeFileSync(file, Buffer.from(r.data, 'base64'));
  console.log('✓', file);
} finally {
  await cerrar();
}

console.log('listo', join(root, 'docs/capturas-cobertura'));
