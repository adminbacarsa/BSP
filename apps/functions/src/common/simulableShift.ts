import type { Firestore } from 'firebase-admin/firestore';
import { isFrancoCoverageOriginDoc, isOpsCoverageHoursOnSourceDoc } from '../coverage/coverageTraceShift';
import { arYearMonth, arYmd } from './arClock';
import { planificacionEstadoLookupDocIds } from '../assistant/planificacionEstadoKeys';

/**
 * Códigos de licencia/ausencia de la grilla (`AbsenceCode` de `tipos_novedad`) + ART.
 * Un turno con uno de estos códigos no es un turno trabajable: el guardia no va al puesto.
 */
export const LICENSE_SHIFT_CODES: ReadonlySet<string> = new Set([
  'V', 'L', 'E', 'A', 'ART', 'AA', 'PG', 'SGS', 'SUS',
]);

/** Descansos CCT: tampoco hay presencia que simular. */
export const FRANCO_SHIFT_CODES: ReadonlySet<string> = new Set(['F', 'FF', 'FP']);

export type SimulableSkipReason =
  | 'LICENCIA'
  | 'FRANCO'
  | 'DRAFT'
  | 'VIRTUAL'
  | 'OPS_COV_TRACE'
  | 'FRANCO_ORIGEN'
  | 'FUERA_OPERACION';

export type SimulableShiftOpts = {
  /**
   * false = el objetivo no está en operación el día del turno.
   * Omitido = no se evalúa (llamados sin Firestore, tests de códigos).
   */
  inOperation?: boolean;
};

function normalizeCode(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

/** Código de grilla del turno; `shiftCode` es el alias que usan novedades/ausencias. */
export function shiftGridCode(data: Record<string, unknown> | null | undefined): string {
  if (!data) return '';
  return normalizeCode(data.code) || normalizeCode(data.shiftCode);
}

export function isLicenseShiftCode(code: unknown): boolean {
  return LICENSE_SHIFT_CODES.has(normalizeCode(code));
}

export function isFrancoShiftCode(code: unknown): boolean {
  return FRANCO_SHIFT_CODES.has(normalizeCode(code));
}

/** Turno con licencia/ausencia de grilla (V, L, E, A, ART, AA, PG, SGS, SUS). */
export function isLicenseShift(data: Record<string, unknown> | null | undefined): boolean {
  return isLicenseShiftCode(shiftGridCode(data));
}

/**
 * Filtro único de "turno simulable" para todo escritor de presencia simulada
 * (modo Demo, auto-presencia SuperAdmin, auto-presencia del asistente).
 * Devuelve el motivo del descarte o `null` si el turno se puede simular.
 * `opts.inOperation === false` descarta objetivos fuera de operación ese día.
 */
export function simulableShiftSkipReason(
  data: Record<string, unknown> | null | undefined,
  opts?: SimulableShiftOpts,
): SimulableSkipReason | null {
  if (!data) return 'VIRTUAL';
  if (data.draft === true) return 'DRAFT';
  if (data.isVirtual === true) return 'VIRTUAL';
  if (isOpsCoverageHoursOnSourceDoc(data)) return 'OPS_COV_TRACE';
  if (isFrancoCoverageOriginDoc(data)) return 'FRANCO_ORIGEN';
  const code = shiftGridCode(data);
  if (isLicenseShiftCode(code)) return 'LICENCIA';
  if (data.isFranco === true || isFrancoShiftCode(code)) return 'FRANCO';
  if (opts?.inOperation === false) return 'FUERA_OPERACION';
  return null;
}

/**
 * La simulación nunca inventa presencia sobre licencias, francos, borradores,
 * turnos virtuales, los `ops_cov` de registro EXT/ADV ni objetivos fuera de operación.
 */
export function isSimulableShift(
  data: Record<string, unknown> | null | undefined,
  opts?: SimulableShiftOpts,
): boolean {
  return simulableShiftSkipReason(data, opts) === null;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Fecha de contrato: string YYYY-MM-DD, o Timestamp 00:00 UTC leído como ese día UTC (no corrido a AR). */
export function contractCalendarYmd(value: unknown): string {
  if (value == null || value === '') return '';
  if (typeof value === 'string') return value.trim().slice(0, 10);
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'object') {
    const o = value as { toDate?: () => Date; seconds?: number; _seconds?: number };
    if (typeof o.toDate === 'function') {
      const d = o.toDate();
      if (d && !Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
    const sec = o.seconds ?? o._seconds;
    if (typeof sec === 'number') return new Date(sec * 1000).toISOString().slice(0, 10);
  }
  return String(value).trim().slice(0, 10);
}

function contractActive(status: unknown): boolean {
  const st = String(status ?? '').trim().toLowerCase();
  if (!st) return true;
  return st !== 'inactive' && st !== 'inactivo' && st !== 'cancelled' && st !== 'cancelado';
}

/** Mismo criterio que el libro de horas: sin doc, se asume activo. */
function clientIsActive(data: Record<string, unknown> | undefined): boolean {
  if (!data) return true;
  if (data.active === false) return false;
  const u = String(data.status ?? 'ACTIVO').trim().toUpperCase();
  return u === 'ACTIVO' || u === 'ACTIVE' || u === '';
}

/**
 * Rango del SLA del mes (libro de horas: bucket activo o cerrado).
 * `closed: true` entra si el status sigue activo y el día cae en la vigencia.
 * Status inactivo/cancelado no entra.
 */
function slaMonthRange(data: Record<string, unknown>): { start: string; end: string } | null {
  if (!contractActive(data.status)) return null;
  const startRaw = contractCalendarYmd(data.startDate);
  const endRaw = contractCalendarYmd(data.endDate);
  if (!startRaw && !endRaw) return null;
  return { start: startRaw || '1970-01-01', end: endRaw || '2099-12-31' };
}

function overlapsMonth(start: string, end: string, year: number, month: number): boolean {
  const from = `${year}-${pad2(month)}-01`;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const to = `${year}-${pad2(month)}-${pad2(last)}`;
  return start <= to && end >= from;
}

export function shiftStartMs(data: Record<string, unknown> | null | undefined): number {
  if (!data) return 0;
  const raw = data.startTime as
    | { toMillis?: () => number; seconds?: number; _seconds?: number; toDate?: () => Date }
    | Date
    | number
    | string
    | undefined;
  if (!raw) return 0;
  if (typeof raw === 'number') return raw;
  if (raw instanceof Date) return raw.getTime();
  if (typeof raw === 'string') {
    const ms = Date.parse(raw);
    return Number.isNaN(ms) ? 0 : ms;
  }
  if (typeof raw.toMillis === 'function') return raw.toMillis();
  if (typeof raw.toDate === 'function') return raw.toDate().getTime();
  const sec = raw.seconds ?? raw._seconds;
  if (typeof sec === 'number') return sec * 1000;
  return 0;
}

type MonthOp = {
  published: boolean;
  ranges: Array<{ start: string; end: string }>;
};

type SlaDoc = { data: () => Record<string, unknown> };

/**
 * Universo Demo = SLA del mes del Banco de Horas: contrato activo vigente ese día,
 * o cerrado cuya vigencia incluye ese día, cliente activo y cronograma PUBLICADO.
 * Borrador (sin `publishedAt`) no se simula. Cache por empresa/objetivo/mes.
 */
export class ObjectiveOperationCache {
  private slasByEmpresa = new Map<string, SlaDoc[]>();
  private clientsByEmpresa = new Map<string, Map<string, Record<string, unknown>>>();
  private monthCache = new Map<string, MonthOp>();

  async isShiftInOperation(
    db: Firestore,
    shift: Record<string, unknown> | null | undefined,
  ): Promise<boolean> {
    if (!shift) return false;
    const empresaId = String(shift.empresaId ?? '').trim();
    const objectiveId = String(shift.objectiveId ?? '').trim();
    const ms = shiftStartMs(shift);
    if (!empresaId || !objectiveId || !ms) return false;
    const ymd = arYmd(ms);
    const { year, month } = arYearMonth(ms);
    const entry = await this.monthEntry(db, empresaId, objectiveId, year, month);
    if (!entry.published) return false;
    return entry.ranges.some((r) => ymd >= r.start && ymd <= r.end);
  }

  private async monthEntry(
    db: Firestore,
    empresaId: string,
    objectiveId: string,
    year: number,
    month: number,
  ): Promise<MonthOp> {
    const key = `${empresaId}|${objectiveId}|${year}|${month}`;
    const hit = this.monthCache.get(key);
    if (hit) return hit;

    const [published, slas, clients] = await Promise.all([
      this.isPlanPublished(db, empresaId, objectiveId, year, month),
      this.loadSlas(db, empresaId),
      this.loadClients(db, empresaId),
    ]);

    const ranges: Array<{ start: string; end: string }> = [];
    if (published) {
      for (const doc of slas) {
        const data = doc.data();
        if (String(data.objectiveId ?? '').trim() !== objectiveId) continue;
        const clientId = String(data.clientId ?? '').trim();
        const client = clientId ? clients.get(clientId) : undefined;
        if (clientId && clients.has(clientId) && !clientIsActive(client)) continue;
        if (!clientId && !clientIsActive(undefined)) continue;
        const range = slaMonthRange(data);
        if (!range) continue;
        if (!overlapsMonth(range.start, range.end, year, month)) continue;
        ranges.push(range);
      }
    }

    const entry: MonthOp = { published, ranges };
    this.monthCache.set(key, entry);
    return entry;
  }

  private async isPlanPublished(
    db: Firestore,
    empresaId: string,
    objectiveId: string,
    year: number,
    month: number,
  ): Promise<boolean> {
    const docIds = planificacionEstadoLookupDocIds(empresaId, objectiveId, year, month);
    const docs = await Promise.all(docIds.map((id) => db.collection('planificacion_estados').doc(id).get()));
    return docs.some((d) => {
      if (!d.exists) return false;
      const pub = d.data()?.publishedAt;
      return pub != null && pub !== '';
    });
  }

  private async loadSlas(db: Firestore, empresaId: string): Promise<SlaDoc[]> {
    const hit = this.slasByEmpresa.get(empresaId);
    if (hit) return hit;
    const snap = await db.collection('servicios_sla').where('empresaId', '==', empresaId).get();
    const docs = snap.docs.map((d) => ({ data: () => d.data() as Record<string, unknown> }));
    this.slasByEmpresa.set(empresaId, docs);
    return docs;
  }

  private async loadClients(
    db: Firestore,
    empresaId: string,
  ): Promise<Map<string, Record<string, unknown>>> {
    const hit = this.clientsByEmpresa.get(empresaId);
    if (hit) return hit;
    const snap = await db.collection('clients').where('empresaId', '==', empresaId).get();
    const map = new Map<string, Record<string, unknown>>();
    snap.docs.forEach((d) => map.set(d.id, d.data() as Record<string, unknown>));
    this.clientsByEmpresa.set(empresaId, map);
    return map;
  }
}

/** Filtro de códigos + objetivo en operación (cache por empresa/objetivo/mes). */
export async function simulableShiftSkipReasonResolved(
  db: Firestore,
  data: Record<string, unknown> | null | undefined,
  cache: ObjectiveOperationCache = new ObjectiveOperationCache(),
): Promise<SimulableSkipReason | null> {
  const base = simulableShiftSkipReason(data);
  if (base) return base;
  const inOperation = await cache.isShiftInOperation(db, data);
  return simulableShiftSkipReason(data, { inOperation });
}
