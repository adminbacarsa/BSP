import { relieverFor } from '@cosp/ops-core';
import type { RetentionWaitInfo } from '@cosp/ops-core';
import { canRevertAbsenceNow } from '@/lib/operaciones/revertAbsenceWindow';
import { guardTone, type GuardFlags } from '@/lib/movil/guardTone';

/**
 * Acciones de la hoja inferior de la tarjeta del guardia en el celular.
 * Solo decide QUÉ se ofrece según el estado; cada acción llama a la misma
 * callable/función que usa el escritorio (registrarPresencia, CHECKOUT,
 * marcarAusenciaOperaciones, revertirAusencia, protocolo de cobertura,
 * avisarGuardiaOperaciones).
 */
export type GuardAccionId =
  | 'AVISAR_ENTRANTE'
  | 'AVISAR_RETENIDO'
  | 'INGRESO'
  | 'SALIDA'
  | 'LIBERAR'
  | 'RETENCION'
  | 'AUSENTE'
  | 'LLEGO'
  | 'PROTOCOLO';

export interface GuardAccion {
  id: GuardAccionId;
  label: string;
  /** Texto corto bajo la etiqueta. */
  hint: string;
  tone: 'go' | 'pri' | 'warn' | 'danger' | 'neutral';
  /** Pregunta de confirmación (null = sin confirmación, ej. abrir el protocolo). */
  confirm: string | null;
  /** Turno al que apunta el aviso (el entrante cuando se avisa desde el retenido). */
  targetShiftId?: string;
  /** Turno relacionado (el entrante cuando se avisa al retenido). */
  relatedShiftId?: string;
}

export interface GuardAccionShift extends GuardFlags {
  id: string;
  employeeName?: string;
  positionName?: string;
  shiftDateObj?: Date | string | null;
  endDateObj?: Date | string | null;
  startTime?: unknown;
  status?: string;
  isPendingClose?: boolean;
  isProvisionalLateAbsence?: boolean;
  operacionallyCovered?: boolean;
  coverageStatus?: string;
  isFranco?: boolean;
  draft?: boolean;
  isVirtual?: boolean;
  retentionWait?: RetentionWaitInfo | null;
  /** Último aviso manual desde el CC (cooldown 5 min, lo escribe el servidor). */
  opsAvisoManualAt?: unknown;
  [key: string]: unknown;
}

/** Quién tiene que relevar al retenido (todavía sin fichar). */
export interface GuardEntrante {
  id: string;
  nombre: string;
  /** El entrante ya está marcado ausente: se le puede avisar igual (hasta T+60 se revierte). */
  ausente: boolean;
}

function startMs(shift: GuardAccionShift): number {
  const raw = shift.shiftDateObj;
  if (raw instanceof Date) return raw.getTime();
  if (typeof raw === 'string') {
    const parsed = new Date(raw).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toMs(value: unknown): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : 0;
  }
  const v = value as { toMillis?: () => number; seconds?: number };
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  return 0;
}

/** Ventana del ingreso manual desde Operaciones: desde T−60 (Ops no tiene ventana de fichada hacia adelante). */
const INGRESO_DESDE_MS = 60 * 60 * 1000;

/** Espejo de `AVISO_MANUAL_COOLDOWN_MS` (functions/src/ops/avisarGuardiaOperaciones.ts). */
export const AVISO_MANUAL_COOLDOWN_MS = 5 * 60 * 1000;

/** Segundos que faltan para poder volver a avisar a ese guardia (0 = se puede). */
export function avisoManualRestanteSeg(shift: { opsAvisoManualAt?: unknown }, nowMs: number = Date.now()): number {
  const last = toMs(shift.opsAvisoManualAt);
  if (!last) return 0;
  const rest = last + AVISO_MANUAL_COOLDOWN_MS - nowMs;
  return rest > 0 ? Math.ceil(rest / 1000) : 0;
}

function esRetenido(shift: GuardAccionShift): boolean {
  const presente = shift.isPresent === true && shift.isCompleted !== true;
  return presente && (shift.isRetention === true || shift.isPendingRetention === true || shift.isPendingClose === true);
}

/**
 * Entrante del retenido: el relevo de la serie que todavía no fichó (`retentionWait.reliever`
 * del hook, o `relieverFor` sobre los hermanos del objetivo). Presente → null (ya llegó).
 */
export function entranteDelRetenido(shift: GuardAccionShift, siblings: readonly GuardAccionShift[] = []): GuardEntrante | null {
  if (!esRetenido(shift)) return null;
  const rel = shift.retentionWait?.reliever;
  if (rel) {
    if (rel.status === 'PRESENTE' || !rel.id) return null;
    return { id: rel.id, nombre: rel.employeeName, ausente: rel.status === 'AUSENTE' };
  }
  const pool = siblings.filter((row) => row && row.id !== shift.id && !row.isUnassigned && !row.isCompleted);
  const presentes = pool.filter((row) => row.isPresent && !row.realEndTime);
  const quien = relieverFor(shift as never, pool as never, { peers: presentes as never, roster: siblings as never }) as GuardAccionShift | null;
  if (!quien || quien.isPresent) return null;
  return { id: quien.id, nombre: String(quien.employeeName || 'relevo').trim(), ausente: quien.isAbsent === true };
}

export function accionesParaTurno(shift: GuardAccionShift, nowMs: number = Date.now(), siblings: readonly GuardAccionShift[] = []): GuardAccion[] {
  if (!shift || shift.isFranco || shift.draft) return [];
  const nombre = shift.employeeName || 'el guardia';
  const puesto = String(shift.positionName || 'el puesto').trim();
  const tone = guardTone(shift);
  const presente = shift.isPresent === true && shift.isCompleted !== true;
  const retenido = esRetenido(shift);
  const inicio = startMs(shift);
  const empezo = inicio > 0 && nowMs >= inicio;
  const out: GuardAccion[] = [];

  if (shift.isUnassigned) {
    out.push({ id: 'PROTOCOLO', label: 'Cubrir hueco', hint: 'Candidatos en orden · convocar', tone: 'pri', confirm: null });
    return out;
  }

  const puedeRevertir = canRevertAbsenceNow(shift, nowMs);
  // Guardia que no llegó (tarde, o ausente todavía reversible): el aviso por la app va primero; llamar es el último recurso.
  if (!presente && !shift.isCompleted && (tone === 'late' || (tone === 'aus' && puedeRevertir))) {
    out.push({
      id: 'AVISAR_ENTRANTE',
      label: `Avisar a ${nombre} por la app`,
      hint: 'Push «¿venís?» · responde 10/15/30 min o «tengo un problema»',
      tone: 'pri',
      confirm: `¿Avisar a ${nombre} por la app que lo esperan en ${puesto}?`,
      targetShiftId: shift.id,
    });
  }

  if (puedeRevertir) {
    out.push({ id: 'LLEGO', label: 'Llegó · revertir ausencia', hint: 'Hasta T+60 · revertirAusencia', tone: 'go', confirm: `¿${nombre} llegó? Se revierte la ausencia.` });
  }
  if (tone === 'aus') {
    out.push({ id: 'PROTOCOLO', label: 'Cubrir hueco', hint: shift.operacionallyCovered ? 'Ya tiene cobertura · ver protocolo' : 'Candidatos en orden · convocar', tone: 'pri', confirm: null });
  }

  if (!presente && !shift.isAbsent && !shift.isCompleted && (tone === 'plan' || tone === 'late')) {
    if (inicio > 0 && nowMs >= inicio - INGRESO_DESDE_MS) {
      out.push({ id: 'INGRESO', label: 'Marcar ingreso', hint: 'Relevo de la serie (registrarPresencia)', tone: 'go', confirm: `¿Registrar el ingreso de ${nombre}?` });
    }
    if (empezo) {
      out.push({ id: 'AUSENTE', label: 'Marcar ausente', hint: 'AA + vacante (marcarAusenciaOperaciones)', tone: 'danger', confirm: `¿Declarar ausente a ${nombre}? Abre la vacante y el protocolo.` });
    }
  }

  if (retenido) {
    const entrante = entranteDelRetenido(shift, siblings);
    if (entrante) {
      out.push({
        id: 'AVISAR_ENTRANTE',
        label: `Avisar a ${entrante.nombre} por la app`,
        hint: entrante.ausente ? 'Relevo marcado ausente · push «¿venís?» igual' : 'Push «te esperan, ¿venís?» · responde 10/15/30 min o problema',
        tone: 'pri',
        confirm: `¿Avisar a ${entrante.nombre} por la app que lo esperan en ${puesto}?`,
        targetShiftId: entrante.id,
        relatedShiftId: shift.id,
      });
    }
    out.push({ id: 'LIBERAR', label: 'Liberar retenido', hint: 'Salida ahora (CHECKOUT)', tone: 'warn', confirm: `¿Liberar a ${nombre}? Se registra la salida ahora.` });
    out.push({ id: 'RETENCION', label: 'Extender retención', hint: '+1 h · +2 h · +4 h · tope 12:59', tone: 'neutral', confirm: null });
    out.push({
      id: 'AVISAR_RETENIDO',
      label: `Avisar a ${nombre}`,
      hint: entrante ? `Push «seguís retenido, ${entrante.nombre} llega ~HH:MM / no llegó»` : 'Push «seguís retenido, sin relevo confirmado»',
      tone: 'neutral',
      confirm: `¿Avisar a ${nombre} por la app que sigue retenido?`,
      targetShiftId: shift.id,
      relatedShiftId: entrante?.id,
    });
  } else if (presente) {
    out.push({ id: 'SALIDA', label: 'Salida · relevo', hint: 'Cierra el turno (CHECKOUT)', tone: 'warn', confirm: `¿Registrar la salida de ${nombre}?` });
  }

  return out;
}

export function accionPorId(shift: GuardAccionShift, id: GuardAccionId, nowMs: number = Date.now(), siblings: readonly GuardAccionShift[] = []): GuardAccion | null {
  return accionesParaTurno(shift, nowMs, siblings).find((a) => a.id === id) || null;
}
