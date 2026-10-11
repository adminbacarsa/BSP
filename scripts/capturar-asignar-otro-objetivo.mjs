/**
 * Capturas de «Asignar en otro objetivo» y del par de 12 h entre puestos (solo emulador propio).
 *   firebase emulators:start --only auth,firestore --config firebase.importar-8291.json --project comtroldata
 *   NEXT_PUBLIC_USE_EMULATOR=true npm --prefix apps/web2 run build
 *   PLANIF_EMU_PORTS=8080:8291,9099:9291 FIRESTORE_EMULATOR_HOST=127.0.0.1:8291 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9291 node scripts/capturar-asignar-otro-objetivo.mjs
 * → docs/capturas-cobertura/otro-objetivo-*.png
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { abrirPlanificacion, sleep } from './planif-cdp-lib.mjs';

const host = process.env.FIRESTORE_EMULATOR_HOST || '';
if (!/^(127\.0\.0\.1|localhost):(?!8080)/.test(host)) throw new Error('Solo emulador propio (no 8080). Definí FIRESTORE_EMULATOR_HOST.');

const require = createRequire(fileURLToPath(new URL('../apps/functions/package.json', import.meta.url)));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const app = initializeApp({ projectId: 'comtroldata' }, 'captura-otro-objetivo');
const db = getFirestore(app);
const auth = getAuth(app);
const empresaId = 'bacarsa';
const clientId = 'cli_oob';
const obrador = 'oob_obrador';
const vifood = 'oob_vifood';
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
const p24 = (name, extra = []) => ({
  name, positionName: name, quantity: 1, coverageType: '24hs', activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
  allowedShiftTypes: [banda('M', '07:00', '15:00', 8), banda('T', '15:00', '23:00', 8), banda('N', '23:00', '07:00', 8), ...extra],
});
const doce = [banda('D12', '07:00', '19:00', 12), banda('N12', '19:00', '07:00', 12)];
await db.collection('servicios_sla').doc('sla_oob_obrador').set({
  empresaId, clientId, clientName: 'Grupo Demo', objectiveId: obrador, objectiveName: 'Obrador Demo',
  status: 'active', active: true, startDate: '2026-10-01', endDate: '2026-10-31',
  positions: [p24('Puesto 1', doce), p24('Puesto 2', doce)], createdAt: now,
});
await db.collection('servicios_sla').doc('sla_oob_vifood').set({
  empresaId, clientId, clientName: 'Grupo Demo', objectiveId: vifood, objectiveName: 'Vifood',
  status: 'active', active: true, startDate: '2026-10-01', endDate: '2026-10-31',
  positions: [{
    name: 'Puesto 1', positionName: 'Puesto 1', quantity: 1, coverageType: '24hs', activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
    allowedShiftTypes: [banda('M', '06:00', '14:00', 8), banda('T', '14:00', '22:00', 8), banda('N', '22:00', '06:00', 8)],
  }],
  createdAt: now,
});
await db.collection('clients').doc(clientId).set({
  name: 'Grupo Demo', empresaId, status: 'ACTIVE', active: true,
  objetivos: [
    { id: obrador, name: 'Obrador Demo', active: true, status: 'ACTIVE' },
    { id: vifood, name: 'Vifood', active: true, status: 'ACTIVE' },
  ],
  createdAt: now,
});
for (const obj of [obrador, vifood]) {
  await db.collection('planificacion_estados').doc(`${empresaId}_${obj}_2026_10`).set({ empresaId, objectiveId: obj, year: 2026, month: 10, status: 'DRAFT' });
}
await db.collection('planificacion_import_mapeos').doc(`${empresaId}_${obrador}`).set({ equivalenciasOtro: [] }, { merge: true });

const guardias = [
  { id: 'oobHerrera', name: 'HERRERA, Matías', legajo: '5101', pos: 'Puesto 1' },
  { id: 'oobNievas', name: 'NIEVAS, Adriana', legajo: '5102', pos: 'Puesto 1' },
  { id: 'oobQuiroga', name: 'QUIROGA, Fabián', legajo: '5103', pos: 'Puesto 1' },
  { id: 'oobPalacios', name: 'PALACIOS, Julio', legajo: '5104', pos: 'Puesto 2' },
  { id: 'oobPeralta', name: 'PERALTA, Jeremías', legajo: '5105', pos: 'Puesto 2' },
];
for (const viejo of ['oob_herrera', 'oob_nieves', 'oob_quiroga', 'oob_palacios', 'oob_peralta']) {
  const snap = await db.collection('turnos').where('employeeId', '==', viejo).get();
  const b = db.batch();
  snap.docs.forEach((d) => b.delete(d.ref));
  b.delete(db.collection('empleados').doc(viejo));
  await b.commit();
}
for (const col of ['turnos']) {
  const snap = await db.collection(col).where('employeeId', 'in', guardias.map((g) => g.id)).get();
  const b = db.batch();
  snap.docs.forEach((d) => b.delete(d.ref));
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
const HORAS = { M: ['07:00', '15:00', 8], T: ['15:00', '23:00', 8], N: ['23:00', '07:00', 8], D12: ['07:00', '19:00', 12], N12: ['19:00', '07:00', 12], F: ['00:00', '00:00', 0] };
const ymd = (d) => `2026-10-${String(d).padStart(2, '0')}`;
const stamp = (ds, hm, sig) => {
  const d = new Date(`${ds}T${hm}:00-03:00`);
  if (sig) d.setUTCDate(d.getUTCDate() + 1);
  return Timestamp.fromDate(d);
};
async function turno(g, d, code, obj = obrador, pos = g.pos, horas = HORAS[code]) {
  const ds = ymd(d);
  const [s, e, h] = horas;
  const id = `${g.id}_${ds}_${obj}`;
  await db.collection('turnos').doc(id).set({
    empresaId, clientId, objectiveId: obj, objectiveName: obj === obrador ? 'Obrador Demo' : 'Vifood', positionName: pos,
    employeeId: g.id, employeeName: g.name, code, scheduleDate: ds, hours: h, draft: true,
    startTime: stamp(ds, s, false), endTime: stamp(ds, e, e <= s && code !== 'F'), isFranco: code === 'F',
  });
}
const [herrera, nieves, quiroga, palacios, peralta] = guardias;
await turno(herrera, 1, 'M');
await turno(nieves, 1, 'N');
await turno(quiroga, 1, 'D12');
await turno(palacios, 1, 'M');
await turno(peralta, 1, 'N12');
const ciclo = ['M', 'M', 'T', 'T', 'N', 'N', 'F', 'F'];
for (let d = 2; d <= 20; d++) {
  for (const [i, g] of guardias.entries()) {
    if (g === peralta && (d === 12 || d === 14)) continue;
    await turno(g, d, ciclo[(d + i * 2) % ciclo.length]);
  }
}
await turno(peralta, 14, 'T', vifood, 'Puesto 1', ['14:00', '22:00', 8]);
console.log('✓ seed');

const sesion = await abrirPlanificacion({
  objectiveId: obrador, clientId, year: 2026, month: 10, prefijo: 'otro-objetivo',
  port: Number(process.env.CAPTURA_PORT || 3031), devtoolsPort: Number(process.env.CAPTURA_DEVTOOLS || 9371),
});
const { send, evaluate, waitFor, click, shot, cerrar, celda } = sesion;
try {
  await waitFor(`document.getElementById('plan-emp-oobPeralta')`, 120000, 'grilla Obrador');
  await sleep(1500);
  await evaluate(`document.querySelector('[aria-label="Cerrar bandas faltantes"]')?.click()`);
  await sleep(300);

  await waitFor(`document.querySelector('[data-cobertura-dia="2026-10-01"]')`, 30000, 'fila cobertura');
  const titulo = await evaluate(`document.querySelector('[data-cobertura-dia="2026-10-01"]').getAttribute('title') || ''`);
  console.log('día 1:', titulo.replace(/\n/g, ' | '));
  if (!/48\/48 h/.test(titulo) || !/cubierto entre puestos/.test(titulo)) fail('el día 1 no muestra 48/48 h y cubierto entre puestos');
  if (/falta/i.test(titulo)) fail('el día 1 marca una falta');
  await click(`document.querySelector('[data-cobertura-dia="2026-10-01"]')`);
  await sleep(600);
  await shot('48h');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(400);

  await click(celda('oobPeralta', 12), 'right');
  await waitFor(`document.querySelector('[data-menu-accion="otro-objetivo"]')`, 10000, 'menú otro objetivo');
  await shot('menu');
  await click(`document.querySelector('[data-menu-accion="otro-objetivo"]')`);
  await waitFor(`document.querySelector('[data-otro-objetivo="modal"]')`, 8000, 'modal');
  await click(`document.querySelector('[data-otro-objetivo-opcion="${vifood}"]')`);
  await waitFor(`document.querySelector('[data-otro-objetivo-franja]')?.options.length > 1`, 20000, 'franjas de Vifood');
  await evaluate(`(() => { const s = document.querySelector('[data-otro-objetivo-franja]'); const v = [...s.options].find((o) => o.textContent.includes('T 14:00'))?.value; const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, v); s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(300);
  await shot('modal');
  await click(`document.querySelector('[data-otro-objetivo-confirmar]')`);
  await waitFor(`!document.querySelector('[data-otro-objetivo="modal"]')`, 15000, 'modal cerrado');
  await sleep(800);
  const celda12 = await evaluate(`(${celda('oobPeralta', 12)})?.innerText || ''`);
  console.log('celda 12:', celda12);
  await shot('celda');

  await click(celda('oobPeralta', 14), 'right');
  await waitFor(`[...document.querySelectorAll('[data-sonner-toast]')].some((t) => /ya tiene T en Vifood/.test(t.innerText) && /Abrir el cronograma de Vifood/.test(t.innerText))`, 15000, 'aviso ya tiene con link');
  await sleep(400);
  await shot('ya-tiene');

  if (!(await evaluate(`document.querySelector('[data-modo-rapido-toggle]')?.dataset.modoRapidoToggle === '1'`))) {
    await click(`document.querySelector('[data-modo-rapido-toggle]')`);
    await waitFor(`document.querySelector('[data-modo-rapido-capa]')`, 8000, 'modo rápido');
  }
  await evaluate(`(() => { window.confirm = () => true; window.alert = () => {}; })()`);
  await click(`document.querySelector('button[title^="Guardar cambios pendientes"]')`);
  await waitFor(`!document.querySelector('[data-cambios-pendientes]')`, 30000, 'guardado');
  await sleep(4000);
  const guardado = (await db.collection('turnos').where('employeeId', '==', 'oobPeralta').where('scheduleDate', '==', '2026-10-12').get()).docs.map((d) => d.data());
  console.log('guardado 12/10:', JSON.stringify(guardado.map((d) => ({ obj: d.objectiveId, code: d.code, pos: d.positionName, draft: d.draft }))));
  if (!guardado.some((d) => d.objectiveId === vifood && d.code === 'T')) fail('el turno del 12/10 no quedó en Vifood');
  const audit = (await db.collection('audit_logs').where('empresaId', '==', empresaId).get()).docs.map((d) => d.data()).filter((d) => JSON.stringify(d).includes('OTRO_OBJETIVO'));
  console.log('audit OTRO_OBJETIVO:', audit.length);
  if (!audit.length) fail('sin audit_logs con via OTRO_OBJETIVO');
  const dias = Array.from({ length: 31 }, (_, i) => i + 1);
  const tsv = [
    ['', '', 'LEGAJO', 'PUESTO', ...dias.map(() => '')].join('\t'),
    ['', '', '', '', ...dias.map(String)].join('\t'),
    ['PERALTA JEREMIAS', '', '5105', 'PUESTO 2', ...dias.map((d) => (d === 21 || d === 23 ? 'VF/T' : d === 22 ? 'BANCO' : d >= 24 ? 'F' : ''))].join('\t'),
  ].join('\n');
  await evaluate(`document.querySelector('[data-plan-grilla]')?.focus()`);
  await sleep(200);
  await evaluate(`(() => { const dt = new DataTransfer(); dt.setData('text/plain', ${JSON.stringify(tsv)}); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
  await waitFor(`document.querySelector('[data-pegar-ajeno]')`, 10000, 'pregunta de objetivo en el pegado');
  await evaluate(`(() => { const s = document.querySelector('[data-pegar-ajeno-obj="VF"]'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, '${vifood}'); s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await waitFor(`document.querySelector('[data-pegar-ajeno-franja="VF"]')?.options.length > 1`, 20000, 'franjas en el pegado');
  await evaluate(`(() => { const s = document.querySelector('[data-pegar-ajeno-franja="VF"]'); const v = [...s.options].find((o) => o.textContent.includes('T 14:00'))?.value ?? s.options[1].value; const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, v); s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(300);
  await shot('pegado');
  await click(`document.querySelector('[data-pegar-ajeno-asignar]')`);
  await sleep(2500);
  const eq = (await db.collection('planificacion_import_mapeos').doc(`${empresaId}_${obrador}`).get()).data()?.equivalenciasOtro || [];
  console.log('equivalenciasOtro:', JSON.stringify(eq));
  if (!eq.some((e) => e.codigo === 'VF' && e.objectiveId === vifood)) fail('no se guardó la equivalencia VF → Vifood');
} finally {
  await cerrar();
}
process.exit(process.exitCode || 0);
