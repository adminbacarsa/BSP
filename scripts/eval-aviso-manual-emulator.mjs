/**
 * Aviso manual por la app desde el CC (`avisarGuardiaOperaciones`).
 * - ENTRANTE: crea la convocatoria LLEGADA_TARDE + notificación con el texto «te esperan…»;
 *   si ya hay una pendiente, reenvía el push (resent) sin duplicar la convocatoria.
 * - Cooldown: un segundo aviso al mismo guardia antes de 5 min → AVISO_RECIENTE.
 * - RETENIDO: notificación RETENCION_AVISO con ETA del relevo o «no llegó».
 * - audit_logs AVISO_MANUAL_GUARDIA en cada aviso enviado.
 *
 * Cada corrida usa ids y empresaId propios (`aviso_<timestamp>_…`). Las lecturas filtran
 * por esos ids (nunca «la última notificación» de la colección). Al inicio borra solo lo
 * de esta suite, así puede correr después de otras en el mismo emulador (demo-p2-e2e).
 *
 * Emulador aislado (no el lab :8080):
 *   firebase emulators:exec --only firestore --config firebase.e2e-p2.json --project demo-aviso "node scripts/eval-aviso-manual-emulator.mjs"
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

if (!process.env.FIRESTORE_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST.includes(':8080')) {
  console.error('Usar el emulador aislado firebase.e2e-p2.json, no el lab :8080.');
  process.exit(1);
}

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-aviso' });
const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;
const { avisarGuardiaOperaciones, AVISO_MANUAL_COOLDOWN_MS } = requireFn('./lib/ops/avisarGuardiaOperaciones.js');

const results = [];
function report(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${name}\t${detail}`);
}

const PREFIX = `aviso_${Date.now()}`;
const EMP = `${PREFIX}_emp`;
const id = (name) => `${PREFIX}_${name}`;
const E_LOPEZ = id('e_lopez');
const E_FERRERO = id('e_ferrero');
const T_LOPEZ = id('t_lopez');
const T_FERRERO = id('t_ferrero');
const T_VACANTE = id('t_vacante');
const OWN_SHIFTS = new Set([T_LOPEZ, T_FERRERO, T_VACANTE]);
const AVISO_PREFIX_END = `aviso${String.fromCharCode('_'.charCodeAt(0) + 1)}`;

const ar = (h, min) => Timestamp.fromDate(new Date(`2026-10-01T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00-03:00`));
const NOW = ar(15, 40).toMillis();
const base = { empresaId: EMP, clientId: id('cli'), clientName: 'Cliente Demo', objectiveId: id('obj_peaje'), objectiveName: 'Peaje 9 Norte', positionName: 'Puesto 2' };

async function borrarQuery(q) {
  const snap = await q.get();
  if (snap.empty) return;
  let batch = db.batch();
  let n = 0;
  const flush = async () => {
    if (!n) return;
    await batch.commit();
    batch = db.batch();
    n = 0;
  };
  for (const doc of snap.docs) {
    if (doc.ref.parent.id === 'convocatorias_cobertura') {
      const eventos = await doc.ref.collection('eventos').get();
      for (const ev of eventos.docs) {
        batch.delete(ev.ref);
        n += 1;
        if (n >= 400) await flush();
      }
    }
    batch.delete(doc.ref);
    n += 1;
    if (n >= 400) await flush();
  }
  await flush();
}

async function limpiarPropio() {
  const cols = ['turnos', 'empleados', 'convocatorias_cobertura', 'user_notifications', 'audit_logs'];
  for (const col of cols) {
    await borrarQuery(db.collection(col).where('empresaId', '==', 'emp_aviso'));
    await borrarQuery(db.collection(col).where('empresaId', '>=', 'aviso_').where('empresaId', '<', AVISO_PREFIX_END));
  }
}

await limpiarPropio();

await db.collection('empleados').doc(E_LOPEZ).set({ uid: id('uid_lopez'), firstName: 'Héctor', nombre: 'LOPEZ, HECTOR', empresaId: EMP });
await db.collection('empleados').doc(E_FERRERO).set({ uid: id('uid_ferrero'), firstName: 'Kevin', nombre: 'FERRERO, KEVIN', empresaId: EMP });

await db.batch()
  .set(db.collection('turnos').doc(T_FERRERO), { ...base, employeeId: E_FERRERO, employeeName: 'FERRERO, KEVIN', code: 'M', status: 'PRESENT', isPresent: true, isCompleted: false, startTime: ar(11, 30), endTime: ar(15, 15), checkInAt: ar(11, 38), realStartTime: ar(11, 38), isRetention: true, retentionStartedAt: ar(15, 15) })
  .set(db.collection('turnos').doc(T_LOPEZ), { ...base, employeeId: E_LOPEZ, employeeName: 'LOPEZ, HECTOR', code: 'T', status: 'PENDING', isPresent: false, startTime: ar(15, 15), endTime: ar(23, 15) })
  .set(db.collection('turnos').doc(T_VACANTE), { ...base, employeeId: 'VACANTE', isUnassigned: true, code: 'T', status: 'PENDING', startTime: ar(15, 15), endTime: ar(23, 15) })
  .commit();

const op = { operatorUid: 'op_mauro', actorName: 'Mauro', device: 'celular' };

async function convs(shiftId) {
  const snap = await db.collection('convocatorias_cobertura').where('shiftId', '==', shiftId).get();
  return snap.docs.filter((d) => d.data().empresaId === EMP && d.data().type === 'LLEGADA_TARDE');
}

async function notifs({ employeeId, shiftId, type, convocatoriaId }) {
  const snap = await db.collection('user_notifications').where('empresaId', '==', EMP).get();
  return snap.docs.map((d) => d.data()).filter((n) =>
    n.employeeId === employeeId
    && n.shiftId === shiftId
    && (!type || n.type === type)
    && (!convocatoriaId || n.convocatoriaId === convocatoriaId));
}

async function audits() {
  const snap = await db.collection('audit_logs').where('empresaId', '==', EMP).get();
  return snap.docs.map((d) => d.data()).filter((x) => x.action === 'AVISO_MANUAL_GUARDIA' && OWN_SHIFTS.has(x.shiftId));
}

// 1) ENTRANTE: crea convocatoria LLEGADA_TARDE + push con el texto del aviso manual
const r1 = await avisarGuardiaOperaciones(db, { shiftId: T_LOPEZ, kind: 'ENTRANTE', ...op, nowMs: NOW });
const c1 = await convs(T_LOPEZ);
const n1 = await notifs({ employeeId: E_LOPEZ, shiftId: T_LOPEZ, type: 'CONVOCATORIA_COBERTURA', convocatoriaId: r1.convocatoriaId });
report('ENTRANTE ok y crea 1 convocatoria LLEGADA_TARDE', r1.ok === true && r1.resent === false && c1.length === 1 && c1[0].id === r1.convocatoriaId && c1[0].data().status === 'PENDING' && c1[0].data().createdBy === 'op_mauro', JSON.stringify({ r1, convs: c1.length }));
report('ENTRANTE push: saludo + «te esperan en Peaje 9 Norte · Puesto 2, ¿venís?»', n1.length === 1 && n1[0].type === 'CONVOCATORIA_COBERTURA' && n1[0].title === '¿Venís?' && /^Héctor, te esperan en Peaje 9 Norte · Puesto 2, ¿venís\?/.test(n1[0].body) && n1[0].convocatoriaId === c1[0].id, n1[0]?.body || '');
const lopez1 = (await db.collection('turnos').doc(T_LOPEZ).get()).data();
report('turno marca opsAvisoManualAt/Kind/By', lopez1.opsAvisoManualAt?.toMillis?.() === NOW && lopez1.opsAvisoManualKind === 'ENTRANTE' && lopez1.opsAvisoManualBy === 'op_mauro' && lopez1.opsAvisoManualByName === 'Mauro');

// 2) Cooldown: mismo guardia antes de 5 min → AVISO_RECIENTE con segundos restantes
const r2 = await avisarGuardiaOperaciones(db, { shiftId: T_LOPEZ, kind: 'ENTRANTE', ...op, nowMs: NOW + 2 * 60 * 1000 });
report('segundo aviso a los 2 min → AVISO_RECIENTE (180 s)', r2.ok === false && r2.reason === 'AVISO_RECIENTE' && r2.retryInSec === 180, JSON.stringify(r2));
report('cooldown no duplica convocatoria ni push', (await convs(T_LOPEZ)).length === 1 && (await notifs({ employeeId: E_LOPEZ, shiftId: T_LOPEZ, type: 'CONVOCATORIA_COBERTURA' })).length === 1);

// 3) Pasados 5 min con la convocatoria todavía PENDING → reenvía el push sin crear otra
const r3 = await avisarGuardiaOperaciones(db, { shiftId: T_LOPEZ, kind: 'ENTRANTE', ...op, nowMs: NOW + AVISO_MANUAL_COOLDOWN_MS });
const c3 = await convs(T_LOPEZ);
const n3 = await notifs({ employeeId: E_LOPEZ, shiftId: T_LOPEZ, type: 'CONVOCATORIA_COBERTURA', convocatoriaId: c1[0].id });
report('a los 5 min: resent=true, misma convocatoria, 2 push', r3.ok === true && r3.resent === true && r3.convocatoriaId === c1[0].id && c3.length === 1 && n3.length === 2, JSON.stringify({ r3, convs: c3.length, notifs: n3.length }));
const ev3 = await db.collection('convocatorias_cobertura').doc(c1[0].id).collection('eventos').where('reason', '==', 'AVISO_MANUAL_CC').get();
report('reenvío deja evento PUSH AVISO_MANUAL_CC en la línea de tiempo', !ev3.empty && ev3.docs[0].data().createdBy === 'op_mauro');

// 4) ENTRANTE sobre un guardia ya presente → ESTADO_INVALIDO; vacante → SIN_EMPLEADO; inexistente → TURNO_NOT_FOUND
const r4 = await avisarGuardiaOperaciones(db, { shiftId: T_FERRERO, kind: 'ENTRANTE', ...op, nowMs: NOW });
const r4b = await avisarGuardiaOperaciones(db, { shiftId: T_VACANTE, kind: 'ENTRANTE', ...op, nowMs: NOW });
const r4c = await avisarGuardiaOperaciones(db, { shiftId: id('no_existe'), kind: 'ENTRANTE', ...op, nowMs: NOW });
report('ENTRANTE presente → ESTADO_INVALIDO; vacante → SIN_EMPLEADO; inexistente → TURNO_NOT_FOUND', r4.reason === 'ESTADO_INVALIDO' && r4b.reason === 'SIN_EMPLEADO' && r4c.reason === 'TURNO_NOT_FOUND', JSON.stringify([r4.reason, r4b.reason, r4c.reason]));

// 5) RETENIDO sin relevo conocido → «Todavía no hay relevo confirmado»
const r5 = await avisarGuardiaOperaciones(db, { shiftId: T_FERRERO, kind: 'RETENIDO', ...op, nowMs: NOW });
const n5 = (await notifs({ employeeId: E_FERRERO, shiftId: T_FERRERO, type: 'RETENCION_AVISO' })).filter((n) => n.body === r5.body);
report('RETENIDO sin relevo → RETENCION_AVISO «no hay relevo confirmado»', r5.ok === true && n5.length === 1 && n5[0].type === 'RETENCION_AVISO' && n5[0].manual === true && /^Kevin, seguís retenido en Peaje 9 Norte · Puesto 2\. Todavía no hay relevo confirmado/.test(n5[0].body), n5[0]?.body || '');

// 6) RETENIDO con relevo que avisó ETA → «llega ~HH:MM»
await db.collection('turnos').doc(T_LOPEZ).set({ lateArrivalEtaAt: ar(16, 5), lateArrivalEtaMinutes: 30, lateArrivalAt: ar(15, 35) }, { merge: true });
const r6 = await avisarGuardiaOperaciones(db, { shiftId: T_FERRERO, kind: 'RETENIDO', relatedShiftId: T_LOPEZ, ...op, nowMs: NOW + AVISO_MANUAL_COOLDOWN_MS });
const n6 = (await notifs({ employeeId: E_FERRERO, shiftId: T_FERRERO, type: 'RETENCION_AVISO' })).find((n) => n.body === r6.body);
report('RETENIDO con ETA → «Tu relevo LOPEZ, HECTOR llega ~16:05»', r6.ok === true && !!n6 && n6.body.includes('Tu relevo LOPEZ, HECTOR llega ~16:05') && n6.relatedShiftId === T_LOPEZ, n6?.body || '');

// 7) RETENIDO con relevo ausente → «no llegó»
await db.collection('turnos').doc(T_LOPEZ).set({ isAbsent: true, status: 'ABSENT' }, { merge: true });
const r7 = await avisarGuardiaOperaciones(db, { shiftId: T_FERRERO, kind: 'RETENIDO', relatedShiftId: T_LOPEZ, ...op, nowMs: NOW + 2 * AVISO_MANUAL_COOLDOWN_MS });
const n7 = await notifs({ employeeId: E_FERRERO, shiftId: T_FERRERO, type: 'RETENCION_AVISO' });
report('RETENIDO con relevo ausente → «no llegó»', r7.ok === true && n7.some((n) => n.body === r7.body && n.body.includes('Tu relevo LOPEZ, HECTOR no llegó')), JSON.stringify(n7.map((n) => n.body)));

// 8) RETENIDO sobre un guardia que no está presente → ESTADO_INVALIDO
const r8 = await avisarGuardiaOperaciones(db, { shiftId: T_LOPEZ, kind: 'RETENIDO', ...op, nowMs: NOW + 3 * AVISO_MANUAL_COOLDOWN_MS });
report('RETENIDO sin presencia → ESTADO_INVALIDO', r8.ok === false && r8.reason === 'ESTADO_INVALIDO', JSON.stringify(r8));

// 9) audit_logs: uno por aviso enviado (1, 3, 5, 6, 7), con actor, device y kind
const a = await audits();
report('audit_logs AVISO_MANUAL_GUARDIA = 5 (ninguno por los rechazos)', a.length === 5 && a.every((x) => x.actorId === 'op_mauro' && x.device === 'celular' && ['ENTRANTE', 'RETENIDO'].includes(x.kind)), `count=${a.length}`);
report('audit del reenvío marca resent=true', a.some((x) => x.kind === 'ENTRANTE' && x.resent === true && x.convocatoriaId === c1[0].id));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
if (failed.length) {
  console.error('FALLAS:', failed.map((f) => f.name).join(' | '));
  process.exit(1);
}
console.log('eval-aviso-manual ok');
process.exit(0);
