import { httpsCallable, type Functions } from 'firebase/functions';
import { PORTAL_CALLABLES } from './names';
import type {
  ActivateAndSetPasswordRequest,
  ActivateAndSetPasswordResponse,
  RequestCheckInRequest,
} from '@cosp/portal-types';

export function createPortalCallables(functions: Functions) {
  return {
    activateAndSetPassword: httpsCallable<ActivateAndSetPasswordRequest, ActivateAndSetPasswordResponse>(
      functions,
      PORTAL_CALLABLES.activateAndSetPassword,
    ),
    requestCheckIn: httpsCallable<RequestCheckInRequest, unknown>(functions, PORTAL_CALLABLES.requestCheckIn),
    notificarLlegadaTarde: httpsCallable<{ shiftId: string }, unknown>(
      functions,
      PORTAL_CALLABLES.notificarLlegadaTarde,
    ),
    deleteMyTokens: httpsCallable<void, unknown>(functions, PORTAL_CALLABLES.deleteMyTokens),
    sendTestNotification: httpsCallable<{ title?: string; body?: string }, unknown>(
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
  };
}

export type PortalCallables = ReturnType<typeof createPortalCallables>;
