import type { Firestore } from 'firebase-admin/firestore';
import { isFrancoCoverageOriginDoc, isOpsCoverageHoursOnSourceDoc } from '../coverage/coverageTraceShift';
import { arYearMonth, arYmd } from './arClock';
import { planificacionEstadoLookupDocIds } from '../assistant/planificacionEstadoKeys';
import { isExcluidoDeOperacion } from './excluirDeOperacion';
import { isRetShift, isZeroDurationShift } from './retShift';

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
  | 'RET'
  | 'DURACION_CERO'
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
  if (isExcluidoDeOperacion(data)) return 'FUERA_OPERACION';
  if (isRetShift(data)) return 'RET';
  if (isZeroDurationShift(data)) return 'DURACION_CERO';
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
export function clientIsActive(data: Record<string, unknown> | undefined): boolean {
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

export type SlaDayCoverage = 'IN' | 'OUT' | 'UNDATED';

/**
 * ?El contrato cubre ese d?a calendario (YYYY-MM-DD)? Mismo universo que el Banco de Horas / P1d:
 * activo vigente o cerrado (`closed: true`) cuya vigencia incluye el d?a. Inactivo/cancelado = OUT.
 * Sin fechas = UNDATED (el llamador decide si aplica la regla anterior).
 * Un SLA cerrado del 25/09 no cubre el 02/10: no genera huecos ni avisos de octubre.
 */
export function slaDayCoverage(data: Record<string, unknown>, ymd: string): SlaDayCoverage {
  if (!contractActive(data.status)) return 'OUT';
  const startRaw = contractCalendarYmd(data.startDate);
  const endRaw = contractCalendarYmd(data.endDate);
  if (!startRaw && !endRaw) return 'UNDATED';
  const range = slaMonthRange(data);
  if (!range) return 'OUT';
  return ymd >= range.start && ymd <= range.end ? 'IN' : 'OUT';
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

type SlaDoc = { id: string; data: () => Record<string, unknown> };

export type SlaVigenteDia = { id: string; objectiveId: string; data: Record<string, unknown> };

/**
 * Universo Demo = SLA del mes del Banco de Horas: contrato activo vigente ese día,
 * o cerrado cuya vigencia incluye ese día, cliente activo y cronograma PUBLICADO.
 * Borrador (sin `publishedAt`) no se simula. Cache por empresa/objetivo/mes.
 */
export type OperationVerdict = 'IN' | 'OUT' | 'UNMODELED';

export class ObjectiveOperationCache {
  private slasByEmpresa = new Map<string, SlaDoc[]>();
  private clientsByEmpresa = new Map<string, Map<string, Record<string, unknown>>>();
  private monthCache = new Map<string, MonthOp>();
  /** Objetivo con SLA fechado de esa empresa. Sin fechas, el resto del CC sigue la regla anterior. */
  private modeledKeys = new Set<string>();

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

  /**
   * IN = día en operación (SLA vigente + cliente activo + cronograma publicado).
   * OUT = hay SLA fechado y ese día no entra.
   * UNMODELED = el objetivo no tiene vigencia cargada: no se usa para cortar el servicio.
   */
  async operationVerdict(
    db: Firestore,
    shift: Record<string, unknown> | null | undefined,
  ): Promise<OperationVerdict> {
    if (!shift) return 'UNMODELED';
    const empresaId = String(shift.empresaId ?? '').trim();
    const objectiveId = String(shift.objectiveId ?? '').trim();
    const ms = shiftStartMs(shift);
    if (!empresaId || !objectiveId || !ms) return 'UNMODELED';
    const { year, month } = arYearMonth(ms);
    await this.monthEntry(db, empresaId, objectiveId, year, month);
    if (!this.modeledKeys.has(`${empresaId}|${objectiveId}`)) return 'UNMODELED';
    return (await this.isShiftInOperation(db, shift)) ? 'IN' : 'OUT';
  }

  /**
   * Contratos que cubren ese d?a (`slaDayCoverage === 'IN'`) con cliente activo, en el orden de
   * Firestore. Universo de ?hay servicio vendido ese d?a?: lo usan el detector de huecos y el
   * aviso de cronograma sin publicar. No mira el cronograma.
   */
  async slasVigentesEnDia(db: Firestore, empresaId: string, ymd: string): Promise<SlaVigenteDia[]> {
    const [slas, clients] = await Promise.all([this.loadSlas(db, empresaId), this.loadClients(db, empresaId)]);
    const out: SlaVigenteDia[] = [];
    for (const doc of slas) {
      const data = doc.data();
      const objectiveId = String(data.objectiveId ?? '').trim();
      if (!objectiveId) continue;
      if (slaDayCoverage(data, ymd) !== 'IN') continue;
      const clientId = String(data.clientId ?? '').trim();
      if (clientId && clients.has(clientId) && !clientIsActive(clients.get(clientId))) continue;
      out.push({ id: doc.id, objectiveId, data });
    }
    return out;
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
    for (const doc of slas) {
      const data = doc.data();
      if (String(data.objectiveId ?? '').trim() !== objectiveId) continue;
      if (slaMonthRange(data)) this.modeledKeys.add(`${empresaId}|${objectiveId}`);
    }
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
    const docs = snap.docs.map((d) => ({ id: d.id, data: () => d.data() as Record<string, unknown> }));
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
