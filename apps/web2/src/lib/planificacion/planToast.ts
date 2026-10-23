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

/** Objetivo del guardado: permite distinguir toasts cuando hay más de un guardado en vuelo (navegó mientras guardaba). */
type ObjetivoToast = { id?: string | null; name?: string | null };

function idGuardado(objetivo?: ObjetivoToast): string {
  return objetivo?.id ? `${PLAN_TOAST.save}:${objetivo.id}` : PLAN_TOAST.save;
}

function prefijoGuardado(objetivo?: ObjetivoToast): string {
  return objetivo?.name ? `${objetivo.name}: ` : '';
}

export function planToastSaving(count: number, objetivo?: ObjetivoToast): string | number {
  return toast.loading(`${prefijoGuardado(objetivo)}Guardando ${count} cambio${count === 1 ? '' : 's'}…`, {
    id: idGuardado(objetivo),
  });
}

export function planToastSaved(count: number, opts?: { borrador?: boolean; objetivo?: ObjetivoToast }): void {
  const base = `${prefijoGuardado(opts?.objetivo)}${count} cambio${count === 1 ? '' : 's'} guardado${count === 1 ? '' : 's'}`;
  toast.success(opts?.borrador ? `${base} en borrador — falta publicar` : base, {
    id: idGuardado(opts?.objetivo),
    duration: opts?.borrador ? 4000 : 2800,
  });
}

export function planToastSaveError(message = 'Error al guardar — cambios restaurados en pendientes', objetivo?: ObjetivoToast): void {
  toast.error(`${prefijoGuardado(objetivo)}${message}`, { id: idGuardado(objetivo), duration: 5000 });
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
