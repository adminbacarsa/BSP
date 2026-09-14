import { toast } from 'sonner';

export type LogOpsErrorOptions = {
  /** Mensaje visible al operador. Si se omite, no hay toast. */
  userMessage?: string;
  level?: 'error' | 'warn';
  /** Por defecto: true si hay userMessage. */
  showToast?: boolean;
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error ?? 'Error desconocido');
}

function errorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code: unknown }).code;
    return code != null ? String(code) : undefined;
  }
  return undefined;
}

/**
 * Log estructurado para Operaciones: consola + toast opcional al operador.
 */
export function logOpsError(context: string, error: unknown, options?: LogOpsErrorOptions): void {
  const level = options?.level ?? 'error';
  const msg = errorMessage(error);
  const code = errorCode(error);
  const line = code ? `[${context}] ${msg} (${code})` : `[${context}] ${msg}`;

  if (level === 'warn') console.warn(line, error);
  else console.error(line, error);

  const shouldToast = options?.showToast ?? !!options?.userMessage;
  if (shouldToast && options?.userMessage) {
    if (level === 'warn') toast.warning(options.userMessage);
    else toast.error(options.userMessage);
  }
}

/** Listeners Firestore / reconexión — solo consola, sin alarmar al operador. */
export function logOpsListenerWarn(context: string, error: unknown): void {
  logOpsError(context, error, { level: 'warn', showToast: false });
}

/** Automatismos en background (cron cliente, auto-cierre). */
export function logOpsBackgroundWarn(context: string, error: unknown): void {
  logOpsError(context, error, { level: 'warn', showToast: false });
}
