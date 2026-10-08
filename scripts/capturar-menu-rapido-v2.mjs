#!/usr/bin/env node
/**
 * Capturas 1440x900 de la GRILLA real de Planificación con el menú rápido (clic derecho → modo elegir).
 * Requiere: emuladores Auth + Firestore, `node scripts/seed-admin.js`, `node scripts/seed-captura-menu-rapido.mjs`
 * y `next build` en apps/web2 con NEXT_PUBLIC_USE_EMULATOR=true.
 *
 *   node scripts/capturar-menu-rapido-v2.mjs
 */
import { abrirPlanificacion, sleep } from './planif-cdp-lib.mjs';

const { evaluate, waitFor, click, hover, shot, cerrar, celda } = await abrirPlanificacion({
  objectiveId: 'obj_mr',
  clientId: 'cli_mr',
  prefijo: 'menu-rapido-v2',
  port: Number(process.env.CAPTURA_PORT || 3011),
});
await waitFor(`${celda('mr_baez', 13)}`, 90000, 'grilla con BAEZ');
await sleep(2500);

// 1. Menú abierto sobre la V de BAEZ (13/10)
await click(celda('mr_baez', 13), 'right');
await waitFor(`document.querySelector('[data-menu-rapido=raiz]')`, 5000, 'menú');
await shot('1-menu');

// 2. Modo elegir (Asignar a…) con la franja
await click(`document.querySelector('[data-menu-accion=asignar]')`);
await waitFor(`document.querySelector('[data-franja-elegir]')`, 5000, 'franja');
await hover(celda('mr_ferrero', 9));
await shot('2-elegir-asignar');

// 2b. Un clic que no pasa (BARROS está de franco ese día)
await click(celda('mr_barros', 13));
await waitFor(`document.querySelector('[data-franja-aviso]')`, 5000, 'aviso');
await shot('2b-elegir-aviso');

// 3. FERRERO (RET) cubre: celda pendiente con la marca + oferta de repetir
await click(celda('mr_ferrero', 20));
await waitFor(`document.querySelector('[data-franja-repetir]')`, 8000, 'oferta repetir');
await hover(celda('mr_ferrero', 13), 2600);
await shot('3-asignado');
await hover(`document.querySelector('[data-franja-repetir]')`);
await shot('6-repetir');

// 7. Repetir: 14/10 se aplica, 15/10 se saltea (FERRERO con licencia)
await click(`document.querySelector('[data-franja-repetir]')`);
await waitFor(`document.querySelector('[data-franja-aviso]')`, 8000, 'resultado repetir');
await shot('7-repetir-resultado');
await click(`document.querySelector('[data-franja-cancelar]')`);

// 4 y 5. Ext / Adel sobre el 15/10
await click(celda('mr_baez', 15), 'right');
await waitFor(`document.querySelector('[data-menu-rapido=raiz]')`, 5000, 'menú 15');
await click(`document.querySelector('[data-menu-accion=ext]')`);
await waitFor(`document.querySelector('[data-franja-elegir]')`, 5000, 'franja ext');
const extId = process.env.CAPTURA_EXT || 'mr_galeano';
const adelId = process.env.CAPTURA_ADEL || 'mr_barros';
await click(celda(extId, 15));
await sleep(300);
await shot('4-ext');
await click(celda(adelId, 15));
await sleep(600);
if (await evaluate(`!!document.querySelector('[data-franja-elegir]')`)) {
  console.log('franja:', await evaluate(`document.querySelector('[data-franja-elegir]').innerText`));
}
await hover(celda(extId, 15), 2600);
await shot('5-ext-adel');

await cerrar();
process.exit(0);
