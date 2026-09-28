/** El índice compuesto puede estar todavía construyéndose en Firestore. */
export function isFirestoreIndexError(error: unknown): boolean {
  const code = String((error as { code?: string })?.code ?? '');
  const msg = error instanceof Error ? error.message : String(error ?? '');
  return code === 'failed-precondition' || /requires an index|index is currently building/i.test(msg);
}
