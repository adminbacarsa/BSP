/** Mensaje legible de errores httpsCallable (Firebase pone el texto en message o details). */
export function callableErrorText(e: unknown): string {
  const err = e as { message?: string; details?: unknown };
  if (typeof err.details === 'string' && err.details.trim()) return err.details.trim();
  if (err.details && typeof err.details === 'object' && 'message' in err.details) {
    return String((err.details as { message?: string }).message || '').trim();
  }
  return String(err.message || '').trim();
}
