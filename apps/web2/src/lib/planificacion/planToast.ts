/**
 * Toasts de planificación: IDs estables (reemplazan en vez de apilar) y menos ruido.
 */
import { toast } from 'sonner';

const PLAN_TOAST = {
  change: 'plan-cambio',
  save: 'plan-save',
  bulk: 'plan-bulk',
  warn: 'plan-warn',
} as const;

/** Feedback de celda: no spam — la barra ámbar ya muestra pendientes. */
export function planToastChangeApplied(_detail?: string): void {
  // Intencionalmente vacío: un toast por cada celda satura la UI.
}

export function planToastSaving(count: number): string | number {
  return toast.loading(`Guardando ${count} cambio${count === 1 ? '' : 's'}…`, {
    id: PLAN_TOAST.save,
  });
}

export function planToastSaved(count: number): void {
  toast.success(`${count} cambio${count === 1 ? '' : 's'} guardado${count === 1 ? '' : 's'}`, {
    id: PLAN_TOAST.save,
    duration: 2800,
  });
}

export function planToastSaveError(message = 'Error al guardar — cambios restaurados en pendientes'): void {
  toast.error(message, { id: PLAN_TOAST.save, duration: 5000 });
}

export function planToastBulk(message: string): void {
  toast.info(message, { id: PLAN_TOAST.bulk, duration: 3200 });
}

export function planToastWarn(message: string, duration = 6000): void {
  toast.warning(message, { id: PLAN_TOAST.warn, duration });
}

export function planToastWarnMany(messages: string[], duration = 7000): void {
  const unique = [...new Set(messages.filter(Boolean))];
  if (unique.length === 0) return;
  if (unique.length === 1) {
    planToastWarn(unique[0], duration);
    return;
  }
  toast.warning(unique.slice(0, 4).join(' · ') + (unique.length > 4 ? ` (+${unique.length - 4})` : ''), {
    id: PLAN_TOAST.warn,
    duration,
  });
}
