import { formatRetentionDuration, outgoingFor, relevoAusenteAviso, relieverFor, seriesBoundMs } from '@cosp/ops-core';
import type { RetentionWaitInfo } from '@cosp/ops-core';
import { formatIngresoLine } from '@/lib/operaciones/ingresoLabel';
import { convocadoEnCaminoLabel } from '@/lib/operaciones/convocadoVentana';
import { formatOpsNotaLine, type OpsNota } from '@/lib/operaciones/opsNota';
import { guardTone, type GuardFlags } from '@/lib/movil/guardTone';
import { isEventShift } from '@/lib/operaciones/eventoCc';

type TsLike = { seconds?: number; toMillis?: () => number; toDate?: () => Date } | Date | string | number | null | undefined;

/** Turno tal como lo entrega `useOperacionesMonitor` (mismos campos que lee la GuardCard del escritorio). */
export interface GuardDetalleShift extends GuardFlags {
  id: string;
  objectiveId?: string;
  employeeId?: string;
  employeeName?: string;
  code?: string;
  positionName?: string;
  objectiveName?: string;
  clientName?: string;
  shiftDateObj?: Date | string | null;
  endDateObj?: Date | string | null;
  startTime?: TsLike;
  endTime?: TsLike;
  phone?: string | null;
  checkInAt?: TsLike;
  checkInTime?: TsLike;
  realStartTime?: TsLike;
  vacancyBand?: string | null;
  isProvisionalLateAbsence?: boolean;
  isPendingClose?: boolean;
  /** «CIERRA HH:MM · sin franja siguiente»: fin vencido sin continuidad. No es retención. */
  cierreSinFranja?: string | null;
  retentionWait?: RetentionWaitInfo | null;
  lateArrivalEtaLabel?: string | null;
  /** HH:MM de la respuesta del guardia al aviso (classifyOpsShift). */
  lateArrivalRespondedLabel?: string | null;
  lateArrivalEtaMinutes?: number | null;
  minutesRemainingLate?: number | null;
  expectedArrivalAt?: TsLike;
  originSource?: string;
  convocadoReminderSentAt?: TsLike;
  convocadoReply?: string;
  convocadoDemorado?: boolean;
  origin?: string;
  operacionallyCovered?: boolean;
  plannedOperativelyCovered?: boolean;
  coverageStatus?: string;
  coveredByEmployeeName?: string | null;
  coveredBy?: string | null;
  coveringDisplayName?: string | null;
  coversEmployeeName?: string | null;
  coverageType?: string | null;
  coverageSegmentRole?: string | null;
  coverageHoursOnSource?: boolean;
  coverageUsed?: boolean;
  coverageUsedLabel?: string | null;
  coverageUsedCoversEmployeeName?: string | null;
  [key: string]: unknown;
}

export interface GuardDetalle {
  nombre: string;
  code: string;
  puesto: string;
  objetivo: string;
  /** 'HH:MM–HH:MM' planificado. */
  horario: string;
  /** «Ingresó 07:12 (12 min tarde)» — solo con presencia. */
  ingreso: string | null;
  /** Estado con minutos cuando no hay ingreso o cuando está retenido. */
  estado: string | null;
  /** A quién releva al entrar (saliente de la serie). */
  relevaA: string | null;
  /** Quién lo releva al salir (o a quién espera si está retenido). */
  loReleva: string | null;
  /** EN CAMINO · llega ~HH:MM · recordatorio · DEMORADO. */
  convocatoria: string | null;
  /** Cubre a X · EXT hasta HH:MM / Cubierto por X. */
  cobertura: string | null;
  /** «Nota 15:21 · Lopez: sin llaves» (última nota del operador). */
  nota: string | null;
  telefono: string | null;
}

const TZ = 'America/Argentina/Buenos_Aires';

function toMs(value: TsLike | Date | string | null | undefined): number {
  if (!value) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 0 : value.getTime();
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : 0;
  }
  if (typeof value.toMillis === 'function') return value.toMillis() || 0;
  if (typeof value.toDate === 'function') return value.toDate().getTime() || 0;
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  return 0;
}

export function hhmmAR(value: TsLike | Date | string | null | undefined): string {
  const ms = toMs(value);
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TZ });
}

export function horarioPlanificado(shift: { shiftDateObj?: Date | string | null; endDateObj?: Date | string | null; startTime?: TsLike; endTime?: TsLike }): string {
  const start = hhmmAR(shift.shiftDateObj || shift.startTime);
  const end = hhmmAR(shift.endDateObj || shift.endTime);
  if (start && end) return `${start}–${end}`;
  return start || '—';
}

function minutosDesde(ms: number, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - ms) / 60000));
}

/** Misma lectura que `formatCoveringEmployeeLabel` (lib/operaciones/syncAusenciaCobertura, que importa Firebase). */
function nombreCubridor(shift: GuardDetalleShift): string | null {
  const preset = String(shift.coveringDisplayName || '').trim();
  if (preset) return preset;
  const raw = String(shift.coveredByEmployeeName || shift.coveredBy || '').trim();
  if (!raw) return null;
  return raw.replace(/\s*\([^)]*\)\s*$/, '').trim() || raw;
}

function titularCubierto(shift: GuardDetalleShift): boolean {
  if (!shift.isAbsent) return false;
  return !!(shift.operacionallyCovered || shift.plannedOperativelyCovered || String(shift.coverageStatus || '').toUpperCase() === 'COVERED');
}

function etiquetaRelevo(row: GuardDetalleShift): string {
  const code = String(row.code || '').trim().toUpperCase();
  const start = hhmmAR(row.shiftDateObj || row.startTime);
  const name = String(row.employeeName || 'relevo').trim();
  return `${name}${code ? ` · ${code}` : ''}${start ? ` ${start}` : ''}`;
}

function estadoDe(shift: GuardDetalleShift, nowMs: number): string | null {
  const cierre = String(shift.cierreSinFranja || '').trim();
  if (cierre) return cierre;
  const startMs = toMs(shift.shiftDateObj || shift.startTime);
  const tone = guardTone(shift);
  if (tone === 'ret') {
    const wait = shift.retentionWait;
    if (wait) {
      const parts = [
        `${shift.isRetention ? 'Retenido' : 'Esperando relevo'} desde ${hhmmAR(wait.sinceMs)}`,
        formatRetentionDuration(wait.elapsedMinutes),
      ];
      if (wait.capAtMs > 0) parts.push(`tope ${hhmmAR(wait.capAtMs)}`);
      return parts.join(' · ');
    }
    const mins = Number(shift.retentionMinutes || 0);
    const endMs = toMs(shift.endDateObj || shift.endTime);
    return `Retenido${endMs ? ` desde ${hhmmAR(endMs)}` : ''}${mins > 0 ? ` · ${formatRetentionDuration(mins)}` : ''}`;
  }
  if (tone === 'ok') return null;
  if (tone === 'aus') {
    const desde = startMs ? ` desde ${hhmmAR(startMs)}` : '';
    if (shift.isProvisionalLateAbsence) return `No llegó${desde} · posible ausencia`;
    if (shift.isPotentialAbsence && !shift.isAbsent) return `No llegó${desde} · ausencia`;
    return `No llegó${desde} · ausente`;
  }
  if (tone === 'late') {
    const mins = startMs ? minutosDesde(startMs, nowMs) : 0;
    if (shift.isLateNotified) {
      const eta = shift.lateArrivalEtaLabel ? ` · llega ~${shift.lateArrivalEtaLabel}` : '';
      // Hora de la respuesta del guardia al aviso (¿venís? / avisó demora): misma fuente que el escritorio.
      const respondidoMs = toMs(shift.lateArrivalConfirmedAt as TsLike) || toMs(shift.lateArrivalAt as TsLike);
      const respondido = shift.lateArrivalRespondedLabel
        ? ` · respondió ${shift.lateArrivalRespondedLabel}`
        : respondidoMs ? ` · respondió ${hhmmAR(respondidoMs)}` : '';
      return `Tarde ${mins} min · avisó${eta}${respondido}`;
    }
    return `Tarde ${mins} min · sin aviso`;
  }
  if (tone === 'vac') {
    const band = String(shift.vacancyBand || shift.code || '').trim();
    const desde = startMs && startMs <= nowMs ? ` · desde ${hhmmAR(startMs)}` : startMs ? ` · entra ${hhmmAR(startMs)}` : '';
    return `Vacante${band ? ` ${band}` : ''}${desde}`;
  }
  if (startMs) return `Entra ${hhmmAR(startMs)}`;
  return null;
}

function coberturaDe(shift: GuardDetalleShift): string | null {
  const role = String(shift.coverageSegmentRole || '').toUpperCase();
  const cubreA = String(shift.coversEmployeeName || shift.coverageUsedCoversEmployeeName || '').trim();
  const esOpsCov = String(shift.origin || '').toUpperCase() === 'OPERATIONS_COVERAGE' || !!shift.coversEmployeeName;
  if (esOpsCov) {
    const tipo = String(shift.coverageType || '').toUpperCase();
    const partes: string[] = [];
    if (role === 'EXTENSION') partes.push(`EXT hasta ${hhmmAR(shift.endDateObj || shift.endTime)}`);
    else if (role === 'EARLY_START') partes.push(`ADV desde ${hhmmAR(shift.shiftDateObj || shift.startTime)}`);
    else if (tipo && !['COBERTURA', 'OPERATIONS_COVERAGE'].includes(tipo)) partes.push(tipo);
    if (cubreA) partes.push(`cubre a ${cubreA}`);
    return partes.length ? partes.join(' · ') : null;
  }
  if (shift.coverageUsed) {
    const label = String(shift.coverageUsedLabel || '').trim();
    if (label) return label;
    return cubreA ? `Cubre a ${cubreA}` : 'Cobertura asignada';
  }
  if (titularCubierto(shift)) {
    const quien = nombreCubridor(shift);
    return quien ? `Cubierto por ${quien}` : 'Cubierto desde el CC';
  }
  return null;
}

/**
 * Detalle compacto de la tarjeta del guardia en el celular. Misma información que la
 * GuardCard del escritorio (`pages/admin/operaciones/index.tsx`), menos texto.
 * `siblings` = turnos del mismo objetivo (para la serie de relevo).
 */
export function guardDetalle(shift: GuardDetalleShift, siblings: readonly GuardDetalleShift[] = [], now: Date | number = Date.now()): GuardDetalle {
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const tone = guardTone(shift);
  const isVacante = !!shift.isUnassigned;
  const nombre = isVacante
    ? `VACANTE${shift.vacancyBand ? ` · ${shift.vacancyBand}` : ''}`
    : String(shift.employeeName || 'Sin nombre').trim();

  const pool = siblings.filter((row) => row && row.id !== shift.id && !row.isUnassigned && !row.isCompleted);
  // FIFO: los otros presentes del puesto son pares del saliente; los que entran, pares del entrante.
  const presentes = pool.filter((row) => row.isPresent && !row.realEndTime);
  const avisoRelevo = relevoAusenteAviso(shift, siblings, now);
  const quienLoReleva = tone === 'ret' && shift.retentionWait
    ? null
    : avisoRelevo
      ? null
      : relieverFor(shift, pool, { peers: presentes, roster: siblings });
  const aQuienReleva = isVacante ? null : outgoingFor(shift, pool, { peers: pool, roster: siblings });

  let loReleva: string | null = null;
  if (String(shift.cierreSinFranja || '').trim()) {
    loReleva = null;
  } else if (tone === 'ret' && shift.retentionWait) {
    const rel = shift.retentionWait.reliever;
    if (!rel) loReleva = 'Sin relevo planificado → vacante';
    else if (rel.status === 'AUSENTE') loReleva = `Relevo ausente: ${rel.employeeName}${rel.code ? ` · ${rel.code}` : ''} ${hhmmAR(rel.startMs)}`;
    else if (rel.status === 'PRESENTE') loReleva = `Lo releva ${rel.employeeName}${rel.code ? ` · ${rel.code}` : ''} ${hhmmAR(rel.startMs)} · ya fichó`;
    else loReleva = `Espera a ${rel.employeeName}${rel.code ? ` · ${rel.code}` : ''} ${hhmmAR(rel.startMs)}`;
  } else if (avisoRelevo) {
    loReleva = avisoRelevo;
  } else if (quienLoReleva) {
    loReleva = `Lo releva ${etiquetaRelevo(quienLoReleva)}`;
  }

  const relevaA = aQuienReleva
    ? `Releva a ${String(aQuienReleva.employeeName || 'saliente').trim()}${aQuienReleva.code ? ` · ${String(aQuienReleva.code).toUpperCase()}` : ''} ${hhmmAR(aQuienReleva.endDateObj || aQuienReleva.endTime) || hhmmAR(seriesBoundMs(aQuienReleva, 'end'))}`.trim()
    : null;

  const plannedStartMs = toMs(shift.shiftDateObj || shift.startTime);
  const ingreso = shift.isPresent && !isVacante
    ? formatIngresoLine({
      checkInAt: toMs(shift.checkInAt) || undefined,
      checkInTime: toMs(shift.checkInTime) || undefined,
      realStartTime: toMs(shift.realStartTime) || undefined,
      shiftDateObj: plannedStartMs ? new Date(plannedStartMs) : null,
    })
    : null;
  const telefono = String(shift.phone || '').trim() || null;
  const convocatoria = isVacante
    ? null
    : convocadoEnCaminoLabel({
      isPresent: shift.isPresent,
      isCompleted: shift.isCompleted,
      expectedArrivalAt: toMs(shift.expectedArrivalAt) || undefined,
      originSource: shift.originSource,
      convocadoReminderSentAt: toMs(shift.convocadoReminderSentAt) || undefined,
      convocadoReply: shift.convocadoReply,
      convocadoDemorado: shift.convocadoDemorado,
    });

  return {
    nombre,
    code: String(shift.code || '').trim().toUpperCase() || '—',
    puesto: String(shift.positionName || 'Puesto').trim(),
    // EV: el lugar del evento (lo resuelve el monitor), nunca el objetivo de base del guardia.
    objetivo: isEventShift(shift)
      ? String(shift.eventoLugar || shift.eventoObjectiveName || shift.eventoNombre || shift.clientName || '').trim()
      : String(shift.objectiveName || shift.clientName || '').trim(),
    horario: horarioPlanificado(shift),
    ingreso,
    estado: estadoDe(shift, nowMs),
    relevaA,
    loReleva,
    convocatoria,
    cobertura: coberturaDe(shift),
    nota: formatOpsNotaLine(shift.opsNota as Partial<OpsNota> | null | undefined),
    telefono,
  };
}

/** Próxima franja que entra en el objetivo: «Próximo relevo 15:00 · T». */
export function proximoRelevo(shifts: readonly GuardDetalleShift[], now: Date | number = Date.now()): string | null {
  const nowMs = typeof now === 'number' ? now : now.getTime();
  let best: { ms: number; code: string; vacante: boolean } | null = null;
  for (const row of shifts) {
    if (!row || row.isPresent || row.isAbsent || row.isCompleted || row.isRetention) continue;
    const ms = toMs(row.shiftDateObj || row.startTime);
    if (!ms || ms <= nowMs) continue;
    const code = row.isUnassigned ? row.vacancyBand || row.code : row.code || row.vacancyBand;
    if (!best || ms < best.ms) best = { ms, code: String(code || '').trim().toUpperCase(), vacante: !!row.isUnassigned };
  }
  if (!best) return null;
  return `Próximo relevo ${hhmmAR(best.ms)}${best.code ? ` · ${best.code}` : ''}${best.vacante ? ' · VACANTE' : ''}`;
}
