import * as admin from 'firebase-admin';
import { Timestamp, type Query, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { runAutoScheduleCore, type RunAutoScheduleInput, type RunAutoScheduleOutput } from '../scheduling/runAutoSchedule';
import { runPlanningGeminiOptimize, type GeminiRespuesta } from '../assistant/planningGeminiServer';

type TurnoDoc = Record<string, unknown>;
type EmployeeDoc = Record<string, unknown>;
type SlaDoc = Record<string, unknown>;

export type PlanningAutomationInput = {
  empresaId: string;
  objectiveId: string;
  year: number;
  month: number;
  applyGemini?: boolean;
  overwriteAutoDrafts?: boolean;
  dryRun?: boolean;
};

export type PlanningAutomationResult = {
  ok: boolean;
  runId: string;
  objectiveId: string;
  year: number;
  month: number;
  assignmentsGenerated: number;
  assignmentsPersisted: number;
  coverageRatio: number;
  uncoveredSlots: number;
  slaHoursClosed: boolean;
  geminiApplied: boolean;
  geminiCorrectionsApplied: number;
  geminiSummary: string | null;
  dryRun: boolean;
  notes: string[];
};

type AlertSeverity = 'low' | 'medium' | 'high';

export type OperationalAlertScanInput = {
  empresaId: string;
  lookbackHours?: number;
  lookaheadHours?: number;
  toleranceMinutes?: number;
};

export type OperationalAlertScanResult = {
  ok: boolean;
  empresaId: string;
  evaluatedShifts: number;
  anomaliesDetected: number;
  alertsCreated: number;
  byType: Record<string, number>;
  generatedAt: string;
};

export type ClosureChecklistInput = {
  empresaId: string;
  year: number;
  month: number;
  persistSnapshot?: boolean;
};

export type ClosureChecklistResult = {
  ok: boolean;
  empresaId: string;
  period: string;
  generatedAt: string;
  totals: {
    turnos: number;
    marcacionesPendientes: number;
    turnosAbiertosFueraHorario: number;
    ausencias: number;
    ausenciasSinResolver: number;
    inconsistenciasEstado: number;
  };
  horas: {
    slaVendidas: number;
    planificadasCobertura: number;
    ejecutadasFichadas: number;
    gapSlaVsPlan: number;
    gapPlanVsEjecutado: number;
  };
  prefactura: {
    source: 'hours_balances' | 'fallback_turnos';
    rows: number;
    slaHours: number;
    plannedHours: number;
    realHours: number;
    resultante: number;
    saldoPlan: number;
    saldoReal: number;
  };
  checks: {
    marcacionesOk: boolean;
    cierresOk: boolean;
    ausenciasOk: boolean;
    coberturaOk: boolean;
    listoParaCierre: boolean;
  };
  recomendaciones: string[];
};

const NON_BILLABLE_CODES = new Set(['F', 'FF', 'FP', 'FT', 'RET', 'V', 'L', 'E', 'A', 'AA', 'PG']);
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SHIFT_HOURS: Record<string, number> = {
  M: 8,
  T: 8,
  N: 8,
  D12: 12,
  N12: 12,
  REF: 8,
  ESC: 8,
  EN: 9,
  RO: 10,
};

type AssignmentRow = RunAutoScheduleOutput['assignments'][number];

function nowIso(): string {
  return new Date().toISOString();
}

function monthPeriodKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function monthStartArUtc(year: number, month: number): Date {
  return new Date(Date.UTC(year, month - 1, 1, 3, 0, 0, 0));
}

function monthEndExclusiveArUtc(year: number, month: number): Date {
  return new Date(Date.UTC(year, month, 1, 3, 0, 0, 0));
}

function dayStartArUtc(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 3, 0, 0, 0));
}

function arDateFromTimestamp(ts: Timestamp): string {
  const msAr = ts.toMillis() - 3 * 60 * 60 * 1000;
  return new Date(msAr).toISOString().slice(0, 10);
}

function durationHoursFromRange(start: Timestamp, end: Timestamp): number {
  const diff = end.toMillis() - start.toMillis();
  if (!Number.isFinite(diff) || diff <= 0) return 0;
  return Math.round((diff / 3600000) * 10) / 10;
}

function assignmentHours(row: AssignmentRow): number {
  const code = String(row.code || '').toUpperCase();
  if (Number.isFinite(row.hours) && row.hours > 0) return row.hours;
  return DEFAULT_SHIFT_HOURS[code] ?? 8;
}

function normalizeCode(raw: unknown): string {
  return String(raw ?? '').trim().toUpperCase();
}

function isFrancoCode(code: string): boolean {
  return code === 'F' || code === 'FF' || code === 'FP';
}

function isOpsCoverageShift(row: TurnoDoc): boolean {
  return (
    row.origin === 'OPERATIONS_COVERAGE' ||
    row.origin === 'RETEN' ||
    row.origin === 'SLA_VIRTUAL' ||
    row.resolvedBy === 'OPERACIONES' ||
    row.isReten === true
  );
}

function planificacionPublishLookupKey(objectiveId: string, year: number, month: number): string {
  return `${String(objectiveId ?? '').trim()}_${year}_${month}`;
}

function isShiftUnassigned(row: TurnoDoc): boolean {
  const empId = String(row.employeeId ?? '').trim();
  return !empId || empId.toUpperCase() === 'VACANTE' || row.isUnassigned === true;
}

function isRealOperativeVacancy(row: TurnoDoc): boolean {
  if (!isShiftUnassigned(row)) return false;
  const origin = String(row.origin ?? '');
  return (
    origin === 'VACANTE_POR_AUSENCIA' ||
    origin === 'VACANTE_CORRECCION' ||
    origin === 'VACANTE_POR_EVENTO' ||
    origin === 'INTERRUPTION' ||
    origin === 'VACANTE_OPERATIVA' ||
    row.vacancyOrigin === 'ABSENCE' ||
    !!row.causedByShiftId ||
    !!row.causedByEmployeeId
  );
}

function isOperationalOriginForOps(row: TurnoDoc, code: string): boolean {
  const origin = String(row.origin ?? '');
  const isClientRefuerzoPlanificado =
    origin === 'CLIENT_REQUEST' && (code === 'RFZ' || code === 'TURA');
  return (
    origin === 'RETEN' ||
    origin === 'OPERATIONS_COVERAGE' ||
    origin === 'SLA_VIRTUAL' ||
    (origin === 'CLIENT_REQUEST' && !isClientRefuerzoPlanificado) ||
    origin === 'EVENTO' ||
    row.isReten === true ||
    row.resolvedBy === 'OPERACIONES'
  );
}

/** Hueco de malla publicada sin guardia: Operaciones no lo muestra como vacante accionable. */
function isPlannedCellWithoutAssignee(row: TurnoDoc, code: string): boolean {
  if (!isShiftUnassigned(row)) return false;
  if (isRealOperativeVacancy(row)) return false;
  if (row.isSinCobertura === true) return false;
  if (code === 'RFZ' || code === 'TURA') return false;
  if (row.status === 'REPORTED_TO_PLANNING' || row.isReported === true) return false;
  return true;
}

function isRetPassiveWithoutCheckin(row: TurnoDoc, code: string): boolean {
  if (code === 'RET') return row.isPresent !== true;
  if (row.origin === 'RETEN' || row.isReten === true) {
    return row.isPresent !== true && row.resolvedBy !== 'OPERACIONES';
  }
  return false;
}

function shiftEligibleForIaAlert(row: TurnoDoc, start: Timestamp, publishedPlanKeys: Set<string>): boolean {
  const code = normalizeCode(row.code);
  if (row.draft === true || row.isVirtual === true || row.isFranco === true || isFrancoCode(code)) {
    return false;
  }
  if (isShiftUnassigned(row)) return false;
  if (row.status === 'COVERED' && row.isAbsent !== true) return false;
  if (isPlannedCellWithoutAssignee(row, code)) return false;
  if (isRetPassiveWithoutCheckin(row, code)) return false;

  if (!isOperationalOriginForOps(row, code)) {
    const ymd = arDateFromTimestamp(start);
    const [y, m] = ymd.split('-').map(Number);
    const objId = String(row.objectiveId ?? '').trim();
    if (!objId || !publishedPlanKeys.has(planificacionPublishLookupKey(objId, y, m))) {
      return false;
    }
    if (isPlannedCellWithoutAssignee(row, code)) return false;
  }
  return true;
}

function parsePlanificacionEstadoDocId(docId: string): { objectiveId: string; year: number; month: number } | null {
  const parts = String(docId ?? '').split('_');
  if (parts.length < 3) return null;
  const month = parseInt(parts[parts.length - 1], 10);
  const year = parseInt(parts[parts.length - 2], 10);
  if (!Number.isFinite(month) || !Number.isFinite(year) || year < 2000) return null;
  if (parts.length === 3) return { objectiveId: parts[0], year, month };
  if (parts.length === 4) return { objectiveId: parts[1], year, month };
  return { objectiveId: parts.slice(1, -2).join('_'), year, month };
}

async function loadPublishedPlanKeys(empresaId: string): Promise<Set<string>> {
  const keys = new Set<string>();
  const db = admin.firestore();
  const snap = await db.collection('planificacion_estados').where('empresaId', '==', empresaId).limit(800).get();
  for (const doc of snap.docs) {
    const data = doc.data();
    if (!data.publishedAt) continue;
    const objId = String(data.objectiveId ?? data.objetivoId ?? '').trim();
    const y = Number(data.year ?? data.año);
    const m = Number(data.month ?? data.mes);
    if (objId && Number.isFinite(y) && Number.isFinite(m) && m >= 1 && m <= 12) {
      keys.add(planificacionPublishLookupKey(objId, y, m));
    }
    const parsed = parsePlanificacionEstadoDocId(doc.id);
    if (parsed) keys.add(planificacionPublishLookupKey(parsed.objectiveId, parsed.year, parsed.month));
  }
  return keys;
}

function sanitizeDocId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 220);
}

function objectiveNameFromSla(sla: SlaDoc | null, objectiveId: string): string {
  const direct = String((sla?.objectiveName as string | undefined) ?? '').trim();
  return direct || objectiveId;
}

function clientIdFromSla(sla: SlaDoc | null): string {
  return String((sla?.clientId as string | undefined) ?? '').trim();
}

function clientNameFromSla(sla: SlaDoc | null): string {
  return String((sla?.clientName as string | undefined) ?? '').trim();
}

function parseHourToUtcComponents(hhmm: string): { h: number; m: number } {
  const [hRaw, mRaw] = hhmm.split(':');
  const h = Number(hRaw);
  const m = Number(mRaw);
  return {
    h: Number.isFinite(h) ? h : 7,
    m: Number.isFinite(m) ? m : 0,
  };
}

function assignmentToTimestamps(row: AssignmentRow): { startTime: Timestamp; endTime: Timestamp } {
  const base = dayStartArUtc(row.dateStr);
  const start = parseHourToUtcComponents(row.startTime || '07:00');
  const startUtc = new Date(base.getTime() + (start.h * 60 + start.m) * 60 * 1000);
  let endUtc: Date;
  if (row.endTime) {
    const end = parseHourToUtcComponents(row.endTime);
    endUtc = new Date(base.getTime() + (end.h * 60 + end.m) * 60 * 1000);
    if (endUtc.getTime() <= startUtc.getTime()) {
      endUtc = new Date(endUtc.getTime() + DAY_MS);
    }
  } else {
    endUtc = new Date(startUtc.getTime() + assignmentHours(row) * 3600000);
  }
  return {
    startTime: Timestamp.fromDate(startUtc),
    endTime: Timestamp.fromDate(endUtc),
  };
}

async function loadSlaForObjective(objectiveId: string): Promise<{ id: string; data: SlaDoc } | null> {
  const db = admin.firestore();
  const snap = await db
    .collection('servicios_sla')
    .where('objectiveId', '==', objectiveId)
    .where('status', '==', 'active')
    .limit(1)
    .get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, data: snap.docs[0].data() as SlaDoc };
}

async function loadEmployeeDocsByIds(empresaId: string, ids: string[]): Promise<Map<string, EmployeeDoc>> {
  const db = admin.firestore();
  const unique = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, EmployeeDoc>();
  const chunkSize = 20;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const docs = await Promise.all(chunk.map((id) => db.collection('empleados').doc(id).get()));
    for (const doc of docs) {
      if (!doc.exists) continue;
      const data = doc.data() as EmployeeDoc;
      const emp = String((data.empresaId as string | undefined) ?? '').trim();
      if (emp && emp !== empresaId) continue;
      map.set(doc.id, data);
    }
  }
  return map;
}

function buildPlanificacionCompleta(assignments: AssignmentRow[]): Record<string, Array<{ fecha: string; codigo: string; puesto: string }>> {
  const out: Record<string, Array<{ fecha: string; codigo: string; puesto: string }>> = {};
  for (const row of assignments) {
    if (!out[row.empId]) out[row.empId] = [];
    out[row.empId].push({
      fecha: row.dateStr,
      codigo: normalizeCode(row.code),
      puesto: row.positionName || 'General',
    });
  }
  return out;
}

async function loadAbsencesByEmployee(
  empresaId: string,
  objectiveId: string,
  year: number,
  month: number,
): Promise<Record<string, string[]>> {
  const db = admin.firestore();
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  const out: Record<string, string[]> = {};
  const snap = await db
    .collection('ausencias')
    .where('objectiveId', '==', objectiveId)
    .where('date', '>=', start)
    .where('date', '<=', end)
    .limit(2200)
    .get();
  for (const doc of snap.docs) {
    const data = doc.data();
    const emp = String(data.employeeId ?? '').trim();
    const date = String(data.date ?? '').trim().slice(0, 10);
    const rowEmp = String(data.empresaId ?? '').trim();
    if (!emp || !date) continue;
    if (rowEmp && rowEmp !== empresaId) continue;
    if (!out[emp]) out[emp] = [];
    out[emp].push(date);
  }
  return out;
}

function buildCoverageFromAssignments(assignments: AssignmentRow[]): Record<string, Record<string, { actual: number; requerido: number; deficit: number; retDisponibles: number }>> {
  const dayPos: Record<string, Record<string, { actual: number; requerido: number; deficit: number; retDisponibles: number }>> = {};
  const requiredByPosition = new Map<string, number>();
  for (const row of assignments) {
    const pos = row.positionName || 'General';
    const key = `${pos}`;
    const expectedForCode = DEFAULT_SHIFT_HOURS[normalizeCode(row.code)] ?? 8;
    const current = requiredByPosition.get(key) ?? 0;
    if (expectedForCode > current) requiredByPosition.set(key, expectedForCode);
  }

  for (const row of assignments) {
    const day = row.dateStr;
    const pos = row.positionName || 'General';
    if (!dayPos[day]) dayPos[day] = {};
    if (!dayPos[day][pos]) {
      dayPos[day][pos] = {
        actual: 0,
        requerido: requiredByPosition.get(pos) ?? 8,
        deficit: 0,
        retDisponibles: 0,
      };
    }
    const code = normalizeCode(row.code);
    if (code === 'RET') {
      dayPos[day][pos].retDisponibles += 1;
      continue;
    }
    if (!NON_BILLABLE_CODES.has(code)) {
      dayPos[day][pos].actual += assignmentHours(row);
    }
  }

  for (const [day, byPos] of Object.entries(dayPos)) {
    for (const [pos, row] of Object.entries(byPos)) {
      const deficit = Math.max(0, row.requerido - row.actual);
      dayPos[day][pos] = { ...row, deficit };
    }
  }
  return dayPos;
}

function applyGeminiCorrections(
  base: AssignmentRow[],
  gemini: GeminiRespuesta,
): { assignments: AssignmentRow[]; applied: number } {
  if (gemini.bloqueoEstructural || !Array.isArray(gemini.correcciones) || gemini.correcciones.length === 0) {
    return { assignments: base, applied: 0 };
  }
  const map = new Map<string, AssignmentRow>();
  for (const row of base) map.set(`${row.empId}_${row.dateStr}`, row);
  let applied = 0;
  for (const corr of gemini.correcciones) {
    const key = `${corr.empId}_${corr.fecha}`;
    const hit = map.get(key);
    if (!hit) continue;
    const code = normalizeCode(corr.codigoNuevo);
    const patched: AssignmentRow = {
      ...hit,
      code,
      name: code,
      positionName: corr.puesto || hit.positionName,
      hours: NON_BILLABLE_CODES.has(code) ? 0 : DEFAULT_SHIFT_HOURS[code] ?? hit.hours,
      isFranco: isFrancoCode(code),
    };
    map.set(key, patched);
    applied += 1;
  }
  return { assignments: [...map.values()], applied };
}

function toNovedadDescription(data: {
  employeeName: string;
  objectiveName: string;
  code: string;
  detail: string;
}): string {
  return `${data.employeeName} · ${data.objectiveName} · ${data.code} — ${data.detail}`;
}

type AlertNameContext = {
  objectives: Map<string, string>;
  employees: Map<string, string>;
  publishedPlanKeys: Set<string>;
};

function etiquetaPareceIdFirestore(text: string, docId = ''): boolean {
  const e = String(text || '').trim();
  if (!e) return true;
  const id = String(docId || '').trim();
  if (id && (e === id || e === id.slice(0, 12))) return true;
  return e.length >= 10 && !/\s/.test(e) && /^[a-zA-Z0-9_-]+$/.test(e);
}

function nombreLegibleEmpleadoRow(row: Record<string, unknown>): string {
  const ln = String(row.lastName ?? '').trim();
  const fn = String(row.firstName ?? '').trim();
  if (ln && fn) return `${ln}, ${fn}`;
  if (ln || fn) return [ln, fn].filter(Boolean).join(' ');
  const nameRaw = String(row.name ?? row.nombre ?? '').trim();
  if (nameRaw) return nameRaw.replace(/\s+/g, ' ').trim();
  return '';
}

async function loadObjectiveNameMap(empresaId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const db = admin.firestore();
  const snap = await db.collection('clients').where('empresaId', '==', empresaId).limit(200).get();
  for (const doc of snap.docs) {
    const objetivos = (doc.data().objetivos ?? []) as Array<Record<string, unknown>>;
    for (const o of objetivos) {
      const id = String(o.id ?? o.objectiveId ?? '').trim();
      const name = String(o.nombre ?? o.name ?? o.objetivoNombre ?? '').trim();
      if (id && name && !etiquetaPareceIdFirestore(name, id)) map.set(id, name);
    }
  }
  return map;
}

async function loadEmployeeNameMap(empresaId: string, employeeIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const db = admin.firestore();
  const uniq = [...new Set(employeeIds.map((id) => String(id || '').trim()).filter(Boolean))];
  if (uniq.length === 0) return map;

  const chunkSize = 100;
  for (let i = 0; i < uniq.length; i += chunkSize) {
    const chunk = uniq.slice(i, i + chunkSize);
    const refs = chunk.map((id) => db.collection('empleados').doc(id));
    const snaps = await db.getAll(...refs);
    for (const s of snaps) {
      if (!s.exists) continue;
      const row = s.data() as Record<string, unknown>;
      const empE = String(row.empresaId ?? '').trim();
      if (empE && empE.toLowerCase() !== empresaId.toLowerCase()) continue;
      const nombre = nombreLegibleEmpleadoRow(row);
      if (nombre) map.set(s.id, nombre);
    }
  }

  try {
    const scoped = await db.collection('empleados').where('empresaId', '==', empresaId).limit(900).get();
    for (const d of scoped.docs) {
      if (map.has(d.id)) continue;
      const nombre = nombreLegibleEmpleadoRow(d.data() as Record<string, unknown>);
      if (nombre) map.set(d.id, nombre);
    }
  } catch {
    // índice ausente en entornos viejos: batch por id alcanza
  }
  return map;
}

function resolveEmployeeDisplayName(row: TurnoDoc, ctx: AlertNameContext, employeeIdHint = ''): string {
  const raw = String(row.employeeName ?? row.empleadoNombre ?? '').trim();
  const empId = String(employeeIdHint || (row.employeeId ?? '')).trim();
  if (raw && !etiquetaPareceIdFirestore(raw, empId)) {
    if (raw.toUpperCase() === 'VACANTE') return 'Vacante';
    return raw;
  }
  if (!empId) return 'Guardia sin nombre';
  if (empId.toUpperCase() === 'VACANTE') return 'Vacante';
  const fromMap = ctx.employees.get(empId);
  if (fromMap) return fromMap;
  return 'Guardia (sin nombre en legajo)';
}

function resolveObjectiveDisplayName(row: TurnoDoc, ctx: AlertNameContext): string {
  const raw = String(row.objectiveName ?? row.objetivoNombre ?? '').trim();
  const objId = String(row.objectiveId ?? '').trim();
  if (raw && !etiquetaPareceIdFirestore(raw, objId)) return raw;
  if (objId) {
    const fromMap = ctx.objectives.get(objId);
    if (fromMap) return fromMap;
  }
  return 'Objetivo sin nombre en CRM';
}

type DetectedAnomaly = {
  fingerprint: string;
  type: string;
  severity: AlertSeverity;
  title: string;
  description: string;
  shiftId: string;
  employeeId: string;
  employeeName: string;
  objectiveId: string;
  objectiveName: string;
};

function turnosTimestamp(row: TurnoDoc, key: 'startTime' | 'endTime' | 'realStartTime' | 'realEndTime'): Timestamp | null {
  const value = row[key];
  return value instanceof Timestamp ? value : null;
}

async function queryShiftsForWindow(
  empresaId: string,
  start: Timestamp,
  end: Timestamp,
  limitCount: number,
): Promise<QueryDocumentSnapshot<TurnoDoc>[]> {
  const db = admin.firestore();
  const base = db.collection('turnos').where('empresaId', '==', empresaId) as Query<TurnoDoc>;
  try {
    const snap = await base
      .where('startTime', '>=', start)
      .where('startTime', '<=', end)
      .limit(limitCount)
      .get();
    return snap.docs;
  } catch {
    const snap = await base.limit(limitCount).get();
    return snap.docs.filter((d) => {
      const st = turnosTimestamp(d.data(), 'startTime');
      if (!st) return false;
      const ms = st.toMillis();
      return ms >= start.toMillis() && ms <= end.toMillis();
    });
  }
}

function buildCoverageKey(row: TurnoDoc): string {
  const objectiveId = String(row.objectiveId ?? '');
  const code = normalizeCode(row.code);
  const start = turnosTimestamp(row, 'startTime');
  const day = start ? arDateFromTimestamp(start) : '';
  return `${objectiveId}__${code}__${day}`;
}

function detectOperationalAnomalies(
  shifts: Array<{ id: string; data: TurnoDoc }>,
  now: Date,
  toleranceMinutes: number,
  nameCtx: AlertNameContext,
): DetectedAnomaly[] {
  const anomalies: DetectedAnomaly[] = [];
  const tolMs = toleranceMinutes * 60 * 1000;
  const coverageKeys = new Set<string>();
  for (const row of shifts) {
    if (isOpsCoverageShift(row.data) && row.data.isAbsent !== true) {
      coverageKeys.add(buildCoverageKey(row.data));
    }
  }

  for (const row of shifts) {
    const code = normalizeCode(row.data.code);
    const start = turnosTimestamp(row.data, 'startTime');
    const end = turnosTimestamp(row.data, 'endTime');
    if (!start || !end) continue;
    if (!shiftEligibleForIaAlert(row.data, start, nameCtx.publishedPlanKeys)) continue;
    const employeeId = String(row.data.employeeId ?? '').trim();
    const objectiveId = String(row.data.objectiveId ?? '').trim();
    const employeeName = resolveEmployeeDisplayName(row.data, nameCtx, employeeId);
    const objectiveName = resolveObjectiveDisplayName(row.data, nameCtx);
    const nowMs = now.getTime();
    const startMs = start.toMillis();
    const endMs = end.toMillis();

    if (nowMs > startMs + tolMs && row.data.isPresent !== true && row.data.isAbsent !== true && row.data.isCompleted !== true) {
      const fp = `late_checkin__${row.id}`;
      anomalies.push({
        fingerprint: fp,
        type: 'IA_ALERTA_MARCACION_TARDIA',
        severity: 'medium',
        title: 'Marcación tardía detectada',
        description: toNovedadDescription({
          employeeName,
          objectiveName,
          code,
          detail: `sin presencia ${toleranceMinutes} min después del inicio`,
        }),
        shiftId: row.id,
        employeeId,
        employeeName,
        objectiveId,
        objectiveName,
      });
    }

    if (nowMs > endMs + tolMs && row.data.isCompleted !== true && row.data.isAbsent !== true) {
      const fp = `expired_open_shift__${row.id}`;
      anomalies.push({
        fingerprint: fp,
        type: 'IA_ALERTA_TURNO_VENCIDO_ABIERTO',
        severity: 'high',
        title: 'Turno vencido sin cierre',
        description: toNovedadDescription({
          employeeName,
          objectiveName,
          code,
          detail: `pasó fin de turno y sigue abierto`,
        }),
        shiftId: row.id,
        employeeId,
        employeeName,
        objectiveId,
        objectiveName,
      });
    }

    const dur = durationHoursFromRange(start, end);
    if (dur > 12.5) {
      const fp = `long_shift__${row.id}`;
      anomalies.push({
        fingerprint: fp,
        type: 'IA_ALERTA_JORNADA_EXCESIVA',
        severity: 'high',
        title: 'Jornada excesiva detectada',
        description: toNovedadDescription({
          employeeName,
          objectiveName,
          code,
          detail: `duración ${dur} hs (revisar asignación)`,
        }),
        shiftId: row.id,
        employeeId,
        employeeName,
        objectiveId,
        objectiveName,
      });
    }

    if (row.data.isAbsent === true) {
      const key = buildCoverageKey(row.data);
      const hasCoverage = coverageKeys.has(key);
      const resolved = row.data.resolvedBy === 'OPERACIONES' || row.data.isReportedToPlanning === true;
      if (!hasCoverage && !resolved) {
        const fp = `absence_uncovered__${row.id}`;
        anomalies.push({
          fingerprint: fp,
          type: 'IA_ALERTA_AUSENCIA_SIN_COBERTURA',
          severity: 'high',
          title: 'Ausencia sin cobertura',
          description: toNovedadDescription({
            employeeName,
            objectiveName,
            code,
            detail: 'ausencia detectada sin cobertura asociada',
          }),
          shiftId: row.id,
          employeeId,
          employeeName,
          objectiveId,
          objectiveName,
        });
      }
    }
  }

  const byEmployee = new Map<string, Array<{ id: string; data: TurnoDoc }>>();
  for (const row of shifts) {
    const start = turnosTimestamp(row.data, 'startTime');
    if (!start) continue;
    if (!shiftEligibleForIaAlert(row.data, start, nameCtx.publishedPlanKeys)) continue;
    const emp = String(row.data.employeeId ?? '').trim();
    if (!emp || emp.toUpperCase() === 'VACANTE') continue;
    if (!byEmployee.has(emp)) byEmployee.set(emp, []);
    byEmployee.get(emp)!.push(row);
  }
  for (const [emp, rows] of byEmployee.entries()) {
    const ordered = rows
      .map((r) => ({
        row: r,
        start: turnosTimestamp(r.data, 'startTime'),
        end: turnosTimestamp(r.data, 'endTime'),
      }))
      .filter((r) => r.start && r.end && shiftEligibleForIaAlert(r.row.data, r.start!, nameCtx.publishedPlanKeys))
      .sort((a, b) => a.start!.toMillis() - b.start!.toMillis());
    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1];
      const cur = ordered[i];
      if (!prev.end || !cur.start) continue;
      if (prev.end.toMillis() > cur.start.toMillis() + 5 * 60 * 1000) {
        const codePrev = normalizeCode(prev.row.data.code);
        const codeCur = normalizeCode(cur.row.data.code);
        const employeeName = resolveEmployeeDisplayName(cur.row.data, nameCtx, emp);
        const objectiveName = resolveObjectiveDisplayName(cur.row.data, nameCtx);
        const fp = `overlap__${prev.row.id}__${cur.row.id}`;
        anomalies.push({
          fingerprint: fp,
          type: 'IA_ALERTA_SOLAPAMIENTO_TURNOS',
          severity: 'high',
          title: 'Solapamiento de turnos',
          description: toNovedadDescription({
            employeeName,
            objectiveName,
            code: codePrev,
            detail:
              codePrev === codeCur
                ? `turnos superpuestos (${codePrev}) para ${employeeName}`
                : `turnos superpuestos (${codePrev} y ${codeCur}) para ${employeeName}`,
          }),
          shiftId: cur.row.id,
          employeeId: emp,
          employeeName,
          objectiveId: String(cur.row.data.objectiveId ?? ''),
          objectiveName,
        });
      }
    }
  }

  const dedup = new Map<string, DetectedAnomaly>();
  for (const an of anomalies) dedup.set(an.fingerprint, an);
  return [...dedup.values()];
}

async function persistOperationalAnomalies(empresaId: string, anomalies: DetectedAnomaly[]): Promise<number> {
  if (anomalies.length === 0) return 0;
  const db = admin.firestore();
  const nowTs = Timestamp.now();
  let created = 0;
  for (const an of anomalies) {
    const safeId = sanitizeDocId(`${empresaId}__${an.fingerprint}`);
    const ledgerRef = db.collection('automation_alerts_ledger').doc(safeId);
    const ledgerSnap = await ledgerRef.get();
    const pendingSnap = await db
      .collection('novedades')
      .where('empresaId', '==', empresaId)
      .where('origin', '==', 'AUTOMATION_P0')
      .where('automationFingerprint', '==', an.fingerprint)
      .where('status', '==', 'pending')
      .limit(1)
      .get();
    if (!pendingSnap.empty) {
      await ledgerRef.set(
        {
          empresaId,
          fingerprint: an.fingerprint,
          lastDetectedAt: nowTs,
          status: 'OPEN',
        },
        { merge: true },
      );
      continue;
    }
    const novedadRef = await db.collection('novedades').add({
      empresaId,
      type: an.type,
      title: an.title,
      description: an.description,
      severity: an.severity,
      status: 'pending',
      origin: 'AUTOMATION_P0',
      automationFingerprint: an.fingerprint,
      shiftId: an.shiftId,
      employeeId: an.employeeId,
      employeeName: an.employeeName,
      objectiveId: an.objectiveId,
      objectiveName: an.objectiveName,
      createdAt: nowTs,
      detectedAt: nowTs,
    });
    created += 1;
    await ledgerRef.set(
      {
        empresaId,
        fingerprint: an.fingerprint,
        type: an.type,
        status: 'OPEN',
        firstDetectedAt: ledgerSnap.exists ? ledgerSnap.data()?.firstDetectedAt ?? nowTs : nowTs,
        lastDetectedAt: nowTs,
        lastNovedadId: novedadRef.id,
      },
      { merge: true },
    );
  }
  return created;
}

async function queryTurnosInMonth(empresaId: string, year: number, month: number): Promise<Array<{ id: string; data: TurnoDoc }>> {
  const db = admin.firestore();
  const start = Timestamp.fromDate(monthStartArUtc(year, month));
  const end = Timestamp.fromDate(monthEndExclusiveArUtc(year, month));
  const rows: Array<{ id: string; data: TurnoDoc }> = [];
  try {
    const snap = await db
      .collection('turnos')
      .where('empresaId', '==', empresaId)
      .where('startTime', '>=', start)
      .where('startTime', '<', end)
      .limit(20000)
      .get();
    snap.docs.forEach((d) => rows.push({ id: d.id, data: d.data() as TurnoDoc }));
    return rows;
  } catch {
    const snap = await db.collection('turnos').where('empresaId', '==', empresaId).limit(20000).get();
    for (const doc of snap.docs) {
      const data = doc.data() as TurnoDoc;
      const st = turnosTimestamp(data, 'startTime');
      if (!st) continue;
      const ms = st.toMillis();
      if (ms >= start.toMillis() && ms < end.toMillis()) {
        rows.push({ id: doc.id, data });
      }
    }
    return rows;
  }
}

async function sumSlaVendidasEmpresaMes(empresaId: string, year: number, month: number): Promise<number> {
  const db = admin.firestore();
  const periodStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const periodEnd = `${year}-${String(month).padStart(2, '0')}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0')}`;
  const docs = await db
    .collection('servicios_sla')
    .where('empresaId', '==', empresaId)
    .where('status', '==', 'active')
    .limit(2500)
    .get();
  let total = 0;
  for (const doc of docs.docs) {
    const data = doc.data();
    const sd = String(data.startDate ?? '').slice(0, 10);
    const ed = String(data.endDate ?? '').slice(0, 10);
    const overlap = (!sd || sd <= periodEnd) && (!ed || ed >= periodStart);
    if (!overlap) continue;
    const hs = Number(data.totalMonthlyHours ?? 0);
    if (Number.isFinite(hs) && hs > 0) total += hs;
  }
  return Math.round(total * 10) / 10;
}

async function loadHoursBalancesEmpresaMes(empresaId: string, year: number, month: number): Promise<Array<Record<string, unknown>>> {
  const db = admin.firestore();
  const snap = await db
    .collection('hours_balances')
    .where('empresaId', '==', empresaId)
    .where('year', '==', year)
    .where('month', '==', month)
    .limit(4000)
    .get();
  return snap.docs.map((d) => d.data() as Record<string, unknown>);
}

function summarizePrefacturaFromBalances(rows: Array<Record<string, unknown>>) {
  const total = {
    source: 'hours_balances' as const,
    rows: rows.length,
    slaHours: 0,
    plannedHours: 0,
    realHours: 0,
    resultante: 0,
    saldoPlan: 0,
    saldoReal: 0,
  };
  for (const row of rows) {
    total.slaHours += Number(row.slaHours ?? 0);
    total.plannedHours += Number(row.plannedHours ?? 0);
    total.realHours += Number(row.realHours ?? 0);
    total.resultante += Number(row.resultante ?? 0);
    total.saldoPlan += Number(row.saldoPlan ?? 0);
    total.saldoReal += Number(row.saldoReal ?? 0);
  }
  total.slaHours = Math.round(total.slaHours * 10) / 10;
  total.plannedHours = Math.round(total.plannedHours * 10) / 10;
  total.realHours = Math.round(total.realHours * 10) / 10;
  total.resultante = Math.round(total.resultante * 10) / 10;
  total.saldoPlan = Math.round(total.saldoPlan * 10) / 10;
  total.saldoReal = Math.round(total.saldoReal * 10) / 10;
  return total;
}

export async function runPlanningAutomationCycle(input: PlanningAutomationInput): Promise<PlanningAutomationResult> {
  const empresaId = String(input.empresaId || '').trim();
  const objectiveId = String(input.objectiveId || '').trim();
  const year = Number(input.year);
  const month = Number(input.month);
  if (!empresaId || !objectiveId || !Number.isFinite(year) || !Number.isFinite(month)) {
    throw new Error('empresaId, objectiveId, year y month son requeridos.');
  }
  const dryRun = input.dryRun === true;
  const applyGemini = input.applyGemini !== false;
  const overwriteAutoDrafts = input.overwriteAutoDrafts !== false;
  const runId = `auto_${empresaId}_${objectiveId}_${monthPeriodKey(year, month)}_${Date.now()}`;
  const notes: string[] = [];

  const autoInput: RunAutoScheduleInput = {
    empresaId,
    objectiveId,
    year,
    month,
  };
  const auto = await runAutoScheduleCore(autoInput);
  let assignments = auto.assignments;
  let geminiApplied = false;
  let geminiCorrectionsApplied = 0;
  let geminiSummary: string | null = null;

  if (applyGemini) {
    try {
      const slaInfo = await loadSlaForObjective(objectiveId);
      const empIds = assignments.map((a) => a.empId);
      const employeeDocs = await loadEmployeeDocsByIds(empresaId, empIds);
      const absences = await loadAbsencesByEmployee(empresaId, objectiveId, year, month);
      const gemini = await runPlanningGeminiOptimize({
        mes: monthPeriodKey(year, month),
        objetivo: objectiveNameFromSla(slaInfo?.data ?? null, objectiveId),
        slaVendidas: Number(slaInfo?.data?.totalMonthlyHours ?? auto.coverage.slaVendidas ?? 0),
        puestos: Array.isArray(slaInfo?.data?.positions) ? slaInfo?.data?.positions : [],
        empleados: [...new Set(empIds)].map((id) => {
          const row = employeeDocs.get(id);
          const firstName = String(row?.firstName ?? '').trim();
          const lastName = String(row?.lastName ?? '').trim();
          const name = [lastName, firstName].filter(Boolean).join(', ') || String(row?.name ?? id);
          return { id, nombre: name };
        }),
        dias: [...new Set(assignments.map((a) => a.dateStr))].sort(),
        diasBloqueados: [],
        planificacionCompleta: buildPlanificacionCompleta(assignments),
        ausencias: absences,
        coberturaPorDia: buildCoverageFromAssignments(assignments),
        autoCycles: ['6+2'],
      });
      const applied = applyGeminiCorrections(assignments, gemini);
      assignments = applied.assignments;
      geminiApplied = !gemini.bloqueoEstructural;
      geminiCorrectionsApplied = applied.applied;
      geminiSummary = gemini.resumen || null;
      if (gemini.bloqueoEstructural) {
        notes.push(`Gemini reportó bloqueo estructural: ${gemini.razonBloqueo || 'sin detalle'}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      notes.push(`No se aplicó ajuste Gemini: ${msg.slice(0, 180)}`);
    }
  } else {
    notes.push('Ajuste Gemini omitido por configuración.');
  }

  if (dryRun) {
    return {
      ok: auto.ok,
      runId,
      objectiveId,
      year,
      month,
      assignmentsGenerated: auto.assignments.length,
      assignmentsPersisted: 0,
      coverageRatio: auto.coverage.coverageRatio,
      uncoveredSlots: auto.coverage.uncoveredSlots,
      slaHoursClosed: auto.coverage.slaHoursClosed,
      geminiApplied,
      geminiCorrectionsApplied,
      geminiSummary,
      dryRun: true,
      notes,
    };
  }

  const db = admin.firestore();
  const start = Timestamp.fromDate(monthStartArUtc(year, month));
  const end = Timestamp.fromDate(monthEndExclusiveArUtc(year, month));
  const slaInfo = await loadSlaForObjective(objectiveId);
  const empIds = assignments.map((a) => a.empId);
  const employeeDocs = await loadEmployeeDocsByIds(empresaId, empIds);

  if (overwriteAutoDrafts) {
    const oldSnap = await db
      .collection('turnos')
      .where('empresaId', '==', empresaId)
      .where('objectiveId', '==', objectiveId)
      .where('draft', '==', true)
      .where('automationSource', '==', 'AUTO_PLANNING_P0')
      .where('startTime', '>=', start)
      .where('startTime', '<', end)
      .limit(5000)
      .get();
    if (!oldSnap.empty) {
      const deletions = oldSnap.docs.map((doc) => doc.ref.delete());
      await Promise.all(deletions);
      notes.push(`Se reemplazaron ${oldSnap.size} turnos auto-generados previos del mismo mes.`);
    }
  }

  const now = Timestamp.now();
  const BATCH_SIZE = 350;
  let batch = db.batch();
  let ops = 0;
  let persisted = 0;
  const commits: Array<Promise<FirebaseFirestore.WriteResult[]>> = [];

  for (const row of assignments) {
    const refs = assignmentToTimestamps(row);
    const code = normalizeCode(row.code);
    const emp = employeeDocs.get(row.empId);
    const firstName = String(emp?.firstName ?? '').trim();
    const lastName = String(emp?.lastName ?? '').trim();
    const employeeName = [lastName, firstName].filter(Boolean).join(', ') || String(emp?.name ?? row.empId);
    const ref = db.collection('turnos').doc();
    batch.set(ref, {
      empresaId,
      objectiveId,
      objectiveName: objectiveNameFromSla(slaInfo?.data ?? null, objectiveId),
      objetivoNombre: objectiveNameFromSla(slaInfo?.data ?? null, objectiveId),
      clientId: clientIdFromSla(slaInfo?.data ?? null),
      clientName: clientNameFromSla(slaInfo?.data ?? null),
      employeeId: row.empId,
      employeeName,
      empleadoNombre: employeeName,
      positionName: row.positionName || 'General',
      code,
      name: code,
      hours: NON_BILLABLE_CODES.has(code) ? 0 : assignmentHours(row),
      startTime: refs.startTime,
      endTime: refs.endTime,
      draft: true,
      isFranco: isFrancoCode(code),
      isReten: code === 'RET',
      isPresent: false,
      isAbsent: false,
      isCompleted: false,
      status: 'planned',
      origin: 'AUTO_PLANNING',
      automationSource: 'AUTO_PLANNING_P0',
      automationRunId: runId,
      automationGeneratedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    persisted += 1;
    ops += 1;
    if (ops >= BATCH_SIZE) {
      commits.push(batch.commit());
      batch = db.batch();
      ops = 0;
    }
  }
  if (ops > 0) commits.push(batch.commit());
  if (commits.length > 0) await Promise.all(commits);

  await db.collection('automation_runs').doc(runId).set({
    runId,
    type: 'PLANNING_AUTOMATION_P0',
    empresaId,
    objectiveId,
    year,
    month,
    applyGemini,
    geminiApplied,
    geminiCorrectionsApplied,
    assignmentsGenerated: auto.assignments.length,
    assignmentsPersisted: persisted,
    coverageRatio: auto.coverage.coverageRatio,
    uncoveredSlots: auto.coverage.uncoveredSlots,
    slaHoursClosed: auto.coverage.slaHoursClosed,
    notes,
    createdAt: now,
  });

  return {
    ok: auto.ok,
    runId,
    objectiveId,
    year,
    month,
    assignmentsGenerated: auto.assignments.length,
    assignmentsPersisted: persisted,
    coverageRatio: auto.coverage.coverageRatio,
    uncoveredSlots: auto.coverage.uncoveredSlots,
    slaHoursClosed: auto.coverage.slaHoursClosed,
    geminiApplied,
    geminiCorrectionsApplied,
    geminiSummary,
    dryRun: false,
    notes,
  };
}

export async function scanOperationalAlertsForEmpresa(
  input: OperationalAlertScanInput,
): Promise<OperationalAlertScanResult> {
  const empresaId = String(input.empresaId || '').trim();
  if (!empresaId) throw new Error('empresaId requerido.');
  const lookbackHours = Math.max(2, Math.min(72, Number(input.lookbackHours ?? 24)));
  const lookaheadHours = Math.max(0, Math.min(24, Number(input.lookaheadHours ?? 8)));
  const toleranceMinutes = Math.max(5, Math.min(180, Number(input.toleranceMinutes ?? 25)));
  const now = new Date();
  const start = Timestamp.fromDate(new Date(now.getTime() - lookbackHours * 3600000));
  const end = Timestamp.fromDate(new Date(now.getTime() + lookaheadHours * 3600000));
  const docs = await queryShiftsForWindow(empresaId, start, end, 2500);
  const shifts = docs.map((d) => ({ id: d.id, data: d.data() as TurnoDoc }));
  const employeeIds = shifts.map((s) => String(s.data.employeeId ?? '').trim()).filter(Boolean);
  const [objectives, employees, publishedPlanKeys] = await Promise.all([
    loadObjectiveNameMap(empresaId),
    loadEmployeeNameMap(empresaId, employeeIds),
    loadPublishedPlanKeys(empresaId),
  ]);
  const nameCtx: AlertNameContext = { objectives, employees, publishedPlanKeys };
  const anomalies = detectOperationalAnomalies(shifts, now, toleranceMinutes, nameCtx);
  const created = await persistOperationalAnomalies(empresaId, anomalies);
  const byType: Record<string, number> = {};
  for (const an of anomalies) byType[an.type] = (byType[an.type] ?? 0) + 1;
  return {
    ok: true,
    empresaId,
    evaluatedShifts: shifts.length,
    anomaliesDetected: anomalies.length,
    alertsCreated: created,
    byType,
    generatedAt: nowIso(),
  };
}

export async function buildOperationalClosureChecklist(
  input: ClosureChecklistInput,
): Promise<ClosureChecklistResult> {
  const empresaId = String(input.empresaId || '').trim();
  const year = Number(input.year);
  const month = Number(input.month);
  if (!empresaId || !Number.isFinite(year) || !Number.isFinite(month)) {
    throw new Error('empresaId, year y month son requeridos.');
  }
  if (month < 1 || month > 12) throw new Error('month fuera de rango (1-12).');
  const turnos = await queryTurnosInMonth(empresaId, year, month);
  const now = Date.now();
  const nowMinusTolerance = now - 30 * 60 * 1000;
  let total = 0;
  let marcacionesPendientes = 0;
  let turnosAbiertosFueraHorario = 0;
  let ausencias = 0;
  let ausenciasSinResolver = 0;
  let inconsistenciasEstado = 0;
  let horasPlanificadasCobertura = 0;
  let horasEjecutadasFichadas = 0;

  for (const row of turnos) {
    const data = row.data;
    if (data.draft === true || data.isVirtual === true) continue;
    const st = turnosTimestamp(data, 'startTime');
    const et = turnosTimestamp(data, 'endTime');
    if (!st || !et) continue;
    const code = normalizeCode(data.code);
    total += 1;
    const isAbsent = data.isAbsent === true;
    const isPresent = data.isPresent === true;
    const isCompleted = data.isCompleted === true;
    const isFranco = data.isFranco === true || isFrancoCode(code);
    if (isAbsent) {
      ausencias += 1;
      const resolved = data.resolvedBy === 'OPERACIONES' || data.isReportedToPlanning === true;
      if (!resolved) ausenciasSinResolver += 1;
    }
    if (isPresent && isAbsent) inconsistenciasEstado += 1;
    if (isCompleted && isAbsent) inconsistenciasEstado += 1;

    if (!isFranco && !isAbsent && !isCompleted && st.toMillis() < nowMinusTolerance && !isPresent) {
      marcacionesPendientes += 1;
    }
    if (!isAbsent && !isCompleted && et.toMillis() < nowMinusTolerance) {
      turnosAbiertosFueraHorario += 1;
    }

    const planned = Number(data.hours ?? 0) > 0 ? Number(data.hours) : durationHoursFromRange(st, et);
    if (!NON_BILLABLE_CODES.has(code) && planned > 0) {
      horasPlanificadasCobertura += planned;
    }

    const realStart = turnosTimestamp(data, 'realStartTime');
    const realEnd = turnosTimestamp(data, 'realEndTime');
    if (realStart && realEnd) {
      horasEjecutadasFichadas += durationHoursFromRange(realStart, realEnd);
    } else if (isCompleted && isPresent && !NON_BILLABLE_CODES.has(code)) {
      horasEjecutadasFichadas += planned;
    }
  }

  horasPlanificadasCobertura = Math.round(horasPlanificadasCobertura * 10) / 10;
  horasEjecutadasFichadas = Math.round(horasEjecutadasFichadas * 10) / 10;

  const slaVendidas = await sumSlaVendidasEmpresaMes(empresaId, year, month);
  const balances = await loadHoursBalancesEmpresaMes(empresaId, year, month);
  const prefactura = balances.length
    ? summarizePrefacturaFromBalances(balances)
    : {
        source: 'fallback_turnos' as const,
        rows: 0,
        slaHours: slaVendidas,
        plannedHours: horasPlanificadasCobertura,
        realHours: horasEjecutadasFichadas,
        resultante: horasPlanificadasCobertura,
        saldoPlan: Math.round((slaVendidas - horasPlanificadasCobertura) * 10) / 10,
        saldoReal: Math.round((slaVendidas - horasEjecutadasFichadas) * 10) / 10,
      };

  const gapSlaVsPlan = Math.round((slaVendidas - horasPlanificadasCobertura) * 10) / 10;
  const gapPlanVsEjecutado = Math.round((horasPlanificadasCobertura - horasEjecutadasFichadas) * 10) / 10;
  const marcacionesOk = marcacionesPendientes === 0;
  const cierresOk = turnosAbiertosFueraHorario === 0;
  const ausenciasOk = ausenciasSinResolver === 0;
  const coberturaOk = gapSlaVsPlan <= Math.max(8, slaVendidas * 0.03);
  const listoParaCierre = marcacionesOk && cierresOk && ausenciasOk;

  const recomendaciones: string[] = [];
  if (!marcacionesOk) {
    recomendaciones.push(`Resolver ${marcacionesPendientes} turno(s) sin marcación para evitar distorsión en horas reales.`);
  }
  if (!cierresOk) {
    recomendaciones.push(`Cerrar ${turnosAbiertosFueraHorario} turno(s) vencidos antes de consolidar liquidación.`);
  }
  if (!ausenciasOk) {
    recomendaciones.push(`Atender ${ausenciasSinResolver} ausencia(s) sin resolución de cobertura.`);
  }
  if (!coberturaOk) {
    recomendaciones.push(`Gap SLA vs plan de ${gapSlaVsPlan} hs. Revisar objetivos con menor cobertura antes del cierre.`);
  }
  if (gapPlanVsEjecutado > Math.max(10, horasPlanificadasCobertura * 0.05)) {
    recomendaciones.push(`Desvío plan vs ejecutado de ${gapPlanVsEjecutado} hs. Verificar marcaciones tardías y cierres pendientes.`);
  }
  if (recomendaciones.length === 0) {
    recomendaciones.push('Checklist operativo en verde. Condiciones mínimas cumplidas para cierre asistido.');
  }

  const result: ClosureChecklistResult = {
    ok: true,
    empresaId,
    period: monthPeriodKey(year, month),
    generatedAt: nowIso(),
    totals: {
      turnos: total,
      marcacionesPendientes,
      turnosAbiertosFueraHorario,
      ausencias,
      ausenciasSinResolver,
      inconsistenciasEstado,
    },
    horas: {
      slaVendidas,
      planificadasCobertura: horasPlanificadasCobertura,
      ejecutadasFichadas: horasEjecutadasFichadas,
      gapSlaVsPlan,
      gapPlanVsEjecutado,
    },
    prefactura,
    checks: {
      marcacionesOk,
      cierresOk,
      ausenciasOk,
      coberturaOk,
      listoParaCierre,
    },
    recomendaciones,
  };

  if (input.persistSnapshot !== false) {
    const db = admin.firestore();
    await db
      .collection('operational_closure_checklists')
      .doc(`${empresaId}_${monthPeriodKey(year, month)}`)
      .set(
        {
          ...result,
          updatedAt: Timestamp.now(),
        },
        { merge: true },
      );
  }

  return result;
}
