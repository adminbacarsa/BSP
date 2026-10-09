/**
 * Modal «Continuar desde octubre» de Tadicor (noviembre) y la fila de CACERES.
 *   PLANIF_EMU_PORTS=8080:8291,9099:9291 node scripts/capturar-continuar-ret.mjs
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { abrirPlanificacion, sleep } from './planif-cdp-lib.mjs';

const m = JSON.parse(readFileSync(new URL('./continuar-mes/.manifest.json', import.meta.url), 'utf8'));
const [year, month] = m.mes.split('-').map(Number);
const EMP = 'di53KCLWRsq9q225SXml';

const { evaluate, waitFor, click, shot, cerrar } = await abrirPlanificacion({
  objectiveId: m.objectiveId,
  clientId: m.clientId,
  year,
  month,
  prefijo: 'continuar-mes',
  port: Number(process.env.CAPTURA_PORT || 3053),
  devtoolsPort: Number(process.env.CAPTURA_DEVTOOLS || 9387),
});

try {
  await waitFor(`document.querySelector('td[data-testid=grilla-celda]')`, 120000, 'grilla');
  await waitFor(`document.querySelector('[data-continuar-mes]') && !document.querySelector('[data-continuar-mes]').disabled`, 60000, 'botón habilitado');
  await sleep(1200);
  await click(`document.querySelector('[data-continuar-mes]')`);
  await waitFor(`document.querySelector('[data-continuar-guardia="${EMP}"]')`, 90000, 'fila CACERES');
  await sleep(600);
  await evaluate(`document.querySelector('[data-continuar-guardia="${EMP}"]').scrollIntoView({ block: 'center' })`);
  await sleep(300);
  const fila = await evaluate(`document.querySelector('[data-continuar-guardia="${EMP}"]')?.innerText.replace(/\\s+/g,' ') || ''`);
  const alertas = await evaluate(`document.querySelector('[data-continuar-alertas]')?.innerText || ''`);
  console.log('CACERES', fila);
  console.log('ALERTAS', alertas);
  await shot('ret-modal');
  await click(`document.querySelector('[data-continuar-aplicar]')`);
  await waitFor(`!document.querySelector('[data-continuar-mes-modal]')`, 20000, 'modal cerrado');
  await waitFor(`document.getElementById('plan-emp-${EMP}')`, 30000, 'fila en la grilla');
  await sleep(600);
  await evaluate(`document.getElementById('plan-emp-${EMP}').scrollIntoView({ block: 'center' })`);
  await sleep(400);
  const grilla = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('tr[id^="plan-emp-"]')];
    const pack = (tr, i) => {
      if (!tr) return null;
      const celdas = [...tr.querySelectorAll('td[data-testid=grilla-celda]')];
      const texto = celdas.map((td) => (td.innerText || '').replace(/\\s+/g, ' ').trim());
      const vacias = texto.map((t, k) => (t ? '' : String(k + 1))).filter(Boolean);
      const lct = celdas.map((td, k) => (td.querySelector('.bg-amber-500') ? String(k + 1) : '')).filter(Boolean);
      return { i: i + 1, nombre: (tr.innerText || '').split('\\n')[0].trim().slice(0, 40), dia21: texto[20] || '', vacias: vacias.join(','), lct: lct.join(',') };
    };
    const cac = document.getElementById('plan-emp-${EMP}');
    return JSON.stringify({ n: rows.length, fila5: pack(rows[4], 4), caceres: pack(cac, rows.indexOf(cac)) });
  })()`);
  console.log('GRILLA', grilla);
  await shot('ret-fila');
  const py = spawnSync('python', ['-c', `
from PIL import Image
from pathlib import Path
d = Path(r"${process.cwd()}").joinpath("docs", "capturas-cobertura")
modal = Image.open(d / "continuar-mes-ret-modal.png").convert("RGB")
fila = Image.open(d / "continuar-mes-ret-fila.png").convert("RGB")
w = max(modal.width, fila.width)
gap = 12
out = Image.new("RGB", (w, modal.height + gap + fila.height), (15, 23, 42))
out.paste(modal, (0, 0))
out.paste(fila, (0, modal.height + gap))
out.save(d / "continuar-mes-ret.png")
print("stitched", out.size)
`], { encoding: 'utf8' });
  if (py.status !== 0) throw new Error(py.stderr || py.stdout || 'no se pudo unir la captura');
  console.log(py.stdout.trim());
} finally {
  await cerrar();
}
process.exit(0);
