/**
 * Sobrecobertura del día 1 y menú Liberar del día 2.
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8291 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9291 node scripts/seed-sobrecobertura-emu.mjs
 *   NEXT_PUBLIC_USE_EMULATOR=true npm --prefix apps/web2 run build
 *   PLANIF_EMU_PORTS=8080:8291,9099:9291 node scripts/capturar-sobrecobertura.mjs
 * → docs/capturas-cobertura/sobrecobertura.png y liberar-ret.png
 */
import { renameSync } from 'node:fs';
import { join } from 'node:path';
import { abrirPlanificacion, shotsDir } from './planif-cdp-lib.mjs';

const { click, waitFor, shot, cerrar, celda } = await abrirPlanificacion({
  objectiveId: 'obj_sobrecob',
  clientId: 'cli_sobrecob',
  year: 2026,
  month: 10,
  prefijo: 'sobrecobertura',
  port: Number(process.env.CAPTURA_PORT || 3026),
  devtoolsPort: Number(process.env.CAPTURA_DEVTOOLS || 9346),
});

try {
  await waitFor(`document.querySelector('td[data-testid=grilla-celda]')`, 120000, 'grilla');
  await waitFor(`document.querySelector('[data-cobertura-dia="2026-10-01"]')`, 30000, 'fila cobertura');
  await waitFor(`(document.querySelector('[data-cobertura-dia="2026-10-01"]')?.getAttribute('data-cobertura-extra') || '') !== ''`, 20000, 'extra del día 1');
  await click(`document.querySelector('[data-cobertura-dia="2026-10-01"]')`);
  await waitFor(`document.querySelector('[data-lectura-dia]')`, 15000, 'lectura del día');
  await waitFor(`document.querySelector('[data-puestos-de-mas]')`, 10000, 'puestos con de más');
  await waitFor(`document.querySelector('[data-sin-puesto]')`, 10000, 'sin puesto');
  await shot('dia');
  renameSync(join(shotsDir, 'sobrecobertura-dia.png'), join(shotsDir, 'sobrecobertura.png'));
  console.log('✓', join(shotsDir, 'sobrecobertura.png'));

  await click(`document.querySelector('[data-cobertura-dia="2026-10-01"]')`);
  await click(celda('empVidela', 2), 'right');
  await waitFor(`document.querySelector('[data-menu-accion="liberar"]')`, 10000, 'liberar');
  await shot('liberar');
  renameSync(join(shotsDir, 'sobrecobertura-liberar.png'), join(shotsDir, 'liberar-ret.png'));
  console.log('✓', join(shotsDir, 'liberar-ret.png'));
} finally {
  await cerrar();
}
process.exit(0);
