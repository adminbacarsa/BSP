/**
 * REF/ESC en el mismo objetivo y horario del hueco: asignación directa.
 * No crea convocatoria ni pregunta de asistencia. El aviso es informativo.
 */
import * as admin from 'firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  gapWindowFromConvocatoria,
  sourceShiftEligibleForCoverageGap,
} from './coverageSourceShiftForGap';
import {
  applyCoverage,
  buildOpsCoverageDocId,
  CoverageApplyError,
  syncAusenciaCoberturaGestionada,
} from './syncAusenciaCobertura';

const NOMBRE_TURNO: Record<string, string> = {
  M: 'Turno Mañana',
  T: 'Turno Tarde',
  N: 'Turno Noche',
  D12: 'Diurno 12h',
  N12: 'Nocturno 12h',
};

/** T−5: antes de esto no hay pregunta de asistencia (¿Venís? / ¿Seguís en camino?). */
export const ASISTENCIA_LEAD_MS = 5 * 60 * 1000;
/** Fichada del convocado con el hueco todavía lejos: abre a T−15. */
export const FICHADA_LEAD_MS = 15 * 60 * 1000;

export function esRefOEsc(type: unknown): boolean {
  const t = String(type || '').trim().toUpperCase();
  return t === 'REF' || t === 'ESC';
}

export function textoTurnoActualizado(input: {
  code?: string | null;
  objectiveName?: string | null;
  positionName?: string | null;
}): string {
  const code = String(input.code || '').trim().toUpperCase() || 'M';
  const nombre = NOMBRE_TURNO[code] || `Turno ${code}`;
  const lugar = [input.objectiveName, input.positionName]
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join(' · ');
  return `Tu turno fue actualizado a ${nombre} (${code})${lugar ? ` en ${lugar}` : ''}.`;
}

/**
 * Mismo objetivo y el turno origen solapa el hueco (banda u horario).
 * RET no entra: sigue siendo asignación por retención.
 */
export function refEscMismoObjetivo(input: {
  type: unknown;
  source: Record<string, unknown> | null | undefined;
  objectiveId: unknown;
  startTime?: Timestamp | null;
  endTime?: Timestamp | null;
  shiftCode?: string | null;
}): boolean {
  if (!esRefOEsc(input.type) || !input.source) return false;
  const gapObj = String(input.objectiveId || '').trim();
  const srcObj = String(input.source.objectiveId || '').trim();
  if (!gapObj || gapObj !== srcObj) return false;
  const gap = gapWindowFromConvocatoria({
    startTime: input.startTime || undefined,
    endTime: input.endTime || undefined,
    shiftCode: String(input.shiftCode || ''),
  });
  if (!gap) return false;
  return sourceShiftEligibleForCoverageGap(input.source, gap);
}

/** El hueco empieza más adelante que la ventana de asistencia (T−5). */
export function asistenciaAntesDeVentana(gapStartMs: number, nowMs: number): boolean {
  return gapStartMs > 0 && nowMs > 0 && gapStartMs - nowMs > ASISTENCIA_LEAD_MS;
}

/**
 * Fichada: si faltan más de 15 min, abre a T−15. Si el hueco ya empezó o está cerca, desde la aceptación.
 */
export function fichadaAbreMs(gapStartMs: number, acceptedMs: number): number {
  if (gapStartMs > 0 && acceptedMs > 0 && gapStartMs - acceptedMs > FICHADA_LEAD_MS) {
    return gapStartMs - FICHADA_LEAD_MS;
  }
  return acceptedMs;
}

type DirectaInput = {
  empresaId: string;
  shiftId: string;
  objectiveId: string;
  objectiveName?: string;
  positionName?: string;
  clientId?: string;
  clientName?: string;
  shiftCode?: string;
  startTime: Timestamp;
  endTime: Timestamp;
  type: string;
  candidateEmployeeId: string;
  candidateEmployeeName: string;
  candidateShiftId?: string;
  createdBy: string;
};

function resolvedByDe(createdBy: string): 'OPERACIONES' | 'AUTO' | 'MODO_DEMO' {
  const c = String(createdBy || '').toUpperCase();
  if (c === 'MODO_DEMO') return 'MODO_DEMO';
  if (c === 'AUTO') return 'AUTO';
  return 'OPERACIONES';
}

async function avisarTurnoActualizado(
  db: admin.firestore.Firestore,
  employeeId: string,
  body: string,
  turnoId: string,
  empresaId: string,
): Promise<void> {
  const emp = await db.collection('empleados').doc(employeeId).get();
  const uid = emp.exists ? String(emp.data()?.uid || '') : '';
  await db.collection('user_notifications').add({
    uid: uid || null,
    employeeId,
    title: 'Turno actualizado',
    body,
    type: 'TURNO_ACTUALIZADO',
    target: 'employee',
    turnoId,
    empresaId: empresaId || null,
    read: false,
    readAt: null,
    createdAt: FieldValue.serverTimestamp(),
  });
  if (!uid && !employeeId) return;
  const [byEmp, byUid] = await Promise.all([
    db.collection('device_tokens').where('employeeId', '==', employeeId).get(),
    uid ? db.collection('device_tokens').where('uid', '==', uid).get() : Promise.resolve({ docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] }),
  ]);
  const tokens = new Set<string>();
  for (const d of [...byEmp.docs, ...byUid.docs]) {
    const t = d.data()?.token;
    if (typeof t === 'string' && t.length > 10) tokens.add(t);
  }
  if (!tokens.size) return;
  try {
    await admin.messaging().sendEachForMulticast({
      tokens: [...tokens],
      notification: { title: 'Turno actualizado', body },
      data: { type: 'TURNO_ACTUALIZADO', turnoId },
    });
  } catch {
    /* sin FCM (emulador o sin token válido) el aviso queda en la bandeja */
  }
}

/**
 * Si el REF/ESC está en el mismo objetivo y cubre el hueco, aplica la cobertura
 * y avisa. Devuelve el id del ops_cov. Si no corresponde, null (hay que convocar).
 */
export async function asignarRefEscSiMismoObjetivo(
  db: admin.firestore.Firestore,
  data: DirectaInput,
): Promise<string | null> {
  if (!esRefOEsc(data.type)) return null;
  const sourceId = String(data.candidateShiftId || '').trim();
  if (!sourceId || !data.shiftId || !data.candidateEmployeeId) return null;
  const srcSnap = await db.collection('turnos').doc(sourceId).get();
  if (!srcSnap.exists) return null;
  const source = srcSnap.data() as Record<string, unknown>;
  if (!refEscMismoObjetivo({
    type: data.type,
    source,
    objectiveId: data.objectiveId,
    startTime: data.startTime,
    endTime: data.endTime,
    shiftCode: data.shiftCode,
  })) return null;

  const resolvedBy = resolvedByDe(data.createdBy);
  const batch = db.batch();
  let covDocId = '';
  try {
    covDocId = await applyCoverage(db, batch, {
      titularShiftId: data.shiftId,
      candidateEmployeeId: data.candidateEmployeeId,
      candidateEmployeeName: data.candidateEmployeeName,
      sourceShiftId: sourceId,
      coverageType: String(data.type).toUpperCase(),
      resolvedBy,
      empresaId: data.empresaId,
      startTime: data.startTime,
      endTime: data.endTime,
      code: data.shiftCode,
      objectiveId: data.objectiveId,
      objectiveName: data.objectiveName,
      positionName: data.positionName,
      clientId: data.clientId,
      clientName: data.clientName,
      titularCloseMode: 'FULL',
      refEscAsignacionDirecta: true,
    });
    await syncAusenciaCoberturaGestionada(db, {
      shiftId: data.shiftId,
      coveredByEmployeeId: data.candidateEmployeeId,
      coveredByEmployeeName: data.candidateEmployeeName,
      coverageType: String(data.type).toUpperCase(),
      resolvedBy,
      empresaId: data.empresaId,
    }, batch);
  } catch (e) {
    if (e instanceof CoverageApplyError && e.code === 'ALREADY_COVERED') {
      return buildOpsCoverageDocId(data.shiftId, data.candidateEmployeeId);
    }
    throw e;
  }
  await batch.commit();

  const texto = textoTurnoActualizado({
    code: data.shiftCode,
    objectiveName: data.objectiveName,
    positionName: data.positionName,
  });
  await avisarTurnoActualizado(db, data.candidateEmployeeId, texto, covDocId, data.empresaId).catch((err) => {
    console.warn('[refEscDirecto] aviso:', (err as Error).message);
  });
  return covDocId;
}
