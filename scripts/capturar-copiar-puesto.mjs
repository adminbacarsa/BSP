/**
 * Capturas del copiado con puesto y de la ventana externa.
 * Emulador del padrón (8391/9391) y `next build` previo.
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
  port: 3035,
  devtoolsPort: 9365,
  scriptInicial: `try {
    localStorage.setItem('planif_emp_order', JSON.stringify({ obj_padron: ['emp_regalo', 'emp_perez', 'emp_sosa'] }));
    localStorage.setItem('cosp-planif-avisos-abierto', '1');
  } catch (e) {}`,
});

const { send, evaluate, waitFor, click, shot, cerrar } = sesion;

async function tecla(key, { ctrl = false, commands } = {}) {
  const modifiers = ctrl ? 2 : 0;
  const code = key.length === 1 ? `Key${key.toUpperCase()}` : key;
  const vk = key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0;
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: ctrl ? key : key.toLowerCase(),
    code,
    windowsVirtualKeyCode: vk,
    modifiers,
    ...(commands ? { commands } : {}),
  });
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: ctrl ? key : key.toLowerCase(),
    code,
    windowsVirtualKeyCode: vk,
    modifiers,
  });
  await sleep(400);
}

try {
  await waitFor(`document.querySelector('td[data-rc="0:0"]')`, 90000, 'celda de la grilla');
  for (let i = 0; i < 8; i++) {
    if (await evaluate(`!!document.querySelector('[data-modo-rapido-capa]')`)) break;
    await evaluate(`document.querySelector('[data-modo-rapido-toggle]')?.click()`);
    await sleep(600);
  }
  const estado = await evaluate(`document.querySelector('[data-modo-rapido-toggle]')?.getAttribute('data-modo-rapido-toggle')`);
  console.log('modo rápido', estado);
  await waitFor(`document.querySelector('[data-modo-rapido-capa]')`, 10000, 'capa modo rápido');
  const filas = await evaluate(`JSON.stringify([...document.querySelectorAll('[id^="plan-emp-"]')].slice(0, 4).map((el) => el.id))`);
  console.log('filas', filas);

  await click(`document.querySelector('td[data-rc="1:0"]')`);
  await tecla('c', { ctrl: true, commands: ['copy'] });
  const port = await evaluate(`localStorage.getItem('cosp-planif-portapapeles')`);
  console.log('portapapeles', String(port || '').slice(0, 240));
  await click(`document.querySelector('td[data-rc="0:6"]')`);
  await tecla('v', { ctrl: true, commands: ['paste'] });
  await waitFor(`/tomó un turno de Puesto 2/i.test(document.body.innerText)`, 15000, 'aviso de puesto');
  const celda = await evaluate(`(document.querySelector('td[data-rc="0:6"]')?.innerText || '').trim()`);
  console.log('celda destino', celda);
  if (!/M/.test(celda)) throw new Error(`La celda no quedó en M: ${celda}`);
  await evaluate(`document.querySelector('[aria-label="Cerrar bandas faltantes"]')?.click()`);
  await sleep(2500);
  await shot('copiar-puesto');

  await send('Page.navigate', { url: 'http://127.0.0.1:3035/admin/planificacion/crono-popout/?client=cli_padron&objective=obj_padron&month=2026-09&main=obj_padron' });
  await waitFor(`document.querySelectorAll('[data-ventana-fila]').length >= 2`, 90000, 'filas con turno');
  await waitFor(`/sin turno en este mes/i.test(document.body.innerText)`, 20000, 'colapsados sin turno');
  const orden = await evaluate(`JSON.stringify([...document.querySelectorAll('[data-ventana-fila]')].map((tr) => tr.getAttribute('data-ventana-fila')))`);
  console.log('orden ventana', orden);
  if (orden !== '["emp_regalo","emp_perez"]') throw new Error(`Orden inesperado: ${orden}`);
  await evaluate(`document.querySelector('[data-alineacion-opcion="semana"]')?.click()`);
  await sleep(400);
  const alineada = await evaluate(`document.querySelector('[data-ventana-externa]')?.getAttribute('data-alineacion')`);
  if (alineada !== 'semana') throw new Error(`Alineación: ${alineada}`);
  await click(`document.querySelector('[data-ventana-celda="0:0"]')`);
  await evaluate(`(() => {
    const el = document.querySelector('[data-ventana-celda="1:2"]');
    if (!el) return false;
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, shiftKey: true }));
    return true;
  })()`);
  await sleep(300);
  const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1440, height: 900, scale: 1 } });
  const file = join(shotsDir, 'ventana-externa.png');
  writeFileSync(file, Buffer.from(r.data, 'base64'));
  console.log('✓', file);
} finally {
  await cerrar();
}

console.log('listo', join(root, 'docs/capturas-cobertura'));
