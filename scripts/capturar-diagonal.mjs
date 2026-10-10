/** Diagonal del modo rápido. Mismos puertos que capturar-padron.mjs. */
import { abrirPlanificacion, sleep } from './planif-cdp-lib.mjs';

const { send, evaluate, waitFor, click, shot, cerrar, mouse, rectOf } = await abrirPlanificacion({
  objectiveId: 'obj_padron',
  clientId: 'cli_padron',
  year: 2026,
  month: 10,
  prefijo: 'modo-rapido',
  port: 3029,
  devtoolsPort: 9356,
});

try {
  await waitFor(`document.querySelector('td[data-rc="0:0"]')`, 90000, 'celda');
  const ya = await evaluate(`document.querySelector('[data-modo-rapido-toggle]')?.getAttribute('data-modo-rapido-toggle') === '1'`);
  if (!ya) await click(`document.querySelector('[data-modo-rapido-toggle]')`);
  await waitFor(`document.querySelector('[data-modo-rapido-capa]')`, 10000, 'capa');
  await click(`document.querySelector('td[data-rc="0:2"]')`);
  const a = await rectOf(`document.querySelector('td[data-rc="0:2"]')`);
  const b = await rectOf(`document.querySelector('td[data-rc="1:3"]')`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: b.x, y: b.y, button: 'left', clickCount: 1, buttons: 1, modifiers: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', clickCount: 1, buttons: 0, modifiers: 1 });
  await sleep(400);
  const marcas = await evaluate(`document.querySelectorAll('[data-modo-rapido-suelta]').length`);
  console.log('suelta', marcas, 'desde', a, 'hasta', b);
  await shot('diagonal');
  if (!marcas) throw new Error('La diagonal no marcó celdas');
} finally {
  await cerrar();
}
