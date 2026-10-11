/**
 * Resumen de pegado: ACOSTA queda en un solo grupo, con cliente · objetivo.
 * PLANIF_EMU_PORTS=8080:8391,9099:9391
 */
import { abrirPlanificacion } from './planif-cdp-lib.mjs';

const sesion = await abrirPlanificacion({
  objectiveId: 'obj_padron',
  clientId: 'cli_padron',
  year: 2026,
  month: 10,
  prefijo: 'pegar',
  port: 3037,
  devtoolsPort: 9367,
});
const { evaluate, waitFor, click, shot, cerrar } = sesion;

const tsv = [
  'PEREZ JUAN\t\t1001\tPuesto 1\tM\tT',
  'ACOSTA JULIO\t\t2001\tPuesto 1\tM\tT',
  'NADIE RARO\t\t9999\tPuesto 1\tM\tT',
].join('\n');

try {
  await waitFor(`document.querySelector('[data-modo-rapido-toggle]')`, 90000, 'modo rápido');
  if (await evaluate(`document.querySelector('[data-modo-rapido-toggle]')?.getAttribute('data-modo-rapido-toggle') !== '1'`)) {
    await evaluate(`document.querySelector('[data-modo-rapido-toggle]')?.click()`);
  }
  await waitFor(`document.querySelector('[data-modo-rapido-capa]')`, 15000, 'capa');
  await click(`document.querySelector('[data-pegar-excel-abrir]')`);
  await waitFor(`document.querySelector('[data-pegar-texto]')`, 10000, 'pegar');
  await evaluate(`(() => {
    const el = document.querySelector('[data-pegar-texto]');
    const d = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    d.set.call(el, ${JSON.stringify(tsv)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await click(`document.querySelector('[data-pegar-revisar]')`);
  await waitFor(`document.querySelector('[data-pegar-grupos]')`, 20000, 'grupos');
  await waitFor(`/Peaje Norte/.test(document.querySelector('[data-pegar-excel]')?.innerText || '')`, 10000, 'objetivo de ACOSTA');
  const texto = await evaluate(`document.querySelector('[data-pegar-excel]')?.innerText || ''`);
  console.log(texto);
  if (/Desconocido/.test(texto)) throw new Error('Sigue diciendo Desconocido');
  if (!/Cliente Ruta · Peaje Norte/.test(texto)) throw new Error('No resolvió cliente · objetivo');
  if (!/1 sin encontrar/.test(texto)) throw new Error(`El contador no es 1: ${texto.split('\\n')[0]}`);
  if (/2 sin encontrar/.test(texto)) throw new Error('Cuenta a ACOSTA como sin encontrar');
  const altaAcosta = await evaluate(`[...document.querySelectorAll('[data-pegar-alta]')].some((b) => /ACOSTA/i.test(b.closest('li')?.innerText || ''))`);
  if (altaAcosta) throw new Error('ACOSTA también está en Para dar de alta');
  const altaNadie = await evaluate(`[...document.querySelectorAll('[data-pegar-alta]')].some((b) => /NADIE/i.test(b.closest('li')?.innerText || ''))`);
  if (!altaNadie) throw new Error('NADIE no quedó para dar de alta');
  await shot('agregar-guardias');
} finally {
  await cerrar();
}
console.log('listo');
