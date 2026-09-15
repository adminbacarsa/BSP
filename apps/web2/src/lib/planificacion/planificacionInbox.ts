/**
 * Criterio unificado: qué novedades alimentan campanita + globito de Planificación.
 * Ops (RETENCION, LLEGADA_TARDE, etc.) quedan afuera salvo actionTarget PLANIFICACION.
 */

export const PLAN_INBOX_EXPLICIT_TYPES = [
  'REFUERZO_CLIENTE_PENDIENTE',
  'VACANTE_A_PLANIFICACION',
  'VACANTE_NO_CUBIERTA',
  'VACANTE_POR_EVENTO',
] as const;

const PLAN_INBOX_EXPLICIT_SET = new Set<string>(PLAN_INBOX_EXPLICIT_TYPES);

/** Tipos de vacante que el menú lateral cuenta aparte del RFZ. */
export const PLAN_SIDEBAR_VACANTE_TYPES = [
  'VACANTE_A_PLANIFICACION',
  'VACANTE_NO_CUBIERTA',
] as const;

export function isPendingNovedadStatus(status: unknown): boolean {
  const st = String(status || '').trim().toLowerCase();
  return st === 'pending' || st === 'pendiente';
}

export function isPlanificacionInboxNovedad(
  data: Record<string, unknown> | null | undefined,
): boolean {
  if (!data) return false;
  if (data.actionTarget === 'OPERACIONES') return false;
  if (data.viewed === true) return false;
  if (!isPendingNovedadStatus(data.status)) return false;
  if (data.source === 'AUSENCIA') return true;
  if (data.actionTarget === 'PLANIFICACION') return true;
  const t = String(data.type || '');
  return PLAN_INBOX_EXPLICIT_SET.has(t);
}

/** Payload estándar al avisar a Planificación desde RRHH (vacaciones, licencias, etc.). */
export function buildAusenciaPlanificacionNovedad(input: {
  type: string;
  employeeId?: string | null;
  employeeName?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  ausenciaId: string;
  reportedBy?: string | null;
  objectiveId?: string | null;
  clientId?: string | null;
}): Record<string, unknown> {
  const typeLabel = String(input.type || 'Novedad').trim() || 'Novedad';
  const empName = String(input.employeeName || 'Guardia').trim();
  const range =
    input.startDate && input.endDate
      ? `${input.startDate} al ${input.endDate}`
      : input.startDate || '';
  return {
    source: 'AUSENCIA',
    type: typeLabel,
    title: `${typeLabel} → Planificación`,
    status: 'pending',
    priority: 'high',
    actionTarget: 'PLANIFICACION',
    viewed: false,
    employeeId: input.employeeId || null,
    employeeName: empName,
    startDate: input.startDate || null,
    endDate: input.endDate || null,
    ausenciaId: input.ausenciaId,
    objectiveId: input.objectiveId || null,
    clientId: input.clientId || null,
    description: range
      ? `${typeLabel} de ${empName} — ${range}. Revisá cobertura en el cronograma.`
      : `${typeLabel} de ${empName}. Revisá cobertura en el cronograma.`,
    reportedBy: input.reportedBy || 'RRHH',
  };
}

/** Estados RRHH en los que ya corresponde avisar a Planificación. */
export function shouldNotifyPlanificacionAusencia(status: unknown): boolean {
  const st = String(status || '').trim();
  return (
    st === 'Autorizada' ||
    st === 'Justificada' ||
    st === 'Injustificada' ||
    st === 'Confirmada'
  );
}
