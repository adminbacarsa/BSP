/**
 * Capturas 1440x900 de Obrador Malagueño (copia de prod en el emulador 8190/9199).
 *   PLANIF_EMU_PORTS=8080:8190,9099:9199 node scripts/capturar-obrador.mjs
 */
import { readFileSync } from 'node:fs';
import { abrirPlanificacion, sleep } from './planif-cdp-lib.mjs';

const m = JSON.parse(readFileSync(new URL('./.obrador-manifest.json', import.meta.url), 'utf8'));
const MART = m.martinez;
const MORALES = m.morales;
const HERRERA = 'fBJeRulBMbWda5irotFO';
const HERRANTE = 'usUePceuvfcF8gO12vHw';

const { evaluate, waitFor, click, hover, shot, cerrar, celda, fila } = await abrirPlanificacion({
  objectiveId: m.objectiveId,
  clientId: m.clientId,
  year: 2026,
  month: 10,
  prefijo: 'obrador',
  port: Number(process.env.CAPTURA_PORT || 3011),
  devtoolsPort: Number(process.env.CAPTURA_DEVTOOLS || 9334),
});

const cobertura = (dia) => `document.querySelector('tfoot tr')?.querySelectorAll('td')[${dia}]?.innerText`;
const nombre = (emp) => `document.getElementById('plan-emp-${emp}')?.querySelector('td,th')`;
await waitFor(`${fila(MART)}`, 90000, 'grilla con MARTINEZ');
await sleep(2000);
console.log('cobertura 11 antes', await evaluate(cobertura(11)));
console.log('cobertura 12 antes', await evaluate(cobertura(12)));

await click(celda(MART, 11), 'right');
await waitFor(`document.querySelector('[data-menu-rapido=raiz]')`, 8000, 'menú 11');
console.log('menú', await evaluate(`document.querySelector('[data-menu-rapido=raiz]')?.innerText`));
await shot('1-menu-11');

await click(`document.querySelector('[data-menu-accion=asignar]')`);
await waitFor(`document.querySelector('[data-franja-elegir]')`, 8000, 'franja asignar');
console.log('franja', await evaluate(`document.querySelector('[data-franja-texto]')?.innerText`));
await shot('2-franja-asignar');

if (await evaluate(`!!${nombre(MORALES)}`)) {
  await click(nombre(MORALES));
} else {
  await click(`document.querySelector('[data-franja-fuera]')`);
  await waitFor(`document.querySelector('[data-franja-buscar]')`, 5000, 'buscar fuera');
  await evaluate(`(() => { const el = document.querySelector('[data-franja-buscar]'); const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, 'MORALES'); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(400);
  await click(`document.querySelector('[data-franja-fuera-fila="${MORALES}"]')`);
}
await sleep(800);
console.log('franja tras morales', await evaluate(`document.querySelector('[data-franja-texto]')?.innerText || document.querySelector('[data-franja-aviso]')?.innerText`));
await shot('3-morales-pendiente');
console.log('cambios', await evaluate(`[...document.querySelectorAll('span')].map(s => s.innerText).find(t => /camb/.test(t))`));

await evaluate(`window.confirm = () => true`);
await click(`document.querySelector('button[title="Guardar cambios pendientes"]')`);
await sleep(4000);
console.log('cobertura 11 después', await evaluate(cobertura(11)));
console.log('celda morales', await evaluate(`${celda(MORALES, 11)}?.innerText`));
await hover(celda(MORALES, 11), 800);
await shot('4-morales-guardado');

await click(celda(MART, 12), 'right');
await waitFor(`document.querySelector('[data-menu-rapido=raiz]')`, 8000, 'menú 12');
await click(`document.querySelector('[data-menu-accion=ext]')`);
await waitFor(`document.querySelector('[data-franja-elegir]')`, 8000, 'franja ext');
console.log('franja ext', await evaluate(`document.querySelector('[data-franja-texto]')?.innerText`));
await shot('5-franja-ext');
await click(nombre(HERRERA));
await sleep(600);
console.log('tras herrera', await evaluate(`document.querySelector('[data-franja-texto]')?.innerText || document.querySelector('[data-franja-aviso]')?.innerText`));
await shot('6-ext-herrera');
await click(nombre(HERRANTE));
await sleep(800);
console.log('tras herrante', await evaluate(`document.querySelector('[data-franja-texto]')?.innerText || document.querySelector('[data-franja-aviso]')?.innerText`));
console.log('cambios ext', await evaluate(`[...document.querySelectorAll('span')].map(s => s.innerText).find(t => /camb/.test(t))`));
await shot('7-ext-adel-pendiente');

await evaluate(`window.confirm = () => true`);
await click(`document.querySelector('button[title="Guardar cambios pendientes"]')`);
await sleep(4000);
console.log('cobertura 12 después', await evaluate(cobertura(12)));
await shot('8-ext-adel-guardado');

await cerrar();
process.exit(0);
