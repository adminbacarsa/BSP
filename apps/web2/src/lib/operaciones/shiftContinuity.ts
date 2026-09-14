/**
 * Continuidad operativa: ¿el presente debe quedar en RETENCIÓN o puede cerrar auto?
 *
 * Reglas (spec Ops):
 * - 24hs / cobertura continua → retención hasta relevo
 * - Bandas: si tiene turno posterior el mismo día en el objetivo → retención
 * - Si tiene extensión TURA / isExtended → no cierra al fin original
 * - Solo sin posterior ni extensión → cierre auto al fin de banda
 */

export type ContinuityDecision =
  | { action: 'RETAIN'; reason: string }
  | { action: 'AUTO_CLOSE'; reason: string };

export function hasTuraOrExtension(shift: {
  isExtended?: boolean;
  isRetention?: boolean;
  code?: string;
  retentionEndTime?: unknown;
  extendedBy?: string;
}): boolean {
  if (shift.isExtended === true) return true;
  if (shift.retentionEndTime) return true;
  const code = String(shift.code || '').toUpperCase();
  if (code === 'D12' || code === 'N12' || code === 'TURA') return true;
  if (String(shift.extendedBy || '') === 'CONVOCATORIA' || String(shift.extendedBy || '') === 'TURA') return true;
  return false;
}

/** ¿Hay otro turno del mismo empleado en el mismo objetivo con start > fin del actual? */
export function employeeHasPosteriorShift(params: {
  employeeId: string;
  objectiveId: string;
  currentShiftId: string;
  currentEndMs: number;
  dayShifts: Array<{
    id: string;
    employeeId?: string;
    objectiveId?: string;
    startTime?: { toMillis?: () => number; seconds?: number } | number;
    isFranco?: boolean;
    code?: string;
  }>;
}): boolean {
  const { employeeId, objectiveId, currentShiftId, currentEndMs, dayShifts } = params;
  if (!employeeId || !objectiveId || !currentEndMs) return false;
  const skipCodes = new Set(['F', 'FF', 'FP', 'V', 'L', 'E', 'A', 'AA', 'PG', 'SUS']);

  for (const s of dayShifts) {
    if (s.id === currentShiftId) continue;
    if (String(s.employeeId || '') !== employeeId) continue;
    if (String(s.objectiveId || '') !== objectiveId) continue;
    if (s.isFranco) continue;
    const code = String(s.code || '').toUpperCase();
    if (skipCodes.has(code)) continue;
    let startMs = 0;
    if (typeof s.startTime === 'number') startMs = s.startTime;
    else if (s.startTime?.toMillis) startMs = s.startTime.toMillis();
    else if (s.startTime && typeof (s.startTime as any).seconds === 'number') {
      startMs = (s.startTime as any).seconds * 1000;
    }
    if (startMs > currentEndMs - 5 * 60 * 1000) return true; // overlap/seguido
  }
  return false;
}

export function decideShiftCloseOrRetain(params: {
  shift: {
    id?: string;
    employeeId?: string;
    objectiveId?: string;
    isExtended?: boolean;
    isRetention?: boolean;
    code?: string;
    retentionEndTime?: unknown;
    extendedBy?: string;
  };
  requiresContinuousCoverage24h: boolean;
  hasPosteriorShift: boolean;
}): ContinuityDecision {
  const { shift, requiresContinuousCoverage24h, hasPosteriorShift } = params;

  if (requiresContinuousCoverage24h) {
    return { action: 'RETAIN', reason: 'CONTINUIDAD_24HS' };
  }
  if (hasPosteriorShift) {
    return { action: 'RETAIN', reason: 'TURNO_POSTERIOR_MISMO_OBJETIVO' };
  }
  if (hasTuraOrExtension(shift)) {
    return { action: 'RETAIN', reason: 'EXTENSION_TURA_ACTIVA' };
  }
  return { action: 'AUTO_CLOSE', reason: 'SIN_POSTERIOR_NI_EXTENSION' };
}

/** Texto canónico de vacante referenciada. */
export function vacancyCoverageLabel(params: {
  titularName?: string | null;
  shiftCode?: string | null;
  positionName?: string | null;
  objectiveName?: string | null;
  timeRange?: string | null;
}): string {
  const who = String(params.titularName || '').trim() || 'titular';
  const code = String(params.shiftCode || '').trim().toUpperCase() || '—';
  const pos = String(params.positionName || '').trim();
  const obj = String(params.objectiveName || '').trim();
  const tr = String(params.timeRange || '').trim();
  const parts = [
    `Vacante por ausencia de ${who}`,
    `turno ${code}`,
    pos ? `puesto ${pos}` : '',
    obj ? obj : '',
    tr ? tr : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

/**
 * Campos para convertir RET / ESC / REF en el turno real del hueco.
 * Plan/prefactura = banda de la vacante; no usar arrival como startTime del slot.
 */
export function buildReassignPassiveToVacancyFields(vacancy: {
  objectiveId?: string;
  objectiveName?: string;
  clientId?: string;
  clientName?: string;
  positionName?: string;
  code?: string;
  startTime?: unknown;
  endTime?: unknown;
  empresaId?: string;
}, opts: {
  coverageType: 'RET' | 'ESC' | 'REF' | string;
  resolvedBy?: string;
  previousCode?: string;
  coverageEventId?: string;
}): Record<string, unknown> {
  const prev = String(opts.previousCode || opts.coverageType).toUpperCase();
  return {
    code: String(vacancy.code || 'M').toUpperCase(),
    objectiveId: vacancy.objectiveId || null,
    objectiveName: vacancy.objectiveName || null,
    clientId: vacancy.clientId || null,
    clientName: vacancy.clientName || null,
    positionName: vacancy.positionName || null,
    startTime: vacancy.startTime || null,
    endTime: vacancy.endTime || null,
    // Banda plan del puesto (prefactura); fichada real va en presentAt/realStartTime al marcar
    plannedStartTime: vacancy.startTime || null,
    plannedEndTime: vacancy.endTime || null,
    isReten: false,
    isFranco: false,
    origin: 'OPERATIONS_COVERAGE',
    coverageType: opts.coverageType,
    previousPassiveCode: prev,
    reassignedFromPassiveAt: true,
    resolvedBy: opts.resolvedBy || 'OPERACIONES',
    ...(opts.coverageEventId ? { coverageEventId: opts.coverageEventId } : {}),
  };
}
