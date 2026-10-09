#!/usr/bin/env node
/**
 * Costo por tecla del modo rápido, una tecla por vez (sin cola): mover el cursor, tipear un carácter
 * y confirmar un código (escritura). Corre sobre «Peaje Rápido» noviembre 2026 ya cargado por
 * `scripts/e2e-modo-rapido.mjs` (10 × 30). Con MEDIR_PERFIL=1 guarda el top de funciones de la escritura.
 *
 *   PLANIF_EMU_PORTS=8080:8190,9099:9199 node scripts/medir-modo-rapido.mjs
 */
import { abrirPlanificacion, sleep } from './planif-cdp-lib.mjs';

if (!process.env.PLANIF_EMU_PORTS) process.env.PLANIF_EMU_PORTS = '8080:8190,9099:9199';

const { send, evaluate, waitFor, click, cerrar } = await abrirPlanificacion({
  objectiveId: 'obj_mq_sla',
  clientId: 'cli_mq',
  year: 2026,
  month: 11,
  prefijo: 'modo-rapido-medir',
  port: Number(process.env.CAPTURA_PORT || 3022),
  devtoolsPort: 9362,
  scriptInicial: `window.__planifPerf = []; window.__lat = [];
    window.addEventListener('keydown', () => { const t0 = performance.now(); { const ch = new MessageChannel(); ch.port1.onmessage = () => window.__lat.push(performance.now() - t0); ch.port2.postMessage(0); }; }, true);
    window.confirm = () => true;`,
});
await waitFor(`document.getElementById('plan-emp-mq10')`, 120000, 'grilla');
await sleep(2500);
if (!(await evaluate(`!!document.querySelector('[data-modo-rapido-capa]')`))) {
  await click(`document.querySelector('[data-modo-rapido-toggle]')`);
  await waitFor(`document.querySelector('[data-modo-rapido-capa]')`, 8000, 'capa');
}
await sleep(1000);
await send('Performance.enable');

const VK = { Tab: 9, Enter: 13, Escape: 27, ArrowRight: 39, ArrowDown: 40, ArrowLeft: 37 };
async function tecla(key) {
  const one = key.length === 1;
  const code = one ? (/[0-9]/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`) : key;
  const vk = one ? key.toUpperCase().charCodeAt(0) : VK[key];
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, text: one ? key : undefined });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
}
const cpu = async () => {
  const { metrics } = await send('Performance.getMetrics');
  return metrics.find((m) => m.name === 'TaskDuration').value * 1000;
};
async function medir(key, espera) {
  await evaluate('window.__planifPerf.length = 0; window.__lat.length = 0');
  const c0 = await cpu();
  await tecla(key);
  await sleep(espera);
  const c1 = await cpu();
  const r = await evaluate('JSON.stringify({ lat: window.__lat[0] || 0, commits: window.__planifPerf.reduce((a, c) => a + c.ms, 0), n: window.__planifPerf.length })').then(JSON.parse);
  return { ...r, cpu: c1 - c0 };
}
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))] || 0;
  return `mediana ${q(0.5).toFixed(1)} ms · p95 ${q(0.95).toFixed(1)} ms · máx ${(s.at(-1) || 0).toFixed(1)} ms`;
};

await tecla('ArrowRight');
await sleep(300);
const control = [];
for (let i = 0; i < 10; i++) control.push(await medir('F9', 250));
console.log(`control (F9, nadie la atiende): latencia ${stats(control.map((x) => x.lat))} · CPU ${stats(control.map((x) => x.cpu))}`);
const nav = [];
for (let i = 0; i < 24; i++) nav.push(await medir(i % 6 === 5 ? 'ArrowDown' : 'ArrowRight', 250));
const tipeo = [];
const escritura = [];
if (process.env.MEDIR_PERFIL) { await send('Profiler.enable'); await send('Profiler.setSamplingInterval', { interval: 200 }); await send('Profiler.start'); }
for (let i = 0; i < 10; i++) {
  tipeo.push(await medir(i % 2 ? 't' : 'm', 250));
  escritura.push(await medir('Tab', 1500));
}
if (process.env.MEDIR_PERFIL) {
  const { profile } = await send('Profiler.stop');
  const self = new Map();
  const dt = profile.timeDeltas;
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  profile.samples.forEach((id, i) => {
    const n = byId.get(id);
    const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}:${n.callFrame.columnNumber}`;
    self.set(k, (self.get(k) || 0) + (dt[i] || 0) / 1000);
  });
  console.log('top self-time (ms) en 10 escrituras:');
  [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([k, v]) => console.log(`  ${v.toFixed(0).padStart(6)}  ${k}`));
}
console.log(`mover cursor (${nav.length}): latencia ${stats(nav.map((x) => x.lat))} · CPU ${stats(nav.map((x) => x.cpu))} · renders de la página ${nav.reduce((a, x) => a + x.n, 0)}`);
console.log(`tipear carácter (${tipeo.length}): latencia ${stats(tipeo.map((x) => x.lat))} · CPU ${stats(tipeo.map((x) => x.cpu))} · renders de la página ${tipeo.reduce((a, x) => a + x.n, 0)}`);
console.log(`confirmar código (${escritura.length}): latencia ${stats(escritura.map((x) => x.lat))} · CPU ${stats(escritura.map((x) => x.cpu))} · render de la página ${stats(escritura.map((x) => x.commits))}`);
await cerrar();
process.exit(0);
