/**
 * Grilla real: Obrador (copia de Bacar SA en el emulador). Cubrir el 10 con Ext/Adel y repetir.
 *   PLANIF_EMU_PORTS=8080:8190,9099:9199 node scripts/capturar-repetir-extadel.mjs
 */
import { readFileSync } from 'node:fs';
import { abrirPlanificacion, sleep } from './planif-cdp-lib.mjs';

const m = JSON.parse(readFileSync(new URL('./.repetir-extadel.json', import.meta.url), 'utf8'));
const { evaluate, waitFor, click, shot, cerrar, celda, fila } = await abrirPlanificacion({
  objectiveId: m.objectiveId,
  clientId: m.clientId,
  year: 2026,
  month: 10,
  prefijo: 'repetir-extadel',
  port: Number(process.env.CAPTURA_PORT || 3024),
  devtoolsPort: Number(process.env.CAPTURA_DEVTOOLS || 9356),
});

const nombre = (emp) => `${fila(emp)}?.querySelector('td,th')`;
await waitFor(`${fila(m.baigorria)}`, 90000, 'grilla con BAIGORRIA');
await sleep(2000);

await click(celda(m.baigorria, 10), 'right');
await waitFor(`document.querySelector('[data-menu-rapido=raiz]')`, 8000, 'menú 10');
console.log('menú', await evaluate(`document.querySelector('[data-menu-rapido=raiz]')?.innerText`));
await shot('1-menu');

await click(`document.querySelector('[data-menu-accion=ext]')`);
await waitFor(`document.querySelector('[data-franja-elegir]')`, 8000, 'franja ext');
console.log('franja', await evaluate(`document.querySelector('[data-franja-texto]')?.textContent`));
await shot('2-elegir-ext');

await click(nombre(m.barrios));
await sleep(700);
console.log('tras barrios', await evaluate(`document.querySelector('[data-franja-texto]')?.textContent || document.querySelector('[data-franja-aviso]')?.textContent`));
await shot('3-elegir-adel');

await click(nombre(m.bordino));
await waitFor(`document.querySelector('[data-franja-repetir]')`, 8000, 'oferta repetir');
console.log('repetir', await evaluate(`document.querySelector('[data-franja-repetir]')?.textContent`));
await shot('4-oferta-repetir');

await click(`document.querySelector('[data-franja-repetir]')`);
await waitFor(`document.querySelector('[data-franja-aviso]')`, 8000, 'resultado repetir');
console.log('resultado', await evaluate(`document.querySelector('[data-franja-aviso]')?.textContent`));
await shot('5-resultado');

const marcas = async (emp, dia) => evaluate(`${celda(emp, dia)}?.textContent`);
console.log('baig 10', await marcas(m.baigorria, 10));
console.log('baig 11', await marcas(m.baigorria, 11));
console.log('baig 12', await marcas(m.baigorria, 12));
console.log('baig 13', await marcas(m.baigorria, 13));
console.log('barrios 10', await marcas(m.barrios, 10));
console.log('barrios 11', await marcas(m.barrios, 11));
console.log('barrios 12', await marcas(m.barrios, 12));
console.log('bordino 11', await marcas(m.bordino, 11));
console.log('bordino 12', await marcas(m.bordino, 12));
console.log('bordino 13', await marcas(m.bordino, 13));

await evaluate(`window.confirm = () => true`);
await click(`document.querySelector('button[title="Guardar cambios pendientes"]')`);
await sleep(4000);
console.log('guardado', await evaluate(`[...document.querySelectorAll('[data-sonner-toast], [data-sonner-toaster] *')].map(n => n.textContent).filter(Boolean).slice(0, 4).join(' | ')`));
await shot('6-guardado');

await cerrar();
process.exit(0);
