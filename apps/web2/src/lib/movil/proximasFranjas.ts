import { guardTone } from '@/lib/movil/guardTone';
import { hhmmAR, type GuardDetalleShift } from '@/lib/movil/guardDetalle';

/**
 * «Próximas 3 horas» del celular: franjas que entran en (ahora, ahora + 3 h] agrupadas por
 * objetivo → puesto → hora de inicio. Cada franja dice quién está confirmado, quién no
 * respondió y si no hay nadie (vacante o todos ausentes) para abrir el protocolo.
 * Lógica pura sobre los turnos visibles del monitor (sin consultas nuevas).
 */
export const PROXIMAS_HORAS_MS = 3 * 60 * 60 * 1000;

export type FranjaEstadoGuardia = 'CONFIRMADO' | 'SIN_CONFIRMAR' | 'AUSENTE';

export interface FranjaGuardia {
  shiftId: string;
  nombre: string;
  code: string;
  estado: FranjaEstadoGuardia;
  /** Hora de la respuesta/fichada que confirma (HH:MM) cuando existe. */
  hora: string | null;
}

export interface ProximaFranja {
  key: string;
  objectiveId: string;
  objetivo: string;
  cliente: string;
  puesto: string;
  code: string;
  startMs: number;
  /** HH:MM del inicio. */
  hora: string;
  /** Minutos desde ahora hasta el inicio. */
  enMin: number;
  guardias: FranjaGuardia[];
  confirmados: number;
  sinConfirmar: number;
  /** Nadie va a estar: vacante o todos ausentes. */
  sinNadie: boolean;
  /** Turno sobre el que se abre el protocolo (vacante o el ausente). */
  cubrirShift: GuardDetalleShift | null;
}

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

/**
 * Confirmado = ya fichó, pidió fichar, o respondió al aviso de llegada (T−5 / ¿venís?):
 * `lateArrivalConfirmedAt`, `lateArrivalAt` (avisó demora) o `checkInRequestedAt`.
 */
export function estadoGuardiaFranja(shift: GuardDetalleShift): { estado: FranjaEstadoGuardia; hora: string | null } {
  if (shift.isAbsent || shift.isPotentialAbsence) return { estado: 'AUSENTE', hora: null };
  if (shift.isPresent) {
    const ms = toMs(shift.checkInAt) || toMs(shift.realStartTime) || toMs(shift.checkInTime);
    return { estado: 'CONFIRMADO', hora: ms ? hhmmAR(ms) : null };
  }
  const respondido = toMs(shift.lateArrivalConfirmedAt as TsLike) || toMs(shift.lateArrivalAt as TsLike) || toMs(shift.checkInRequestedAt as TsLike);
  if (respondido) return { estado: 'CONFIRMADO', hora: hhmmAR(respondido) };
  return { estado: 'SIN_CONFIRMAR', hora: null };
}

function esTurnoDeFranja(shift: GuardDetalleShift): boolean {
  if (!shift || shift.draft || shift.isFranco || shift.isCompleted) return false;
  if (shift.coverageHoursOnSource) return false;
  const code = String(shift.code || '').toUpperCase();
  if (['F', 'FF', 'FP', 'V', 'L', 'E', 'A', 'ART', 'AA', 'PG', 'SGS', 'SUS'].includes(code)) return false;
  return true;
}

export function proximasFranjas(shifts: readonly GuardDetalleShift[], now: Date | number = Date.now(), horizonteMs: number = PROXIMAS_HORAS_MS): ProximaFranja[] {
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const grupos = new Map<string, ProximaFranja>();
  for (const shift of shifts) {
    if (!esTurnoDeFranja(shift)) continue;
    const startMs = toMs(shift.shiftDateObj || shift.startTime);
    if (!startMs || startMs <= nowMs || startMs > nowMs + horizonteMs) continue;
    const objectiveId = String(shift.objectiveId || '');
    const puesto = String(shift.positionName || 'Puesto').trim();
    const code = String(shift.isUnassigned ? shift.vacancyBand || shift.code : shift.code || shift.vacancyBand || '').trim().toUpperCase();
    const key = `${objectiveId}|${puesto}|${startMs}`;
    let franja = grupos.get(key);
    if (!franja) {
      franja = {
        key,
        objectiveId,
        objetivo: String(shift.objectiveName || shift.clientName || 'Objetivo').trim(),
        cliente: String(shift.clientName || '').trim(),
        puesto,
        code,
        startMs,
        hora: hhmmAR(startMs),
        enMin: Math.max(0, Math.round((startMs - nowMs) / 60000)),
        guardias: [],
        confirmados: 0,
        sinConfirmar: 0,
        sinNadie: false,
        cubrirShift: null,
      };
      grupos.set(key, franja);
    }
    if (shift.isUnassigned) {
      franja.sinNadie = true;
      franja.cubrirShift = franja.cubrirShift || shift;
      continue;
    }
    const { estado, hora } = estadoGuardiaFranja(shift);
    franja.guardias.push({ shiftId: shift.id, nombre: String(shift.employeeName || 'Sin nombre').trim(), code: String(shift.code || '').toUpperCase(), estado, hora });
    if (estado === 'CONFIRMADO') franja.confirmados += 1;
    else if (estado === 'SIN_CONFIRMAR') franja.sinConfirmar += 1;
    else if (!franja.cubrirShift && guardTone(shift) === 'aus') franja.cubrirShift = shift;
  }
  const out = Array.from(grupos.values());
  for (const franja of out) {
    const vivos = franja.guardias.filter((g) => g.estado !== 'AUSENTE').length;
    if (vivos === 0) franja.sinNadie = true;
    if (franja.sinNadie && !franja.cubrirShift) {
      const ausente = franja.guardias.find((g) => g.estado === 'AUSENTE');
      franja.cubrirShift = ausente ? (shifts.find((s) => s.id === ausente.shiftId) || null) : null;
    }
    // Sin nadie va primero; después por hora.
  }
  out.sort((a, b) => (Number(b.sinNadie) - Number(a.sinNadie)) || a.startMs - b.startMs || a.objetivo.localeCompare(b.objetivo) || a.puesto.localeCompare(b.puesto));
  return out;
}

export interface ProximasResumen {
  franjas: number;
  confirmados: number;
  sinConfirmar: number;
  sinNadie: number;
}

export function resumenProximas(franjas: readonly ProximaFranja[]): ProximasResumen {
  return franjas.reduce<ProximasResumen>((acc, f) => ({
    franjas: acc.franjas + 1,
    confirmados: acc.confirmados + f.confirmados,
    sinConfirmar: acc.sinConfirmar + f.sinConfirmar,
    sinNadie: acc.sinNadie + (f.sinNadie ? 1 : 0),
  }), { franjas: 0, confirmados: 0, sinConfirmar: 0, sinNadie: 0 });
}

/** «Próximas 3 h · 4 franjas · 3 ok · 1 sin confirmar · 1 sin nadie». */
export function etiquetaProximas(resumen: ProximasResumen): string {
  if (resumen.franjas === 0) return 'Próximas 3 h · sin relevos';
  const partes = [`${resumen.franjas} ${resumen.franjas === 1 ? 'franja' : 'franjas'}`];
  if (resumen.confirmados) partes.push(`${resumen.confirmados} ok`);
  if (resumen.sinConfirmar) partes.push(`${resumen.sinConfirmar} sin confirmar`);
  if (resumen.sinNadie) partes.push(`${resumen.sinNadie} sin nadie`);
  return `Próximas 3 h · ${partes.join(' · ')}`;
}
