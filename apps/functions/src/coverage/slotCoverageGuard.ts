/**
 * Guard de saturación por slot SLA: evita N cubridores de más sobre el mismo hueco.
 * Respeta quantity del puesto (ej. Puesto 1 = 4 pax): satura solo cuando covered >= required.
 */
import * as admin from 'firebase-admin';
import {
  FieldValue,
  type WriteBatch,
  type Timestamp,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
  type Query,
} from 'firebase-admin/firestore';

export function normalizePosMatch(n: unknown): string {
  let s = String(n ?? '').trim().toLowerCase();
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  s = s.replace(/^puesto\s+/, '');
  return s;
}

export function isNoPlanningVacancyOrigin(data: Record<string, unknown> | null | undefined): boolean {
  const o = String(data?.vacancyOrigin || data?.origin || '').toUpperCase();
  return o.includes('NO_PLANNING') || o.includes('SIN_PLANIFICAR') || o === 'SLA_VIRTUAL';
}

function isVacancyDoc(data: Record<string, unknown>): boolean {
  return (
    data.isUnassigned === true
    || data.employeeId === 'VACANTE'
    || String(data.employeeName || '').toUpperCase().startsWith('VACANTE')
    || String(data.status || '').toUpperCase() === 'UNCOVERED'
  );
}

function isRealCovererDoc(data: Record<string, unknown>): boolean {
  if (isVacancyDoc(data)) return false;
  if (data.isAbsent === true || data.isFranco === true) return false;
  if (data.isSinCobertura === true || data.employeeId === 'SIN_COBERTURA') return false;
  const empId = String(data.employeeId || '');
  if (!empId || empId === 'VACANTE') return false;
  return true;
}

/** Quantity del puesto para el slot (default 1 si no está sellada en el doc). */
export function resolveSlotRequiredQuantity(data: Record<string, unknown> | null | undefined): number {
  const raw = Number(
    data?.requiredQuantity
    ?? data?.slotRequiredQuantity
    ?? data?.quantity
    ?? data?.guardQty
    ?? 0,
  );
  if (Number.isFinite(raw) && raw >= 1) return Math.floor(raw);
  return 1;
}

export type SlotRef = {
  objectiveId: string;
  positionName?: string | null;
  startTime?: Timestamp | null;
  endTime?: Timestamp | null;
  empresaId?: string | null;
  excludeShiftIds?: string[];
  /** Capacidad SLA del puesto (4 = hasta 4 cubridores/planificados). */
  requiredQuantity?: number | null;
};

export type SlotCoverageStatus = {
  covered: number;
  required: number;
  saturated: boolean;
  covererNames: string[];
};

async function querySlotDocs(
  db: admin.firestore.Firestore,
  slot: SlotRef,
): Promise<QuerySnapshot> {
  const objId = String(slot.objectiveId || '').trim();
  try {
    let q: Query = db.collection('turnos')
      .where('objectiveId', '==', objId)
      .where('startTime', '==', slot.startTime)
      .limit(60);
    if (slot.empresaId) {
      q = db.collection('turnos')
        .where('empresaId', '==', slot.empresaId)
        .where('objectiveId', '==', objId)
        .where('startTime', '==', slot.startTime)
        .limit(60);
    }
    return await q.get();
  } catch {
    return await db.collection('turnos')
      .where('objectiveId', '==', objId)
      .where('startTime', '==', slot.startTime)
      .limit(60)
      .get();
  }
}

/**
 * Estado de cobertura del slot vs quantity del puesto.
 * Si el doc no trae requiredQuantity, infiere: max(sellado, cubridores + vacantes abiertas).
 */
export async function slotCoverageStatus(
  db: admin.firestore.Firestore,
  slot: SlotRef,
): Promise<SlotCoverageStatus> {
  const objId = String(slot.objectiveId || '').trim();
  const stamped = Math.max(1, Math.floor(Number(slot.requiredQuantity) || 1));
  if (!objId || !slot.startTime) {
    return { covered: 0, required: stamped, saturated: false, covererNames: [] };
  }

  const pos = normalizePosMatch(slot.positionName);
  const exclude = new Set((slot.excludeShiftIds || []).map(String));
  const snap = await querySlotDocs(db, slot);

  const covererNames: string[] = [];
  let openVacancies = 0;
  for (const d of snap.docs) {
    if (exclude.has(d.id)) continue;
    const data = d.data() as Record<string, unknown>;
    const dPos = normalizePosMatch(data.positionName);
    const coversPos = normalizePosMatch(data.coversPositionName);

    if (isVacancyDoc(data)) {
      if (pos && dPos && dPos !== pos) continue;
      const st = String(data.status || '').toUpperCase();
      if (st !== 'COVERED' && st !== 'CANCELLED' && st !== 'COMPLETED') openVacancies++;
      continue;
    }
    if (!isRealCovererDoc(data)) continue;
    if (pos && dPos !== pos && coversPos !== pos) continue;
    covererNames.push(String(data.employeeName || data.employeeId || d.id));
  }

  const covered = covererNames.length;
  // Inferir cupo si docs viejos no tienen requiredQuantity: vacantes abiertas + ya cubiertos
  const inferred = Math.max(stamped, covered + openVacancies);
  const required = Number(slot.requiredQuantity) > 1 ? stamped : inferred;

  return {
    covered,
    required,
    saturated: covered >= required,
    covererNames,
  };
}

/** @deprecated usar slotCoverageStatus */
export async function slotAlreadyHasCoverer(
  db: admin.firestore.Firestore,
  slot: SlotRef,
): Promise<{ saturated: boolean; covererNames: string[]; covered: number; required: number }> {
  const st = await slotCoverageStatus(db, slot);
  return {
    saturated: st.saturated,
    covererNames: st.covererNames,
    covered: st.covered,
    required: st.required,
  };
}

/**
 * Cierra vacantes UNCOVERED hermanas solo si el slot ya alcanzó quantity.
 * Si faltan cupos (covered < required), deja las demás vacantes abiertas.
 */
export async function closeSiblingNoPlanningVacancies(
  db: admin.firestore.Firestore,
  opts: {
    coveredVacancyId: string;
    objectiveId: string;
    positionName?: string | null;
    startTime?: Timestamp | null;
    empresaId?: string | null;
    covererEmployeeId?: string | null;
    covererEmployeeName?: string | null;
    coverageEventId?: string | null;
    resolvedBy?: string | null;
    requiredQuantity?: number | null;
  },
): Promise<number> {
  const objId = String(opts.objectiveId || '').trim();
  const coveredId = String(opts.coveredVacancyId || '').trim();
  if (!objId || !opts.startTime || !coveredId) return 0;

  const required = Math.max(1, Math.floor(Number(opts.requiredQuantity) || 1));
  const status = await slotCoverageStatus(db, {
    objectiveId: objId,
    positionName: opts.positionName,
    startTime: opts.startTime,
    empresaId: opts.empresaId,
    requiredQuantity: required,
    excludeShiftIds: [],
  });

  // Todavía faltan cupos → no cerrar hermanas (son huecos legítimos V124_0..n)
  if (!status.saturated) return 0;

  const pos = normalizePosMatch(opts.positionName);
  const snap = await querySlotDocs(db, {
    objectiveId: objId,
    positionName: opts.positionName,
    startTime: opts.startTime,
    empresaId: opts.empresaId,
  });

  const batch = db.batch();
  let closed = 0;
  const siblingIds: string[] = [];

  for (const d of snap.docs) {
    if (d.id === coveredId) continue;
    const data = d.data() as Record<string, unknown>;
    if (!isVacancyDoc(data)) continue;
    if (!isNoPlanningVacancyOrigin(data) && String(data.origin || '') !== 'SLA_VIRTUAL') continue;
    const dPos = normalizePosMatch(data.positionName);
    if (pos && dPos && dPos !== pos) continue;
    const st = String(data.status || '').toUpperCase();
    if (st === 'COVERED' || st === 'CANCELLED' || st === 'COMPLETED') continue;

    siblingIds.push(d.id);
    batch.update(d.ref, {
      status: 'COVERED',
      isUnassigned: false,
      coveredByEmployeeId: opts.covererEmployeeId || null,
      coveredByEmployeeName: opts.covererEmployeeName || null,
      coverageEventId: opts.coverageEventId || data.coverageEventId || null,
      coveredBySiblingVacancyId: coveredId,
      slotSaturatedClosedAt: FieldValue.serverTimestamp(),
      resolvedBy: opts.resolvedBy || data.resolvedBy || 'AUTO',
    });
    closed++;
  }

  if (!closed) return 0;
  await batch.commit();

  for (const sid of siblingIds) {
    const convs = await db.collection('convocatorias_cobertura')
      .where('shiftId', '==', sid)
      .where('status', 'in', ['PENDING', 'ESCALATED'])
      .limit(20)
      .get();
    if (convs.empty) continue;
    const cb = db.batch();
    for (const c of convs.docs) {
      cb.update(c.ref, {
        status: 'CANCELLED',
        cancelledAt: FieldValue.serverTimestamp(),
        cancelReason: 'SLOT_YA_SATURADO',
      });
    }
    await cb.commit();
  }

  return closed;
}

export function queueCloseSiblingVacanciesInBatch(
  batch: WriteBatch,
  siblingDocs: QueryDocumentSnapshot[],
  opts: {
    coveredVacancyId: string;
    covererEmployeeId?: string | null;
    covererEmployeeName?: string | null;
    coverageEventId?: string | null;
    resolvedBy?: string | null;
    positionName?: string | null;
  },
): string[] {
  const pos = normalizePosMatch(opts.positionName);
  const closedIds: string[] = [];
  for (const d of siblingDocs) {
    if (d.id === opts.coveredVacancyId) continue;
    const data = d.data() as Record<string, unknown>;
    if (!isVacancyDoc(data)) continue;
    if (!isNoPlanningVacancyOrigin(data) && String(data.origin || '') !== 'SLA_VIRTUAL') continue;
    const dPos = normalizePosMatch(data.positionName);
    if (pos && dPos && dPos !== pos) continue;
    const st = String(data.status || '').toUpperCase();
    if (st === 'COVERED' || st === 'CANCELLED' || st === 'COMPLETED') continue;
    batch.update(d.ref, {
      status: 'COVERED',
      isUnassigned: false,
      coveredByEmployeeId: opts.covererEmployeeId || null,
      coveredByEmployeeName: opts.covererEmployeeName || null,
      coverageEventId: opts.coverageEventId || null,
      coveredBySiblingVacancyId: opts.coveredVacancyId,
      slotSaturatedClosedAt: FieldValue.serverTimestamp(),
      resolvedBy: opts.resolvedBy || 'AUTO',
    });
    closedIds.push(d.id);
  }
  return closedIds;
}
