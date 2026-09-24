/**
 * Avisos de eventos automáticos del Centro de Comando (ingresos, tardanzas, recargos, cierres).
 * No se pintan como toast: tapaban los controles y se encolaban. El operador los ve en
 * «Alertas y prioridad» y en la bitácora. Misma firma que `toast` de sonner para no tocar los llamados.
 */
type SilentFn = (message: unknown, opts?: unknown) => void;

const log: SilentFn = (message) => {
  if (process.env.NODE_ENV !== 'production') console.debug('[ops-event]', message);
};

export const silentToast = Object.assign(log, {
  success: log,
  info: log,
  warning: log,
  error: log,
  message: log,
});
