/**
 * Capturas que faltaban de la tanda 12 h (emulador propio 8291/9291, nunca el lab).
 *   firebase emulators:start --only auth,firestore --config firebase.importar-8291.json --project comtroldata
 *   NEXT_PUBLIC_USE_EMULATOR=true npm --prefix apps/web2 run build
 *   PLANIF_EMU_PORTS=8080:8291,9099:9291 FIRESTORE_EMULATOR_HOST=127.0.0.1:8291 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9291 node scripts/capturar-pendientes-12h.mjs
 */
import { renameSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { abrirPlanificacion, shotsDir, sleep } from './planif-cdp-lib.mjs';

const host = process.env.FIRESTORE_EMULATOR_HOST || '';
if (!/^(127\.0\.0\.1|localhost):8291$/.test(host)) throw new Error('Solo el emulador propio :8291.');

const require = createRequire(fileURLToPath(new URL('../apps/functions/package.json', import.meta.url)));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const app = initializeApp({ projectId: 'comtroldata' }, 'captura-pendientes');
const db = getFirestore(app);
const auth = getAuth(app);
const empresaId = 'bacarsa';
const clientId = 'cliPend12';
const obrador = 'objPend12';
const now = Timestamp.now();
const fail = (m) => { console.error('✗', m); process.exitCode = 1; };

const EMAIL = 'admin@bacarsa.com.ar';
let uid;
try { uid = (await auth.getUserByEmail(EMAIL)).uid; } catch {
  uid = (await auth.createUser({ email: EMAIL, password: 'admin1234', displayName: 'Admin' })).uid;
}
await auth.setCustomUserClaims(uid, { role: 'SUPERADMIN' });
await db.collection('system_users').doc(uid).set({ email: EMAIL, role: 'SUPERADMIN', empresaId, nombre: 'Admin' }, { merge: true });
await db.collection('empresas').doc(empresaId).set({ name: 'Bacarsa', migracionCompleta: true }, { merge: true });

const banda = (code, startTime, endTime, hours) => ({ code, startTime, endTime, hours, quantity: 1 });
const doce = [banda('D12', '07:00', '19:00', 12), banda('N12', '19:00', '07:00', 12)];
const p24 = (name) => ({
  name, positionName: name, quantity: 1, coverageType: '24hs', activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
  allowedShiftTypes: [banda('M', '07:00', '15:00', 8), banda('T', '15:00', '23:00', 8), banda('N', '23:00', '07:00', 8), ...doce],
});
for (const [id, desde, hasta] of [
  ['slaPend12oct', '2026-10-01', '2026-10-31'],
  ['slaPend12nov', '2026-11-01', '2026-11-30'],
]) {
  await db.collection('servicios_sla').doc(id).set({
    empresaId, clientId, clientName: 'CASISA', objectiveId: obrador, objectiveName: 'Obrador Malagueño',
    status: 'active', active: true, startDate: desde, endDate: hasta,
    positions: [p24('Puesto 1'), p24('Puesto 2')], createdAt: now,
  });
}
await db.collection('clients').doc(clientId).set({
  name: 'CASISA', empresaId, status: 'ACTIVE', active: true,
  objetivos: [{ id: obrador, name: 'Obrador Malagueño', active: true, status: 'ACTIVE' }],
  createdAt: now,
});
await db.collection('planificacion_estados').doc(`${empresaId}_${obrador}_2026_10`).set({
  empresaId, objectiveId: obrador, year: 2026, month: 10, status: 'DRAFT',
});
await db.collection('planificacion_estados').doc(`${empresaId}_${obrador}_2026_11`).set({
  empresaId, objectiveId: obrador, year: 2026, month: 11, status: 'DRAFT',
});

const guardias = [
  { id: 'pendHerrera', name: 'HERRERA, Matías', legajo: '6101', pos: 'Puesto 1' },
  { id: 'pendNievas', name: 'NIEVAS, Adriana', legajo: '6102', pos: 'Puesto 1' },
  { id: 'pendQuiroga', name: 'QUIROGA, Fabián', legajo: '6103', pos: 'Puesto 1' },
  { id: 'pendPalacios', name: 'PALACIOS, Julio', legajo: '6104', pos: 'Puesto 2' },
  { id: 'pendPeralta', name: 'PERALTA, Jeremías', legajo: '6105', pos: 'Puesto 2' },
  { id: 'pendRegalo', name: 'REGALO, Juan', legajo: '6106', pos: 'Puesto 2' },
];
const snapViejos = await db.collection('turnos').where('objectiveId', '==', obrador).get();
for (let i = 0; i < snapViejos.docs.length; i += 400) {
  const b = db.batch();
  snapViejos.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
  await b.commit();
}
for (const g of guardias) {
  const [apellido, nombre] = g.name.split(',').map((s) => s.trim());
  await db.collection('empleados').doc(g.id).set({
    empresaId, name: g.name, fullName: g.name, nombre, apellido, lastName: apellido, firstName: nombre,
    fileNumber: g.legajo, legajo: g.legajo, status: 'ACTIVE', modalidad: 'NOMINA', category: 'VIGILADOR',
    preferredObjectiveId: obrador, preferredObjectiveIds: [obrador],
    planificacionDotacion: { [obrador]: { positionName: g.pos } }, createdAt: now,
  });
}
const HORAS = { M: ['07:00', '15:00', 8], T: ['15:00', '23:00', 8], N: ['23:00', '07:00', 8], D12: ['07:00', '19:00', 12], N12: ['19:00', '07:00', 12], F: ['00:00', '00:00', 0], ART: ['00:00', '00:00', 0] };
const ymd = (mes, d) => `2026-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const stamp = (ds, hm, sig) => {
  const d = new Date(`${ds}T${hm}:00-03:00`);
  if (sig) d.setUTCDate(d.getUTCDate() + 1);
  return Timestamp.fromDate(d);
};
async function turno(g, mes, d, code, extra = {}) {
  const ds = ymd(mes, d);
  const [s, e, h] = HORAS[code] || HORAS.M;
  await db.collection('turnos').doc(`${g.id}${ds.replace(/-/g, '')}`).set({
    empresaId, clientId, objectiveId: obrador, objectiveName: 'Obrador Malagueño', positionName: extra.positionName || g.pos,
    employeeId: g.id, employeeName: g.name, code, name: code, scheduleDate: ds, hours: h, draft: true,
    startTime: stamp(ds, s, false), endTime: stamp(ds, e, e <= s && code !== 'F' && code !== 'ART'),
    isFranco: code === 'F', ...extra,
  });
}
const [herrera, nieves, quiroga, palacios, peralta, regalo] = guardias;
await turno(herrera, 10, 2, 'M');
await turno(nieves, 10, 2, 'T');
await turno(quiroga, 10, 2, 'N');
await turno(palacios, 10, 2, 'D12', { coverageMode: '12H', coversBandCode: 'T', coversPositionName: 'Puesto 2', coversDateStr: '2026-10-02', coversVacante: true });
await turno(peralta, 10, 2, 'N');
await turno(regalo, 10, 2, 'ART', { originalCode: 'T', originalPositionName: 'Puesto 2', isNovedad: true });
const ciclo = ['M', 'T', 'N', 'M', 'T', 'N', 'F', 'F'];
for (let d = 1; d <= 24; d++) {
  if (d === 2) continue;
  for (const [i, g] of [herrera, nieves, quiroga, palacios, peralta].entries()) {
    await turno(g, 10, d, ciclo[(d + i) % ciclo.length]);
  }
  await turno(regalo, 10, d, d <= 5 ? 'ART' : ciclo[(d + 3) % ciclo.length], d <= 5 ? { originalCode: 'T', originalPositionName: 'Puesto 2' } : {});
  if (d >= 3) await turno(herrera, 10, d, 'D12');
}
console.log('✓ seed');

const sesion = await abrirPlanificacion({
  objectiveId: obrador, clientId, year: 2026, month: 10, prefijo: 'bug-12h-entre-puestos',
  port: Number(process.env.CAPTURA_PORT || 3033), devtoolsPort: Number(process.env.CAPTURA_DEVTOOLS || 9373),
});
const { send, evaluate, waitFor, click, shot, cerrar } = sesion;
const exacta = async (nombre) => {
  await shot('tmp');
  renameSync(`${shotsDir}/bug-12h-entre-puestos-tmp.png`, `${shotsDir}/${nombre}.png`);
  console.log('✓', `${shotsDir}/${nombre}.png`);
};
try {
  await waitFor(`document.getElementById('plan-emp-pendRegalo')`, 120000, 'grilla');
  await sleep(1500);
  await waitFor(`document.querySelector('[data-bandas-faltantes], [data-bandas-faltantes-pastilla]')`, 20000, 'panel de bandas');
  if (await evaluate(`!!document.querySelector('[data-bandas-faltantes-pastilla]')`)) {
    await click(`document.querySelector('[data-bandas-faltantes-pastilla]')`);
    await waitFor(`document.querySelector('[data-bandas-faltantes]')`, 8000, 'panel abierto');
  }
  await exacta('bandas-faltantes-panel');
  await evaluate(`document.querySelector('[aria-label="Cerrar bandas faltantes"]')?.click()`);
  await sleep(400);

  await waitFor(`document.querySelector('[data-cobertura-dia="2026-10-02"]')`, 20000, 'cobertura día 2');
  const antes = await evaluate(`document.querySelector('[data-cobertura-dia="2026-10-02"]').getAttribute('title') || ''`);
  console.log('antes:', antes.replace(/\n/g, ' | '));
  await click(`document.querySelector('[data-cobertura-dia="2026-10-02"]')`);
  await sleep(500);
  await shot('antes');

  await turno(peralta, 10, 2, 'N12', {
    coverageMode: '12H', coversBandCode: 'T', coversPositionName: 'Puesto 2', coversDateStr: '2026-10-02',
    coversEmployeeId: 'pendRegalo', coversEmployeeName: 'REGALO, Juan', coversAbsenceCode: 'ART', coversVacante: false, employeeName: 'PERALTA, Jeremías',
  });
  await db.collection('turnos').doc(`pendPalacios20261002`).set({
    coversEmployeeId: 'pendRegalo', coversEmployeeName: 'REGALO, Juan', coversAbsenceCode: 'ART', coversVacante: false, employeeName: 'PALACIOS, Julio',
  }, { merge: true });
  await sleep(2500);
  await evaluate(`([...document.querySelectorAll('[data-puestos-sin-cerrar] button')].find((b) => (b.textContent || '').trim() === 'Cerrar') || { click() {} }).click()`);
  await waitFor(`!document.querySelector('[data-puestos-sin-cerrar]')`, 8000, 'popover cerrado');
  await sleep(600);
  const despues = await evaluate(`document.querySelector('[data-cobertura-dia="2026-10-02"]').getAttribute('title') || ''`);
  console.log('despues:', despues.replace(/\n/g, ' | '));
  if (/falta/i.test(despues)) fail('el día 2 sigue marcando falta después del N12');
  await shot('despues');

  await click(`document.querySelector('[data-action="publicar-cronograma"]')`);
  await waitFor(`document.querySelector('[data-publicar-excepciones], [data-publicar-sin-servicio]') || [...document.querySelectorAll('button')].some((b) => /Publicar cronograma/.test(b.textContent || ''))`, 15000, 'modal publicar');
  await sleep(600);
  await exacta('publicar-pin-detalle');
  await evaluate(`([...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Cancelar') || { click() {} }).click()`);
  await waitFor(`!document.querySelector('[data-publicar-excepciones]')`, 8000, 'publicar cerrado');
  await sleep(400);

  const btnServ = await evaluate(`(() => { const b = document.querySelector('button[data-servicio-planilla]'); return b ? (b.disabled ? 'disabled' : 'ok') : 'no'; })()`);
  console.log('botón servicio:', btnServ);
  await click(`document.querySelector('button[data-servicio-planilla]')`);
  await waitFor(`document.querySelector('[data-servicio-planilla-modal]')`, 15000, 'modal servicio');
  await sleep(500);
  await click(`document.querySelector('[data-servicio-desde-turnos]')`);
  await waitFor(`document.querySelector('[data-servicio-propuesta]')`, 20000, 'propuesta desde turnos');
  const titulo = await evaluate(`(() => { const p = document.querySelector('[data-servicio-planilla-modal] p'); const r = p ? p.getBoundingClientRect() : null; return (p ? p.textContent : 'sin titulo') + (r ? ' top=' + Math.round(r.top) + ' bottom=' + Math.round(r.bottom) : ''); })()`);
  console.log('titulo servicio:', titulo);
  await sleep(400);
  await exacta('servicio-modal-ux');
  await click(`document.querySelector('[data-servicio-planilla-modal] [aria-label="Cerrar"]')`);
  await sleep(300);

  await send('Page.navigate', { url: `http://127.0.0.1:${Number(process.env.CAPTURA_PORT || 3033)}/admin/planificacion/?objectiveId=${obrador}&clientId=${clientId}&year=2026&month=11` });
  await sleep(2000);
  await waitFor(`document.querySelector('[data-continuar-mes]')`, 60000, 'continuar en noviembre');
  await click(`document.querySelector('[data-continuar-mes]')`);
  await waitFor(`document.querySelector('[data-continuar-mes-modal]')`, 30000, 'modal continuar');
  await sleep(800);
  await exacta('continuar-por-puesto');
} finally {
  await cerrar();
}
process.exit(process.exitCode || 0);
