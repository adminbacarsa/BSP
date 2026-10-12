/**
 * Vista previa del par 12 h en modo rápido, sin popover.
 * Emulador propio 8291/9291. Puerto 3038.
 *   NEXT_PUBLIC_USE_EMULATOR=true npm --prefix apps/web2 run build
 *   PLANIF_EMU_PORTS=8080:8291,9099:9291 FIRESTORE_EMULATOR_HOST=127.0.0.1:8291 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9291 node scripts/capturar-12h-sin-modal.mjs
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirPlanificacion, shotsDir, sleep } from './planif-cdp-lib.mjs';

const host = process.env.FIRESTORE_EMULATOR_HOST || '';
if (!/^(127\.0\.0\.1|localhost):8291$/.test(host)) throw new Error('Solo el emulador propio :8291.');

const require = createRequire(fileURLToPath(new URL('../apps/functions/package.json', import.meta.url)));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const app = initializeApp({ projectId: 'comtroldata' }, 'captura-12h-sin-modal');
const db = getFirestore(app);
const auth = getAuth(app);
const empresaId = 'bacarsa';
const clientId = 'cli12sin';
const objetivo = 'obj12sin';
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
await db.collection('servicios_sla').doc('sla12sinoct').set({
  empresaId, clientId, clientName: 'CASISA', objectiveId: objetivo, objectiveName: 'Obrador 12 h',
  status: 'active', active: true, startDate: '2026-10-01', endDate: '2026-10-31',
  positions: [{
    name: 'Puesto 1', positionName: 'Puesto 1', quantity: 1, coverageType: '24hs', exigeCobertura: true,
    activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
    allowedShiftTypes: [
      banda('M', '06:00', '14:00', 8), banda('T', '14:00', '22:00', 8), banda('N', '22:00', '06:00', 8),
      banda('D12', '06:00', '18:00', 12), banda('N12', '18:00', '06:00', 12),
    ],
  }],
  createdAt: now,
});
await db.collection('clients').doc(clientId).set({
  name: 'CASISA', empresaId, status: 'ACTIVE', active: true,
  objetivos: [{ id: objetivo, name: 'Obrador 12 h', active: true, status: 'ACTIVE' }],
  createdAt: now,
});
await db.collection('planificacion_estados').doc(`${empresaId}_${objetivo}_2026_10`).set({
  empresaId, objectiveId: objetivo, year: 2026, month: 10, status: 'DRAFT',
});

const guardias = [
  { id: 'her12sin', name: 'HERRERA, Juan', legajo: '9201' },
  { id: 'kas12sin', name: 'KASIANCHUK, Pedro', legajo: '9202' },
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
async function turno(empId, ds, code, start, end, hours) {
  const g = guardias.find((x) => x.id === empId);
  const doc = {
    empresaId, clientId, objectiveId: objetivo, objectiveName: 'Obrador 12 h', positionName: 'Puesto 1',
    employeeId: empId, employeeName: g.name, code, name: code,
    scheduleDate: ds, hours, draft: true,
    startTime: stamp(ds, start), endTime: stamp(ds, end),
  };
  if (end <= start) {
    const [y, m, d] = ds.split('-').map(Number);
    const next = new Date(y, m - 1, d + 1);
    const nd = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
    doc.endTime = Timestamp.fromDate(new Date(`${nd}T${end}:00-03:00`));
  }
  await db.collection('turnos').doc(`${empId}${ds.replace(/-/g, '')}`).set(doc);
}
await turno('her12sin', '2026-10-02', 'M', '06:00', '14:00', 8);
await turno('kas12sin', '2026-10-02', 'N', '22:00', '06:00', 8);
console.log('✓ seed');

const sesion = await abrirPlanificacion({
  objectiveId: objetivo, clientId, year: 2026, month: 10, prefijo: '12h-sin-modal',
  port: Number(process.env.CAPTURA_PORT || 3038), devtoolsPort: Number(process.env.CAPTURA_DEVTOOLS || 9378),
  scriptInicial: `try { localStorage.setItem('cosp-planif-modo-rapido:${''}', '1'); } catch (e) {}`,
});
const { send, evaluate, waitFor, cerrar } = sesion;

try {
  await waitFor(`document.getElementById('plan-emp-her12sin')`, 120000, 'grilla');
  const modo = await evaluate(`document.querySelector('[data-modo-rapido-toggle]')?.getAttribute('data-modo-rapido-toggle')`);
  if (modo !== '1') {
    await evaluate(`document.querySelector('[data-modo-rapido-toggle]')?.click()`);
    await waitFor(`document.querySelector('[data-modo-rapido-capa]')`, 15000, 'modo rápido');
  }
  const celda = await evaluate(`(() => {
    const tr = document.getElementById('plan-emp-her12sin')?.closest('tr');
    const td = tr?.querySelector('td[data-rc$=":1"]');
    if (!td) return 'sin celda';
    td.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    document.querySelector('[data-plan-grilla]')?.focus();
    return td.getAttribute('data-rc');
  })()`);
  console.log('celda', celda);
  await sleep(300);
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true, cancelable: true }))`);
  await sleep(600);
  const ya = await evaluate(`!!document.querySelector('[data-vista-12]')`);
  if (!ya) {
    await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.textContent.trim() === 'Elegir otro'); b?.click(); })()`);
  }
  await waitFor(`document.querySelector('[data-vista-12]')`, 8000, 'fantasma');
  await sleep(400);
  const barra = await evaluate(`document.querySelector('[data-vista-12-barra]')?.innerText || ''`);
  const codigos = await evaluate(`[...document.querySelectorAll('[data-vista-12]')].map((el) => el.getAttribute('data-vista-12')).join(',')`);
  const popover = await evaluate(`document.querySelector('[data-cierre-12h]') ? 'si' : 'no'`);
  console.log('barra', barra.replace(/\s+/g, ' '));
  console.log('codigos', codigos, 'popover', popover);
  if (!/HERRERA D12/.test(barra) || !/KASIANCHUK N12/.test(barra)) fail(`barra: ${barra}`);
  if (!/D12/.test(codigos) || !/N12/.test(codigos)) fail(`fantasmas: ${codigos}`);
  if (popover !== 'no') fail('sigue el popover');
  const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1440, height: 900, scale: 1 } });
  const file = join(shotsDir, '12h-sin-modal.png');
  writeFileSync(file, Buffer.from(r.data, 'base64'));
  console.log('✓', file);
} finally {
  await cerrar();
}
if (process.exitCode) process.exit(process.exitCode);
console.log('✓ captura');
