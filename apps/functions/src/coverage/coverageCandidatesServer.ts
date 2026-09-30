import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { arDayBoundsMs } from '../common/arClock';
import { SHIFT_HARD_CAP_MS } from '../scheduling/shiftClose';
import {
  acceptanceStillValid,
  buildCoverageCandidates,
  COVERAGE_LICENSE_CODES,
  pickBestCandidate,
  type AcceptanceCheck,
  type BuildCoverageCandidatesInput,
  type CoverageAbsenceView,
  type CoverageCandidateRow,
  type CoverageCascadeType,
  type CoverageEmployeeView,
  type CoverageEngagementView,
  type CoverageGapView,
  type CoverageShiftView,
} from './coverageCandidates';

export type CascadeConvLike = {
  empresaId: string;
  shiftId: string;
  objectiveId: string;
  clientId?: string;
  positionName?: string;
  shiftCode?: string;
  startTime?: Timestamp;
  endTime?: Timestamp;
  aptitudesRequeridas?: string[];
  candidateEmployeeId?: string;
};

const msOf = (v: unknown): number => {
  const ts = v as { toMillis?: () => number; seconds?: number } | undefined;
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    const [y, m, d] = v.slice(0, 10).split('-').map(Number);
    return Date.UTC(y, (m || 1) - 1, d || 1, 3, 0, 0, 0);
  }
  return 0;
};

function ymdToStartMs(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return 0;
  return Date.UTC(y, m - 1, d, 3, 0, 0, 0);
}

function absenceWindow(data: Record<string, unknown>): { startMs: number; endMs: number } | null {
  const startRaw = data.startDate ?? data.fechaInicio ?? data.start;
  const endRaw = data.endDate ?? data.fechaFin ?? data.end;
  let startMs = 0;
  let endMs = 0;
  if (typeof startRaw === 'string') startMs = ymdToStartMs(startRaw.slice(0, 10));
  else startMs = msOf(startRaw);
  if (typeof endRaw === 'string') {
    const s = ymdToStartMs(endRaw.slice(0, 10));
    endMs = s ? s + 24 * 60 * 60 * 1000 - 1 : 0;
  } else endMs = msOf(endRaw);
  if (!startMs) return null;
  if (!endMs) endMs = startMs + 24 * 60 * 60 * 1000 - 1;
  return { startMs, endMs };
}

function licenseCodeOf(data: Record<string, unknown>): string {
  const candidates = [data.absenceType, data.shiftCode, data.code, data.tipo, data.type];
  for (const c of candidates) {
    const n = String(c || '').trim().toUpperCase();
    if (COVERAGE_LICENSE_CODES.has(n)) return n;
  }
  const label = String(data.type || data.tipoNovedad || '').trim().toUpperCase();
  if (label.includes('VACAC')) return 'V';
  if (label.includes('ENFER')) return 'E';
  if (label.includes('ART')) return 'ART';
  if (label.includes('GREMI')) return 'PG';
  if (label.includes('SUSP')) return 'SUS';
  if (label.includes('LICENC')) return 'L';
  return '';
}

function mapShift(id: string, t: Record<string, unknown>): CoverageShiftView {
  return {
    id,
    employeeId: String(t.employeeId || ''),
    employeeName: String(t.employeeName || ''),
    code: String(t.code || t.shiftCode || ''),
    objectiveId: String(t.objectiveId || ''),
    positionId: String(t.positionId || t.puestoId || ''),
    positionName: String(t.positionName || ''),
    startMs: msOf(t.startTime),
    endMs: msOf(t.endTime),
    isPresent: t.isPresent === true,
    isCompleted: t.isCompleted === true,
    isAbsent: t.isAbsent === true,
    isFranco: t.isFranco === true,
    isUnassigned: t.isUnassigned === true,
    isVirtual: t.isVirtual === true,
    draft: t.draft === true,
    coverageUsed: t.coverageUsed === true,
    isDeleted: t.isDeleted === true,
    coverageSuperseded: t.coverageSuperseded === true,
    origin: String(t.origin || ''),
    coverageType: String(t.coverageType || ''),
    coverageHoursOnSource: t.coverageHoursOnSource === true,
    realStartMs: msOf(t.realStartTime) || undefined,
    checkInMs: msOf(t.checkInTime) || msOf(t.presenciaAt) || undefined,
    deploymentBand: String(t.deploymentBand || t.coversBandCode || ''),
    absenceShiftId: String(t.absenceShiftId || ''),
    isRetention: t.isRetention === true,
    retentionAbsenceShiftId: String(t.retentionAbsenceShiftId || ''),
  };
}

/** Sin `.limit()`: el tope de 500 ocultaba licencias y francos del día. */
async function fetchQuery(q: admin.firestore.Query): Promise<admin.firestore.QueryDocumentSnapshot[]> {
  const snap = await q.get();
  return snap.docs;
}

export async function loadCoverageCandidateInput(
  db: admin.firestore.Firestore,
  conv: CascadeConvLike,
  opts?: { purpose?: 'select' | 'accept'; titular?: Record<string, unknown> },
): Promise<BuildCoverageCandidatesInput> {
  const titularSnap = conv.shiftId
    ? await db.collection('turnos').doc(conv.shiftId).get()
    : null;
  const titular = (opts?.titular || titularSnap?.data() || {}) as Record<string, unknown>;
  const startMs = msOf(conv.startTime) || msOf(titular.startTime);
  const endMs = msOf(conv.endTime) || msOf(titular.endTime);
  const bounds = arDayBoundsMs(startMs || Date.now());
  const gap: CoverageGapView = {
    titularShiftId: conv.shiftId,
    absentEmployeeId: String(titular.employeeId || ''),
    objectiveId: String(conv.objectiveId || titular.objectiveId || ''),
    clientId: String(conv.clientId || titular.clientId || '') || undefined,
    positionId: String(titular.positionId || titular.puestoId || '') || undefined,
    positionName: String(conv.positionName || titular.positionName || '') || undefined,
    startMs,
    endMs,
    band: String(conv.shiftCode || titular.code || '') || undefined,
    aptitudesRequeridas: conv.aptitudesRequeridas || [],
    alreadyCovered: String(titular.coverageStatus || '').toUpperCase() === 'COVERED'
      || titular.operacionallyCovered === true,
  };

  const empresaId = String(conv.empresaId || titular.empresaId || '');
  const dayQ = db.collection('turnos')
    .where('empresaId', '==', empresaId)
    .where('startTime', '>=', Timestamp.fromMillis(bounds.startMs))
    .where('startTime', '<=', Timestamp.fromMillis(bounds.endMs));
  const presentQ = db.collection('turnos')
    .where('empresaId', '==', empresaId)
    .where('objectiveId', '==', gap.objectiveId)
    .where('isPresent', '==', true);

  const [dayDocs, presentDocs, ausDocs, convDocs, empDocs] = await Promise.all([
    fetchQuery(dayQ),
    fetchQuery(presentQ),
    fetchQuery(db.collection('ausencias').where('empresaId', '==', empresaId)),
    fetchQuery(
      db.collection('convocatorias_cobertura')
        .where('empresaId', '==', empresaId)
        .where('status', 'in', ['PENDING', 'ESCALATED']),
    ),
    fetchQuery(
      db.collection('empleados')
        .where('empresaId', '==', empresaId)
        .where('status', 'in', ['ACTIVE', 'active', 'activo', 'ACTIVO']),
    ),
  ]);

  const shifts = new Map<string, CoverageShiftView>();
  for (const d of [...dayDocs, ...presentDocs]) {
    shifts.set(d.id, mapShift(d.id, d.data() as Record<string, unknown>));
  }

  const absences: CoverageAbsenceView[] = [];
  for (const d of ausDocs) {
    const data = d.data() as Record<string, unknown>;
    const win = absenceWindow(data);
    const code = licenseCodeOf(data);
    if (!win || !code || !data.employeeId) continue;
    absences.push({
      employeeId: String(data.employeeId),
      startMs: win.startMs,
      endMs: win.endMs,
      code,
      status: String(data.status || ''),
    });
  }

  const engagements: CoverageEngagementView[] = convDocs.map((d) => {
    const c = d.data();
    return {
      employeeId: String(c.candidateEmployeeId || ''),
      shiftId: String(c.shiftId || ''),
      status: String(c.status || ''),
    };
  });

  const employees: CoverageEmployeeView[] = empDocs.map((d) => {
    const e = d.data();
    const name = `${e.lastName || ''} ${e.firstName || ''}`.trim() || String(e.name || d.id);
    return {
      id: d.id,
      name,
      restriccionesObjetivo: e.restriccionesObjetivo || [],
      restriccionesCliente: e.restriccionesCliente || [],
      aptitudes: e.aptitudes || [],
    };
  });

  return {
    nowMs: Date.now(),
    gap,
    shifts: [...shifts.values()],
    absences,
    employees,
    engagements,
    hardCapMs: SHIFT_HARD_CAP_MS,
    purpose: opts?.purpose || 'select',
  };
}

export async function findBestCoverageCandidate(
  db: admin.firestore.Firestore,
  conv: CascadeConvLike,
  type: CoverageCascadeType,
): Promise<{ row: CoverageCandidateRow; uid?: string } | null> {
  const input = await loadCoverageCandidateInput(db, conv, { purpose: 'select' });
  const set = buildCoverageCandidates(input);
  const row = pickBestCandidate(set, type);
  if (!row) return null;
  const emp = await db.collection('empleados').doc(row.employeeId).get();
  const uid = emp.exists ? String(emp.data()?.uid || '') || undefined : undefined;
  return { row, uid };
}

export async function listFtCandidates(
  db: admin.firestore.Firestore,
  conv: CascadeConvLike,
  limit: number,
): Promise<{ row: CoverageCandidateRow; uid?: string }[]> {
  const input = await loadCoverageCandidateInput(db, conv, { purpose: 'select' });
  const set = buildCoverageCandidates(input);
  const rows = set.byType.FT.filter((r) => r.eligible).slice(0, limit);
  const out: { row: CoverageCandidateRow; uid?: string }[] = [];
  for (const row of rows) {
    const emp = await db.collection('empleados').doc(row.employeeId).get();
    out.push({ row, uid: emp.exists ? String(emp.data()?.uid || '') || undefined : undefined });
  }
  return out;
}

export async function revalidateAcceptance(
  db: admin.firestore.Firestore,
  conv: CascadeConvLike & { type: string; extendShiftId?: string; advanceShiftId?: string; candidateShiftId?: string; ftShiftId?: string },
  purpose: 'select' | 'accept' = 'accept',
): Promise<AcceptanceCheck> {
  const type = String(conv.type || '').toUpperCase() as CoverageCascadeType;
  const input = await loadCoverageCandidateInput(db, conv, { purpose });
  const source = conv.extendShiftId || conv.advanceShiftId || conv.candidateShiftId || conv.ftShiftId;
  return acceptanceStillValid(input, type, String(conv.candidateEmployeeId || ''), source);
}
