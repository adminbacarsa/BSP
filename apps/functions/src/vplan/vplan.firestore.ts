/**
 * Lectura Firestore para VPLAN — adaptado de runAutoSchedule, sin importar legacy.
 */

import * as admin from 'firebase-admin';
import { buildMonthDays, previousMonth } from './vplan.calendar';
import { normalizeSlaPositions, type VplanPositionDef } from './vplan.positions';

const db = () => admin.firestore();

export interface VplanEmployeeRecord {
  id: string;
  displayName: string;
  priorCctHours: number;
}

export interface VplanPlanningSnapshot {
  empresaId: string;
  objectiveId: string;
  objectiveName?: string;
  slaId: string;
  slaVendidas: number;
  positions: VplanPositionDef[];
  employees: VplanEmployeeRecord[];
  absences: Record<string, Set<string>>;
  days: Array<{ dateStr: string; dayLetter: string }>;
  previousMonthStateKey?: string;
}

function isSlaActive(data: admin.firestore.DocumentData): boolean {
  const status = String(data.status || '').toLowerCase();
  if (status === 'inactive') return false;
  if (status === 'active') return true;
  if (data.active === false) return false;
  return true;
}

function isEmployeeActive(data: admin.firestore.DocumentData): boolean {
  if (data.activo === false) return false;
  const status = String(data.status || '').toUpperCase();
  if (status === 'INACTIVE') return false;
  return data.activo === true || status === 'ACTIVE' || status === '';
}

async function loadSlaForObjective(objectiveId: string, empresaId: string): Promise<{
  slaId: string;
  slaVendidas: number;
  positions: VplanPositionDef[];
  objectiveName?: string;
}> {
  const snap = await db()
    .collection('servicios_sla')
    .where('objectiveId', '==', objectiveId)
    .get();

  const docs = snap.docs.filter((d) => {
    const data = d.data();
    if (empresaId && data.empresaId && data.empresaId !== empresaId) return false;
    return isSlaActive(data);
  });

  if (docs.length === 0) {
    throw new Error(`No hay SLA activo para el objetivo ${objectiveId}`);
  }

  const doc = docs[0];
  const sla = doc.data();
  return {
    slaId: doc.id,
    slaVendidas: Math.max(0, Number(sla.totalMonthlyHours) || 0),
    positions: normalizeSlaPositions(sla.positions || []),
    objectiveName: sla.objectiveName ? String(sla.objectiveName) : undefined,
  };
}

async function resolveObjectiveName(objectiveId: string, empresaId: string): Promise<string | undefined> {
  const snap = await db().collection('clients').where('empresaId', '==', empresaId).limit(40).get();
  for (const doc of snap.docs) {
    const objs = Array.isArray(doc.data().objetivos) ? doc.data().objetivos : [];
    const found = objs.find((o: { id?: string; name?: string }) => o?.id === objectiveId || o?.name === objectiveId);
    if (found) return String(found.name || found.id || objectiveId);
  }
  return undefined;
}

async function loadEmployees(
  empresaId: string,
  objectiveId: string,
  employeeIds?: string[],
): Promise<VplanEmployeeRecord[]> {
  const snap = await db()
    .collection('empleados')
    .where('empresaId', '==', empresaId)
    .get();

  const allowSet = employeeIds?.length ? new Set(employeeIds) : null;

  return snap.docs
    .filter((doc) => {
      if (allowSet && !allowSet.has(doc.id)) return false;
      const data = doc.data();
      if (!isEmployeeActive(data)) return false;
      const pref = data.preferredObjectiveId;
      return !pref || pref === objectiveId;
    })
    .map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        displayName: String(data.nombre || data.fullName || data.name || doc.id),
        priorCctHours: Math.max(0, Number(data.priorCctHours ?? data.horasCiclo ?? data.horasMes) || 0),
      };
    });
}

async function loadAbsences(
  empresaId: string,
  year: number,
  month: number,
): Promise<Record<string, Set<string>>> {
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const snap = await db()
    .collection('ausencias')
    .where('empresaId', '==', empresaId)
    .where('startDate', '<=', monthEnd)
    .where('endDate', '>=', monthStart)
    .get();

  const result: Record<string, Set<string>> = {};
  snap.docs.forEach((doc) => {
    const d = doc.data();
    const empId = String(d.employeeId || d.empId || '');
    if (!empId) return;
    const startStr = String(d.startDate || '').slice(0, 10);
    const endStr = String(d.endDate || '').slice(0, 10);
    if (!startStr || !endStr) return;
    if (!result[empId]) result[empId] = new Set();
    const start = new Date(`${startStr}T12:00:00`);
    const end = new Date(`${endStr}T12:00:00`);
    for (let cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) {
      const y = cur.getFullYear();
      const m = String(cur.getMonth() + 1).padStart(2, '0');
      const day = String(cur.getDate()).padStart(2, '0');
      const dk = `${y}-${m}-${day}`;
      if (dk >= monthStart && dk <= monthEnd) result[empId].add(dk);
    }
  });

  return result;
}

export async function loadVplanPlanningSnapshot(request: {
  empresaId: string;
  objectiveId: string;
  year: number;
  month: number;
  employeeIds?: string[];
}): Promise<VplanPlanningSnapshot> {
  const sla = await loadSlaForObjective(request.objectiveId, request.empresaId);
  const objectiveName = sla.objectiveName ?? await resolveObjectiveName(request.objectiveId, request.empresaId);
  const employees = await loadEmployees(request.empresaId, request.objectiveId, request.employeeIds);
  const absences = await loadAbsences(request.empresaId, request.year, request.month);
  const days = buildMonthDays(request.year, request.month);
  const prev = previousMonth(request.year, request.month);
  const prevKey = `${request.objectiveId}_${prev.year}_${prev.month}`;

  return {
    empresaId: request.empresaId,
    objectiveId: request.objectiveId,
    objectiveName,
    slaId: sla.slaId,
    slaVendidas: sla.slaVendidas,
    positions: sla.positions,
    employees,
    absences,
    days,
    previousMonthStateKey: prevKey,
  };
}
