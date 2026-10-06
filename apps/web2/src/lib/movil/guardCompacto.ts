import { deploymentCodeLabel, outgoingFor, relevoAusenteAviso, relieverFor, seriesBoundMs } from '@cosp/ops-core';
import { guardTone, type GuardTone } from '@/lib/movil/guardTone';
import { hhmmAR, horarioPlanificado, type GuardDetalleShift } from '@/lib/movil/guardDetalle';
import { normalizarNota } from '@/lib/operaciones/opsNota';
import { textoSinNotificacionesDe } from '@/lib/operaciones/pushAviso';

/**
 * Datos de la tarjeta compacta del guardia (celular): dos filas con íconos, sin textos
 * largos. El detalle completo (retención, relevo, cobertura) va en la hoja de acciones.
 */
export type GuardEstadoCompacto = 'activo' | 'retenido' | 'tarde' | 'ausente' | 'cubierto' | 'vacante' | 'plan' | 'cierra';

export interface GuardCompacto {
  /** «LOPEZ Hector» (apellido en mayúsculas, nombre capitalizado). */
  nombre: string;
  code: string;
  /** «P2» para «Puesto 2»; otros nombres se acortan. */
  puesto: string;
  /** «15:15–23:15». */
  horario: string;
  /** Hora de pago del ingreso y minutos de tardanza (LogIn). */
  ingreso: { hhmm: string; tardeMin: number } | null;
  /** Hora del tope 12:59 cuando está retenido (Hourglass). */
  tope: string | null;
  /** Apellido y hora de quien lo releva (saliente) o a quién releva (entrante). */
  relevo: { apellido: string; hhmm: string; sentido: 'lo_releva' | 'releva_a' } | null;
  /** Respuesta del guardia al aviso (¿venís? / avisó demora): hora y ETA (MessageSquare). */
  respuesta: { hhmm: string; eta: string | null } | null;
  /** Última nota del operador (texto corto, StickyNote). */
  nota: string | null;
  /** Antes del fin: «Relevo ausente: VENENCIA (T3 16:00) · sin cubrir». */
  avisoRelevo: string | null;
  /** Fin vencido sin franja siguiente: texto gris, no es retención. */
  cierre: string | null;
  /** Marca del escritorio que no es el código (TURA anexado al turno del guardia). */
  extra: string | null;
  /** Chip de estado a la derecha de la fila 1. */
  estado: { kind: GuardEstadoCompacto; texto: string };
  tone: GuardTone;
  telefono: string | null;
  esVacante: boolean;
  /** Tooltip si no recibe push; null si está activo o el turno no trae el dato. */
  sinAvisos: string | null;
}

/** Alto de diseño de la tarjeta compacta: 2 filas (20 + 16 px) + gap 2 + padding 16 + borde 2, más 6 px de separación. */
export const ALTO_TARJETA_COMPACTA_PX = 56 + 6;

type TsLike = GuardDetalleShift['startTime'];

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

function capitalizar(texto: string): string {
  return texto
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** «Lopez, Hector Juan» → «LOPEZ Hector Juan». Sin coma se deja como está. */
export function nombreCompacto(nombre: string | null | undefined): string {
  const raw = String(nombre || '').trim();
  if (!raw) return 'Sin nombre';
  const coma = raw.indexOf(',');
  if (coma < 0) return raw;
  const apellido = raw.slice(0, coma).trim().toUpperCase();
  const nombres = capitalizar(raw.slice(coma + 1).trim());
  return nombres ? `${apellido} ${nombres}` : apellido;
}

/** Apellido para la fila de relevo: «Lopez, Hector» → «LOPEZ»; sin coma, la primera palabra. */
export function apellidoCompacto(nombre: string | null | undefined): string {
  const raw = String(nombre || '').trim();
  if (!raw) return '—';
  const coma = raw.indexOf(',');
  const base = coma >= 0 ? raw.slice(0, coma) : raw.split(/\s+/)[0];
  return base.trim().toUpperCase();
}

/** «Puesto 2» → «P2»; «Portería» → «PORTERÍ…» (máx. 7). */
export function puestoCompacto(positionName: string | null | undefined): string {
  const raw = String(positionName || '').trim();
  if (!raw) return 'P?';
  const m = /^puesto\s*(\S+)$/i.exec(raw);
  if (m) return `P${m[1].toUpperCase()}`;
  const up = raw.toUpperCase();
  return up.length > 7 ? `${up.slice(0, 6)}…` : up;
}

/** «3:40» horas:minutos trabajados. */
export function duracionHm(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function titularCubierto(shift: GuardDetalleShift): boolean {
  if (!shift.isAbsent) return false;
  return !!(shift.operacionallyCovered || shift.plannedOperativelyCovered || String(shift.coverageStatus || '').toUpperCase() === 'COVERED');
}

function estadoDe(shift: GuardDetalleShift, tone: GuardTone, nowMs: number): GuardCompacto['estado'] {
  const cierre = String(shift.cierreSinFranja || '').trim();
  if (cierre) {
    const hm = cierre.match(/CIERRA\s+(\d{2}:\d{2})/);
    return { kind: 'cierra', texto: hm ? `CIERRA ${hm[1]}` : 'CIERRA' };
  }
  const startMs = toMs(shift.shiftDateObj || shift.startTime);
  const endMs = toMs(shift.endDateObj || shift.endTime);
  if (tone === 'ret') {
    const wait = shift.retentionWait;
    const mins = wait ? wait.elapsedMinutes : Number(shift.retentionMinutes || 0) || (endMs ? Math.max(0, Math.floor((nowMs - endMs) / 60000)) : 0);
    return { kind: 'retenido', texto: `RET ${mins}m` };
  }
  if (tone === 'ok') {
    const desde = toMs(shift.checkInAt) || toMs(shift.realStartTime) || toMs(shift.checkInTime) || startMs;
    return { kind: 'activo', texto: desde ? duracionHm(nowMs - desde) : 'ACT' };
  }
  if (tone === 'aus') {
    return titularCubierto(shift) ? { kind: 'cubierto', texto: 'CUB' } : { kind: 'ausente', texto: 'AUS' };
  }
  if (tone === 'late') {
    const mins = startMs ? Math.max(0, Math.floor((nowMs - startMs) / 60000)) : 0;
    return { kind: 'tarde', texto: `TAR ${mins}′` };
  }
  if (tone === 'vac') return { kind: 'vacante', texto: 'VAC' };
  return { kind: 'plan', texto: startMs ? hhmmAR(startMs) : 'PLAN' };
}

export function guardCompacto(shift: GuardDetalleShift, siblings: readonly GuardDetalleShift[] = [], now: Date | number = Date.now()): GuardCompacto {
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const tone = guardTone(shift);
  const esVacante = !!shift.isUnassigned;
  const nombre = esVacante
    ? `VACANTE${shift.vacancyBand ? ` · ${shift.vacancyBand}` : ''}`
    : nombreCompacto(shift.employeeName);

  const pool = siblings.filter((row) => row && row.id !== shift.id && !row.isUnassigned && !row.isCompleted);
  const presentes = pool.filter((row) => row.isPresent && !row.realEndTime);

  let relevo: GuardCompacto['relevo'] = null;
  if (tone === 'ret' && shift.retentionWait?.reliever) {
    const rel = shift.retentionWait.reliever;
    relevo = { apellido: apellidoCompacto(rel.employeeName), hhmm: hhmmAR(rel.startMs), sentido: 'lo_releva' };
  } else if (tone === 'ok' || tone === 'ret') {
    const quien = relieverFor(shift, pool, { peers: presentes });
    if (quien) relevo = { apellido: apellidoCompacto(quien.employeeName), hhmm: hhmmAR(quien.shiftDateObj || quien.startTime) || hhmmAR(seriesBoundMs(quien, 'start')), sentido: 'lo_releva' };
  } else if (!esVacante) {
    const aQuien = outgoingFor(shift, pool, { peers: pool });
    if (aQuien) relevo = { apellido: apellidoCompacto(aQuien.employeeName), hhmm: hhmmAR(aQuien.endDateObj || aQuien.endTime) || hhmmAR(seriesBoundMs(aQuien, 'end')), sentido: 'releva_a' };
  }

  const plannedStartMs = toMs(shift.shiftDateObj || shift.startTime);
  let ingreso: GuardCompacto['ingreso'] = null;
  if (shift.isPresent && !esVacante) {
    const pay = toMs(shift.realStartTime) || toMs(shift.checkInAt) || toMs(shift.checkInTime);
    if (pay) {
      const tardeMin = plannedStartMs ? Math.round((pay - plannedStartMs) / 60000) : 0;
      ingreso = { hhmm: hhmmAR(pay), tardeMin: tardeMin > 5 ? tardeMin : 0 };
    }
  }

  const cierre = String(shift.cierreSinFranja || '').trim() || null;
  const tope = !cierre && tone === 'ret' && shift.retentionWait && shift.retentionWait.capAtMs > 0 ? `tope ${hhmmAR(shift.retentionWait.capAtMs)}` : null;

  let respuesta: GuardCompacto['respuesta'] = null;
  if (!esVacante && !shift.isPresent && shift.isLateNotified) {
    const ms = toMs(shift.lateArrivalConfirmedAt as TsLike) || toMs(shift.lateArrivalAt as TsLike);
    const hhmm = String(shift.lateArrivalRespondedLabel || '').trim() || (ms ? hhmmAR(ms) : '');
    if (hhmm) respuesta = { hhmm, eta: shift.lateArrivalEtaLabel ? String(shift.lateArrivalEtaLabel) : null };
  }
  const notaRaw = shift.opsNota && typeof shift.opsNota === 'object' ? normalizarNota((shift.opsNota as { texto?: unknown }).texto) : null;

  const avisoRelevo = relevoAusenteAviso(shift, siblings, now);
  const code = deploymentCodeLabel(String(shift.code || shift.vacancyBand || ''), shift.deploymentBand) || '—';
  const type = String(shift.type || '').trim().toUpperCase();
  const extra = (shift.turaContiguous || shift.isTuraCutSegment) && code !== 'TURA'
    ? 'TURA'
    : (type === 'TURA' || type === 'RFZ') && type !== code
      ? type
      : null;

  return {
    nombre,
    code,
    puesto: puestoCompacto(shift.positionName),
    horario: horarioPlanificado(shift),
    ingreso,
    tope,
    respuesta,
    nota: notaRaw,
    cierre,
    relevo: cierre || avisoRelevo ? null : relevo,
    avisoRelevo,
    extra,
    estado: estadoDe(shift, tone, nowMs),
    tone,
    telefono: String(shift.phone || '').trim() || null,
    esVacante,
    sinAvisos: esVacante ? null : textoSinNotificacionesDe(shift),
  };
}

/**
 * Cuántas tarjetas compactas entran en la pantalla. `altoFijo` = barra superior +
 * encabezado + contadores + barra inferior (lo que no hace scroll).
 */
export function tarjetasVisibles(altoPantalla: number, altoFijo: number, altoTarjeta: number = ALTO_TARJETA_COMPACTA_PX): number {
  return Math.max(0, Math.floor((altoPantalla - altoFijo) / altoTarjeta));
}
