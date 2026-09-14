import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

/**
 * Tipos de convocatoria individuales (doc convocatorias_cobertura.type).
 * EXTEND/ADVANCE son mitades del paso dual EXT_DUAL.
 * VOLANTE / SIN_TURNO_CON_EXP son subtipos del paso SIN_TURNO (misma cola).
 */
export type CandidateType =
  | 'SIN_TURNO'
  | 'VOLANTE'
  | 'SIN_TURNO_CON_EXP'
  | 'RET'
  | 'ESC' // ESC / REF redirigibles
  | 'EXTEND'
  | 'ADVANCE'
  | 'INTERCAMBIO'
  | 'FT';

/**
 * Escalera CCT = protocolo manual (CoverageSessionManager.STEPS).
 * Auto y manual comparten este orden; auto notifica en paralelo y gana el 1º que acepta.
 * RET es forzado (asignación directa, sin esperar aceptación).
 */
export type CascadeStepType = 'SIN_TURNO' | 'RET' | 'ESC' | 'EXT_DUAL' | 'INTERCAMBIO' | 'FT';

export const CASCADE_ORDER: CascadeStepType[] = [
  'SIN_TURNO',
  'RET',
  'ESC',
  'EXT_DUAL',
  'INTERCAMBIO',
  'FT',
];

/** Radio RET: primero 15 km, luego ampliar a 30 km. */
export const RET_RADIUS_KM_PRIMARY = 15;
export const RET_RADIUS_KM_EXPANDED = 30;

/** Máx. candidatos notificados en paralelo por paso (o por mitad EXT/ADV). */
export const BROADCAST_LIMIT = 5;

export interface EligibilityContext {
  objectiveId: string;
  clientId?: string;
  aptitudesRequeridas?: string[];
  shiftCode?: string;
}

export interface EligibilityResult {
  eligible: boolean;
  reason?: string;
}

interface AptitudEntry {
  codigo: string;
  vigencia?: string; // YYYY-MM-DD
}

export function toCascadeStep(type: string): CascadeStepType | null {
  if (type === 'VOLANTE' || type === 'SIN_TURNO_CON_EXP' || type === 'SIN_TURNO') return 'SIN_TURNO';
  if (type === 'RET') return 'RET';
  if (type === 'ESC') return 'ESC';
  if (type === 'EXTEND' || type === 'ADVANCE' || type === 'EXT_DUAL') return 'EXT_DUAL';
  if (type === 'INTERCAMBIO') return 'INTERCAMBIO';
  if (type === 'FT') return 'FT';
  return null;
}

export function cascadeStepIndex(type: string): number {
  const step = toCascadeStep(type);
  if (!step) return -1;
  return CASCADE_ORDER.indexOf(step);
}

export function nextCascadeStep(current: CascadeStepType | CandidateType | string): CascadeStepType | null {
  const step = toCascadeStep(String(current));
  if (!step) return null;
  const idx = CASCADE_ORDER.indexOf(step);
  if (idx === -1 || idx >= CASCADE_ORDER.length - 1) return null;
  return CASCADE_ORDER[idx + 1];
}

export function checkEligibility(
  employee: Record<string, any>,
  ctx: EligibilityContext,
  candidateType: CandidateType,
  distanceKm?: number,
  maxDistanceKm: number = RET_RADIUS_KM_PRIMARY,
): EligibilityResult {
  const today = new Date().toISOString().slice(0, 10);

  const restricObjs: { objectiveId?: string }[] = employee.restriccionesObjetivo || [];
  if (restricObjs.some((r) => r.objectiveId === ctx.objectiveId)) {
    return { eligible: false, reason: 'RESTRICCION_OBJETIVO' };
  }

  if (ctx.clientId) {
    const restricClients: { clientId?: string }[] = employee.restriccionesCliente || [];
    if (restricClients.some((r) => r.clientId === ctx.clientId)) {
      return { eligible: false, reason: 'RESTRICCION_CLIENTE' };
    }
  }

  if (
    (candidateType === 'RET' || candidateType === 'VOLANTE' || candidateType === 'FT' || candidateType === 'ESC') &&
    distanceKm !== undefined &&
    Number.isFinite(distanceKm)
  ) {
    if (distanceKm > maxDistanceKm) {
      return { eligible: false, reason: `DISTANCIA_EXCEDE_${maxDistanceKm}KM` };
    }
  }

  const required: string[] = ctx.aptitudesRequeridas || [];
  if (required.length > 0) {
    const empApts: AptitudEntry[] = employee.aptitudes || [];
    const vigentes = empApts
      .filter((a) => !a.vigencia || a.vigencia >= today)
      .map((a) => a.codigo);
    const missing = required.filter((r) => !vigentes.includes(r));
    if (missing.length > 0) {
      return { eligible: false, reason: `FALTA_APTITUD:${missing.join(',')}` };
    }
  }

  return { eligible: true };
}

export function deriveCandidateType(
  employee: Record<string, any>,
  objectiveId: string,
  todayShifts: { employeeId: string; code?: string }[],
): CandidateType | null {
  const empId = employee.id as string;
  const shift = todayShifts.find((s) => s.employeeId === empId);
  if (shift) {
    const code = String(shift.code || '').toUpperCase();
    if (code === 'RET') return 'RET';
    if (code === 'ESC' || code === 'REF') return 'ESC';
    if (['F', 'FF', 'FP', 'FT'].includes(code)) return 'FT';
    return null;
  }
  const isVolante = (employee.volante || []).includes(objectiveId);
  if (isVolante) return 'VOLANTE';
  const isTitular = employee.preferredObjectiveId === objectiveId;
  const hasExp = !!(employee.experienciaObjetivos || {})[objectiveId];
  if (isTitular || hasExp) return 'SIN_TURNO_CON_EXP';
  return 'SIN_TURNO';
}

export function getUrgency(
  startTime: Timestamp | { seconds: number },
): 'URGENTE' | 'INTERMEDIO' | 'NORMAL' {
  const startMs =
    startTime instanceof Timestamp
      ? startTime.toMillis()
      : (startTime as { seconds: number }).seconds * 1000;
  const diffMin = (startMs - Date.now()) / 60000;
  if (diffMin <= 60) return 'URGENTE';
  if (diffMin <= 240) return 'INTERMEDIO';
  return 'NORMAL';
}

export async function findEmployeeUid(
  db: admin.firestore.Firestore,
  employeeId: string,
  empData?: Record<string, any>,
): Promise<string | null> {
  const data = empData || (await db.collection('empleados').doc(employeeId).get()).data();
  if (!data) return null;
  if (data.uid) return String(data.uid);
  return null;
}
