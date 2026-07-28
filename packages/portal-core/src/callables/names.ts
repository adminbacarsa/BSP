export const PORTAL_CALLABLES = {
  activateDevice: 'activateDevice',
  activateAndSetPassword: 'activateAndSetPassword',
  requestCheckIn: 'requestCheckIn',
  reportarAusencia: 'reportarAusencia',
  notificarLlegadaTarde: 'notificarLlegadaTarde',
  getSwapCandidates: 'getSwapCandidates',
  getSwapPeople: 'getSwapPeople',
  createSwapRequest: 'createSwapRequest',
  respondSwapRequest: 'respondSwapRequest',
  confirmSwapRequest: 'confirmSwapRequest',
  cancelSwapRequest: 'cancelSwapRequest',
  deleteMyTokens: 'deleteMyTokens',
  sendTestNotification: 'sendTestNotification',
} as const;

export type PortalCallableName = (typeof PORTAL_CALLABLES)[keyof typeof PORTAL_CALLABLES];
