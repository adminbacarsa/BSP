/** Firestore doc id seguro a partir de idempotencyKey del cliente. */
export function fichajeDocIdFromKey(key: string): string {
  const cleaned = String(key).trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  if (!cleaned) return `fichaje_${Date.now()}`;
  return cleaned.length > 200 ? cleaned.slice(0, 200) : cleaned;
}
