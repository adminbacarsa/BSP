/**
 * Guard de saturación por slot (cliente) — respeta quantity del puesto.
 */
import {
  collection,
  getDocs,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type Timestamp,
  doc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

export function normalizePosMatchClient(n: unknown): string {
  let s = String(n ?? '').trim().toLowerCase();
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  s = s.replace(/^puesto\s+/, '');
  return s;
}

export function isNoPlanningVacancyOriginClient(data: Record<string, unknown> | null | undefined): boolean {
  const o = String(data?.vacancyOrigin || data?.origin || '').toUpperCase();
  return o.includes('NO_PLANNING') || o.includes('SIN_PLANIFICAR') || o === 'SLA_VIRTUAL';
}

export function resolveSlotRequiredQuantityClient(data: Record<string, unknown> | null | undefined): number {
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

function isVacancyLikeClient(s: any): boolean {
  return (
    s?.isUnassigned === true
    || s?.employeeId === 'VACANTE'
    || String(s?.employeeName || '').toUpperCase().startsWith('VACANTE')
  );
}

function isRealCovererClient(s: any): boolean {
  if (!s || isVacancyLikeClient(s)) return false;
  if (s.isAbsent || s.isFranco || s.isSinCobertura) return false;
  const empId = String(s.employeeId || '');
  if (!empId || empId === 'VACANTE') return false;
  return true;
}

/** Cuántos cubridores reales hay en el slot dentro de processedData. */
export function countSlotCoverersInProcessedData(
  processedData: any[],
  slot: { objectiveId?: string; positionName?: string; shiftDateObj?: Date | null; id?: string },
): number {
  const objId = String(slot.objectiveId || '');
  const pos = normalizePosMatchClient(slot.positionName);
  const startMs = slot.shiftDateObj instanceof Date ? slot.shiftDateObj.getTime() : 0;
  if (!objId || !startMs) return 0;
  return processedData.filter((s) => {
    if (s.id === slot.id) return false;
    if (!isRealCovererClient(s)) return false;
    if (String(s.objectiveId || '') !== objId) return false;
    const sPos = normalizePosMatchClient(s.positionName);
    const cPos = normalizePosMatchClient(s.coversPositionName);
    if (pos && sPos !== pos && cPos !== pos) return false;
    const sStart = s.shiftDateObj instanceof Date ? s.shiftDateObj.getTime() : 0;
    return Math.abs(sStart - startMs) < 2 * 60 * 1000;
  }).length;
}

/** Saturado solo si covered >= requiredQuantity del puesto. */
export function slotSaturatedInProcessedData(
  processedData: any[],
  slot: {
    objectiveId?: string;
    positionName?: string;
    shiftDateObj?: Date | null;
    id?: string;
    requiredQuantity?: number;
    quantity?: number;
  },
): boolean {
  const required = resolveSlotRequiredQuantityClient(slot as any);
  return countSlotCoverersInProcessedData(processedData, slot) >= required;
}

/** Cierra vacantes hermanas solo si el slot ya alcanzó quantity. */
export async function closeSiblingNoPlanningVacanciesClient(opts: {
  coveredVacancyId: string;
  objectiveId: string;
  positionName?: string | null;
  startTime: Timestamp;
  empresaId?: string | null;
  covererEmployeeId?: string | null;
  covererEmployeeName?: string | null;
  coverageEventId?: string | null;
  requiredQuantity?: number | null;
  /** Cubiertos ya contados en memoria (incluye el que se acaba de asignar). */
  coveredAfterAssign?: number | null;
}): Promise<number> {
  const objId = String(opts.objectiveId || '').trim();
  if (!objId || !opts.startTime || !opts.coveredVacancyId) return 0;
  const required = Math.max(1, Math.floor(Number(opts.requiredQuantity) || 1));
  const coveredAfter = Number(opts.coveredAfterAssign);
  if (Number.isFinite(coveredAfter) && coveredAfter < required) return 0;

  const pos = normalizePosMatchClient(opts.positionName);

  let snap;
  try {
    if (opts.empresaId) {
      snap = await getDocs(query(
        collection(db, 'turnos'),
        where('empresaId', '==', opts.empresaId),
        where('objectiveId', '==', objId),
        where('startTime', '==', opts.startTime),
        limit(60),
      ));
    } else {
      snap = await getDocs(query(
        collection(db, 'turnos'),
        where('objectiveId', '==', objId),
        where('startTime', '==', opts.startTime),
        limit(60),
      ));
    }
  } catch {
    snap = await getDocs(query(
      collection(db, 'turnos'),
      where('objectiveId', '==', objId),
      where('startTime', '==', opts.startTime),
      limit(60),
    ));
  }

  // Si no vino coveredAfter, contar en Firestore
  if (!Number.isFinite(coveredAfter)) {
    let covered = 0;
    for (const d of snap.docs) {
      const data = d.data();
      if (isVacancyLikeClient(data) || data.employeeId === 'VACANTE') continue;
      if (data.isAbsent || data.isFranco || data.isSinCobertura) continue;
      if (!data.employeeId || data.employeeId === 'VACANTE') continue;
      const dPos = normalizePosMatchClient(data.positionName);
      const cPos = normalizePosMatchClient(data.coversPositionName);
      if (pos && dPos !== pos && cPos !== pos) continue;
      covered++;
    }
    if (covered < required) return 0;
  }

  const batch = writeBatch(db);
  let closed = 0;
  const siblingIds: string[] = [];
  for (const d of snap.docs) {
    if (d.id === opts.coveredVacancyId) continue;
    const data = d.data();
    if (!isVacancyLikeClient(data) && data.employeeId !== 'VACANTE') continue;
    if (!isNoPlanningVacancyOriginClient(data) && String(data.origin || '') !== 'SLA_VIRTUAL') continue;
    const dPos = normalizePosMatchClient(data.positionName);
    if (pos && dPos && dPos !== pos) continue;
    const st = String(data.status || '').toUpperCase();
    if (st === 'COVERED' || st === 'CANCELLED' || st === 'COMPLETED') continue;
    siblingIds.push(d.id);
    batch.update(d.ref, {
      status: 'COVERED',
      isUnassigned: false,
      coveredByEmployeeId: opts.covererEmployeeId || null,
      coveredByEmployeeName: opts.covererEmployeeName || null,
      coverageEventId: opts.coverageEventId || null,
      coveredBySiblingVacancyId: opts.coveredVacancyId,
      slotSaturatedClosedAt: serverTimestamp(),
      resolvedBy: 'OPERACIONES',
    });
    closed++;
  }
  if (closed) await batch.commit();

  for (const sid of siblingIds) {
    try {
      const convs = await getDocs(query(
        collection(db, 'convocatorias_cobertura'),
        where('shiftId', '==', sid),
        where('status', 'in', ['PENDING', 'ESCALATED']),
        limit(20),
      ));
      if (convs.empty) continue;
      const cb = writeBatch(db);
      convs.docs.forEach((c) => {
        cb.update(c.ref, {
          status: 'CANCELLED',
          cancelledAt: serverTimestamp(),
          cancelReason: 'SLOT_YA_SATURADO',
        });
      });
      await cb.commit();
    } catch { /* ignore */ }
  }
  return closed;
}

export async function markVacancyCoveredIfSlotSaturated(vacancyId: string, covererName?: string): Promise<void> {
  if (!vacancyId || vacancyId.startsWith('V124_') || vacancyId.startsWith('SLA_GAP')) return;
  try {
    await updateDoc(doc(db, 'turnos', vacancyId), {
      status: 'COVERED',
      isUnassigned: false,
      coveredByEmployeeName: covererName || null,
      slotSaturatedClosedAt: serverTimestamp(),
      resolvedBy: 'OPERACIONES',
    });
  } catch { /* ignore */ }
}
