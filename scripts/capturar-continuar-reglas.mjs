/**
 * Captura 1440x900 del modal con los ciclos estimados (ámbar, casilla destildada).
 *   PLANIF_EMU_PORTS=8080:8291,9099:9291 node scripts/capturar-continuar-reglas.mjs
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
  port: Number(process.env.CAPTURA_PORT || 3025),
  devtoolsPort: Number(process.env.CAPTURA_DEVTOOLS || 9345),
});

try {
  await waitFor(`document.querySelector('td[data-testid=grilla-celda]')`, 120000, 'grilla');
  await waitFor(`document.querySelector('[data-continuar-mes]') && !document.querySelector('[data-continuar-mes]').disabled`, 60000, 'botón habilitado');
  await sleep(1500);
  await click(`document.querySelector('[data-continuar-mes]')`);
  await waitFor(`document.querySelector('[data-continuar-mes-modal]')`, 60000, 'vista previa');
  await waitFor(`document.querySelector('[data-continuar-estimado]')`, 30000, 'fila estimada');
  await sleep(600);
  const resumen = await evaluate(`(() => {
    const filas = [...document.querySelectorAll('[data-continuar-estimado]')];
    return {
      n: filas.length,
      notas: filas.map((tr) => tr.querySelector('[data-continuar-nota]')?.textContent || ''),
      destildadas: filas.filter((tr) => !tr.querySelector('input[type=checkbox]')?.checked).length,
      tildadasFijas: [...document.querySelectorAll('[data-continuar-guardia]')].filter((tr) => !tr.hasAttribute('data-continuar-estimado') && tr.querySelector('input[type=checkbox]')?.checked).length,
    };
  })()`);
  console.log(JSON.stringify(resumen));
  await evaluate(`document.querySelector('[data-continuar-estimado]').scrollIntoView({ block: 'center' })`);
  await sleep(400);
  await shot('reglas');
} finally {
  await cerrar();
}
process.exit(0);
