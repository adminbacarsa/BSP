import type { FirestoreTimestampLike } from '@cosp/portal-types';

/** Tipos de cascada CCT + pregunta de llegada tarde. */
export type ConvocatoriaCoberturaType =
  | 'RET'
  | 'REF'
  | 'ESC'
  | 'FT'
  | 'EXTEND'
  | 'ADVANCE'
  | 'EXT'
  | 'ADV'
  | 'VOLANTE'
  | 'SIN_TURNO'
  | 'SIN_TURNO_CON_EXP'
  | 'LLEGADA_TARDE'
  | string;

export type ConvocatoriaCoberturaStatus =
  | 'PENDING'
  | 'ESCALATED'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'TIMEOUT'
  | 'CANCELLED'
  | string;

export type ConvocatoriaCobertura = {
  id: string;
  empresaId?: string;
  shiftId?: string;
  objectiveId?: string;
  objectiveName?: string;
  positionName?: string;
  clientId?: string;
  clientName?: string;
  shiftCode?: string;
  startTime?: FirestoreTimestampLike;
  endTime?: FirestoreTimestampLike;
  type: ConvocatoriaCoberturaType;
  urgency?: string;
  cascadeStep?: number;
  candidateEmployeeId?: string;
  candidateEmployeeName?: string;
  candidateUid?: string;
  status: ConvocatoriaCoberturaStatus;
  timeoutAt?: FirestoreTimestampLike;
  createdAt?: FirestoreTimestampLike;
  rejectionReason?: string;
};

export function isLlegadaTardeConvocatoria(c: Pick<ConvocatoriaCobertura, 'type'>): boolean {
  return String(c.type || '')
    .trim()
    .toUpperCase() === 'LLEGADA_TARDE';
}

export function isActiveCoberturaStatus(status: string | undefined): boolean {
  const s = String(status || '')
    .trim()
    .toUpperCase();
  return s === 'PENDING' || s === 'ESCALATED';
}

/** Etiqueta corta para UI (RET/REF/ESC/FT/EXT/ADV). */
export function convocatoriaCoberturaTypeLabel(type: string | undefined): string {
  const t = String(type || '')
    .trim()
    .toUpperCase();
  if (t === 'EXTEND' || t === 'EXT') return 'EXT';
  if (t === 'ADVANCE' || t === 'ADV') return 'ADV';
  if (t === 'LLEGADA_TARDE') return '¿Venís?';
  if (t === 'VOLANTE' || t === 'SIN_TURNO' || t === 'SIN_TURNO_CON_EXP') return 'COB';
  return t || 'COB';
}
