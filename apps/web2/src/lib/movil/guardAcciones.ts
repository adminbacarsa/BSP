import { canRevertAbsenceNow } from '@/lib/operaciones/revertAbsenceWindow';
import { guardTone, type GuardFlags } from '@/lib/movil/guardTone';

/**
 * Acciones de la hoja inferior de la tarjeta del guardia en el celular.
 * Solo decide QUÉ se ofrece según el estado; cada acción llama a la misma
 * callable/función que usa el escritorio (registrarPresencia, CHECKOUT,
 * marcarAusenciaOperaciones, revertirAusencia, protocolo de cobertura).
 */
export type GuardAccionId =
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
}

export interface GuardAccionShift extends GuardFlags {
  id: string;
  employeeName?: string;
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

/** Ventana del ingreso manual desde Operaciones: desde T−60 (Ops no tiene ventana de fichada hacia adelante). */
const INGRESO_DESDE_MS = 60 * 60 * 1000;

export function accionesParaTurno(shift: GuardAccionShift, nowMs: number = Date.now()): GuardAccion[] {
  if (!shift || shift.isFranco || shift.draft) return [];
  const nombre = shift.employeeName || 'el guardia';
  const tone = guardTone(shift);
  const presente = shift.isPresent === true && shift.isCompleted !== true;
  const retenido = presente && (shift.isRetention === true || shift.isPendingRetention === true || shift.isPendingClose === true);
  const inicio = startMs(shift);
  const empezo = inicio > 0 && nowMs >= inicio;
  const out: GuardAccion[] = [];

  if (shift.isUnassigned) {
    out.push({ id: 'PROTOCOLO', label: 'Cubrir hueco', hint: 'Candidatos en orden · convocar', tone: 'pri', confirm: null });
    return out;
  }

  if (canRevertAbsenceNow(shift, nowMs)) {
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
    out.push({ id: 'LIBERAR', label: 'Liberar retenido', hint: 'Salida ahora (CHECKOUT)', tone: 'warn', confirm: `¿Liberar a ${nombre}? Se registra la salida ahora.` });
    out.push({ id: 'RETENCION', label: 'Extender retención', hint: '+1 h · +2 h · +4 h · tope 12:59', tone: 'neutral', confirm: null });
  } else if (presente) {
    out.push({ id: 'SALIDA', label: 'Salida · relevo', hint: 'Cierra el turno (CHECKOUT)', tone: 'warn', confirm: `¿Registrar la salida de ${nombre}?` });
  }

  return out;
}

export function accionPorId(shift: GuardAccionShift, id: GuardAccionId, nowMs: number = Date.now()): GuardAccion | null {
  return accionesParaTurno(shift, nowMs).find((a) => a.id === id) || null;
}
