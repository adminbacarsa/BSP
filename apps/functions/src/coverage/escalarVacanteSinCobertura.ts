import * as admin from 'firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { retainOutgoingForGap } from './coverageRetention';

const normPos = (n: unknown): string =>
  String(n ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^puesto\s+/, '');

function posMatch(a: unknown, b: unknown): boolean {
  const na = normPos(a);
  const nb = normPos(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.endsWith(nb) || nb.endsWith(na)) return true;
  return false;
}

export type EscalarVacanteParams = {
  shiftId: string;
  empresaId?: string | null;
  objectiveId?: string | null;
  objectiveName?: string | null;
  positionName?: string | null;
  message?: string | null;
  /** Intentar retener saliente antes de escalar (orden CC). */
  attemptRetention?: boolean;
  source?: string;
};

export type EscalarVacanteResult = {
  escalated: boolean;
  retained: boolean;
  retentionShiftIds: string[];
  novedadId?: string;
  supervisorsNotified: number;
};

async function notifySupervisorsObjective(
  db: admin.firestore.Firestore,
  objectiveId: string,
  payload: { title: string; body: string; shiftId: string; empresaId?: string | null },
): Promise<number> {
  const oid = String(objectiveId || '').trim();
  if (!oid) return 0;

  const snap = await db
    .collection('system_users')
    .where('objetivosAsignados', 'array-contains', oid)
    .limit(25)
    .get();

  let n = 0;
  for (const d of snap.docs) {
    const uid = String(d.id || d.data()?.uid || '').trim();
    if (!uid) continue;
    await db.collection('user_notifications').add({
      uid,
      employeeId: null,
      title: payload.title,
      body: payload.body,
      type: 'VACANTE_SIN_COBERTURA',
      target: 'supervisor',
      turnoId: payload.shiftId,
      objectiveId: oid,
      empresaId: payload.empresaId ?? null,
      read: false,
      readAt: null,
      createdAt: FieldValue.serverTimestamp(),
    });
    n += 1;

    const tokensSnap = await db.collection('device_tokens').where('uid', '==', uid).limit(5).get();
    const tokens = tokensSnap.docs
      .map((t) => t.data()?.token)
      .filter((t): t is string => typeof t === 'string' && t.length > 10);
    if (tokens.length) {
      await admin
        .messaging()
        .sendEachForMulticast({
          tokens,
          notification: { title: payload.title, body: payload.body },
          webpush: {
            notification: { icon: '/icons/icon-192x192.png', requireInteraction: true },
            fcmOptions: { link: '/admin/operaciones' },
          },
        })
        .catch(() => undefined);
    }
  }
  return n;
}

export async function escalarVacanteSinCobertura(
  db: admin.firestore.Firestore,
  params: EscalarVacanteParams,
): Promise<EscalarVacanteResult> {
  const shiftId = String(params.shiftId || '').trim();
  if (!shiftId) {
    return { escalated: false, retained: false, retentionShiftIds: [], supervisorsNotified: 0 };
  }

  const shiftRef = db.collection('turnos').doc(shiftId);
  const shiftSnap = await shiftRef.get();
  const shift = shiftSnap.exists ? (shiftSnap.data() as Record<string, unknown>) : null;

  const empresaId = String(params.empresaId || shift?.empresaId || '').trim() || null;
  const objectiveId = String(params.objectiveId || shift?.objectiveId || '').trim() || null;
  const objectiveName = String(params.objectiveName || shift?.objectiveName || '').trim();
  const positionName = String(params.positionName || shift?.positionName || '').trim();

  if (params.attemptRetention !== false && shift) {
    const ret = await retainOutgoingForGap(db, { ...shift, id: shiftId });
    if (ret.applied) {
      return {
        escalated: false,
        retained: true,
        retentionShiftIds: ret.shiftIds,
        supervisorsNotified: 0,
      };
    }
  }

  const safeId = shiftId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  const novRef = db.collection('novedades').doc(`escalada_${safeId}`);
  const exist = await novRef.get();
  if (!exist.exists) {
    await novRef.set({
      type: 'VACANTE_SIN_COBERTURA',
      status: 'PENDIENTE',
      shiftId,
      objectiveId,
      objectiveName,
      positionName,
      empresaId,
      message:
        params.message
        || `Vacante sin cobertura en ${objectiveName || 'objetivo'} (${positionName || 'puesto'}). Requiere escalamiento.`,
      resolved: false,
      source: params.source || 'ESCALAR_VACANTE',
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  if (shiftSnap.exists) {
    await shiftRef.update({
      isSinCobertura: true,
      status: 'SIN_COBERTURA',
      vacanteEscalada: true,
      isUnassigned: true,
    });
  }

  const supervisorsNotified = objectiveId
    ? await notifySupervisorsObjective(db, objectiveId, {
        title: 'Vacante sin cobertura',
        body: `${objectiveName || 'Objetivo'} · ${positionName || 'Puesto'} — escalada a supervisor.`,
        shiftId,
        empresaId,
      })
    : 0;

  return {
    escalated: true,
    retained: false,
    retentionShiftIds: [],
    novedadId: novRef.id,
    supervisorsNotified,
  };
}

/** Compañeros presentes en el mismo objetivo (excluye al titular). */
export async function countColleaguesPresentSameObjective(
  db: admin.firestore.Firestore,
  objectiveId: string,
  excludeShiftId: string,
  excludeEmployeeId: string,
): Promise<number> {
  const oid = String(objectiveId || '').trim();
  if (!oid) return 0;
  const snap = await db
    .collection('turnos')
    .where('objectiveId', '==', oid)
    .where('isPresent', '==', true)
    .limit(40)
    .get();
  let n = 0;
  for (const d of snap.docs) {
    if (d.id === excludeShiftId) continue;
    const data = d.data();
    if (data.isCompleted === true) continue;
    const eid = String(data.employeeId || '').trim();
    if (!eid || eid === excludeEmployeeId || eid === 'VACANTE') continue;
    n += 1;
  }
  return n;
}

export async function loadReemplazarRetiro2a3hFromSla(
  db: admin.firestore.Firestore,
  objectiveId: string,
  positionName: string,
): Promise<boolean | null> {
  const oid = String(objectiveId || '').trim();
  if (!oid) return null;
  const slaSnap = await db
    .collection('servicios_sla')
    .where('objectiveId', '==', oid)
    .where('status', '==', 'active')
    .limit(5)
    .get();
  for (const d of slaSnap.docs) {
    const positions = Array.isArray(d.data().positions) ? d.data().positions : [];
    for (const p of positions) {
      if (!posMatch(p?.name, positionName)) continue;
      if (typeof p.reemplazarRetiro2a3h === 'boolean') return p.reemplazarRetiro2a3h;
    }
  }
  return null;
}
