/**
 * Lectura Firestore para VPLAN — adaptado de runAutoSchedule, sin importar legacy.
 */

import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { planificacionEstadoLookupDocIds } from '../assistant/planificacionEstadoKeys';
import { buildMonthDays, previousMonth } from './vplan.calendar';
import { normalizeSlaPositions, type VplanPositionDef } from './vplan.positions';
import { enrichPlanningStateWithTrailingFromTurnos } from './vplan.trailing';

const db = () => admin.firestore();

function timestampToDate(val: unknown): Date | null {
  if (!val) return null;
  if (val instanceof Timestamp) return val.toDate();
  if (val instanceof Date) return val;
  if (typeof val === 'object' && val !== null && 'toDate' in val && typeof (val as { toDate: () => Date }).toDate === 'function') {
    return (val as { toDate: () => Date }).toDate();
  }
  if (typeof val === 'object' && val !== null && 'seconds' in val) {
    const s = Number((val as { seconds: number }).seconds);
    if (Number.isFinite(s)) return new Date(s * 1000);
  }
  return null;
}

export interface VplanEmployeeRecord {
  id: string;
  displayName: string;
  priorCctHours: number;
}

export interface VplanPlanningState {
  defaultPositionByEmp: Record<string, string>;
  defaultShiftByEmp: Record<string, string>;
  trailingWorkDays?: Record<string, number>;
  trailingRestDays?: Record<string, number>;
  lastShiftByEmp?: Record<string, string>;
  lastWorkBandBeforeRest?: Record<string, string>;
}

export interface VplanExistingAssignment {
  employeeId: string;
  dateStr: string;
  code: string;
  positionName: string;
  hours?: number;
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
  planningState: VplanPlanningState;
  prevPlanningState: VplanPlanningState;
  previousMonthAssignments: VplanExistingAssignment[];
  existingAssignments: VplanExistingAssignment[];
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
  const status = String(data.status || '').toLowerCase().trim();
  if (status === 'inactivo' || status === 'inactive') return false;
  if (data.activo === true) return true;
  if (!status || status === 'activo' || status === 'active') return true;
  return true;
}

function normalizeObjectiveKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

async function buildObjectiveAliasIds(
  empresaId: string,
  canonicalObjectiveId: string,
  slaObjectiveId?: string,
  objectiveNameHint?: string,
): Promise<Set<string>> {
  const aliases = new Set<string>();
  const add = (value?: string) => {
    const trimmed = String(value || '').trim();
    if (trimmed) aliases.add(trimmed);
  };

  add(canonicalObjectiveId);
  add(slaObjectiveId);
  if (objectiveNameHint) add(objectiveNameHint);

  const snap = await db().collection('clients').where('empresaId', '==', empresaId).limit(40).get();
  for (const doc of snap.docs) {
    const objetivos = Array.isArray(doc.data().objetivos) ? doc.data().objetivos : [];
    for (const raw of objetivos) {
      const obj = raw as { id?: string; name?: string };
      const keys = [String(obj?.id || '').trim(), String(obj?.name || '').trim()].filter(Boolean);
      const matchesCanonical = keys.some(
        (key) => aliases.has(key) || normalizeObjectiveKey(key) === normalizeObjectiveKey(canonicalObjectiveId),
      );
      if (matchesCanonical) keys.forEach(add);
    }
  }

  const nameHints = new Set<string>();
  for (const alias of aliases) nameHints.add(normalizeObjectiveKey(alias));

  const slaSnap = await db().collection('servicios_sla').where('empresaId', '==', empresaId).get();
  const idsByNormName = new Map<string, Set<string>>();
  for (const doc of slaSnap.docs) {
    const data = doc.data();
    if (!isSlaActive(data)) continue;
    const oid = String(data.objectiveId || '').trim();
    const oname = normalizeObjectiveKey(String(data.objectiveName || data.name || ''));
    if (!oname) continue;
    if (!idsByNormName.has(oname)) idsByNormName.set(oname, new Set());
    if (oid) idsByNormName.get(oname)!.add(oid);
  }

  for (const hint of nameHints) {
    const related = idsByNormName.get(hint);
    if (!related) continue;
    related.forEach(add);
  }

  for (const doc of slaSnap.docs) {
    const data = doc.data();
    if (!isSlaActive(data)) continue;
    const oid = String(data.objectiveId || '').trim();
    const oname = normalizeObjectiveKey(String(data.objectiveName || data.name || ''));
    if ((oid && aliases.has(oid)) || (oname && nameHints.has(oname))) {
      if (oid) add(oid);
      add(data.objectiveName);
    }
  }

  return aliases;
}

function refMatchesObjective(
  ref: string,
  objectiveAliases: Set<string>,
  slaIdToObjectiveId: Record<string, string>,
): boolean {
  const trimmed = String(ref || '').trim();
  if (!trimmed) return false;
  if (objectiveAliases.has(trimmed)) return true;

  const mapped = slaIdToObjectiveId[trimmed];
  if (mapped && objectiveAliases.has(mapped)) return true;

  const norm = normalizeObjectiveKey(trimmed);
  for (const alias of objectiveAliases) {
    if (normalizeObjectiveKey(alias) === norm) return true;
  }
  return false;
}

async function loadSlaForObjective(objectiveId: string, empresaId: string): Promise<{
  slaId: string;
  slaObjectiveId: string;
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
    slaObjectiveId: String(sla.objectiveId || objectiveId),
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

async function buildSlaIdToObjectiveId(empresaId: string): Promise<Record<string, string>> {
  const snap = await db()
    .collection('servicios_sla')
    .where('empresaId', '==', empresaId)
    .get();
  const map: Record<string, string> = {};
  snap.docs.forEach((doc) => {
    const d = doc.data();
    if (!isSlaActive(d)) return;
    const objId = String(d.objectiveId || '');
    if (objId) map[doc.id] = objId;
  });
  return map;
}

function employeeMatchesObjective(
  employeeId: string,
  data: admin.firestore.DocumentData,
  objectiveAliases: Set<string>,
  slaIdToObjectiveId: Record<string, string>,
  planningEmployeeIds: Set<string>,
): boolean {
  if (planningEmployeeIds.has(employeeId)) return true;

  const dotacion = data.planificacionDotacion as Record<string, { positionName?: string }> | undefined;
  if (dotacion && typeof dotacion === 'object') {
    for (const [objKey, cfg] of Object.entries(dotacion)) {
      if (cfg?.positionName && refMatchesObjective(objKey, objectiveAliases, slaIdToObjectiveId)) {
        return true;
      }
    }
  }

  const pref = String(data.preferredObjectiveId || '').trim();
  if (!pref) return false;
  return refMatchesObjective(pref, objectiveAliases, slaIdToObjectiveId);
}

async function loadEmployees(
  empresaId: string,
  objectiveAliases: Set<string>,
  opts: {
    employeeIds?: string[];
    supplyScope?: 'objective' | 'empresa';
    slaIdToObjectiveId?: Record<string, string>;
    planningEmployeeIds?: Set<string>;
  },
): Promise<VplanEmployeeRecord[]> {
  const snap = await db()
    .collection('empleados')
    .where('empresaId', '==', empresaId)
    .get();

  const allowSet = opts.employeeIds?.length ? new Set(opts.employeeIds) : null;
  const scope = opts.supplyScope ?? 'objective';
  const slaMap = opts.slaIdToObjectiveId ?? {};
  const planningIds = opts.planningEmployeeIds ?? new Set<string>();

  return snap.docs
    .filter((doc) => {
      if (allowSet && !allowSet.has(doc.id)) return false;
      const data = doc.data();
      if (!isEmployeeActive(data)) return false;
      if (scope === 'empresa') return true;
      return employeeMatchesObjective(doc.id, data, objectiveAliases, slaMap, planningIds);
    })
    .map((doc) => {
      const data = doc.data();
      const first = String(data.firstName || data.nombre || '').trim();
      const last = String(data.lastName || data.apellido || '').trim();
      const composed = [last, first].filter(Boolean).join(', ');
      return {
        id: doc.id,
        displayName: composed || String(data.fullName || data.name || doc.id),
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

function emptyPlanningState(): VplanPlanningState {
  return {
    defaultPositionByEmp: {},
    defaultShiftByEmp: {},
  };
}

async function loadPlanningState(
  empresaId: string,
  objectiveId: string,
  year: number,
  month: number,
): Promise<VplanPlanningState> {
  const docIds = planificacionEstadoLookupDocIds(empresaId, objectiveId, year, month);
  for (const key of docIds) {
    const snap = await db().collection('planificacion_estados').doc(key).get();
    if (!snap.exists) continue;
    const d = snap.data() || {};
    const defaultPositionByEmp = (d.defaultPositionByEmp as Record<string, string>) || {};
    const hasTrailing = Boolean(
      d.trailingWorkDays || d.trailingRestDays || d.lastShiftByEmp || d.lastWorkBandBeforeRest,
    );
    if (Object.keys(defaultPositionByEmp).length === 0 && !hasTrailing) continue;
    return {
      defaultPositionByEmp,
      defaultShiftByEmp: (d.defaultShiftByEmp as Record<string, string>) || {},
      trailingWorkDays: d.trailingWorkDays as Record<string, number> | undefined,
      trailingRestDays: d.trailingRestDays as Record<string, number> | undefined,
      lastShiftByEmp: d.lastShiftByEmp as Record<string, string> | undefined,
      lastWorkBandBeforeRest: d.lastWorkBandBeforeRest as Record<string, string> | undefined,
    };
  }
  return emptyPlanningState();
}

function dateStrFromTimestamp(ts: unknown): string | null {
  if (!ts) return null;
  if (typeof ts === 'string') return ts.slice(0, 10);
  const d = timestampToDate(ts);
  if (!d || Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function loadMonthAssignments(
  objectiveId: string,
  year: number,
  month: number,
  opts?: { includeDrafts?: boolean },
): Promise<VplanExistingAssignment[]> {
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
  const includeDrafts = opts?.includeDrafts === true;
  const snap = await db()
    .collection('turnos')
    .where('objectiveId', '==', objectiveId)
    .get();

  const byKey = new Map<string, VplanExistingAssignment & { _draft?: boolean }>();
  snap.docs.forEach((doc) => {
    const d = doc.data();
    const isDraft = d.draft === true;
    if (!includeDrafts && isDraft) return;
    const dateStr = dateStrFromTimestamp(d.startTime)
      ?? String(d.dateStr || d.date || '').slice(0, 10);
    if (!dateStr.startsWith(monthPrefix)) return;
    const employeeId = String(d.employeeId || d.empId || '');
    if (!employeeId) return;
    const row: VplanExistingAssignment & { _draft?: boolean } = {
      employeeId,
      dateStr,
      code: String(d.code || d.shiftCode || 'M').toUpperCase(),
      positionName: String(d.positionName || d.puesto || ''),
      hours: Number(d.hours) || undefined,
      _draft: isDraft,
    };
    const key = `${employeeId}_${dateStr}`;
    const prev = byKey.get(key);
    if (!prev || (prev._draft && !isDraft)) {
      byKey.set(key, row);
    }
  });

  return [...byKey.values()].map(({ _draft, ...row }) => row);
}

async function loadExistingAssignments(
  objectiveId: string,
  year: number,
  month: number,
): Promise<VplanExistingAssignment[]> {
  return loadMonthAssignments(objectiveId, year, month, { includeDrafts: false });
}

export async function loadVplanPlanningSnapshot(request: {
  empresaId: string;
  objectiveId: string;
  year: number;
  month: number;
  employeeIds?: string[];
  supplyScope?: 'objective' | 'empresa';
}): Promise<VplanPlanningSnapshot> {
  const sla = await loadSlaForObjective(request.objectiveId, request.empresaId);
  const objectiveName = sla.objectiveName ?? await resolveObjectiveName(request.objectiveId, request.empresaId);
  const days = buildMonthDays(request.year, request.month);
  const prev = previousMonth(request.year, request.month);
  const prevKey = `${request.objectiveId}_${prev.year}_${prev.month}`;

  const prevDays = buildMonthDays(prev.year, prev.month);

  const [objectiveAliases, slaIdToObjectiveId, planningState, prevPlanningStateRaw, absences, existingAssignments, previousMonthAssignments] = await Promise.all([
    buildObjectiveAliasIds(request.empresaId, request.objectiveId, sla.slaObjectiveId, objectiveName),
    buildSlaIdToObjectiveId(request.empresaId),
    loadPlanningState(request.empresaId, request.objectiveId, request.year, request.month),
    loadPlanningState(request.empresaId, request.objectiveId, prev.year, prev.month),
    loadAbsences(request.empresaId, request.year, request.month),
    loadExistingAssignments(request.objectiveId, request.year, request.month),
    loadMonthAssignments(request.objectiveId, prev.year, prev.month, { includeDrafts: true }),
  ]);

  const prevPlanningState = enrichPlanningStateWithTrailingFromTurnos(
    prevPlanningStateRaw,
    previousMonthAssignments,
    prevDays.map((d) => d.dateStr),
  );

  const planningEmployeeIds = new Set([
    ...Object.keys(planningState.defaultPositionByEmp || {}),
    ...Object.keys(prevPlanningState.defaultPositionByEmp || {}),
  ]);

  const employees = await loadEmployees(request.empresaId, objectiveAliases, {
    employeeIds: request.employeeIds,
    supplyScope: request.supplyScope,
    slaIdToObjectiveId,
    planningEmployeeIds,
  });

  let mergedPlanning = planningState;
  if (
    Object.keys(planningState.defaultPositionByEmp).length === 0
    && Object.keys(prevPlanningState.defaultPositionByEmp).length > 0
  ) {
    mergedPlanning = {
      ...planningState,
      defaultPositionByEmp: prevPlanningState.defaultPositionByEmp,
      defaultShiftByEmp: prevPlanningState.defaultShiftByEmp,
    };
  }

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
    planningState: mergedPlanning,
    prevPlanningState,
    previousMonthAssignments,
    existingAssignments,
  };
}
