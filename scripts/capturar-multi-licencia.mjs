/**
 * Capturas 1440x900: selección de licencias en Obrador (emulador 8190/9199).
 *   PLANIF_EMU_PORTS=8080:8190,9099:9199 node scripts/capturar-multi-licencia.mjs
 */
import { readFileSync } from 'node:fs';
import { abrirPlanificacion, sleep } from './planif-cdp-lib.mjs';

const m = JSON.parse(readFileSync(new URL('./.obrador-manifest.json', import.meta.url), 'utf8'));
const MART = m.martinez;

const { send, evaluate, waitFor, rectOf, mouse, click, shot, cerrar, celda } = await abrirPlanificacion({
  objectiveId: m.objectiveId,
  clientId: m.clientId,
  year: 2026,
  month: 10,
  prefijo: 'multi-licencia',
  port: Number(process.env.CAPTURA_PORT || 3012),
  devtoolsPort: Number(process.env.CAPTURA_DEVTOOLS || 9335),
});

await waitFor(`document.getElementById('plan-emp-${MART}')`, 90000, 'grilla');
await sleep(1500);
const corregir = `document.querySelector('button[title^="Modo Corrección"]')`;
if (await evaluate(`!!${corregir}`)) {
  await click(corregir);
  await sleep(400);
}

const desde = await rectOf(celda(MART, 11));
const hasta = await rectOf(celda(MART, 20));
await mouse('mousePressed', desde.x, desde.y, 'left');
const pasos = 8;
for (let i = 1; i <= pasos; i++) {
  const x = desde.x + ((hasta.x - desde.x) * i) / pasos;
  const y = desde.y + ((hasta.y - desde.y) * i) / pasos;
  await mouse('mouseMoved', x, y, 'left');
  await sleep(40);
}
await mouse('mouseReleased', hasta.x, hasta.y, 'left');
await sleep(500);
console.log('barra', await evaluate(`document.querySelector('[data-barra-cubrir]')?.innerText || document.body.innerText.includes('Asignar')`));
await shot('1-barra-cubrir');

await click(celda(MART, 11), 'right');
await waitFor(`document.querySelector('[data-menu-rapido=raiz]')`, 8000, 'menú');
console.log('menú', await evaluate(`document.querySelector('[data-menu-rapido=raiz]')?.innerText`));
await shot('2-menu-dias');

await click(`document.querySelector('[data-menu-accion=asignar]')`);
await waitFor(`document.querySelector('[data-franja-elegir]')`, 8000, 'franja');
console.log('franja', await evaluate(`document.querySelector('[data-franja-texto]')?.innerText`));
await shot('3-dia-1');

const ocultar = `document.querySelector('button[title="Ocultar estadísticas"]')`;
if (await evaluate(`!!${ocultar}`)) await click(ocultar);
await sleep(400);
const medida = await evaluate(`(() => {
  const g = document.querySelector('[data-plan-grilla]');
  const foot = g?.querySelector('tfoot');
  if (!g || !foot) return null;
  const gr = g.getBoundingClientRect();
  const fr = foot.getBoundingClientRect();
  const stats = document.querySelector('button[title="Mostrar estadísticas"], button[title="Ocultar estadísticas"]');
  const sb = stats ? stats.getBoundingClientRect().height : 0;
  return { gap: Math.round(gr.bottom - fr.bottom), alto: Math.round(gr.height), scroll: g.scrollHeight - g.clientHeight, filas: g.querySelectorAll('tbody tr').length, bajo: Math.round(window.innerHeight - gr.bottom), stats: Math.round(sb) };
})()`);
console.log('1440', medida);
await shot('4-grilla-1440');

await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
await sleep(600);
const medida2 = await evaluate(`(() => {
  const g = document.querySelector('[data-plan-grilla]');
  const foot = g?.querySelector('tfoot');
  if (!g || !foot) return null;
  const gr = g.getBoundingClientRect();
  const fr = foot.getBoundingClientRect();
  const stats = document.querySelector('button[title="Mostrar estadísticas"], button[title="Ocultar estadísticas"]');
  const sb = stats ? stats.getBoundingClientRect().height : 0;
  return { gap: Math.round(gr.bottom - fr.bottom), alto: Math.round(gr.height), scroll: g.scrollHeight - g.clientHeight, filas: g.querySelectorAll('tbody tr').length, bajo: Math.round(window.innerHeight - gr.bottom), stats: Math.round(sb) };
})()`);
console.log('1920', medida2);
await shot('5-grilla-1920');

await cerrar();
process.exit(0);
