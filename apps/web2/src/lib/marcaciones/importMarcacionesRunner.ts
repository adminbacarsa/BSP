import {
  collection,
  doc,
  query,
  where,
  writeBatch,
  Timestamp,
  serverTimestamp,
} from 'firebase/firestore';
import { db, getDocsOnce } from '@/lib/firebase';
import {
  empresaScopedQuery,
  shouldScopeQueriesToEmpresa,
  stampEmpresaId,
  planificacionPublishLookupKey,
  fetchPlanificacionEstadoDoc,
  buildPlanificacionEstadoDocId,
} from '@/lib/multiempresa';
import { isShiftFichado } from '@/lib/crm/fichadaHours';
import type { CcostoCatalogItem } from '@/services/ccostoMappingService';
import { marcacionDateKey, type ParsedMarcacionRow } from '@/lib/marcaciones/parseMarcacionesExcel';

const WORKING = new Set(['M', 'T', 'N', 'D12', 'N12', 'PU', 'C', 'REF', 'ESC', 'RET']);

export type ImportSkipReason =
  | 'invalid_row'
  | 'no_dni'
  | 'no_employee'
  | 'no_cc_mapping'
  | 'cronograma_no_publicado'
  | 'sin_celda_planificada'
  | 'turno_otro_objetivo'
  | 'sin_turno_dia'
  | 'already_fichado';

export const IMPORT_SKIP_LABELS: Record<ImportSkipReason, string> = {
  invalid_row: 'Fila inválida',
  no_dni: 'Sin DNI en Excel',
  no_employee: 'Legajo no encontrado',
  no_cc_mapping: 'CC sin mapear',
  cronograma_no_publicado: 'Cronograma no publicado',
  sin_celda_planificada: 'Sin celda en cronograma publicado',
  turno_otro_objetivo: 'Turno ese día en otro objetivo',
  sin_turno_dia: 'Sin turno ese día (ningún objetivo)',
  already_fichado: 'Ya fichado',
};

export interface ImportMarcacionSample {
  rowIndex: number;
  dni: string;
  employeeName: string;
  ccosto: string;
  date: string;
  reason?: ImportSkipReason | 'applied';
  detail?: string;
  turnoId?: string;
  objectiveName?: string;
  clientName?: string;
}

export interface ImportMarcacionDetail extends ImportMarcacionSample {
  reason: ImportSkipReason | 'applied';
}

export interface ImportObjectiveIssueRow {
  objectiveId: string;
  objectiveName: string;
  clientName: string;
  cronograma_no_publicado: number;
  sin_celda_planificada: number;
  turno_otro_objetivo: number;
}

export interface ImportMarcacionSummary {
  totalRows: number;
  toApply: number;
  applied: number;
  skipped: number;
  byReason: Record<ImportSkipReason, number>;
}

export interface ImportMarcacionReport {
  summary: ImportMarcacionSummary;
  samplesApplied: ImportMarcacionSample[];
  samplesSkipped: ImportMarcacionSample[];
  skippedDetails: ImportMarcacionDetail[];
  byObjectiveIssue: ImportObjectiveIssueRow[];
}

function toDateSafe(v: any): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v.toDate === 'function') return v.toDate();
  if (typeof v.seconds === 'number') return new Date(v.seconds * 1000);
  return null;
}

function shiftCode(t: any): string {
  return String(t?.code ?? t?.type ?? '').trim().toUpperCase();
}

function scoreTurno(t: any): number {
  const code = shiftCode(t);
  if (WORKING.has(code)) return 10;
  if (code === 'FT') return 5;
  return 0;
}

function buildCcMap(items: CcostoCatalogItem[]): Map<string, CcostoCatalogItem> {
  const map = new Map<string, CcostoCatalogItem>();
  for (const item of items) {
    if (item.objectiveId) map.set(item.ccosto, item);
  }
  return map;
}

function parseDateParts(date: string): { year: number; month: number } {
  const [y, m] = date.split('-').map(Number);
  return { year: y, month: m };
}

async function loadEmployeesByDni(empresaId: string, scopeEmpresa: boolean): Promise<Map<string, { id: string; name: string }>> {
  const snap = await getDocsOnce(
    empresaScopedQuery('empleados', empresaId, scopeEmpresa) as ReturnType<typeof query>,
    { timeoutMs: 120_000 },
  );
  const map = new Map<string, { id: string; name: string }>();
  for (const d of snap.docs) {
    const data = d.data();
    const status = String(data.status ?? data.estado ?? 'active').toLowerCase();
    if (status.includes('inactiv')) continue;
    const dni = String(data.dni ?? data.document ?? '').replace(/\D/g, '');
    if (!dni) continue;
    const name = `${data.firstName || data.nombre || ''} ${data.lastName || data.apellido || ''}`.trim() || data.name || d.id;
    map.set(dni, { id: d.id, name });
  }
  return map;
}

async function loadTurnosForObjectives(objectiveIds: string[], start: Date, end: Date): Promise<any[]> {
  const col = collection(db, 'turnos');
  const startTs = Timestamp.fromDate(start);
  const endTs = Timestamp.fromDate(end);
  const byId = new Map<string, any>();
  const chunkSize = 8;
  for (let i = 0; i < objectiveIds.length; i += chunkSize) {
    const chunk = objectiveIds.slice(i, i + chunkSize);
    const snaps = await Promise.all(chunk.map(oid => getDocsOnce(query(
      col,
      where('objectiveId', '==', oid),
      where('startTime', '>=', startTs),
      where('startTime', '<=', endTs),
    ), { timeoutMs: 180_000 })));
    for (const snap of snaps) {
      for (const d of snap.docs) byId.set(d.id, { id: d.id, ...d.data() });
    }
  }
  return [...byId.values()];
}

async function loadTurnosForPeriod(
  empresaId: string,
  scopeEmpresa: boolean,
  start: Date,
  end: Date,
): Promise<any[]> {
  const col = collection(db, 'turnos');
  const startTs = Timestamp.fromDate(start);
  const endTs = Timestamp.fromDate(end);
  const q = scopeEmpresa
    ? query(col, where('empresaId', '==', empresaId), where('startTime', '>=', startTs), where('startTime', '<=', endTs))
    : query(col, where('startTime', '>=', startTs), where('startTime', '<=', endTs));
  const snap = await getDocsOnce(q, { timeoutMs: 180_000 });
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function loadPublishStatusMap(
  empresaId: string,
  objectiveIds: string[],
  months: Array<{ year: number; month: number }>,
): Promise<Set<string>> {
  const published = new Set<string>();
  const uniqueObj = [...new Set(objectiveIds)];
  for (const { year, month } of months) {
    for (const objectiveId of uniqueObj) {
      const lookup = planificacionPublishLookupKey(objectiveId, year, month);
      const docSnap = await fetchPlanificacionEstadoDoc(empresaId, objectiveId, year, month);
      const data = docSnap?.data;
      if (data?.publishedAt != null && data.publishedAt !== '') {
        published.add(lookup);
        published.add(buildPlanificacionEstadoDocId(empresaId, objectiveId, year, month));
      }
    }
  }
  return published;
}

function buildTurnoIndex(turnos: any[]): Map<string, any[]> {
  const index = new Map<string, any[]>();
  for (const t of turnos) {
    const empId = String(t.employeeId ?? '').trim();
    const objId = String(t.objectiveId ?? '').trim();
    const st = toDateSafe(t.startTime);
    if (!empId || !objId || !st) continue;
    const key = `${empId}|${objId}|${marcacionDateKey(st)}`;
    const list = index.get(key) ?? [];
    list.push(t);
    index.set(key, list);
  }
  return index;
}

function buildEmpDayIndex(turnos: any[]): Map<string, any[]> {
  const index = new Map<string, any[]>();
  for (const t of turnos) {
    const empId = String(t.employeeId ?? '').trim();
    const st = toDateSafe(t.startTime);
    if (!empId || !st) continue;
    const key = `${empId}|${marcacionDateKey(st)}`;
    const list = index.get(key) ?? [];
    list.push(t);
    index.set(key, list);
  }
  return index;
}

function pickTurno(candidates: any[]): any | null {
  if (!candidates.length) return null;
  return [...candidates].sort((a, b) => scoreTurno(b) - scoreTurno(a))[0];
}

function turnoObjectiveLabel(t: any): string {
  return String(t.objectiveName || t.objectiveId || 'Otro objetivo');
}

function buildFichadaPatch(turno: any, row: ParsedMarcacionRow) {
  const planStart = toDateSafe(turno.startTime);
  const planEnd = toDateSafe(turno.endTime);
  return {
    isPresent: true,
    isCompleted: true,
    isAbsent: false,
    absenceType: null,
    status: 'COMPLETED',
    checkInTime: Timestamp.fromDate(row.entryAt),
    checkOutTime: Timestamp.fromDate(row.exitAt),
    realStartTime: planStart ? Timestamp.fromDate(planStart) : Timestamp.fromDate(row.entryAt),
    realEndTime: planEnd ? Timestamp.fromDate(planEnd) : Timestamp.fromDate(row.exitAt),
    marcacionImportSource: 'EXCEL_CC',
    marcacionImportAt: serverTimestamp(),
  };
}

function emptyReasonCounts(): Record<ImportSkipReason, number> {
  return {
    invalid_row: 0,
    no_dni: 0,
    no_employee: 0,
    no_cc_mapping: 0,
    cronograma_no_publicado: 0,
    sin_celda_planificada: 0,
    turno_otro_objetivo: 0,
    sin_turno_dia: 0,
    already_fichado: 0,
  };
}

function bumpObjectiveIssue(
  map: Map<string, ImportObjectiveIssueRow>,
  ccItem: CcostoCatalogItem,
  reason: ImportSkipReason,
) {
  if (!ccItem.objectiveId) return;
  if (!['cronograma_no_publicado', 'sin_celda_planificada', 'turno_otro_objetivo'].includes(reason)) return;
  const key = ccItem.objectiveId;
  const prev = map.get(key) ?? {
    objectiveId: ccItem.objectiveId,
    objectiveName: ccItem.objectiveName || ccItem.objectiveId,
    clientName: ccItem.clientName || '',
    cronograma_no_publicado: 0,
    sin_celda_planificada: 0,
    turno_otro_objetivo: 0,
  };
  if (reason === 'cronograma_no_publicado') prev.cronograma_no_publicado += 1;
  if (reason === 'sin_celda_planificada') prev.sin_celda_planificada += 1;
  if (reason === 'turno_otro_objetivo') prev.turno_otro_objetivo += 1;
  map.set(key, prev);
}

export function exportImportDetailsCsv(details: ImportMarcacionDetail[]): string {
  const header = [
    'Fila',
    'Fecha',
    'DNI',
    'Nombre',
    'CentroCosto',
    'Cliente',
    'ObjetivoMapeado',
    'Motivo',
    'Detalle',
    'TurnoId',
  ].join(';');
  const lines = details.map(d => [
    d.rowIndex,
    d.date,
    d.dni,
    `"${String(d.employeeName || '').replace(/"/g, '""')}"`,
    `"${String(d.ccosto || '').replace(/"/g, '""')}"`,
    `"${String(d.clientName || '').replace(/"/g, '""')}"`,
    `"${String(d.objectiveName || '').replace(/"/g, '""')}"`,
    IMPORT_SKIP_LABELS[d.reason as ImportSkipReason] || d.reason,
    `"${String(d.detail || '').replace(/"/g, '""')}"`,
    d.turnoId || '',
  ].join(';'));
  return `\uFEFF${header}\n${lines.join('\n')}`;
}

export async function runMarcacionesImport(opts: {
  rows: ParsedMarcacionRow[];
  mappingItems: CcostoCatalogItem[];
  empresaId: string;
  migracionCompleta?: boolean;
  dryRun: boolean;
  overwriteExisting: boolean;
  onProgress?: (label: string, pct: number) => void;
}): Promise<ImportMarcacionReport> {
  const scopeEmpresa = shouldScopeQueriesToEmpresa(opts.empresaId, opts.migracionCompleta === true);
  const ccMap = buildCcMap(opts.mappingItems);
  const byReason = emptyReasonCounts();
  const samplesApplied: ImportMarcacionSample[] = [];
  const samplesSkipped: ImportMarcacionSample[] = [];
  const skippedDetails: ImportMarcacionDetail[] = [];
  const objectiveIssueMap = new Map<string, ImportObjectiveIssueRow>();
  const pendingUpdates: Array<{ turnoId: string; patch: Record<string, unknown>; sample: ImportMarcacionSample }> = [];

  opts.onProgress?.('Cargando legajos…', 5);
  const empByDni = await loadEmployeesByDni(opts.empresaId, scopeEmpresa);

  const objectiveIds = [...new Set(
    opts.rows.map(r => ccMap.get(r.ccosto)?.objectiveId).filter(Boolean) as string[],
  )];

  if (!objectiveIds.length) {
    return {
      summary: {
        totalRows: opts.rows.length,
        toApply: 0,
        applied: 0,
        skipped: opts.rows.length,
        byReason: { ...byReason, no_cc_mapping: opts.rows.length },
      },
      samplesApplied,
      samplesSkipped,
      skippedDetails,
      byObjectiveIssue: [],
    };
  }

  let min = opts.rows[0].entryAt;
  let max = opts.rows[0].entryAt;
  for (const r of opts.rows) {
    if (r.entryAt < min) min = r.entryAt;
    if (r.entryAt > max) max = r.entryAt;
  }
  const start = new Date(min.getFullYear(), min.getMonth(), min.getDate(), 0, 0, 0, 0);
  const end = new Date(max.getFullYear(), max.getMonth(), max.getDate(), 23, 59, 59, 999);

  const monthSet = new Map<string, { year: number; month: number }>();
  for (const r of opts.rows) {
    const dk = marcacionDateKey(r.entryAt);
    const { year, month } = parseDateParts(dk);
    monthSet.set(`${year}-${month}`, { year, month });
  }

  opts.onProgress?.('Verificando cronogramas publicados…', 12);
  const publishStatus = await loadPublishStatusMap(opts.empresaId, objectiveIds, [...monthSet.values()]);

  opts.onProgress?.('Cargando turnos del período…', 18);
  const [mappedTurnos, allTurnos] = await Promise.all([
    loadTurnosForObjectives(objectiveIds, start, end),
    loadTurnosForPeriod(opts.empresaId, scopeEmpresa, start, end),
  ]);
  const turnoIndex = buildTurnoIndex(mappedTurnos);
  const empDayIndex = buildEmpDayIndex(allTurnos);

  const pushSkip = (sample: ImportMarcacionDetail) => {
    skippedDetails.push(sample);
    if (samplesSkipped.length < 20) samplesSkipped.push(sample);
  };

  opts.onProgress?.('Emparejando marcaciones…', 35);
  for (let i = 0; i < opts.rows.length; i++) {
    const row = opts.rows[i];
    const date = marcacionDateKey(row.entryAt);
    const baseSample: ImportMarcacionSample = {
      rowIndex: row.rowIndex,
      dni: row.dni,
      employeeName: row.employeeName,
      ccosto: row.ccosto,
      date,
    };

    if (!row.dni) {
      byReason.no_dni++;
      pushSkip({ ...baseSample, reason: 'no_dni' });
      continue;
    }

    const emp = empByDni.get(row.dni);
    if (!emp) {
      byReason.no_employee++;
      pushSkip({ ...baseSample, reason: 'no_employee', detail: 'DNI no existe en legajos activos' });
      continue;
    }

    const ccItem = ccMap.get(row.ccosto);
    if (!ccItem?.objectiveId) {
      byReason.no_cc_mapping++;
      pushSkip({ ...baseSample, reason: 'no_cc_mapping', detail: row.ccosto });
      continue;
    }

    const key = `${emp.id}|${ccItem.objectiveId}|${date}`;
    const turno = pickTurno(turnoIndex.get(key) ?? []);

    if (!turno) {
      const { year, month } = parseDateParts(date);
      const pubKey = planificacionPublishLookupKey(ccItem.objectiveId, year, month);
      const isPublished = publishStatus.has(pubKey);
      const dayTurnos = empDayIndex.get(`${emp.id}|${date}`) ?? [];
      const otherTurnos = dayTurnos.filter(t => String(t.objectiveId) !== String(ccItem.objectiveId));

      let reason: ImportSkipReason;
      let detail: string;
      if (otherTurnos.length) {
        reason = 'turno_otro_objetivo';
        detail = otherTurnos.slice(0, 2).map(turnoObjectiveLabel).join(' · ');
      } else if (!isPublished) {
        reason = 'cronograma_no_publicado';
        detail = `${ccItem.clientName || ''} / ${ccItem.objectiveName || ''} · ${String(month).padStart(2, '0')}/${year}`;
      } else if (dayTurnos.length === 0) {
        reason = 'sin_turno_dia';
        detail = 'El legajo no tiene turno planificado ese día';
      } else {
        reason = 'sin_celda_planificada';
        detail = `${ccItem.objectiveName || ccItem.objectiveId} · cronograma publicado sin celda para este guardia`;
      }

      byReason[reason]++;
      bumpObjectiveIssue(objectiveIssueMap, ccItem, reason);
      pushSkip({
        ...baseSample,
        reason,
        detail,
        objectiveName: ccItem.objectiveName,
        clientName: ccItem.clientName,
      });
      continue;
    }

    if (isShiftFichado(turno) && !opts.overwriteExisting) {
      byReason.already_fichado++;
      pushSkip({
        ...baseSample,
        reason: 'already_fichado',
        turnoId: turno.id,
        objectiveName: ccItem.objectiveName,
        clientName: ccItem.clientName,
        detail: 'Turno ya tiene fichada',
      });
      continue;
    }

    const sample: ImportMarcacionSample = {
      ...baseSample,
      turnoId: turno.id,
      objectiveName: ccItem.objectiveName,
      clientName: ccItem.clientName,
      reason: 'applied',
    };
    pendingUpdates.push({
      turnoId: turno.id,
      patch: buildFichadaPatch(turno, row),
      sample,
    });
    if (samplesApplied.length < 20) samplesApplied.push(sample);

    if (i % 500 === 0) {
      opts.onProgress?.(`Emparejando ${i + 1}/${opts.rows.length}…`, 35 + Math.round((i / opts.rows.length) * 40));
    }
  }

  let applied = 0;
  if (!opts.dryRun && pendingUpdates.length > 0) {
    opts.onProgress?.('Escribiendo fichadas…', 80);
    let batch = writeBatch(db);
    let ops = 0;
    for (let i = 0; i < pendingUpdates.length; i++) {
      const { turnoId, patch } = pendingUpdates[i];
      batch.update(doc(db, 'turnos', turnoId), stampEmpresaId(patch, opts.empresaId));
      ops++;
      applied++;
      if (ops >= 450) {
        await batch.commit();
        batch = writeBatch(db);
        ops = 0;
        opts.onProgress?.(`Guardado ${applied}/${pendingUpdates.length}…`, 80 + Math.round((applied / pendingUpdates.length) * 18));
      }
    }
    if (ops > 0) await batch.commit();
  }

  const toApply = pendingUpdates.length;
  const skipped = opts.rows.length - toApply;
  if (opts.dryRun) applied = 0;

  opts.onProgress?.('Listo', 100);

  const byObjectiveIssue = [...objectiveIssueMap.values()]
    .sort((a, b) =>
      (b.cronograma_no_publicado + b.sin_celda_planificada + b.turno_otro_objetivo)
      - (a.cronograma_no_publicado + a.sin_celda_planificada + a.turno_otro_objetivo),
    );

  return {
    summary: {
      totalRows: opts.rows.length,
      toApply,
      applied: opts.dryRun ? 0 : applied,
      skipped,
      byReason,
    },
    samplesApplied,
    samplesSkipped,
    skippedDetails,
    byObjectiveIssue,
  };
}
