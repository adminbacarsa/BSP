import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { COVERAGE_CASCADE_ORDER } from './coverageCandidates';

export type CandidateType =
  | 'RET'                // RET pasivo en objetivo (obligación)
  | 'REF'                // Refuerzo en objetivo
  | 'ESC'                // Escuela en objetivo
  | 'EXTEND'             // Extender jornada (costo extra)
  | 'ADVANCE'            // Adelantar turno (costo extra)
  | 'FT'                 // Franco trabajado (último recurso)
  | 'VOLANTE'            // Legacy cascada / listados
  | 'SIN_TURNO_CON_EXP'
  | 'SIN_TURNO'
  | 'EVENTUAL';

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

export function checkEligibility(
  employee: Record<string, any>,
  ctx: EligibilityContext,
  candidateType: CandidateType,
  distanceKm?: number,
): EligibilityResult {
  const today = new Date().toISOString().slice(0, 10);

  // 1. Restricciones de objetivo
  const restricObjs: { objectiveId?: string }[] = employee.restriccionesObjetivo || [];
  if (restricObjs.some((r) => r.objectiveId === ctx.objectiveId)) {
    return { eligible: false, reason: 'RESTRICCION_OBJETIVO' };
  }

  // 2. Restricciones de cliente
  if (ctx.clientId) {
    const restricClients: { clientId?: string }[] = employee.restriccionesCliente || [];
    if (restricClients.some((r) => r.clientId === ctx.clientId)) {
      return { eligible: false, reason: 'RESTRICCION_CLIENTE' };
    }
  }

  // 3. Filtro de distancia (RET, VOLANTE y FT: máx 15 km)
  if (
    (candidateType === 'RET' || candidateType === 'VOLANTE' || candidateType === 'FT') &&
    distanceKm !== undefined
  ) {
    if (distanceKm > 15) {
      return { eligible: false, reason: 'DISTANCIA_EXCEDE_15KM' };
    }
  }

  // 4. Conocimiento del objetivo — obligatorio para RET
  if (candidateType === 'RET') {
    const isTitular = employee.preferredObjectiveId === ctx.objectiveId;
    const hasExp = !!(employee.experienciaObjetivos || {})[ctx.objectiveId];
    const isVolante = (employee.volante || []).includes(ctx.objectiveId);
    if (!isTitular && !hasExp && !isVolante) {
      return { eligible: false, reason: 'SIN_EXPERIENCIA_EN_OBJETIVO' };
    }
  }

  // 5. Aptitudes vigentes
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

/** Misma constante que el CC y la cascada Auto/Demo (`COVERAGE_CASCADE_ORDER`). */
export const CASCADE_ORDER: CandidateType[] = [...COVERAGE_CASCADE_ORDER];

export function nextCascadeStep(current: CandidateType): CandidateType | null {
  const idx = CASCADE_ORDER.indexOf(current);
  if (idx === -1 || idx >= CASCADE_ORDER.length - 1) return null;
  return CASCADE_ORDER[idx + 1];
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
  // Buscar por legajo como uid directo en Auth
  return null;
}
