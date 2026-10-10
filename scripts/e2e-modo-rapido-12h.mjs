#!/usr/bin/env node
/**
 * Modo rápido sobre la copia de Obrador Malagueño (octubre): + cierra 1/2 → 2/2,
 * la pastilla de avisos y el selector de novedad. Solo emulador 8190.
 *
 *   node scripts/copiar-obrador-emulator.mjs
 *   next build
 *   PLANIF_EMU_PORTS=8080:8190,9099:9199 FIRESTORE_EMULATOR_HOST=127.0.0.1:8190 node scripts/e2e-modo-rapido-12h.mjs
 */
import { readFileSync } from 'node:fs';
import { abrirPlanificacion, sleep } from './planif-cdp-lib.mjs';

if (!process.env.PLANIF_EMU_PORTS) process.env.PLANIF_EMU_PORTS = '8080:8190,9099:9199';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8190') throw new Error('Solo contra el emulador aislado 127.0.0.1:8190');

const manifest = JSON.parse(readFileSync('scripts/.obrador-manifest.json', 'utf8'));
const sesion = await abrirPlanificacion({
  objectiveId: manifest.objectiveId,
  clientId: manifest.clientId,
  year: 2026,
  month: 9,
  prefijo: 'modo-rapido',
  port: Number(process.env.CAPTURA_PORT || 3025),
  devtoolsPort: Number(process.env.CAPTURA_DEVTOOLS || 9365),
  scriptInicial: 'window.confirm = () => true;',
});
const { send, evaluate, waitFor, click, shot, cerrar } = sesion;
const fail = (msg) => { console.error('✗', msg); process.exitCode = 1; };

await waitFor(`document.querySelector('[data-plan-grilla]')`, 120000, 'grilla de Obrador');
await sleep(2500);

const correccion = await evaluate(`!!document.querySelector('button[title^="Modo Corrección"]')`);
if (correccion) {
  await click(`document.querySelector('button[title^="Modo Corrección"]')`);
  await sleep(400);
}
await click(`document.querySelector('[data-modo-rapido-toggle]')`);
await waitFor(`document.querySelector('[data-modo-rapido-capa]')`, 8000, 'capa del modo rápido');
await sleep(500);

const hueco = await evaluate(`(() => {
  const celdas = [...document.querySelectorAll('td[data-cobertura-dia]')];
  const abierta = celdas.find((td, col) => {
    const m = (td.textContent || '').trim().match(/^(\\d+)\\/(\\d+)$/);
    if (!m || Number(m[1]) >= Number(m[2])) return false;
    const codigos = [...document.querySelectorAll('td[data-rc]')].filter((c) => (c.dataset.rc || '').endsWith(':' + col)).map((c) => (c.innerText || '').trim()).filter(Boolean);
    return codigos.some((t) => /\\b(M|T|N|D12|N12)\\b/.test(t));
  });
  if (!abierta) return null;
  abierta.focus();
  return { dia: abierta.dataset.coberturaDia, antes: abierta.textContent.trim() };
})()`);
console.log('hueco', hueco);
if (!hueco) fail('no hay un día con puestos sin cerrar');

async function mas() {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: '+', code: 'NumpadAdd', windowsVirtualKeyCode: 107, text: '+' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: '+', code: 'NumpadAdd', windowsVirtualKeyCode: 107 });
}
await mas();
await sleep(600);
const propuesta = await evaluate(`document.querySelector('[data-cierre-12h-texto]')?.textContent || ''`);
const aviso = await evaluate(`[...document.querySelectorAll('[data-sonner-toast], li[data-sonner-toast]')].map((n) => n.innerText).join(' | ')`);
console.log('propuesta', propuesta, 'toast', aviso);
if (!propuesta.includes('Cubre la')) fail('la tecla + no propuso el cierre de 12 h');
await shot('12h-propuesta');

await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
await sleep(800);
const despues = await evaluate(`document.querySelector('td[data-cobertura-dia="${hueco?.dia || ''}"]')?.textContent?.trim() || ''`);
console.log('después', hueco?.antes, '→', despues);
if (despues === hueco?.antes) fail(`el día ${hueco?.dia} sigue en ${despues}`);
await shot('12h-cerrado');

const avisos = await evaluate(`document.querySelector('[data-modo-rapido-avisos]')?.dataset.modoRapidoAvisos || '0'`);
console.log('avisos', avisos);
if (await evaluate(`!!document.querySelector('[data-modo-rapido-avisos-pill]')`)) {
  await click(`document.querySelector('[data-modo-rapido-avisos-pill]')`);
  await sleep(300);
}
await evaluate(`document.querySelector('[data-modo-rapido-avisos]')?.scrollIntoView?.({ block: 'center' })`);
await shot('avisos-v2');

const fila = await evaluate(`(() => {
  const filas = [...document.querySelectorAll('tr[id^=plan-emp-]')];
  const i = filas.findIndex((tr) => /herrante/i.test(tr.innerText || ''));
  return i;
})()`);
console.log('fila herrante', fila);
if (fila >= 0) {
  await click(`document.querySelector('td[data-rc="${fila}:9"]')`);
  await sleep(200);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'l', code: 'KeyL', windowsVirtualKeyCode: 76, modifiers: 2 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'l', code: 'KeyL', windowsVirtualKeyCode: 76, modifiers: 2 });
  await sleep(400);
  const abierto = await evaluate(`!!document.querySelector('[data-novedad-rapida]')`);
  console.log('selector novedad', abierto);
  if (!abierto) fail('Ctrl+L no abrió el selector de novedad');
  await shot('novedad');
} else {
  fail('no está HERRANTE en la grilla');
}

await cerrar();
console.log(process.exitCode ? 'con fallas' : 'ok');
