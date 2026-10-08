#!/usr/bin/env node
/**
 * Mide el cronograma real (H. de Niños, octubre: 21 guardias × 31 días) en Chromium headless:
 *  - render inicial: commit de la página en el que aparecen las 651 celdas (registro propio `__planifPerf`,
 *    solo en builds con perfGrilla) y, en cualquier build, ms desde el inicio de la navegación hasta que
 *    las 651 celdas están en el DOM (MutationObserver);
 *  - hover por 20 celdas: commits de la página, commits de React (hook mínimo de DevTools, sirve también
 *    para el build anterior) y tiempo de CPU del hilo principal (CDP TaskDuration / ScriptDuration);
 *  - asignar un turno (F desde el modal de la celda): commits y ms hasta que la celda queda pendiente.
 * Guarda el HTML de la grilla (tbody y el bloque completo de la grilla, al cargar y después de asignar)
 * para comparar dos builds: con MEDIR_ETIQUETA=antes y después MEDIR_ETIQUETA=despues, la segunda
 * corrida compara contra la primera.
 *
 * Requiere emuladores Auth + Firestore, `node scripts/seed-admin.js`, `node scripts/seed-captura-velocidad.mjs`
 * y `next build` en apps/web2 con NEXT_PUBLIC_USE_EMULATOR=true. Variables de planif-cdp-lib.mjs:
 * PLANIF_OUT_DIR (otro `out`) y PLANIF_EMU_PORTS (p. ej. "8080:8190,9099:9199" para otro emulador).
 *
 *   MEDIR_ETIQUETA=antes node scripts/medir-velocidad-planif.mjs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirPlanificacion, sleep } from './planif-cdp-lib.mjs';

const etiqueta = process.env.MEDIR_ETIQUETA || 'medicion';
const vueltas = Number(process.env.MEDIR_VUELTAS || 3);
const domDir = process.env.MEDIR_DOM_DIR || join(tmpdir(), 'cosp-velocidad-planif');
mkdirSync(domDir, { recursive: true });

const { send, evaluate, waitFor, click, mouse, rectOf, cerrar, celda } = await abrirPlanificacion({
  objectiveId: 'obj_hn',
  clientId: 'cli_ms',
  prefijo: 'velocidad',
  scriptInicial: `window.__planifPerf = []; window.__reactCommits = [];
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { isDisabled: false, supportsFiber: true, renderers: new Map(),
      inject(r) { const id = this.renderers.size + 1; this.renderers.set(id, r); return id; },
      onScheduleFiberRoot() {}, onCommitFiberRoot() { window.__reactCommits.push(performance.now()); },
      onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {} };
    if (location.pathname.startsWith('/admin/planificacion')) {
      const mo = new MutationObserver(() => {
        if (document.querySelectorAll('[data-testid=grilla-celda]').length >= 651) { window.__grillaLista = performance.now(); mo.disconnect(); }
      });
      document.addEventListener('DOMContentLoaded', () => mo.observe(document.body, { childList: true, subtree: true }));
    }`,
});
await send('Performance.enable');
await waitFor(`${celda('hn_21', 31)}`, 120000, 'grilla H. de Niños');

const commits = () => evaluate('JSON.stringify(window.__planifPerf || [])').then((s) => JSON.parse(s));
const vaciar = () => evaluate('window.__planifPerf.length = 0; window.__reactCommits.length = 0');
const reactCommits = () => evaluate('window.__reactCommits.length');
const cpu = async () => {
  const { metrics } = await send('Performance.getMetrics');
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
  return { task: m.TaskDuration * 1000, script: m.ScriptDuration * 1000 };
};
async function quieta(ms = 2500, max = 30000) {
  const t0 = Date.now();
  let ultimo = -1;
  let desde = Date.now();
  while (Date.now() - t0 < max) {
    const n = await evaluate('window.__planifPerf.length + window.__reactCommits.length');
    if (n !== ultimo) { ultimo = n; desde = Date.now(); }
    if (Date.now() - desde >= ms) return;
    await sleep(200);
  }
}
const htmlGrilla = () => evaluate(`document.querySelector('table.planning-grid-table tbody')?.innerHTML || ''`);
const htmlBloque = () => evaluate(`(document.getElementById('printable-section') || document.querySelector('table.planning-grid-table')?.closest('main') || document.body).outerHTML`);
const resumen = (lista) => ({
  n: lista.length,
  total: Math.round(lista.reduce((a, c) => a + c.ms, 0) * 10) / 10,
  max: Math.round(Math.max(0, ...lista.map((c) => c.ms)) * 10) / 10,
});
const mediana = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

await quieta();
const carga = await commits();
const iMontaje = carga.findIndex((c) => c.celdas >= 651);
const montaje = iMontaje >= 0 ? carga[iMontaje] : null;
const domCarga = await htmlGrilla();
const bloqueCarga = await htmlBloque();
const grillaLista = await evaluate('Math.round(window.__grillaLista || 0)');
const commitsReactCarga = await reactCommits();

const hovers = [];
const asignaciones = [];
for (let v = 0; v < vueltas; v++) {
  // Hover: el mouse cruza 20 celdas de la fila de ESCOBAR (días 1..20), una cada 16 ms.
  const puntos = [];
  for (let d = 1; d <= 20; d++) puntos.push(await rectOf(celda('hn_05', d)));
  await mouse('mouseMoved', 5, 5, 'none');
  await sleep(600);
  await quieta(800);
  await vaciar();
  const c0 = await cpu();
  for (const p of puntos) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none' });
    await sleep(16);
  }
  await sleep(600);
  const c1 = await cpu();
  const rc = await reactCommits();
  await mouse('mouseMoved', 5, 5, 'none');
  hovers.push({ ...resumen(await commits()), reactCommits: rc, cpu: Math.round(c1.task - c0.task), script: Math.round(c1.script - c0.script) });

  // Asignar F a un libre (ZARATE, día 10 + v): abrir la celda, después el botón del modal.
  const dia = 10 + v;
  await click(celda('hn_21', dia), 'left', 900);
  await waitFor(`document.querySelector('button[title="Asignar Franco (F)"]')`, 8000, 'modal de la celda');
  await quieta(800);
  await vaciar();
  const a0 = await cpu();
  const tClick = await evaluate(`(() => { const t = performance.now(); document.querySelector('button[title="Asignar Franco (F)"]').click(); return t; })()`);
  await waitFor(`(${celda('hn_21', dia)}?.textContent || '').includes('F')`, 8000, 'celda pendiente');
  const tCelda = await evaluate('performance.now()');
  await quieta(800);
  const a1 = await cpu();
  asignaciones.push({
    ...resumen(await commits()),
    reactCommits: await reactCommits(),
    hastaCeldaMs: Math.round(tCelda - tClick),
    cpu: Math.round(a1.task - a0.task),
    script: Math.round(a1.script - a0.script),
  });
}
const domAsignado = await htmlGrilla();
const bloqueAsignado = await htmlBloque();

const out = {
  etiqueta,
  renderInicial: montaje ? { ms: montaje.ms, celdas: montaje.celdas } : null,
  grillaListaMs: grillaLista,
  commitsReactCarga,
  commitsCarga: resumen(carga),
  hover20: hovers,
  asignar: asignaciones,
  medianas: {
    hoverCommits: mediana(hovers.map((h) => h.n)),
    hoverCommitMs: mediana(hovers.map((h) => h.total)),
    hoverReactCommits: mediana(hovers.map((h) => h.reactCommits)),
    hoverCpuMs: mediana(hovers.map((h) => h.cpu)),
    hoverScriptMs: mediana(hovers.map((h) => h.script)),
    asignarCommitMs: mediana(asignaciones.map((a) => a.total)),
    asignarReactCommits: mediana(asignaciones.map((a) => a.reactCommits)),
    asignarHastaCeldaMs: mediana(asignaciones.map((a) => a.hastaCeldaMs)),
    asignarCpuMs: mediana(asignaciones.map((a) => a.cpu)),
    asignarScriptMs: mediana(asignaciones.map((a) => a.script)),
  },
};
console.log(JSON.stringify(out, null, 2));
writeFileSync(join(domDir, `${etiqueta}-resultado.json`), JSON.stringify(out, null, 2));
writeFileSync(join(domDir, `${etiqueta}-carga.html`), domCarga);
writeFileSync(join(domDir, `${etiqueta}-asignado.html`), domAsignado);
writeFileSync(join(domDir, `${etiqueta}-bloque-carga.html`), bloqueCarga);
writeFileSync(join(domDir, `${etiqueta}-bloque-asignado.html`), bloqueAsignado);

if (etiqueta === 'despues') {
  for (const fase of ['carga', 'asignado']) {
    const prev = join(domDir, `antes-${fase}.html`);
    if (!existsSync(prev)) continue;
    const a = readFileSync(prev, 'utf8');
    const b = fase === 'carga' ? domCarga : domAsignado;
    if (a === b) {
      console.log(`DOM ${fase}: idéntico (${b.length} caracteres)`);
    } else {
      let i = 0;
      while (i < a.length && a[i] === b[i]) i++;
      console.log(`DOM ${fase}: DISTINTO en ${i}\n antes:   ${a.slice(Math.max(0, i - 150), i + 250)}\n después: ${b.slice(Math.max(0, i - 150), i + 250)}`);
    }
  }
}

await cerrar();
process.exit(0);
