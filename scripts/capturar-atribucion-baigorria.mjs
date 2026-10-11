/**
 * Tooltip de la V de BAIGORRIA: el par D12/N12 tecleado (sin coverageMode) se lee del día.
 * Emulador propio 8291/9291.
 *   NEXT_PUBLIC_USE_EMULATOR=true npm --prefix apps/web2 run build
 *   PLANIF_EMU_PORTS=8080:8291,9099:9291 FIRESTORE_EMULATOR_HOST=127.0.0.1:8291 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9291 node scripts/capturar-atribucion-baigorria.mjs
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { abrirPlanificacion, sleep } from './planif-cdp-lib.mjs';

const host = process.env.FIRESTORE_EMULATOR_HOST || '';
if (!/^(127\.0\.0\.1|localhost):8291$/.test(host)) throw new Error('Solo el emulador propio :8291.');

const require = createRequire(fileURLToPath(new URL('../apps/functions/package.json', import.meta.url)));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const app = initializeApp({ projectId: 'comtroldata' }, 'captura-atrib-baigorria');
const db = getFirestore(app);
const auth = getAuth(app);
const empresaId = 'bacarsa';
const clientId = 'cliAtb11';
const objetivo = 'objAtb11';
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
await db.collection('servicios_sla').doc('slaAtb11oct').set({
  empresaId, clientId, clientName: 'CASISA', objectiveId: objetivo, objectiveName: 'Obrador Malagueño',
  status: 'active', active: true, startDate: '2026-10-01', endDate: '2026-10-31',
  positions: [{
    name: 'Puesto 1', positionName: 'Puesto 1', quantity: 1, coverageType: '24hs', exigeCobertura: true,
    activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
    allowedShiftTypes: [
      banda('M', '07:00', '15:00', 8), banda('T', '15:00', '23:00', 8), banda('N', '23:00', '07:00', 8),
      banda('D12', '07:00', '19:00', 12), banda('N12', '19:00', '07:00', 12),
    ],
  }],
  createdAt: now,
});
await db.collection('clients').doc(clientId).set({
  name: 'CASISA', empresaId, status: 'ACTIVE', active: true,
  objetivos: [{ id: objetivo, name: 'Obrador Malagueño', active: true, status: 'ACTIVE' }],
  createdAt: now,
});
await db.collection('planificacion_estados').doc(`${empresaId}_${objetivo}_2026_10`).set({
  empresaId, objectiveId: objetivo, year: 2026, month: 10, status: 'DRAFT',
});

const guardias = [
  { id: 'atbBaigorria', name: 'BAIGORRIA, Luis', legajo: '8101' },
  { id: 'atbRegalo', name: 'REGALO, Juan', legajo: '8102' },
  { id: 'atbHerrante', name: 'HERRANTE, Pedro', legajo: '8103' },
  { id: 'atbDiaz', name: 'DIAZ, Ana', legajo: '8104' },
  { id: 'atbAraya', name: 'ARAYA, Luis', legajo: '8105' },
  { id: 'atbMartinez', name: 'MARTINEZ, Jose', legajo: '8106' },
  { id: 'atbKasianchuk', name: 'KASIANCHUK, Ivan', legajo: '8107' },
  { id: 'atbPalacios', name: 'PALACIOS, Maria', legajo: '8108' },
];
const viejos = await db.collection('turnos').where('objectiveId', '==', objetivo).get();
for (let i = 0; i < viejos.docs.length; i += 400) {
  const b = db.batch();
  viejos.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
  await b.commit();
}
for (const g of guardias) {
  const [apellido, nombre] = g.name.split(',').map((s) => s.trim());
  await db.collection('empleados').doc(g.id).set({
    empresaId, name: g.name, fullName: g.name, nombre, apellido, lastName: apellido, firstName: nombre,
    fileNumber: g.legajo, legajo: g.legajo, status: 'ACTIVE', modalidad: 'NOMINA', category: 'VIGILADOR',
    preferredObjectiveId: objetivo, preferredObjectiveIds: [objetivo],
    planificacionDotacion: { [objetivo]: { positionName: 'Puesto 1' } }, createdAt: now,
  });
}
const stamp = (ds, hm) => Timestamp.fromDate(new Date(`${ds}T${hm}:00-03:00`));
const porId = Object.fromEntries(guardias.map((g) => [g.id, g]));
async function turno(empId, ds, code, extra = {}) {
  const g = porId[empId];
  const horarios = {
    V: ['00:00', '23:59', 0],
    D12: ['07:00', '19:00', 12],
    N12: ['19:00', '07:00', 12],
  };
  const [s, e, h] = horarios[code];
  const fin = code === 'N12' ? stamp(ds, '19:00') : stamp(ds, e);
  const doc = {
    empresaId, clientId, objectiveId: objetivo, objectiveName: 'Obrador Malagueño', positionName: 'Puesto 1',
    employeeId: empId, employeeName: g.name, code, name: code === 'V' ? 'Vacaciones' : code,
    scheduleDate: ds, hours: h, draft: true,
    startTime: stamp(ds, s), endTime: code === 'N12' ? Timestamp.fromDate(new Date(`${ds}T07:00:00-03:00`)) : fin,
    comments: code === 'V' ? 'Cargado en modo rápido' : '',
    ...extra,
  };
  if (code === 'N12') {
    const [y, m, d] = ds.split('-').map(Number);
    const next = new Date(y, m - 1, d + 1);
    const nd = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
    doc.endTime = Timestamp.fromDate(new Date(`${nd}T07:00:00-03:00`));
  }
  await db.collection('turnos').doc(`${empId}${ds.replace(/-/g, '')}`).set(doc);
}

for (let d = 10; d <= 23; d++) {
  const ds = `2026-10-${String(d).padStart(2, '0')}`;
  await turno('atbBaigorria', ds, 'V', {
    originalCode: 'T', originalPositionName: 'Puesto 1', originalStartTime: '15:00', originalEndTime: '23:00',
  });
}
const pares = [
  ['2026-10-12', 'atbRegalo', 'atbHerrante'],
  ['2026-10-13', 'atbDiaz', 'atbAraya'],
  ['2026-10-14', 'atbMartinez', 'atbKasianchuk'],
  ['2026-10-15', 'atbPalacios', 'atbAraya'],
];
for (const [ds, d12, n12] of pares) {
  await turno(d12, ds, 'D12');
  await turno(n12, ds, 'N12');
}
console.log('✓ seed');

const celdaDia = (empId, col) => `(() => { const row = document.getElementById('plan-emp-${empId}'); if (!row) return null; return [...row.querySelectorAll('td[data-rc]')].find((td) => td.dataset.rc.split(':')[1] === '${col}'); })()`;

const sesion = await abrirPlanificacion({
  objectiveId: objetivo, clientId, year: 2026, month: 10, prefijo: 'atribucion',
  port: Number(process.env.CAPTURA_PORT || 3036), devtoolsPort: Number(process.env.CAPTURA_DEVTOOLS || 9376),
});
const { send, evaluate, waitFor, click, hover, shot, cerrar } = sesion;
try {
  await waitFor(`document.getElementById('plan-emp-atbBaigorria')`, 120000, 'grilla');
  await sleep(1200);
  if (await evaluate(`!!document.querySelector('[data-bandas-faltantes], [data-bandas-faltantes-pastilla]')`)) {
    if (await evaluate(`!!document.querySelector('[data-bandas-faltantes-pastilla]')`)) {
      await click(`document.querySelector('[data-bandas-faltantes-pastilla]')`);
      await sleep(300);
    }
    await evaluate(`document.querySelector('[aria-label="Cerrar bandas faltantes"]')?.click()`);
    await sleep(300);
  }
  const modo = await evaluate(`document.querySelector('[data-modo-rapido-toggle]')?.getAttribute('data-modo-rapido-toggle')`);
  if (modo !== '1') {
    await click(`document.querySelector('[data-modo-rapido-toggle]')`);
    await waitFor(`document.querySelector('[data-modo-rapido-capa]')`, 8000, 'modo rápido');
  }
  const v12 = await evaluate(`(${celdaDia('atbBaigorria', 11)})?.innerText || ''`);
  const d12 = await evaluate(`(${celdaDia('atbRegalo', 11)})?.innerText || ''`);
  const n12 = await evaluate(`(${celdaDia('atbHerrante', 11)})?.innerText || ''`);
  console.log('12/10', { v12, d12, n12 });
  if (!/V/.test(v12)) fail(`la V del 12/10 no está (${v12})`);
  if (!/D12/.test(d12)) fail(`falta el D12 de REGALO (${d12})`);
  if (!/N12/.test(n12)) fail(`falta el N12 de HERRANTE (${n12})`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 8, y: 8, button: 'none' });
  await hover(celdaDia('atbBaigorria', 11), 2800);
  await waitFor(`(document.querySelector('[data-tooltip-celda]')?.innerText || '').includes('REGALO D12')`, 8000, 'tooltip de la V');
  const tip = await evaluate(`document.querySelector('[data-tooltip-celda]')?.innerText || ''`);
  console.log('tooltip:', tip.replace(/\n/g, ' | '));
  if (!/Cubierto por: REGALO D12 \+ HERRANTE N12 \(12 h\)/.test(tip)) fail(`tooltip inesperado: ${tip}`);
  if (!/Cargado en modo rápido/.test(tip)) fail('el motivo del modo rápido no está en el tooltip');
  await shot('baigorria');
} finally {
  await cerrar();
}
process.exit(process.exitCode || 0);
