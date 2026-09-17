import * as admin from 'firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  CASCADE_ORDER,
  checkEligibility,
  getUrgency,
  RET_RADIUS_KM_EXPANDED,
  RET_RADIUS_KM_PRIMARY,
  type CascadeStepType,
} from '../coverage/eligibilityFilter';

type TurnoRow = Record<string, unknown> & { id: string };
type EmpRow = Record<string, unknown> & { id: string };

export type CoverageRecommendInput = {
  empresaId: string;
  shiftId?: string;
  objectiveId?: string;
  fecha?: string;
  banda?: string;
  limite?: number;
};

export type CoverageCandidateScore = {
  employeeId: string;
  employeeName: string;
  cascadeStep: CascadeStepType;
  cascadeRank: number;
  score: number;
  costScore: number;
  riskScore: number;
  knowledgeScore: number;
  distanceKm: number | null;
  reason: string;
  sourceShiftId?: string;
  sourceCode?: string;
};

export type CoverageRecommendResult = {
  ok: boolean;
  empresaId: string;
  shiftId: string | null;
  objectiveId: string;
  objectiveName: string;
  fecha: string;
  banda: string;
  urgency: 'URGENTE' | 'INTERMEDIO' | 'NORMAL';
  candidates: CoverageCandidateScore[];
  generatedAt: string;
  notes: string[];
};

export type DailyReplanInput = {
  empresaId: string;
  windowDays?: number;
  objectiveId?: string;
  dryRun?: boolean;
  autoApplyRet?: boolean;
  maxVacancies?: number;
};

export type DailyReplanVacancy = {
  shiftId: string;
  objectiveId: string;
  objectiveName: string;
  employeeId: string;
  employeeName: string;
  code: string;
  date: string;
  startMs: number;
  recommended?: CoverageCandidateScore | null;
  action: 'recommend_only' | 'draft_created' | 'skipped';
  detail: string;
};

export type DailyReplanResult = {
  ok: boolean;
  runId: string;
  empresaId: string;
  windowDays: number;
  vacanciesFound: number;
  recommendations: number;
  draftsCreated: number;
  dryRun: boolean;
  items: DailyReplanVacancy[];
  generatedAt: string;
};

const WORK_CODES = new Set(['M', 'T', 'N', 'D12', 'N12', 'M1', 'T1', 'N1', 'REF', 'ESC', 'EN', 'RO']);
const FRANCO_CODES = new Set(['F', 'FF', 'FP', 'FT']);
const COST_BY_STEP: Record<CascadeStepType, number> = {
  SIN_TURNO: 10,
  RET: 20,
  ESC: 30,
  CROSS_POS: 40,
  EXT_DUAL: 55,
  INTERCAMBIO: 60,
  CROSS_OBJ: 70,
  FT: 90,
};

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeCode(raw: unknown): string {
  return String(raw ?? '').trim().toUpperCase();
}

function dayStartArUtc(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 3, 0, 0, 0));
}

function dayEndArUtc(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1, 3, 0, 0, 0));
}

function arYmdFromTs(ts: Timestamp): string {
  const ms = ts.toMillis() - 3 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

function todayArYmd(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Cordoba',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function empDisplayName(emp: EmpRow): string {
  const ln = String(emp.lastName ?? '').trim();
  const fn = String(emp.firstName ?? '').trim();
  const joined = [ln, fn].filter(Boolean).join(', ');
  if (joined) return joined;
  return String(emp.name ?? emp.fullName ?? emp.id);
}

function empCoords(emp: EmpRow): { lat: number; lng: number } | null {
  const lat = Number(emp.lat ?? (emp.location as any)?.lat);
  const lng = Number(emp.lng ?? (emp.location as any)?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function knowledgeScore(emp: EmpRow, objectiveId: string): number {
  if (String(emp.preferredObjectiveId ?? '') === objectiveId) return 3;
  if ((emp.experienciaObjetivos as any)?.[objectiveId]) return 2;
  if (Array.isArray(emp.volante) && emp.volante.includes(objectiveId)) return 1;
  return 0;
}

async function resolveObjectiveCoords(
  db: admin.firestore.Firestore,
  objectiveId: string,
  clientId?: string,
): Promise<{ lat: number; lng: number } | null> {
  const tryObj = (o: any): { lat: number; lng: number } | null => {
    const lat = Number(o?.lat ?? o?.location?.lat ?? o?.geo?.lat);
    const lng = Number(o?.lng ?? o?.location?.lng ?? o?.geo?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  };
  if (clientId) {
    const snap = await db.collection('clients').doc(clientId).get();
    if (snap.exists) {
      const objs = Array.isArray(snap.data()?.objetivos) ? snap.data()!.objetivos : [];
      const hit = objs.find((o: any) => String(o.id || o.objectiveId || '') === objectiveId);
      const c = tryObj(hit);
      if (c) return c;
    }
  }
  const clients = await db.collection('clients').where('empresaId', '==', arguments[0] ? '' : '').limit(1).get();
  void clients;
  const all = await db.collection('clients').limit(120).get();
  for (const cdoc of all.docs) {
    const objs = Array.isArray(cdoc.data()?.objetivos) ? cdoc.data().objetivos : [];
    const hit = objs.find((o: any) => String(o.id || o.objectiveId || '') === objectiveId);
    const c = tryObj(hit);
    if (c) return c;
  }
  return null;
}

function isOperationalCoverage(row: TurnoRow): boolean {
  return (
    row.origin === 'OPERATIONS_COVERAGE' ||
    row.origin === 'RETEN' ||
    row.resolvedBy === 'OPERACIONES' ||
    row.isReten === true
  );
}

function coverageKey(objectiveId: string, code: string, date: string): string {
  return `${objectiveId}__${code}__${date}`;
}

async function loadShiftById(empresaId: string, shiftId: string): Promise<TurnoRow | null> {
  const snap = await admin.firestore().collection('turnos').doc(shiftId).get();
  if (!snap.exists) return null;
  const data = snap.data() as TurnoRow;
  const emp = String(data.empresaId ?? '').trim();
  if (emp && emp !== empresaId) return null;
  return { ...data, id: snap.id };
}

async function loadEmployees(empresaId: string): Promise<EmpRow[]> {
  const snap = await admin.firestore().collection('empleados').where('empresaId', '==', empresaId).limit(900).get();
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as EmpRow)
    .filter((e) => {
      const st = String(e.status ?? e.estado ?? 'ACTIVE').toUpperCase();
      return st !== 'INACTIVE' && st !== 'INACTIVO';
    });
}

async function loadDayShifts(
  empresaId: string,
  fecha: string,
  objectiveId?: string,
): Promise<TurnoRow[]> {
  const db = admin.firestore();
  const start = Timestamp.fromDate(dayStartArUtc(fecha));
  const end = Timestamp.fromDate(dayEndArUtc(fecha));
  let q: FirebaseFirestore.Query = db
    .collection('turnos')
    .where('empresaId', '==', empresaId)
    .where('startTime', '>=', start)
    .where('startTime', '<', end)
    .limit(1800);
  if (objectiveId) q = q.where('objectiveId', '==', objectiveId);
  try {
    const snap = await q.get();
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as TurnoRow);
  } catch {
    const snap = await db.collection('turnos').where('empresaId', '==', empresaId).limit(3000).get();
    return snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as TurnoRow)
      .filter((t) => {
        const st = t.startTime instanceof Timestamp ? t.startTime : null;
        if (!st) return false;
        const ms = st.toMillis();
        if (ms < start.toMillis() || ms >= end.toMillis()) return false;
        if (objectiveId && String(t.objectiveId ?? '') !== objectiveId) return false;
        return true;
      });
  }
}

function buildCandidate(
  emp: EmpRow,
  step: CascadeStepType,
  opts: {
    objectiveId: string;
    distanceKm: number | null;
    sourceShiftId?: string;
    sourceCode?: string;
    monthlyHours?: number;
  },
): CoverageCandidateScore | null {
  const eligibility = checkEligibility(
    emp,
    { objectiveId: opts.objectiveId },
    step === 'EXT_DUAL' ? 'EXTEND' : (step as any),
    opts.distanceKm ?? undefined,
    step === 'RET' ? RET_RADIUS_KM_EXPANDED : RET_RADIUS_KM_PRIMARY,
  );
  if (!eligibility.eligible) return null;

  const know = knowledgeScore(emp, opts.objectiveId);
  const costScore = COST_BY_STEP[step];
  const hours = Number(opts.monthlyHours ?? 0);
  const riskHours = hours > 180 ? Math.min(40, hours - 180) : 0;
  const riskDistance =
    opts.distanceKm != null && Number.isFinite(opts.distanceKm)
      ? Math.max(0, opts.distanceKm - RET_RADIUS_KM_PRIMARY) * 1.5
      : 8;
  const riskScore = Math.round(riskHours + riskDistance + (step === 'FT' ? 15 : 0));
  const score = Math.round(1000 - costScore * 8 - riskScore * 2 + know * 18);
  return {
    employeeId: emp.id,
    employeeName: empDisplayName(emp),
    cascadeStep: step,
    cascadeRank: CASCADE_ORDER.indexOf(step),
    score,
    costScore,
    riskScore,
    knowledgeScore: know,
    distanceKm: opts.distanceKm,
    reason: `${step} · costo ${costScore} · riesgo ${riskScore} · conocimiento ${know}`,
    sourceShiftId: opts.sourceShiftId,
    sourceCode: opts.sourceCode,
  };
}

export async function recommendCoverageCandidates(
  input: CoverageRecommendInput,
): Promise<CoverageRecommendResult> {
  const empresaId = String(input.empresaId || '').trim();
  if (!empresaId) throw new Error('empresaId requerido.');

  let shift: TurnoRow | null = null;
  if (input.shiftId) {
    shift = await loadShiftById(empresaId, String(input.shiftId));
    if (!shift) throw new Error(`Turno ${input.shiftId} no encontrado.`);
  }

  const objectiveId = String(input.objectiveId || shift?.objectiveId || '').trim();
  if (!objectiveId) throw new Error('objectiveId o shiftId requerido.');

  const startTs = shift?.startTime instanceof Timestamp ? shift.startTime : null;
  const fecha = String(input.fecha || (startTs ? arYmdFromTs(startTs) : todayArYmd())).slice(0, 10);
  const banda = normalizeCode(input.banda || shift?.code || 'M') || 'M';
  const objectiveName = String(shift?.objectiveName || shift?.objetivoNombre || objectiveId);
  const clientId = String(shift?.clientId || '').trim();
  const urgency = startTs ? getUrgency(startTs) : 'NORMAL';
  const limite = Math.max(3, Math.min(40, Number(input.limite ?? 12)));

  const [emps, dayShifts, objCoords] = await Promise.all([
    loadEmployees(empresaId),
    loadDayShifts(empresaId, fecha, undefined),
    resolveObjectiveCoords(admin.firestore(), objectiveId, clientId || undefined),
  ]);

  const byEmp = new Map<string, TurnoRow[]>();
  for (const t of dayShifts) {
    const empId = String(t.employeeId || '').trim();
    if (!empId) continue;
    if (!byEmp.has(empId)) byEmp.set(empId, []);
    byEmp.get(empId)!.push(t);
  }

  const coveredKeys = new Set<string>();
  for (const t of dayShifts) {
    if (isOperationalCoverage(t) && t.isAbsent !== true) {
      const st = t.startTime instanceof Timestamp ? t.startTime : null;
      if (!st) continue;
      coveredKeys.add(coverageKey(String(t.objectiveId || ''), normalizeCode(t.code), arYmdFromTs(st)));
    }
  }

  const candidates: CoverageCandidateScore[] = [];
  const notes: string[] = [];

  for (const emp of emps) {
    const shifts = byEmp.get(emp.id) || [];
    const coords = empCoords(emp);
    const distanceKm =
      objCoords && coords ? haversineKm(objCoords.lat, objCoords.lng, coords.lat, coords.lng) : null;
    const monthlyHours = Number(emp.hoursMonth || emp.horasMes || 0);

    if (shifts.length === 0) {
      const c = buildCandidate(emp, 'SIN_TURNO', { objectiveId, distanceKm, monthlyHours });
      if (c) candidates.push(c);
      continue;
    }

    for (const sh of shifts) {
      if (sh.draft === true || sh.isAbsent === true || sh.isCompleted === true) continue;
      const code = normalizeCode(sh.code);
      if (code === 'RET') {
        const c = buildCandidate(emp, 'RET', {
          objectiveId,
          distanceKm,
          monthlyHours,
          sourceShiftId: sh.id,
          sourceCode: code,
        });
        if (c) candidates.push(c);
      } else if (code === 'ESC' || code === 'REF') {
        if (String(sh.objectiveId || '') === objectiveId) {
          const c = buildCandidate(emp, 'ESC', {
            objectiveId,
            distanceKm,
            monthlyHours,
            sourceShiftId: sh.id,
            sourceCode: code,
          });
          if (c) candidates.push(c);
        }
      } else if (FRANCO_CODES.has(code)) {
        const c = buildCandidate(emp, 'FT', {
          objectiveId,
          distanceKm,
          monthlyHours,
          sourceShiftId: sh.id,
          sourceCode: code,
        });
        if (c) candidates.push(c);
      } else if (WORK_CODES.has(code) && ['M', 'T', 'N'].includes(code)) {
        const c = buildCandidate(emp, 'EXT_DUAL', {
          objectiveId,
          distanceKm,
          monthlyHours,
          sourceShiftId: sh.id,
          sourceCode: code,
        });
        if (c) candidates.push(c);
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.cascadeRank - b.cascadeRank || a.costScore - b.costScore);
  const top = candidates.slice(0, limite);
  if (!top.length) notes.push('Sin candidatos elegibles según cascada CCT y restricciones.');
  if (coveredKeys.has(coverageKey(objectiveId, banda, fecha))) {
    notes.push('Ya existe cobertura operativa para ese slot (se recomienda igual para backup).');
  }

  return {
    ok: true,
    empresaId,
    shiftId: shift?.id || null,
    objectiveId,
    objectiveName,
    fecha,
    banda,
    urgency,
    candidates: top,
    generatedAt: nowIso(),
    notes,
  };
}

async function findWindowVacancies(
  empresaId: string,
  fromYmd: string,
  toYmd: string,
  objectiveId?: string,
): Promise<TurnoRow[]> {
  const db = admin.firestore();
  const start = Timestamp.fromDate(dayStartArUtc(fromYmd));
  const end = Timestamp.fromDate(dayEndArUtc(toYmd));
  let snap: FirebaseFirestore.QuerySnapshot;
  try {
    let q: FirebaseFirestore.Query = db
      .collection('turnos')
      .where('empresaId', '==', empresaId)
      .where('startTime', '>=', start)
      .where('startTime', '<', end)
      .limit(4000);
    if (objectiveId) q = q.where('objectiveId', '==', objectiveId);
    snap = await q.get();
  } catch {
    snap = await db.collection('turnos').where('empresaId', '==', empresaId).limit(5000).get();
  }

  const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as TurnoRow);
  const coverage = new Set<string>();
  for (const t of rows) {
    if (!isOperationalCoverage(t) || t.isAbsent === true) continue;
    const st = t.startTime instanceof Timestamp ? t.startTime : null;
    if (!st) continue;
    coverage.add(coverageKey(String(t.objectiveId || ''), normalizeCode(t.code), arYmdFromTs(st)));
  }

  const out: TurnoRow[] = [];
  for (const t of rows) {
    if (t.draft === true || t.isVirtual === true || t.isFranco === true) continue;
    const st = t.startTime instanceof Timestamp ? t.startTime : null;
    if (!st) continue;
    const ms = st.toMillis();
    if (ms < start.toMillis() || ms >= end.toMillis()) continue;
    if (objectiveId && String(t.objectiveId || '') !== objectiveId) continue;
    const code = normalizeCode(t.code);
    if (!WORK_CODES.has(code)) continue;
    const date = arYmdFromTs(st);
    const oid = String(t.objectiveId || '');
    const uncoveredAbsence = t.isAbsent === true && !coverage.has(coverageKey(oid, code, date));
    const vacantSlot =
      (!t.employeeId || t.employeeId === 'VACANTE' || t.isUnassigned === true) &&
      !coverage.has(coverageKey(oid, code, date));
    const unresolved =
      t.isAbsent === true &&
      t.resolvedBy !== 'OPERACIONES' &&
      t.isReportedToPlanning !== true &&
      !coverage.has(coverageKey(oid, code, date));
    if (uncoveredAbsence || vacantSlot || unresolved) out.push(t);
  }
  return out;
}

export async function runDailyReplanWindow(input: DailyReplanInput): Promise<DailyReplanResult> {
  const empresaId = String(input.empresaId || '').trim();
  if (!empresaId) throw new Error('empresaId requerido.');
  const windowDays = Math.max(1, Math.min(14, Number(input.windowDays ?? 3)));
  const dryRun = input.dryRun !== false;
  const autoApplyRet = input.autoApplyRet === true;
  const maxVacancies = Math.max(1, Math.min(80, Number(input.maxVacancies ?? 40)));
  const objectiveId = String(input.objectiveId || '').trim() || undefined;

  const from = todayArYmd();
  const to = addDaysYmd(from, windowDays - 1);
  const runId = `replan_${empresaId}_${from}_${to}_${Date.now()}`;
  const vacancies = await findWindowVacancies(empresaId, from, to, objectiveId);
  const selected = vacancies.slice(0, maxVacancies);

  const items: DailyReplanVacancy[] = [];
  let recommendations = 0;
  let draftsCreated = 0;
  const db = admin.firestore();

  for (const vac of selected) {
    const st = vac.startTime instanceof Timestamp ? vac.startTime : null;
    const et = vac.endTime instanceof Timestamp ? vac.endTime : null;
    const date = st ? arYmdFromTs(st) : from;
    const code = normalizeCode(vac.code) || 'M';
    const oid = String(vac.objectiveId || '');
    const oname = String(vac.objectiveName || vac.objetivoNombre || oid);
    const empId = String(vac.employeeId || '');
    const empName = String(vac.employeeName || vac.empleadoNombre || empId || 'Vacante');

    let recommended: CoverageCandidateScore | null = null;
    try {
      const rec = await recommendCoverageCandidates({
        empresaId,
        shiftId: vac.id,
        objectiveId: oid,
        fecha: date,
        banda: code,
        limite: 5,
      });
      recommended = rec.candidates[0] || null;
      if (recommended) recommendations += 1;
    } catch {
      recommended = null;
    }

    let action: DailyReplanVacancy['action'] = 'recommend_only';
    let detail = recommended
      ? `Mejor opción: ${recommended.employeeName} (${recommended.cascadeStep}, score ${recommended.score})`
      : 'Sin candidato recomendado';

    if (
      !dryRun &&
      autoApplyRet &&
      recommended &&
      recommended.cascadeStep === 'RET' &&
      st &&
      et
    ) {
      await db.collection('turnos').add({
        empresaId,
        objectiveId: oid,
        objectiveName: oname,
        objetivoNombre: oname,
        clientId: String(vac.clientId || ''),
        employeeId: recommended.employeeId,
        employeeName: recommended.employeeName,
        empleadoNombre: recommended.employeeName,
        code,
        name: code,
        startTime: st,
        endTime: et,
        draft: true,
        origin: 'OPERATIONS_COVERAGE',
        resolvedBy: 'OPERACIONES',
        isPresent: false,
        isAbsent: false,
        isCompleted: false,
        automationSource: 'DAILY_REPLAN_P1',
        automationRunId: runId,
        coversShiftId: vac.id,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      draftsCreated += 1;
      action = 'draft_created';
      detail = `Borrador RET creado: ${recommended.employeeName}`;
    } else if (!recommended) {
      action = 'skipped';
    }

    items.push({
      shiftId: vac.id,
      objectiveId: oid,
      objectiveName: oname,
      employeeId: empId,
      employeeName: empName,
      code,
      date,
      startMs: st?.toMillis() || 0,
      recommended,
      action,
      detail,
    });
  }

  await db.collection('automation_runs').doc(runId).set({
    runId,
    type: 'DAILY_REPLAN_P1',
    empresaId,
    objectiveId: objectiveId || null,
    windowDays,
    from,
    to,
    dryRun,
    autoApplyRet,
    vacanciesFound: vacancies.length,
    recommendations,
    draftsCreated,
    items: items.slice(0, 60),
    createdAt: FieldValue.serverTimestamp(),
  });

  return {
    ok: true,
    runId,
    empresaId,
    windowDays,
    vacanciesFound: vacancies.length,
    recommendations,
    draftsCreated,
    dryRun,
    items,
    generatedAt: nowIso(),
  };
}
