/**
 * Capturas 1440x900 del servicio armado desde la planilla.
 * Los tres cronogramas reales se suben en el emulador; la captura del panel de avisos
 * usa el objetivo sintético (PEREZ), para no guardar nombres de la planilla.
 *
 *   node scripts/importar-excel/preparar-servicio-emulator.mjs
 *   PLANIF_EMU_PORTS=8080:8291,9099:9291 node scripts/capturar-servicio-planilla.mjs
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { abrirPlanificacion, sleep } from './planif-cdp-lib.mjs';

const require = createRequire(fileURLToPath(new URL('../apps/web2/package.json', import.meta.url)));
const XLSX = require('xlsx');
const m = JSON.parse(readFileSync(new URL('./importar-excel/.manifest-servicio.json', import.meta.url), 'utf8'));
const DIR = 'C:/Users/Mauro/OneDrive/Desktop/2026/10 - Octubre/';
const port = Number(process.env.CAPTURA_PORT || 3027);

const letras = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const dow = new Date(Date.UTC(2026, 9, 1)).getUTCDay();
const vacio = () => Array(6).fill('');
const filaDias = (valor) => {
  const row = vacio();
  for (let d = 1; d <= 31; d++) row.push(valor(d));
  return row;
};
const aoa = [
  [],
  [],
  [],
  ['BACAR', '', '', '', '', '', 'Objetivo Aviso'],
  [],
  filaDias((d) => letras[(dow + d - 1) % 7]),
  filaDias((d) => d),
  ['PEREZ JUAN', '', '', '', 1001, 'Puesto 1', ...Array.from({ length: 31 }, (_, i) => {
    const letra = ['D', 'L', 'M', 'X', 'J', 'V', 'S'][(dow + i) % 7];
    if (letra === 'S' || letra === 'D') return 'M';
    return i % 5 === 0 ? 'T' : 'M';
  })],
  [],
  ['REFERENCIAS', '', '', '', '', '', '', '', 'M', 'Mañana', '', '', 'T', 'Tarde', '', '', 'F', 'Franco'],
  ['', '', '', '', '', '', '', '', '', '07 a 15 hs', '', '', '', '15 a 23 hs'],
  ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'OCTUBRE 2026'],
];
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Hoja1');
const xlsxAviso = join(tmpdir(), 'planilla-aviso-servicio.xlsx');
XLSX.writeFile(wb, xlsxAviso);

const { send, evaluate, waitFor, shot, cerrar } = await abrirPlanificacion({
  objectiveId: m.casos.peaje.objectiveId,
  clientId: m.casos.peaje.clientId,
  year: 2026,
  month: 10,
  prefijo: 'servicio-planilla',
  port,
  devtoolsPort: Number(process.env.CAPTURA_DEVTOOLS || 9347),
});

async function ir(caso) {
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/admin/planificacion/?objectiveId=${caso.objectiveId}&clientId=${caso.clientId}&year=2026&month=10` });
  await waitFor(`location.search.includes(${JSON.stringify(caso.objectiveId)}) && document.querySelector('[data-servicio-planilla]') && !document.querySelector('[data-servicio-planilla]').disabled`, 120000, `servicio ${caso.nombre}`);
  await sleep(800);
}

async function taparFondo() {
  await evaluate(`(() => {
    let s = document.getElementById('tapa-nombres');
    if (!s) {
      s = document.createElement('div');
      s.id = 'tapa-nombres';
      s.style.cssText = 'position:fixed;inset:0;background:#e2e8f0;z-index:70';
      document.body.appendChild(s);
    }
  })()`);
}

async function subirServicio(archivo) {
  await evaluate(`document.querySelector('[data-servicio-planilla]').click()`);
  await waitFor(`document.querySelector('[data-servicio-planilla-modal]')`, 30000, 'modal servicio');
  await evaluate(`(() => {
    const modal = document.querySelector('[data-servicio-planilla-modal]');
    const sels = modal.querySelectorAll('select');
    const srv = sels[1];
    if (srv && !srv.value && srv.options.length > 1) {
      srv.value = srv.options[1].value;
      srv.dispatchEvent(new Event('change', { bubbles: true }));
    }
  })()`);
  const doc = await send('DOM.getDocument', { depth: -1 });
  const input = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[data-servicio-archivo]' });
  if (!input.nodeId) throw new Error('No está el input de la planilla');
  await send('DOM.setFileInputFiles', { files: [archivo], nodeId: input.nodeId });
  await waitFor(`document.querySelector('[data-servicio-propuesta]')`, 30000, 'propuesta');
  await sleep(400);
}

function resumenDiff() {
  return evaluate(`(() => {
    const estados = [...document.querySelectorAll('[data-servicio-estado]')].map((el) => el.getAttribute('data-servicio-estado'));
    const cuenta = (k) => estados.filter((e) => e === k).length;
    return { coincide: cuenta('coincide'), distinto: cuenta('distinto'), falta: cuenta('falta'), sobra: cuenta('sobra'), franjas: document.querySelectorAll('[data-servicio-franja]').length };
  })()`);
}

async function ajustarYGuardar(nombre) {
  await evaluate(`(() => {
    const input = document.querySelector('[data-servicio-franja] input[type=number]');
    const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    d.set.call(input, String(Number(input.value || '1') + 1));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(200);
  const cual = await evaluate(`document.querySelector('[data-servicio-crear]') ? 'crear' : 'aplicar'`);
  await evaluate(`document.querySelector('[data-servicio-${cual}]').click()`);
  await waitFor(`document.querySelector('[data-servicio-confirmar]')`, 10000, 'confirmación');
  await taparFondo();
  await shot(`${nombre}-confirmar`);
  await evaluate(`document.querySelector('[data-servicio-confirmar-ok]').click()`);
  await waitFor(`!document.querySelector('[data-servicio-planilla-modal]')`, 30000, 'servicio guardado');
  console.log(nombre, 'guardado vía', cual);
}

async function importar(archivo) {
  await evaluate(`document.querySelector('[data-importar-excel]').click()`);
  await waitFor(`document.querySelector('[data-importar-excel-modal]')`, 20000, 'modal importar');
  const doc = await send('DOM.getDocument', { depth: -1 });
  const input = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[data-importar-archivo]' });
  await send('DOM.setFileInputFiles', { files: [archivo], nodeId: input.nodeId });
  await waitFor(`document.querySelector('[data-cuadro-detectado]')`, 20000, 'cuadro');
  await evaluate(`document.querySelector('[data-importar-siguiente]').click()`);
  await waitFor(`document.querySelector('[data-import-paso="2"]')`, 15000, 'destino');
  const uso = await evaluate(`!!document.querySelector('[data-usar-propuesta]')`);
  if (uso) {
    await evaluate(`document.querySelector('[data-usar-propuesta]').click()`);
    await sleep(300);
  }
  for (let i = 0; i < 4; i++) {
    const paso = await evaluate(`document.querySelector('[data-import-paso]')?.getAttribute('data-import-paso')`);
    if (paso === '6') break;
    await evaluate(`document.querySelector('[data-importar-siguiente]')?.click()`);
    await sleep(500);
  }
  await waitFor(`document.querySelector('[data-importar-resumen]')`, 20000, 'resumen');
  const resumen = await evaluate(`document.querySelector('[data-importar-resumen]').innerText.split('\\n')[0]`);
  await evaluate(`document.querySelector('[data-importar-aplicar]').click()`);
  await waitFor(`!document.querySelector('[data-importar-excel-modal]')`, 30000, 'borrador aplicado');
  await sleep(1200);
  const avisos = await evaluate(`document.querySelector('[data-modo-rapido-avisos]')?.getAttribute('data-modo-rapido-avisos') || '0'`);
  return { resumen, avisos };
}

try {
  if (process.env.SOLO_AVISO !== '1') for (const clave of ['peaje', 'corblock', 'tadicor']) {
    const caso = m.casos[clave];
    await ir(caso);
    await subirServicio(DIR + caso.archivo);
    const diff = await resumenDiff();
    const elegido = await evaluate(`document.querySelector('[data-servicio-planilla-modal] select')?.selectedOptions?.[0]?.textContent || ''`);
    console.log(clave, elegido, JSON.stringify(diff));
    await taparFondo();
    await shot(clave);
    await ajustarYGuardar(clave);
    const imp = await importar(DIR + caso.archivo);
    console.log(clave, 'import', imp.resumen, 'avisos', imp.avisos);
  }

  await ir(m.casos.aviso);
  await importar(xlsxAviso);
  await waitFor(`document.querySelector('[data-modo-rapido-avisos]')`, 20000, 'pastilla de avisos');
  await evaluate(`document.querySelector('[data-modo-rapido-avisos-pill]')?.click()`);
  await waitFor(`document.querySelector('[data-aviso-grupo]')`, 15000, 'panel de avisos');
  await shot('avisos');
  const texto = await evaluate(`(() => {
    const n = document.querySelectorAll('[data-aviso-grupo]').length;
    const fuera = [...document.querySelectorAll('[data-aviso-grupo]')].filter((el) => el.innerText.includes('Fuera del servicio')).length;
    return { grupos: n, fuera };
  })()`);
  console.log('aviso sintético', JSON.stringify(texto));
} finally {
  await cerrar();
}
process.exit(0);
