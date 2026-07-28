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
    sendTestNotification: httpsCallable<void, unknown>(functions, PORTAL_CALLABLES.sendTestNotification),
  };
}

export type PortalCallables = ReturnType<typeof createPortalCallables>;
