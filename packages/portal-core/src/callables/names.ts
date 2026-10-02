export const PORTAL_CALLABLES = {
  activateDevice: 'activateDevice',
  activateAndSetPassword: 'activateAndSetPassword',
  requestCheckIn: 'requestCheckIn',
  cerrarTurnoPortal: 'cerrarTurnoPortal',
  reportarAusencia: 'reportarAusencia',
  notificarLlegadaTarde: 'notificarLlegadaTarde',
  responderConvocatoriaCobertura: 'responderConvocatoriaCobertura',
  responderRecordatorioConvocado: 'responderRecordatorioConvocado',
  getSwapCandidates: 'getSwapCandidates',
  getSwapPeople: 'getSwapPeople',
  createSwapRequest: 'createSwapRequest',
  respondSwapRequest: 'respondSwapRequest',
  confirmSwapRequest: 'confirmSwapRequest',
  cancelSwapRequest: 'cancelSwapRequest',
  deleteMyTokens: 'deleteMyTokens',
  sendTestNotification: 'sendTestNotification',
  respondEventoConvocatoria: 'respondEventoConvocatoria',
  /** Eventuales (docs/EVENTUALES-DISENO.md §7). */
  listarTurnosEventual: 'listarTurnosEventual',
  /** Acuse de recibo del contrato (§3.3). Pendiente en el servidor. */
  acusarReciboContrato: 'acusarReciboContrato',
} as const;

export type PortalCallableName = (typeof PORTAL_CALLABLES)[keyof typeof PORTAL_CALLABLES];
