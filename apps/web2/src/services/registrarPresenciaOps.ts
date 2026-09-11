import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';

export type RegistrarPresenciaSource =
  | 'OPERATIONS'
  | 'VIGI'
  | 'DEMO'
  | 'MANUAL_RADIO'
  | 'MANUAL_PHONE';

export type RegistrarPresenciaRequest = {
  shiftId: string;
  source?: RegistrarPresenciaSource;
  /** Turno saliente forzado; null / skipAutoRelevo = sin relevo; omitido = auto FIFO */
  overrideRelieveShiftId?: string | null;
  skipAutoRelevo?: boolean;
  coords?: { lat?: number; lng?: number } | null;
  recordedAt?: string | null;
};

export type RegistrarPresenciaResponse = {
  success: boolean;
  alreadyPresent?: boolean;
  relieved: {
    shiftId: string;
    employeeId: string;
    employeeName: string;
  } | null;
};

const callRegistrarPresencia = httpsCallable<RegistrarPresenciaRequest, RegistrarPresenciaResponse>(
  functions,
  'registrarPresencia',
  { timeout: 45000 },
);

/**
 * Presencia + auto-relevo FIFO vía Functions (mismo motor que portal y VIGI).
 * Cierra UI al instante: el caller no debe await antes del toast/cierre.
 */
export function registrarPresenciaOps(req: RegistrarPresenciaRequest): Promise<RegistrarPresenciaResponse> {
  return callRegistrarPresencia(req).then((res) => res.data);
}
