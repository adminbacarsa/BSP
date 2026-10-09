#!/usr/bin/env node
/**
 * Modo rápido de la grilla de Planificación, solo con teclado, en Chromium headless (CDP).
 * Carga noviembre 2026 para 10 guardias de «Peaje Rápido» (SLA) y pega un bloque TSV en «Depósito Sin Servicio».
 * Mide teclas, tiempo total y costo por tecla (commits de la página `__planifPerf` y latencia keydown → fin de tarea),
 * guarda en Firestore con Ctrl+S y saca las capturas 1440x900 `docs/capturas-cobertura/modo-rapido-*.png`.
 *
 * Requiere: emulador aislado (auth + firestore en 8190/9199), `node scripts/seed-captura-modo-rapido.mjs`
 * y `next build` en apps/web2 con NEXT_PUBLIC_USE_EMULATOR=true.
 *
 *   npx firebase emulators:start --only auth,firestore --config firebase.e2e-p2.json --project comtroldata
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8190 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9199 node scripts/seed-captura-modo-rapido.mjs
 *   PLANIF_EMU_PORTS=8080:8190,9099:9199 FIRESTORE_EMULATOR_HOST=127.0.0.1:8190 node scripts/e2e-modo-rapido.mjs
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { abrirPlanificacion, sleep } from './planif-cdp-lib.mjs';

if (!process.env.PLANIF_EMU_PORTS) process.env.PLANIF_EMU_PORTS = '8080:8190,9099:9199';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8190') throw new Error('Solo contra el emulador aislado 127.0.0.1:8190');

const require = createRequire(fileURLToPath(new URL('../apps/functions/package.json', import.meta.url)));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const db = getFirestore(initializeApp({ projectId: 'comtroldata' }, 'e2e-modo-rapido'));

const DIAS = 30;
const FILAS = 10;
const prefijo = 'modo-rapido';

const sesion = await abrirPlanificacion({
  objectiveId: 'obj_mq_sla',
  clientId: 'cli_mq',
  year: 2026,
  month: 11,
  prefijo,
  port: Number(process.env.CAPTURA_PORT || 3021),
  devtoolsPort: 9361,
  scriptInicial: `window.__planifPerf = []; window.__teclas = []; window.__lat = [];
    window.addEventListener('keydown', (e) => {
      const t0 = performance.now();
      window.__teclas.push(t0);
      { const ch = new MessageChannel(); ch.port1.onmessage = () => window.__lat.push(performance.now() - t0); ch.port2.postMessage(0); };
    }, true);
    window.confirm = () => true;`,
});
const { send, evaluate, waitFor, click, shot, cerrar } = sesion;
const fail = (msg) => { console.error('✗', msg); process.exitCode = 1; };

await waitFor(`document.getElementById('plan-emp-mq10')`, 120000, 'grilla de Peaje Rápido');
await sleep(2000);

const filasOrden = await evaluate(`[...document.querySelectorAll('tr[id^=plan-emp-]')].map((tr) => tr.id.replace('plan-emp-', ''))`);
console.log('filas:', filasOrden.join(', '));
if (filasOrden.length !== FILAS) fail(`se esperaban ${FILAS} filas y hay ${filasOrden.length}`);

await click(`document.querySelector('[data-modo-rapido-toggle]')`);
await waitFor(`document.querySelector('[data-modo-rapido-capa]')`, 8000, 'capa del modo rápido');
await sleep(600);

let teclas = 0;
const VK = { Tab: 9, Enter: 13, Escape: 27, End: 35, Home: 36, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Delete: 46 };
async function tecla(key, { ctrl = false, shift = false, commands } = {}) {
  teclas++;
  const modifiers = (ctrl ? 2 : 0) | (shift ? 8 : 0);
  let code = key;
  let vk = VK[key];
  let text;
  if (key.length === 1) {
    const up = key.toUpperCase();
    code = /[0-9]/.test(key) ? `Digit${key}` : `Key${up}`;
    vk = up.charCodeAt(0);
    if (!ctrl) text = key.toLowerCase();
  }
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: key.length === 1 && !ctrl ? key.toLowerCase() : key, code, windowsVirtualKeyCode: vk, modifiers, text, ...(commands ? { commands } : {}) });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: key.length === 1 && !ctrl ? key.toLowerCase() : key, code, windowsVirtualKeyCode: vk, modifiers });
  await sleep(12);
}
const escribir = async (s) => { for (const ch of s) await tecla(ch); };
const cursor = () => evaluate(`document.querySelector('[data-modo-rapido-cursor]')?.dataset.modoRapidoCursor || ''`);
const cambios = () => evaluate(`(document.querySelector('[data-cambios-pendientes]')?.textContent || '0').replace(/\\D+/g, '') | 0`);
const textoCelda = (r, c) => evaluate(`(document.querySelector('td[data-rc="${r}:${c}"]')?.innerText || '').trim()`);

const BASE = ['M', 'M', 'M', 'T', 'T', 'T', 'N', 'N', 'N', 'D12'];
const codigoDe = (r, j) => (((j + (r * 3)) % 8) < 6 ? BASE[r] : 'F');

const t0 = Date.now();
await evaluate('window.__planifPerf.length = 0; window.__teclas.length = 0; window.__lat.length = 0');
await tecla('ArrowRight');
if ((await cursor()) !== '0:0') fail(`la primera flecha deja el cursor en 0:0 (está en ${await cursor()})`);

for (let r = 0; r < FILAS; r++) {
  for (let j = 0; j < 8; j++) {
    const code = codigoDe(r, j);
    await escribir(code === 'D12' ? 'd1' : code.toLowerCase());
    if (r === 9 && j === 0) {
      await sleep(400);
      await shot('autocompletar');
    }
    await tecla('Tab');
    if (r === 0 && j === 3) await shot('cursor');
  }
  await tecla('ArrowLeft');
  await tecla('Home', { shift: true });
  await tecla('c', { ctrl: true, commands: ['copy'] });
  for (let k = 0; k < 3; k++) {
    await tecla('ArrowRight', { ctrl: true });
    await tecla('ArrowRight');
    await tecla('v', { ctrl: true, commands: ['paste'] });
    await sleep(60);
  }
  if (r < FILAS - 1) {
    await tecla('ArrowDown');
    await tecla('Home');
  }
}
await sleep(800);
const tMes = Date.now() - t0;
const teclasMes = teclas;

let malas = 0;
for (let r = 0; r < FILAS; r++) {
  for (let c = 0; c < DIAS; c++) {
    const esperado = codigoDe(r, c % 8);
    const txt = await textoCelda(r, c);
    if (!txt.toUpperCase().startsWith(esperado)) { malas++; if (malas <= 5) console.log(`  celda ${r}:${c} esperaba ${esperado} y muestra «${txt}»`); }
  }
}
const nCambios = await cambios();
console.log(`mes cargado: ${teclasMes} teclas, ${(tMes / 1000).toFixed(1)} s de máquina, ${nCambios} cambios pendientes, ${malas} celdas distintas de lo esperado`);
if (malas) fail(`${malas} celdas no quedaron con el código esperado`);
if (nCambios !== FILAS * DIAS) fail(`cambios pendientes ${nCambios} ≠ ${FILAS * DIAS}`);

// Ctrl+D / Ctrl+Z / Ctrl+Y sobre las dos últimas filas.
await tecla('ArrowUp');
await tecla('Home');
await tecla('ArrowDown', { shift: true });
await tecla('End', { shift: true });
await tecla('d', { ctrl: true });
await sleep(300);
const trasD = await textoCelda(9, 0);
await tecla('z', { ctrl: true });
await sleep(300);
const trasZ = await textoCelda(9, 0);
await tecla('y', { ctrl: true });
await sleep(300);
const trasY = await textoCelda(9, 0);
await tecla('z', { ctrl: true });
await sleep(300);
console.log(`Ctrl+D fila 10 día 1: «${trasD}» · Ctrl+Z: «${trasZ}» · Ctrl+Y: «${trasY}»`);
if (!trasD.startsWith(codigoDe(8, 0)) || !trasZ.startsWith('D12') || !trasY.startsWith(codigoDe(8, 0))) fail('Ctrl+D / Ctrl+Z / Ctrl+Y');
await tecla('Escape');

// Rango + licencia: fila 2, días 11 a 13 → V (misma escritura de ausencia, sin modal).
await tecla('ArrowUp', { ctrl: true });
await tecla('Home');
await tecla('ArrowDown');
for (let k = 0; k < 10; k++) await tecla('ArrowRight');
await tecla('ArrowRight', { shift: true });
await tecla('ArrowRight', { shift: true });
await tecla('v');
await sleep(400);
await shot('rango');
await tecla('Enter');
await sleep(400);
const lic = [await textoCelda(1, 10), await textoCelda(1, 11), await textoCelda(1, 12)];
console.log('licencia en rango:', lic.join(' · '));
if (!lic.every((t) => t.toUpperCase().startsWith('V'))) fail('el rango no quedó con V');

// Aviso de descanso: T el día anterior a una M (fila 1).
await tecla('Escape');
await tecla('ArrowUp');
await tecla('Home');
const colT = [...Array(DIAS).keys()].find((c) => codigoDe(0, c % 8) === 'M' && codigoDe(0, (c + 1) % 8) === 'M' && c > 0);
for (let k = 0; k < colT; k++) await tecla('ArrowRight');
await tecla('t');
await tecla('Enter');
await sleep(800);
const avisos = await evaluate(`document.querySelector('[data-modo-rapido-avisos]')?.innerText || ''`);
const marcas = await evaluate(`document.querySelectorAll('[data-modo-rapido-marca]').length`);
console.log(`panel de avisos: ${marcas} marca(s) · «${avisos.replace(/\s+/g, ' ').slice(0, 160)}»`);
if (!marcas || !/descanso/i.test(avisos)) fail('no apareció el aviso de descanso');
await shot('avisos');
await tecla('z', { ctrl: true });
await sleep(400);

// Guardar con Ctrl+S.
const tecGuardar = teclas;
await tecla('s', { ctrl: true });
// El tope de JUAREZ (D12 6+2) pide el PIN una sola vez, agrupado, al guardar.
await waitFor(`[...document.querySelectorAll('h3')].some((h) => /Autorización Requerida/.test(h.textContent || ''))`, 15000, 'PIN al guardar');
await sleep(500);
const pedidos = await evaluate(`[...document.querySelectorAll('h3')].find((h) => /Autorización Requerida/.test(h.textContent || '')).closest('div.bg-white').innerText`);
console.log(`PIN pedido una vez al guardar: «${pedidos.replace(/\s+/g, ' ').slice(0, 200)}»`);
await shot('pin');
await escribir('1234');
if (await evaluate(`!!document.querySelector('form textarea')`)) {
  await tecla('Tab');
  await escribir('cobertura');
}
await tecla('Enter');
await sleep(300);
if (await evaluate(`[...document.querySelectorAll('h3')].some((h) => /Autorización Requerida/.test(h.textContent || ''))`)) {
  await click(`[...document.querySelectorAll('button[type=submit]')].find((b) => /AUTORIZAR/.test(b.textContent || ''))`);
}
await waitFor(`!document.querySelector('[data-cambios-pendientes]')`, 60000, 'guardado');
await sleep(2500);
const guardados = await db.collection('turnos').where('objectiveId', '==', 'obj_mq_sla').get();
const nov = guardados.docs.filter((d) => {
  const st = d.get('startTime')?.toDate?.();
  return st && st >= new Date('2026-11-01T03:00:00Z') && !d.get('isDeleted');
});
const porCodigo = {};
nov.forEach((d) => { const k = d.get('code') || d.get('name'); porCodigo[k] = (porCodigo[k] || 0) + 1; });
console.log(`guardado con Ctrl+S (${teclas - tecGuardar} teclas con PIN y motivo): ${nov.length} turnos de noviembre`, porCodigo);
if (nov.length < FILAS * DIAS) fail(`se guardaron ${nov.length} turnos de noviembre`);
let ausV = { size: 0 };
for (let i = 0; i < 30 && ausV.size === 0; i++) {
  ausV = await db.collection('ausencias').where('employeeId', '==', filasOrden[1]).get();
  if (!ausV.size) await sleep(500);
}
console.log(`ausencias de ${filasOrden[1]} (V del rango, misma escritura que el modal): ${ausV.size}`, ausV.size ? ausV.docs.map((d) => `${d.get('type')} ${d.get('startDate')}→${d.get('endDate')}`) : '');
if (!ausV.size) fail('la licencia del rango no llegó a ausencias');

const perf = await evaluate('JSON.stringify({ commits: window.__planifPerf, lat: window.__lat, teclas: window.__teclas })').then((s) => JSON.parse(s));

// Sin servicio: el modo queda recordado; se pega un bloque TSV de Excel.
await send('Page.navigate', { url: `http://127.0.0.1:${Number(process.env.CAPTURA_PORT || 3021)}/admin/planificacion/?objectiveId=obj_mq_sin&clientId=cli_mq&year=2026&month=11` });
await waitFor(`document.getElementById('plan-emp-mqsin3')`, 90000, 'grilla sin servicio');
await waitFor(`document.querySelector('[data-modo-rapido-capa]')`, 8000, 'modo rápido recordado');
await sleep(1500);
await tecla('ArrowRight');
const tsv = ['M\tM\tM\tM\tM\tF\tF', 'T\tT\tT\tT\tT\tF\tF', 'N\tN\tN\tN\tN\tF\tF'].join('\r\n');
await evaluate(`(() => { const dt = new DataTransfer(); dt.setData('text/plain', ${JSON.stringify(tsv)}); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
teclas++;
await sleep(800);
const sinTxt = [await textoCelda(0, 0), await textoCelda(1, 4), await textoCelda(2, 6)];
const aviso = await evaluate(`!!document.querySelector('[data-cobertura-sin-servicio]')`);
console.log(`sin servicio: pegado TSV → ${sinTxt.join(' · ')} · fila de cobertura «sin servicio»: ${aviso}`);
if (!sinTxt[0].startsWith('M') || !sinTxt[1].startsWith('T') || !sinTxt[2].startsWith('F')) fail('el TSV no se pegó en el objetivo sin servicio');
if (!aviso) fail('falta el rótulo de cobertura sin servicio');
await shot('sin-servicio');

const porTecla = perf.teclas.map((t, i) => {
  const fin = perf.teclas[i + 1] ?? Infinity;
  return perf.commits.filter((c) => c.at >= t && c.at < fin).reduce((a, c) => a + c.ms, 0);
});
const sinCommit = porTecla.filter((ms) => ms === 0).length;
const conCommit = porTecla.filter((ms) => ms > 0).sort((a, b) => a - b);
const pc = (q) => conCommit[Math.min(conCommit.length - 1, Math.floor(conCommit.length * q))] || 0;
console.log(`commits de la página: ${sinCommit} teclas sin render de la página (cursor), ${conCommit.length} con render (escritura/pegado; costo por tecla aislado: scripts/medir-modo-rapido.mjs): mediana ${pc(0.5).toFixed(1)} ms · p95 ${pc(0.95).toFixed(1)} ms · máx ${(conCommit.at(-1) || 0).toFixed(1)} ms`);
console.log(`total: ${teclas} teclas (+1 clic en «Modo rápido»), mes de 10 × 30 en ${teclasMes} teclas`);

await cerrar();
process.exit(process.exitCode || 0);
