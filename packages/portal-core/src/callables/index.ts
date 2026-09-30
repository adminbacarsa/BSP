import { httpsCallable, type Functions } from 'firebase/functions';
import { PORTAL_CALLABLES } from './names';
import type {
  ActivateAndSetPasswordRequest,
  ActivateAndSetPasswordResponse,
  RequestCheckInRequest,
} from '@cosp/portal-types';

/** Respuesta de `listarTurnosEventual` (uid de Auth alcanza; sin argumentos). */
export type ListarTurnosEventualResponse = {
  bolsaCuil: string;
  empresas: string[];
  turnos: Array<{
    id: string;
    empresaId: string | null;
    fecha: string | null;
    code: string | null;
    objectiveName: string | null;
    startTime: unknown;
    endTime: unknown;
  }>;
};

export function createPortalCallables(functions: Functions) {
  return {
    activateAndSetPassword: httpsCallable<ActivateAndSetPasswordRequest, ActivateAndSetPasswordResponse>(
      functions,
      PORTAL_CALLABLES.activateAndSetPassword,
    ),
    requestCheckIn: httpsCallable<RequestCheckInRequest, unknown>(functions, PORTAL_CALLABLES.requestCheckIn),
    notificarLlegadaTarde: httpsCallable<{ shiftId: string; etaMinutes?: number }, unknown>(
      functions,
      PORTAL_CALLABLES.notificarLlegadaTarde,
    ),
    responderConvocatoriaCobertura: httpsCallable<
      {
        convocatoriaId: string;
        response: 'ACCEPTED' | 'REJECTED';
        rejectionReason?: string;
        etaMinutes?: number;
        responseChannel?: 'ALERTAS' | 'BANNER_HOY' | 'PUSH_ACTION' | 'DEMO' | 'CC';
        deviceId?: string;
        platform?: 'android' | 'ios' | 'web';
        appVersion?: string;
        /** GPS al aceptar. Si falta, el servidor usa el domicilio. */
        originCoords?: { lat: number; lng: number; accuracy?: number };
      },
      { success?: boolean }
    >(functions, PORTAL_CALLABLES.responderConvocatoriaCobertura),
    responderRecordatorioConvocado: httpsCallable<
      {
        convocatoriaId: string;
        action: 'ON_WAY' | 'PROBLEM';
        etaMinutes?: 10 | 15 | 30;
        note?: string;
      },
      { success?: boolean }
    >(functions, PORTAL_CALLABLES.responderRecordatorioConvocado),
    deleteMyTokens: httpsCallable<void, unknown>(functions, PORTAL_CALLABLES.deleteMyTokens),
    sendTestNotification: httpsCallable<{ title?: string; body?: string; type?: string }, unknown>(
      functions,
      PORTAL_CALLABLES.sendTestNotification,
    ),
    getSwapPeople: httpsCallable<Record<string, never>, { data?: { id: string; name: string }[] }>(
      functions,
      PORTAL_CALLABLES.getSwapPeople,
    ),
    getSwapCandidates: httpsCallable<{ shiftId: string }, { data?: unknown[] }>(
      functions,
      PORTAL_CALLABLES.getSwapCandidates,
    ),
    createSwapRequest: httpsCallable<{ myShiftId: string; targetShiftId: string }, unknown>(
      functions,
      PORTAL_CALLABLES.createSwapRequest,
    ),
    respondSwapRequest: httpsCallable<{ requestId: string; accept: boolean }, unknown>(
      functions,
      PORTAL_CALLABLES.respondSwapRequest,
    ),
    confirmSwapRequest: httpsCallable<{ requestId: string; confirm: boolean }, unknown>(
      functions,
      PORTAL_CALLABLES.confirmSwapRequest,
    ),
    cancelSwapRequest: httpsCallable<{ requestId: string }, unknown>(functions, PORTAL_CALLABLES.cancelSwapRequest),
    respondEventoConvocatoria: httpsCallable<
      { solicitudId: string; accept: boolean; asEmployeeId?: string },
      { success?: boolean; status?: string }
    >(functions, PORTAL_CALLABLES.respondEventoConvocatoria),
    listarTurnosEventual: httpsCallable<Record<string, never> | undefined, ListarTurnosEventualResponse>(
      functions,
      PORTAL_CALLABLES.listarTurnosEventual,
    ),
    acusarReciboContrato: httpsCallable<
      { contratoId: string; metodo?: 'SESION' | 'OTP' | 'BIOMETRIA'; deviceId?: string; docSha256?: string },
      { ok?: boolean; success?: boolean }
    >(functions, PORTAL_CALLABLES.acusarReciboContrato),
  };
}

export type PortalCallables = ReturnType<typeof createPortalCallables>;
