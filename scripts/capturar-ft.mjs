/**
 * Franco trabajado: modo rápido asigna FT·M y el clic derecho deja la consulta en la celda.
 * Emulador propio 8291/9291 (nunca el lab 8080/9099/3001).
 *   firebase emulators:start --only auth,firestore --config firebase.importar-8291.json --project comtroldata
 *   NEXT_PUBLIC_USE_EMULATOR=true npm --prefix apps/web2 run build
 *   PLANIF_EMU_PORTS=8080:8291,9099:9291 FIRESTORE_EMULATOR_HOST=127.0.0.1:8291 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9291 node scripts/capturar-ft.mjs
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
const app = initializeApp({ projectId: 'comtroldata' }, 'captura-ft');
const db = getFirestore(app);
const auth = getAuth(app);
const empresaId = 'bacarsa';
const clientId = 'cliFt11';
const objetivo = 'objFt11';
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
await db.collection('servicios_sla').doc('slaFt11oct').set({
  empresaId, clientId, clientName: 'CASISA', objectiveId: objetivo, objectiveName: 'Obrador FT',
  status: 'active', active: true, startDate: '2026-10-01', endDate: '2026-10-31',
  positions: [{
    name: 'Puesto 1', positionName: 'Puesto 1', quantity: 1, coverageType: '24hs',
    activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
    allowedShiftTypes: [banda('M', '06:00', '14:00', 8), banda('T', '14:00', '22:00', 8), banda('N', '22:00', '06:00', 8)],
  }],
  createdAt: now,
});
await db.collection('clients').doc(clientId).set({
  name: 'CASISA', empresaId, status: 'ACTIVE', active: true,
  objetivos: [{ id: objetivo, name: 'Obrador FT', active: true, status: 'ACTIVE' }],
  createdAt: now,
});
await db.collection('planificacion_estados').doc(`${empresaId}_${objetivo}_2026_10`).set({
  empresaId, objectiveId: objetivo, year: 2026, month: 10, status: 'DRAFT',
});

const guardias = [
  { id: 'ftFranco', name: 'ACOSTA, Franco', legajo: '7101' },
  { id: 'ftTitular', name: 'ZAPATA, Luis', legajo: '7102' },
  { id: 'ftManana', name: 'BENITEZ, Mara', legajo: '7103' },
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
async function turno(g, code, extra = {}) {
  const ds = '2026-10-02';
  const horarios = { F: ['00:00', '00:00', 0], V: ['00:00', '00:00', 0], M: ['06:00', '14:00', 8] };
  const [s, e, h] = horarios[code];
  await db.collection('turnos').doc(`${g.id}20261002`).set({
    empresaId, clientId, objectiveId: objetivo, objectiveName: 'Obrador FT', positionName: 'Puesto 1',
    employeeId: g.id, employeeName: g.name, code, name: code, scheduleDate: ds, hours: h, draft: true,
    startTime: stamp(ds, s), endTime: stamp(ds, e),
    isFranco: code === 'F',
    ...extra,
  });
}
await turno(guardias[0], 'F');
await turno(guardias[1], 'V', { isNovedad: true });
await turno(guardias[2], 'M');
const vence = new Date('2026-10-11T18:30:00-03:00').getTime();
await db.collection('consultas_disponibilidad').doc('consultaFt11').set({
  empresaId, objectiveId: objetivo, clientId, objectiveName: 'Obrador FT', positionName: 'Puesto 1',
  status: 'ABIERTA', venceAtMs: vence, lugares: 1,
  titularEmployeeId: 'ftTitular', cubreEmployeeId: 'ftTitular', cubreNombre: 'ZAPATA, Luis',
  jornadas: [{ fecha: '2026-10-02', code: 'M', horaInicio: '06:00', horaFin: '14:00', horas: 8, name: 'Mañana' }],
  guardias: [{ employeeId: 'ftFranco', tipo: 'FT', nombre: 'ACOSTA, Franco' }],
  respuestas: [{ nombre: 'ACOSTA, Franco', estado: 'PENDIENTE' }],
  createdAt: now,
});
console.log('✓ seed');

const sesion = await abrirPlanificacion({
  objectiveId: objetivo, clientId, year: 2026, month: 10, prefijo: 'ft',
  port: Number(process.env.CAPTURA_PORT || 3035), devtoolsPort: Number(process.env.CAPTURA_DEVTOOLS || 9375),
});
const { send, evaluate, waitFor, click, shot, cerrar } = sesion;
const VK = { Tab: 9, Enter: 13, ArrowRight: 39 };
async function tecla(key) {
  const text = key.length === 1 ? key.toLowerCase() : undefined;
  const code = key.length === 1 ? `Key${key.toUpperCase()}` : key;
  const vk = key.length === 1 ? key.toUpperCase().charCodeAt(0) : VK[key];
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: text || key, code, windowsVirtualKeyCode: vk, text });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: text || key, code, windowsVirtualKeyCode: vk });
  await sleep(40);
}
try {
  await waitFor(`document.getElementById('plan-emp-ftFranco')`, 120000, 'grilla');
  await sleep(1200);
  if (await evaluate(`!!document.querySelector('[data-bandas-faltantes], [data-bandas-faltantes-pastilla]')`)) {
    if (await evaluate(`!!document.querySelector('[data-bandas-faltantes-pastilla]')`)) {
      await click(`document.querySelector('[data-bandas-faltantes-pastilla]')`);
      await sleep(300);
    }
    await evaluate(`document.querySelector('[aria-label="Cerrar bandas faltantes"]')?.click()`);
    await sleep(300);
  }
  await click(`document.querySelector('[data-modo-rapido-toggle]')`);
  await waitFor(`document.querySelector('[data-modo-rapido-capa]')`, 8000, 'modo rápido');
  await click(`document.getElementById('plan-emp-ftFranco').querySelectorAll('td[data-testid=grilla-celda]')[1]`);
  await sleep(200);
  await tecla('m');
  await sleep(250);
  await tecla('Tab');
  await sleep(800);
  const celda = await evaluate(`(document.getElementById('plan-emp-ftFranco').querySelectorAll('td[data-testid=grilla-celda]')[1]?.innerText || '').replace(/\\s+/g, ' ')`);
  console.log('celda franco:', celda);
  if (!/FT/.test(celda)) fail(`la celda no quedó en FT (muestra «${celda}»)`);
  if (/^F$/.test(celda.trim())) fail('sigue siendo un franco de 0 h');
  await shot('modo-rapido');

  await waitFor(`document.querySelector('[data-consulta-celda]')`, 20000, 'marca de consulta');
  await waitFor(`document.querySelector('[data-consultas-pill]')`, 20000, 'pastilla de consultas');
  await evaluate(`document.querySelector('[data-consultas-toggle]')?.click()`);
  await waitFor(`document.body.innerText.includes('Consulta enviada')`, 8000, 'texto de la consulta');
  await click(`document.getElementById('plan-emp-ftTitular').querySelectorAll('td[data-testid=grilla-celda]')[1]`, 'right');
  await waitFor(`document.querySelector('[data-menu-rapido="raiz"]')`, 8000, 'menú rápido');
  const menu = await evaluate(`document.querySelector('[data-menu-rapido="raiz"]')?.innerText || ''`);
  const pill = await evaluate(`document.querySelector('[data-consultas-pill]')?.innerText || ''`);
  console.log('menú:', menu.replace(/\n/g, ' | '));
  console.log('pastilla:', pill.replace(/\n/g, ' | '));
  if (!/Asignar a/.test(menu)) fail('el menú no ofrece Asignar a');
  if (!/Consulta enviada|Consultas en curso/i.test(`${celda} ${pill}`) && !/Consulta enviada/i.test(await evaluate(`document.body.innerText`))) {
    fail('no se ve la consulta enviada');
  }
  const turnoFranco = await evaluate(`(document.getElementById('plan-emp-ftFranco').querySelectorAll('td[data-testid=grilla-celda]')[1]?.innerText || '')`);
  if (/^M$/.test(turnoFranco.trim())) fail('el franco quedó como turno M, no como FT');
  await shot('consulta-menu');
} finally {
  await cerrar();
}
process.exit(process.exitCode || 0);
