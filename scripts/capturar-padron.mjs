/**
 * Capturas sintéticas del padrón, el pegado y la leyenda.
 * Emulador: firebase.e2e-padron.json (8391/9391). Seed: scripts/seed-padron-emulator.mjs
 * PLANIF_EMU_PORTS=8080:8391,9099:9391 node scripts/capturar-padron.mjs
 */
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { abrirPlanificacion, sleep } from './planif-cdp-lib.mjs';

const require = createRequire(fileURLToPath(new URL('../apps/web2/package.json', import.meta.url)));
const XLSX = require('xlsx');

function fila(legajo, apellido, nombre, dni, cuil, mail) {
  const row = Array(20).fill('');
  row[0] = legajo;
  row[1] = apellido;
  row[2] = nombre;
  row[3] = dni;
  row[4] = cuil;
  row[5] = mail;
  row[6] = '1100001111';
  row[7] = 'Calle Falsa 100';
  row[8] = 'Mensual';
  row[10] = 'Vigilador';
  row[11] = 'Objetivo Prueba';
  row[13] = 'M';
  row[16] = '2024-03-01';
  row[18] = 'Activo';
  return row;
}

const aoa = [
  fila('1001', 'PEREZ', 'JUAN', '30111222', '20301112220', 'juan.nuevo@prueba.test'),
  fila('2001', 'ACOSTA', 'JULIO', '40111222', '20401112228', 'julio@prueba.test'),
  fila('2002', 'DIAZ', 'MARIA', '40111333', '27401112222', 'maria@prueba.test'),
  fila('2003', 'RUIZ', 'PEDRO', '40111444', '20401114441', 'pedro@prueba.test'),
];
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'SP');
const xlsx = join(tmpdir(), 'padron-sintetico.xlsx');
XLSX.writeFile(wb, xlsx);

const ui = await abrirPlanificacion({
  objectiveId: 'obj_padron',
  clientId: 'cli_padron',
  year: 2026,
  month: 10,
  prefijo: 'padron',
  port: Number(process.env.CAPTURA_PORT || 3028),
  devtoolsPort: Number(process.env.CAPTURA_DEVTOOLS || 9355),
});
const { send, evaluate, waitFor, click, shot, cerrar, mouse, rectOf } = ui;

async function ponerArchivo(selector, archivo) {
  await send('DOM.enable');
  const doc = await send('DOM.getDocument', { depth: 0 });
  const input = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector });
  if (!input.nodeId) throw new Error(`No está ${selector}`);
  await send('DOM.setFileInputFiles', { files: [archivo], nodeId: input.nodeId });
}

try {
  await send('Page.navigate', { url: 'http://127.0.0.1:3028/admin/rrhh/' });
  await waitFor(`document.body.innerText.includes('PEREZ') || document.body.innerText.includes('2')`, 20000, 'datos de rrhh').catch(() => {});
  await evaluate(`([...document.querySelectorAll('button, [role=tab]')].find((b) => /^\\s*legajos\\s*$/i.test(b.textContent || '')) || {}).click()`);
  await waitFor(`document.querySelector('[data-padron-abrir]')`, 30000, 'botón padrón');
  await click(`document.querySelector('[data-padron-abrir]')`);
  await waitFor(`document.querySelector('[data-padron-archivo]')`, 10000, 'archivo');
  await ponerArchivo('[data-padron-archivo]', xlsx);
  await waitFor(`document.querySelector('[data-padron-bloque="emerald"]')`, 20000, 'nuevos');
  await evaluate(`document.querySelector('[data-padron-check="2003"]')?.click()`);
  await shot('comparacion');
  await click(`document.querySelector('[data-padron-aplicar]')`);
  await waitFor(`!document.querySelector('[data-padron-panel]')`, 30000, 'padrón aplicado');
  console.log('✓ padrón aplicado');

  await send('Page.navigate', { url: 'http://127.0.0.1:3028/admin/planificacion/?objectiveId=obj_padron&clientId=cli_padron&year=2026&month=10' });
  await waitFor(`document.querySelector('[data-modo-rapido-toggle]')`, 90000, 'modo rápido');
  await click(`document.querySelector('[data-modo-rapido-toggle]')`);
  await waitFor(`document.querySelector('[data-leyenda-modo-rapido]')`, 15000, 'leyenda');
  await shot('leyenda');
  writeFileSync(join(tmpdir(), 'leyenda-ok.txt'), '1');

  const tsv = [
    'PEREZ JUAN\t\t1001\tPuesto 1\tM\tT',
    'ACOSTA JULIO\t\t2001\tPuesto 1\tM\tFT/N',
    'RUIZ PEDRO\t\t2003\tPuesto 1\tVF/T\tM',
  ].join('\n');
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
  await shot('grupos');

  const pideArchivo = await evaluate(`!!document.querySelector('[data-alta-pedir-padron]')`);
  if (pideArchivo) throw new Error('Pidió el archivo teniendo padrón cargado');
  await click(`[...document.querySelectorAll('[data-pegar-alta]')].find((b) => (b.closest('li')?.innerText || '').includes('RUIZ'))`);
  await waitFor(`document.querySelector('[data-alta-fecha-padron]')`, 20000, 'fecha del padrón');
  const enPadron = await evaluate(`document.querySelector('[data-alta-en-padron]')?.getAttribute('data-alta-en-padron')`);
  if (enPadron !== '1') throw new Error('RUIZ no se encontró en el padrón guardado');
  await shot('alta-sin-archivo');
  await click(`document.querySelector('[data-alta-padron] button[aria-label="Cerrar"]')`);

  await waitFor(`document.querySelector('[data-pegar-definir="VF/T"]')`, 10000, 'definir');
  await shot('definir');
  const m = await rectOf(`document.querySelector('[data-pegar-inicio="M"]')`);
  if (m) {
    await evaluate(`(() => {
      const el = document.querySelector('[data-pegar-inicio="M"]');
      const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      d.set.call(el, '06:00');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await waitFor(`document.querySelector('[data-pegar-actualizar-servicio]')`, 8000, 'actualizar servicio');
    await shot('horarios');
  }
  console.log('✓ pegado');
} finally {
  await cerrar();
}

const { renameSync, copyFileSync, existsSync } = await import('node:fs');
const { shotsDir } = await import('./planif-cdp-lib.mjs');
const map = [
  ['padron-comparacion.png', 'padron-comparacion.png'],
  ['padron-leyenda.png', 'modo-rapido-leyenda.png'],
  ['padron-grupos.png', 'pegar-agregar-guardias.png'],
  ['padron-definir.png', 'pegar-definir-codigo.png'],
  ['padron-horarios.png', 'pegar-codigos-horarios.png'],
  ['padron-alta-sin-archivo.png', 'padron-alta.png'],
];
for (const [from, to] of map) {
  const a = join(shotsDir, from);
  const b = join(shotsDir, to);
  if (existsSync(a) && a !== b) copyFileSync(a, b);
}
console.log('capturas listas');
