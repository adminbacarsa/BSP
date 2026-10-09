/**
 * Grilla con un guardia sobre 200 h. El nombre del archivo es tope-200-{antes|despues}.png.
 *   PLANIF_EMU_PORTS=8080:8190,9099:9199 CAPTURA_NOMBRE=antes node scripts/capturar-tope-200.mjs
 */
import { abrirPlanificacion, sleep } from './planif-cdp-lib.mjs';

const nombre = process.env.CAPTURA_NOMBRE || 'despues';
const { evaluate, waitFor, shot, cerrar } = await abrirPlanificacion({
  objectiveId: 'g2_ninos',
  clientId: 'g2_cli',
  year: 2026,
  month: 10,
  prefijo: 'tope-200',
  port: Number(process.env.CAPTURA_PORT || 3049),
  devtoolsPort: Number(process.env.CAPTURA_DEVTOOLS || 9383),
});

try {
  await waitFor(`document.querySelector('#plan-emp-tope_emp')`, 120000, 'fila tope');
  await sleep(800);
  await evaluate(`document.querySelector('#plan-emp-tope_emp')?.scrollIntoView({ block: 'center' })`);
  await sleep(400);
  const pills = await evaluate(`[...document.querySelectorAll('#plan-emp-tope_emp td')].filter((td) => td.innerText.includes('200')).length`);
  const marcas = await evaluate(`[...document.querySelectorAll('#plan-emp-tope_emp [data-marca-tope="1"]')].length`);
  const chip = await evaluate(`document.querySelector('[data-tope-chip="tope_emp"]')?.innerText || ''`);
  const title = await evaluate(`document.querySelector('[data-tope-chip="tope_emp"]')?.getAttribute('title') || ''`);
  console.log(JSON.stringify({ nombre, pills, marcas, chip, title }));
  await shot(nombre);
} finally {
  await cerrar();
}
process.exit(0);
