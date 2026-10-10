/**
 * Captura 1440x900 de la vista previa c2 de «Continuar» (plantilla, grupo, copia de, nivelación tildable).
 *   npx firebase emulators:start --only auth,firestore --config firebase.importar-8291.json --project comtroldata
 *   node scripts/continuar-mes/copiar-emulator.mjs --obj 9CbYIDmsUGnabENKvXZt --mes 2026-10 --anonimizar
 *   NEXT_PUBLIC_USE_EMULATOR=true npm --prefix apps/web2 run build
 *   PLANIF_EMU_PORTS=8080:8291,9099:9291 node scripts/capturar-continuar-c2.mjs
 * → docs/capturas-cobertura/continuar-c2.png
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
  prefijo: 'continuar',
  port: Number(process.env.CAPTURA_PORT || 3022),
  devtoolsPort: Number(process.env.CAPTURA_DEVTOOLS || 9342),
});

try {
  await waitFor(`document.querySelector('td[data-testid=grilla-celda]')`, 120000, 'grilla');
  await waitFor(`document.querySelector('[data-continuar-mes]') && !document.querySelector('[data-continuar-mes]').disabled`, 60000, 'botón habilitado');
  await sleep(2500);
  await click(`document.querySelector('[data-continuar-mes]')`);
  await waitFor(`document.querySelector('[data-continuar-mes-modal]')`, 60000, 'vista previa');
  await sleep(800);
  const resumen = await evaluate(`JSON.stringify({
    vias: [...document.querySelectorAll('[data-continuar-via]')].map((r) => r.getAttribute('data-continuar-via')),
    origenes: [...document.querySelectorAll('[data-continuar-origen]')].map((r) => r.innerText),
    sugerencias: document.querySelectorAll('[data-continuar-sugerencia]').length,
  })`);
  console.log(resumen);
  const hay = await evaluate(`!!document.querySelector('[data-continuar-nivelacion]')`);
  if (hay) {
    await evaluate(`(() => { const s = [...document.querySelectorAll('[data-continuar-sugerencia] input')]; s.slice(0, 2).forEach((i) => i.click()); })()`);
    await sleep(300);
    await evaluate(`(() => {
      const t = document.querySelector('[data-continuar-tabla]');
      const n = document.querySelector('[data-continuar-nivelacion]');
      const box = t.closest('.overflow-y-auto');
      box.scrollTop = Math.max(0, n.offsetTop - box.clientHeight + n.offsetHeight + 12);
    })()`);
  } else {
    await evaluate(`document.querySelector('[data-continuar-tabla]').scrollIntoView({ block: 'start' })`);
  }
  await sleep(400);
  await shot('c2');
} finally {
  await cerrar();
}
process.exit(0);
