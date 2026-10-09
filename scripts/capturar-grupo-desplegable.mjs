/**
 * Desplegable del grupo: cerrado, abierto y viendo un objetivo.
 *   PLANIF_EMU_PORTS=8080:8190,9099:9199 node scripts/capturar-grupo-desplegable.mjs
 */
import { abrirPlanificacion, sleep } from './planif-cdp-lib.mjs';

const { evaluate, waitFor, click, shot, cerrar } = await abrirPlanificacion({
  objectiveId: 'g2_ninos',
  clientId: 'g2_cli',
  year: 2026,
  month: 10,
  prefijo: 'grupo-desplegable',
  port: Number(process.env.CAPTURA_PORT || 3045),
  devtoolsPort: Number(process.env.CAPTURA_DEVTOOLS || 9379),
});

const tecla = (key) => evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }))`);

await waitFor(`document.getElementById('plan-emp-g2_escobar')`, 90000, 'grilla');
await sleep(500);
await click(`[...document.querySelectorAll('button')].find((b) => /h\\. de niños|h\\. de ninos/i.test(b.textContent || ''))`);
await waitFor(`[...document.querySelectorAll('button')].some((b) => /casa 2do/i.test(b.textContent || ''))`, 8000, 'menú del grupo');
await click(`[...document.querySelectorAll('button')].find((b) => /casa 2do/i.test(b.textContent || ''))`);
await waitFor(`document.querySelector('[data-grupo-vista]')`, 15000, 'botón del grupo');
await sleep(300);
const cerrado = await evaluate(`(() => {
  const b = document.querySelector('[data-grupo-vista]');
  const chips = [...document.querySelectorAll('button')].filter((x) => (x.textContent || '').trim() === 'Casa Mc Donalds');
  return JSON.stringify({ rotulo: b?.getAttribute('title') || '', alto: b ? Math.round(b.getBoundingClientRect().height) : 0, chips: chips.length, menu: !!document.querySelector('[data-grupo-vista-menu]') });
})()`);
console.log('cerrado', cerrado);
const c = JSON.parse(cerrado);
if (c.menu) throw new Error('El menú no debería estar abierto');
if (c.chips) throw new Error('Siguen los botones de objetivo en la barra');
if (!/casa 2do/i.test(c.rotulo) || c.rotulo.includes('›')) throw new Error(`Rótulo inesperado: ${c.rotulo}`);
if (c.alto !== 36) throw new Error(`Alto ${c.alto}, se esperaba 36 (h-9)`);
await shot('cerrado');

await click(`document.querySelector('[data-grupo-vista]')`);
await waitFor(`document.querySelector('[data-grupo-vista-menu]')`, 8000, 'menú abierto');
const opciones = await evaluate(`JSON.stringify([...document.querySelectorAll('[data-grupo-opcion]')].map((b) => b.textContent.replace(/\\s+/g, ' ').trim()))`);
console.log('opciones', opciones);
await shot('abierto');

await tecla('ArrowDown');
await sleep(150);
const foco = await evaluate(`document.querySelector('[data-grupo-foco="1"]')?.getAttribute('data-grupo-opcion') || ''`);
console.log('foco', foco);
if (foco !== 'g2_ninos') throw new Error(`La flecha no movió el foco: ${foco}`);
await tecla('Escape');
await sleep(200);
const cerro = await evaluate(`!document.querySelector('[data-grupo-vista-menu]')`);
if (!cerro) throw new Error('Esc no cerró el menú');

await click(`document.querySelector('[data-grupo-vista]')`);
await waitFor(`document.querySelector('[data-grupo-opcion="g2_ninos"]')`, 8000, 'opción niños');
await click(`document.querySelector('[data-grupo-opcion="g2_ninos"]')`);
await waitFor(`(document.querySelector('[data-grupo-vista]')?.getAttribute('title') || '').includes('›')`, 8000, 'rótulo con objetivo');
const objetivo = await evaluate(`document.querySelector('[data-grupo-vista]')?.getAttribute('title') || ''`);
console.log('objetivo', objetivo);
if (!objetivo.includes('H. de Niños')) throw new Error(`Rótulo sin el objetivo: ${objetivo}`);
await shot('objetivo');
await cerrar();
