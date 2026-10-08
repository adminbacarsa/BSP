import { FieldValue, Timestamp, type Firestore, type Query } from 'firebase-admin/firestore';
import * as admin from 'firebase-admin';
import { CONVOCADO_DELAY_GRACE_MIN } from '../common/convocadoEta';
import { logConvocatoriaEvento } from '../coverage/convocatoriaEventos';
import { buildOpsCoverageDocId } from '../coverage/syncAusenciaCobertura';
import { guardFirstName, guardLead } from '../common/pushGreeting';
import { groupTokensByShiftAlertChannel, shiftAlertPlatformConfig, type DeviceTokenRow } from '../notifications/shiftAlertFcm';
import { asistenciaAntesDeVentana } from '../coverage/refEscDirecto';

const PAGE = 50;
const MAX_PAGES = 20;

type Conv = Record<string, unknown>;

function ms(v: unknown): number {
  return (v as Timestamp | undefined)?.toMillis?.() ?? 0;
}

async function tokensOf(db: Firestore, employeeId: string): Promise<DeviceTokenRow[]> {
  if (!employeeId) return [];
  const emp = await db.collection('empleados').doc(employeeId).get();
  const uid = String(emp.data()?.uid || '').trim();
  if (!uid) return [];
  const snap = await db.collection('device_tokens').where('uid', '==', uid).get();
  return snap.docs
    .map((d) => ({ token: String(d.data()?.token || ''), data: d.data() || {} }))
    .filter((r) => r.token.length > 10);
}

function covIdOf(conv: Conv): string {
  const id = buildOpsCoverageDocId(String(conv.shiftId || ''), String(conv.candidateEmployeeId || ''));
  return !id || id.endsWith('_') ? '' : id;
}

async function covDoc(db: Firestore, conv: Conv): Promise<Record<string, unknown> | null> {
  const covId = covIdOf(conv);
  if (!covId) return null;
  const snap = await db.collection('turnos').doc(covId).get();
  return snap.exists ? (snap.data() as Record<string, unknown>) : null;
}

function punched(cov: Record<string, unknown> | null): boolean {
  if (!cov || cov.isDeleted === true) return false;
  const st = String(cov.status || '').toUpperCase();
  if (st === 'CANCELLED') return false;
  return cov.isPresent === true
    || st === 'PRESENT'
    || ms(cov.checkInAt) > 0
    || ms(cov.realStartTime) > 0;
}

/** Fin del hueco: `gapEndAt` de la convocatoria, si no el fin del ops_cov o del titular. */
async function gapEndMs(db: Firestore, conv: Conv, cov: Record<string, unknown> | null): Promise<number> {
  const own = ms(conv.gapEndAt);
  if (own > 0) return own;
  const fromCov = ms(cov?.endTime);
  if (fromCov > 0) return fromCov;
  const titId = String(conv.shiftId || '').trim();
  if (!titId) return 0;
  const tit = await db.collection('turnos').doc(titId).get();
  return ms(tit.data()?.endTime);
}

/** Apaga recordatorio y demora. Lo usa la fichada del convocado y el cierre por hueco terminado. */
export function convocadoFollowUpClosePatch(reason: 'FICHO' | 'HUECO_TERMINADO' | 'CANCELADA', now: Timestamp): Record<string, unknown> {
  return {
    reminderPending: false,
    delayAlertPending: false,
    followUpClosedAt: now,
    followUpClosedReason: reason,
  };
}

/**
 * Cierra el seguimiento de las convocatorias ACCEPTED de este hueco y este guardia.
 * Si el ops_cov no trae `coverageConvocatoriaId`, las busca por `shiftId` del titular.
 */
export async function cerrarSeguimientoPorFichada(
  db: Firestore,
  input: { convIds?: string[]; titularShiftId?: string; employeeId: string; now: Timestamp },
): Promise<string[]> {
  const ids = new Set((input.convIds || []).map((id) => String(id || '').trim()).filter(Boolean));
  const titular = String(input.titularShiftId || '').trim();
  const employeeId = String(input.employeeId || '').trim();
  if (titular && employeeId) {
    const snap = await db.collection('convocatorias_cobertura').where('shiftId', '==', titular).limit(20).get();
    for (const doc of snap.docs) {
      const conv = doc.data() as Conv;
      if (String(conv.status || '') !== 'ACCEPTED') continue;
      if (String(conv.candidateEmployeeId || '') !== employeeId) continue;
      ids.add(doc.id);
    }
  }
  const closed: string[] = [];
  for (const id of ids) {
    const ref = db.collection('convocatorias_cobertura').doc(id);
    const snap = await ref.get();
    if (!snap.exists) continue;
    const conv = snap.data() as Conv;
    if (String(conv.status || '') !== 'ACCEPTED') continue;
    if (ms(conv.followUpClosedAt) > 0) continue;
    await ref.update({ ...convocadoFollowUpClosePatch('FICHO', input.now), checkedInAt: input.now });
    await logConvocatoriaEvento(db, id, { type: 'FICHO', at: input.now }).catch(() => undefined);
    closed.push(id);
  }
  return closed;
}

async function closeIfDone(
  db: Firestore,
  doc: FirebaseFirestore.QueryDocumentSnapshot,
  conv: Conv,
  nowMs: number,
  now: Timestamp,
): Promise<'FICHO' | 'HUECO_TERMINADO' | null> {
  const cov = await covDoc(db, conv);
  if (punched(cov)) {
    await doc.ref.update(convocadoFollowUpClosePatch('FICHO', now));
    return 'FICHO';
  }
  const end = await gapEndMs(db, conv, cov);
  if (end > 0 && end <= nowMs) {
    await doc.ref.update(convocadoFollowUpClosePatch('HUECO_TERMINADO', now));
    return 'HUECO_TERMINADO';
  }
  return null;
}

async function* paginate(base: Query, orderField: string): AsyncGenerator<FirebaseFirestore.QueryDocumentSnapshot> {
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    let q = base.orderBy(orderField).limit(PAGE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) return;
    for (const d of snap.docs) yield d;
    if (snap.size < PAGE) return;
    cursor = snap.docs[snap.docs.length - 1];
  }
}

async function sendReminder(db: Firestore, doc: FirebaseFirestore.QueryDocumentSnapshot, conv: Conv, now: Timestamp): Promise<void> {
  const eta = Number(conv.etaMinutes) || 0;
  const name = guardFirstName({ employeeName: conv.candidateEmployeeName });
  const body = guardLead(name, '¿Seguís en camino? Si te demorás, avisanos en cuánto llegás.');
  const rows = await tokensOf(db, String(conv.candidateEmployeeId || ''));
  for (const [channel, tokens] of groupTokensByShiftAlertChannel(rows)) {
    const platform = shiftAlertPlatformConfig(channel);
    await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title: '¿Venís en camino?', body },
      data: {
        type: 'CONVOCADO_RECORDATORIO',
        convocatoriaId: doc.id,
        etaMinutes: String(eta),
      },
      android: platform.android,
      apns: platform.apns,
    }).catch(() => undefined);
  }
  await doc.ref.update({ reminderSentAt: now, reminderPending: false });
  const covId = covIdOf(conv);
  if (covId) await db.collection('turnos').doc(covId).update({ convocadoReminderSentAt: now }).catch(() => undefined);
  await logConvocatoriaEvento(db, doc.id, { type: 'RECORDATORIO', etaMinutes: eta, at: now });
}

async function raiseDelay(db: Firestore, doc: FirebaseFirestore.QueryDocumentSnapshot, conv: Conv, now: Timestamp): Promise<void> {
  const expectedMs = ms(conv.expectedArrivalAt);
  await db.collection('novedades').add({
    type: 'CONVOCADO_DEMORADO',
    status: 'pending',
    priority: 'high',
    convocatoriaId: doc.id,
    shiftId: conv.shiftId || null,
    employeeId: conv.candidateEmployeeId || null,
    employeeName: conv.candidateEmployeeName || '',
    objectiveId: conv.objectiveId || null,
    objectiveName: conv.objectiveName || '',
    empresaId: conv.empresaId || null,
    title: 'Convocado demorado',
    description: `${conv.candidateEmployeeName || 'Convocado'} no fichó a la hora estimada. Esperar, llamar o cancelar y reconvocar.`,
    createdAt: FieldValue.serverTimestamp(),
    source: 'SYSTEM_SCHEDULER',
  });
  await doc.ref.update({
    delayAlertPending: false,
    delayAlertedForArrivalAt: expectedMs > 0 ? Timestamp.fromMillis(expectedMs) : now,
    convocadoDemorado: true,
  });
  const covId = covIdOf(conv);
  if (covId) await db.collection('turnos').doc(covId).update({ convocadoDemorado: true }).catch(() => undefined);
  await logConvocatoriaEvento(db, doc.id, { type: 'DEMORADO', at: now });
}

/**
 * Recordatorio a los 2/3 del ETA y aviso al CC si pasa la llegada estimada + 15 min.
 * Consulta solo lo que vence (`reminderPending` / `delayAlertPending`), paginado.
 * Convocatorias con el hueco terminado o ya fichadas se cierran. Nunca marca ausencia.
 */
export async function runConvocadoFollowUp(db: Firestore, now: Timestamp = Timestamp.now()): Promise<number> {
  const nowMs = now.toMillis();
  let n = 0;
  const seen = new Set<string>();

  const remBase = db.collection('convocatorias_cobertura')
    .where('status', '==', 'ACCEPTED')
    .where('reminderPending', '==', true)
    .where('reminderAt', '<=', now);
  for await (const doc of paginate(remBase, 'reminderAt')) {
    if (seen.has(doc.id)) continue;
    seen.add(doc.id);
    const conv = doc.data() as Conv;
    if (ms(conv.followUpClosedAt) > 0) {
      await doc.ref.update({ reminderPending: false, delayAlertPending: false });
      continue;
    }
    if (String(conv.type || '') === 'EXTEND' || String(conv.type || '') === 'LLEGADA_TARDE') {
      await doc.ref.update({ reminderPending: false, delayAlertPending: false });
      continue;
    }
    if (await closeIfDone(db, doc, conv, nowMs, now)) continue;
    const gapStart = ms(conv.gapStartAt) || ms(conv.startTime);
    // RET directo: el recordatorio es el del convocado (salida − 10 min), aunque falten más de 5 min.
    const tipoCov = String(conv.type || '').toUpperCase();
    const esRefEscRet = tipoCov === 'RET' || tipoCov === 'REF' || tipoCov === 'ESC';
    if (!esRefEscRet && asistenciaAntesDeVentana(gapStart, nowMs)) {
      await doc.ref.update({ reminderPending: false });
      continue;
    }
    if (conv.reminderSentAt) {
      await doc.ref.update({ reminderPending: false });
      continue;
    }
    await sendReminder(db, doc, conv, now);
    n += 1;
  }

  const delayCut = Timestamp.fromMillis(nowMs - CONVOCADO_DELAY_GRACE_MIN * 60 * 1000);
  const delayBase = db.collection('convocatorias_cobertura')
    .where('status', '==', 'ACCEPTED')
    .where('delayAlertPending', '==', true)
    .where('expectedArrivalAt', '<=', delayCut);
  for await (const doc of paginate(delayBase, 'expectedArrivalAt')) {
    const conv = doc.data() as Conv;
    if (ms(conv.followUpClosedAt) > 0) {
      await doc.ref.update({ reminderPending: false, delayAlertPending: false });
      continue;
    }
    if (String(conv.type || '') === 'EXTEND' || String(conv.type || '') === 'LLEGADA_TARDE') {
      await doc.ref.update({ reminderPending: false, delayAlertPending: false });
      continue;
    }
    if (await closeIfDone(db, doc, conv, nowMs, now)) continue;
    if (ms(conv.delayAlertedForArrivalAt) === ms(conv.expectedArrivalAt)) {
      await doc.ref.update({ delayAlertPending: false });
      continue;
    }
    await raiseDelay(db, doc, conv, now);
    n += 1;
  }

  const sueltos = await db.collection('turnos').where('reminderPending', '==', true).limit(40).get();
  for (const doc of sueltos.docs) {
    const shift = doc.data() as Conv;
    if (shift.coberturaUrgente !== true) continue;
    if (seen.has(doc.id)) continue;
    seen.add(doc.id);
    const gapStart = ms(shift.startTime);
    if (punched(shift)) {
      await doc.ref.update(convocadoFollowUpClosePatch('FICHO', now));
      continue;
    }
    const end = ms(shift.endTime);
    if (end > 0 && end <= nowMs) {
      await doc.ref.update(convocadoFollowUpClosePatch('HUECO_TERMINADO', now));
      continue;
    }
    if (ms(shift.reminderAt) > nowMs) continue;
    if (shift.reminderSentAt) {
      await doc.ref.update({ reminderPending: false });
      continue;
    }
    await sendReminder(db, doc, {
      ...shift,
      candidateEmployeeId: shift.employeeId,
      candidateEmployeeName: shift.employeeName,
      type: shift.coverageType || 'RET',
    }, now);
    n += 1;
  }

  return n;
}
