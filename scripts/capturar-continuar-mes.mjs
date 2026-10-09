/**
 * Capturas 1440x900 de «Continuar desde el mes anterior» (copia de prod en un emulador propio).
 *   node scripts/continuar-mes/copiar-emulator.mjs --obj 9CbYIDmsUGnabENKvXZt --mes 2026-10
 *   PLANIF_EMU_PORTS=8080:8291,9099:9291 node scripts/capturar-continuar-mes.mjs
 */
import { readFileSync } from 'node:fs';
import { abrirPlanificacion, sleep } from './planif-cdp-lib.mjs';

const m = JSON.parse(readFileSync(new URL('./continuar-mes/.manifest.json', import.meta.url), 'utf8'));
const [year, month] = m.mes.split('-').map(Number);

const { evaluate, waitFor, click, shot, cerrar } = await abrirPlanificacion({
  objectiveId: m.objectiveId,
  clientId: m.clientId,
  year,
  month,
  prefijo: 'continuar-mes',
  port: Number(process.env.CAPTURA_PORT || 3021),
  devtoolsPort: Number(process.env.CAPTURA_DEVTOOLS || 9341),
});

try {
  await waitFor(`document.querySelector('td[data-testid=grilla-celda]')`, 120000, 'grilla');
  await waitFor(`document.querySelector('[data-continuar-mes]') && !document.querySelector('[data-continuar-mes]').disabled`, 60000, 'botón habilitado');
  await sleep(2500);
  const celdasAntes = await evaluate(`[...document.querySelectorAll('td[data-testid=grilla-celda]')].filter((td) => td.innerText.trim()).length`);
  console.log('celdas con algo antes', celdasAntes);
  await evaluate(`(() => { const b = document.querySelector('[data-continuar-mes]'); b.style.outline = '3px solid #0d9488'; b.style.outlineOffset = '2px'; })()`);
  await shot('1-boton');
  await evaluate(`document.querySelector('[data-continuar-mes]').style.outline = ''`);

  await click(`document.querySelector('[data-continuar-mes]')`);
  await waitFor(`document.querySelector('[data-continuar-mes-modal]')`, 60000, 'vista previa');
  await sleep(800);
  console.log(await evaluate(`document.querySelector('[data-continuar-mes-modal]').innerText.slice(0, 3000)`));
  await shot('2-vista-previa');
  await evaluate(`document.querySelector('[data-continuar-tabla]').scrollIntoView({ block: 'start' })`);
  await shot('3-vista-previa-tabla');

  await click(`document.querySelector('[data-continuar-aplicar]')`, 'left', 1500);
  await waitFor(`!document.querySelector('[data-continuar-mes-modal]')`, 10000, 'modal cerrado');
  await sleep(2000);
  const celdasDespues = await evaluate(`[...document.querySelectorAll('td[data-testid=grilla-celda]')].filter((td) => td.innerText.trim()).length`);
  console.log('celdas con algo después', celdasDespues);
  console.log('cobertura', await evaluate(`[...(document.querySelector('tfoot tr')?.querySelectorAll('td') || [])].slice(1).map((td) => td.innerText).join(' ')`));
  await evaluate(`window.scrollTo(0, 0)`);
  await shot('4-grilla-aplicada');
  if (process.env.GUARDAR) {
    await evaluate(`window.confirm = () => true`);
    await click(`document.querySelector('button[title="Guardar cambios pendientes"]')`, 'left', 1000);
    await waitFor(`![...document.querySelectorAll('span')].some((s) => /[0-9]+ camb/.test(s.innerText))`, 180000, 'guardado');
    await sleep(3000);
    console.log('guardado');
    await shot('5-guardado');
  }
} finally {
  await cerrar();
}
process.exit(0);
