/**
 * Ventana propuesta de un ops_cov EXT/ADV.
 * Se ancla al hueco del titular y al turno fuente vinculado.
 * Hora AR: apps/functions/src/common/arClock.ts
 * Licencias y francos: mismos códigos que isLicenseShiftCode / isFrancoShiftCode.
 */
import { arYmd } from '../apps/functions/src/common/arClock.ts';

export const JOIN_TOL_MS = 30 * 60 * 1000;
export const HARD_CAP_MS = (12 * 60 + 59) * 60 * 1000;
export const ALIGN_TOL_MS = 60 * 1000;

const AR_OFFSET_MS = 3 * 60 * 60 * 1000;
const LICENSE_CODES = new Set(['V', 'L', 'E', 'A', 'ART', 'AA', 'PG', 'SGS', 'SUS']);
const FRANCO_CODES = new Set(['F', 'FF', 'FP']);
const WORK_CODES = new Set(['M', 'T', 'N', 'D12', 'N12']);

function norm(code) {
  return String(code ?? '').trim().toUpperCase();
}

export function isLicenseShiftCode(code) {
  return LICENSE_CODES.has(norm(code));
}

export function isFrancoShiftCode(code) {
  return FRANCO_CODES.has(norm(code));
}

export function linkedSourceId(cov, conv) {
  const type = norm(cov?.coverageType || cov?.type);
  const pick = (...xs) => xs.map((v) => String(v || '').trim()).find(Boolean) || '';
  if (type === 'EXTEND') {
    return pick(
      cov?.extendShiftId,
      conv?.extendShiftId,
      cov?.coverageSourceShiftId,
      conv?.coverageSourceShiftId,
      cov?.sourceShiftId,
    );
  }
  if (type === 'ADVANCE') {
    return pick(
      cov?.advanceShiftId,
      conv?.advanceShiftId,
      cov?.coverageSourceShiftId,
      conv?.coverageSourceShiftId,
      cov?.sourceShiftId,
    );
  }
  return '';
}

export function gapShiftId(cov) {
  return String(cov?.absenceShiftId || cov?.titularShiftId || cov?.coveredShiftId || '').trim();
}

function pad(n) {
  return String(n).padStart(2, '0');
}

export function fmtHm(ms) {
  if (!ms) return '—';
  const d = new Date(ms - AR_OFFSET_MS);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function fmtWindow(start, end) {
  if (!start || !end) return '—';
  const a = arYmd(start);
  const b = arYmd(end);
  if (a === b) return `${fmtHm(start)}–${fmtHm(end)}`;
  const da = `${a.slice(8, 10)}/${a.slice(5, 7)}`;
  const db = `${b.slice(8, 10)}/${b.slice(5, 7)}`;
  return `${da} ${fmtHm(start)}–${db} ${fmtHm(end)}`;
}

function manual(reason) {
  return { action: 'manual', reason, joinOk: false, proposedStart: 0, proposedEnd: 0 };
}

function sourceReject(row) {
  if (row.sourceMissing) return 'turno fuente inexistente';
  if (!row.sourceId) return 'sin turno fuente vinculado';
  const source = row.source;
  if (!source) return 'sin turno fuente vinculado';
  const code = norm(source.code);
  if (isLicenseShiftCode(code)) return `fuente es licencia (${code})`;
  if (source.isFranco === true || isFrancoShiftCode(code)) return `fuente es franco (${code || 'F'})`;
  if (code === 'RET' || code === 'REF' || code === 'ESC' || code === 'FT') {
    return `fuente ${code} no es turno a extender o adelantar`;
  }
  if (!WORK_CODES.has(code)) return `fuente ${code || 'sin código'} no es turno de trabajo`;
  if (!source.startMs || !source.endMs || source.endMs <= source.startMs) return 'turno fuente sin horario';
  return '';
}

function aligned(row, start, end) {
  return Math.abs(row.covStart - start) <= ALIGN_TOL_MS && Math.abs(row.covEnd - end) <= ALIGN_TOL_MS;
}

function assessOne(row) {
  const gap = row.gap;
  if (!gap?.startMs || !gap?.endMs || gap.endMs <= gap.startMs) {
    return manual('sin hueco del titular');
  }
  const rejected = sourceReject(row);
  if (rejected) return manual(rejected);
  const source = row.source;
  const dur = row.covEnd - row.covStart;
  if (!(dur > 0)) return manual('cobertura sin duración');

  if (row.type === 'EXTEND') {
    const joinOk = Math.abs(source.endMs - gap.startMs) <= JOIN_TOL_MS;
    if (!joinOk && arYmd(source.endMs) !== arYmd(gap.startMs)) {
      return manual('fuente en otro día (no termina en el inicio del hueco)');
    }
    const start = joinOk ? source.endMs : gap.startMs;
    let end = start + dur;
    const capAt = (source.realStartMs || source.startMs) + HARD_CAP_MS;
    end = Math.min(end, gap.endMs, capAt);
    if (end <= start) return manual('la extensión no entra en el hueco sin pasar el tope 12:59');
    if (aligned(row, start, end)) {
      return { action: 'ok', reason: '', joinOk, proposedStart: start, proposedEnd: end };
    }
    return { action: 'propose', reason: '', joinOk, proposedStart: start, proposedEnd: end };
  }

  if (row.type === 'ADVANCE') {
    const joinOk = Math.abs(source.startMs - gap.endMs) <= JOIN_TOL_MS;
    if (!joinOk) {
      const otherDay = arYmd(source.startMs) !== arYmd(gap.endMs);
      return manual(otherDay
        ? 'fuente en otro día (no empieza en el fin del hueco)'
        : 'fuente no contigua al fin del hueco');
    }
    const end = source.startMs;
    let start = end - dur;
    const earliest = source.endMs - HARD_CAP_MS;
    if (start < gap.startMs) start = gap.startMs;
    if (start < earliest) start = earliest;
    if (start >= end) return manual('el adelanto no entra en el hueco sin pasar el tope 12:59');
    if (aligned(row, start, end)) {
      return { action: 'ok', reason: '', joinOk: true, proposedStart: start, proposedEnd: end };
    }
    return { action: 'propose', reason: '', joinOk: true, proposedStart: start, proposedEnd: end };
  }

  return manual('tipo distinto de EXT/ADV');
}

function rangesOverlap(a0, a1, b0, b1) {
  return a0 < b1 && b0 < a1;
}

/**
 * @param {Array<{
 *   id: string, type: 'EXTEND'|'ADVANCE', employeeId?: string, name?: string,
 *   covStart: number, covEnd: number, sourceId?: string, sourceMissing?: boolean,
 *   source?: { startMs: number, endMs: number, code?: string, isFranco?: boolean, realStartMs?: number } | null,
 *   gap?: { startMs: number, endMs: number, employeeName?: string, positionName?: string } | null,
 * }>} rows
 */
export function assessOpsCovWindows(rows) {
  const out = rows.map((row) => ({ ...row, ...assessOne(row) }));
  const byEmp = new Map();
  for (const row of out) {
    const id = String(row.employeeId || '').trim();
    if (!id) continue;
    const list = byEmp.get(id) || [];
    list.push(row);
    byEmp.set(id, list);
  }
  for (const list of byEmp.values()) {
    if (list.length < 2) continue;
    for (const row of list) {
      if (row.joinOk || row.action === 'ok' || row.action === 'propose') continue;
      const siblingOk = list.some((other) => other !== row && other.joinOk);
      if (!siblingOk) continue;
      if (!String(row.reason).startsWith('fuente no contigua') && !String(row.reason).includes('otro día')) {
        continue;
      }
      const who = row.gap?.employeeName || 'el titular';
      const pos = row.gap?.positionName || 'el puesto';
      row.action = 'anular';
      row.proposedStart = 0;
      row.proposedEnd = 0;
      row.reason = `anular la cobertura de ${who} (${pos}): no es contigua al hueco`;
    }
    const proposing = list.filter((row) => row.action === 'propose');
    for (const row of proposing) {
      const hit = proposing.some((other) => other !== row && rangesOverlap(
        row.proposedStart,
        row.proposedEnd,
        other.proposedStart,
        other.proposedEnd,
      ));
      if (!hit) continue;
      row.action = 'manual';
      row.proposedStart = 0;
      row.proposedEnd = 0;
      row.reason = 'doble cobertura del mismo guardia en la misma franja';
    }
  }
  return out;
}

export function verdictLabel(row) {
  if (row.action === 'anular') return 'ANULAR';
  if (row.action === 'manual') return 'REVISIÓN MANUAL';
  if (row.action === 'propose') return fmtWindow(row.proposedStart, row.proposedEnd);
  return fmtWindow(row.covStart, row.covEnd);
}
