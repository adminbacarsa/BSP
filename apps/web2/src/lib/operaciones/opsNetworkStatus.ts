/**
 * Estado de red para Operaciones / Modo Rápido (cortes cortos, un operador).
 * Firestore con persistentLocalCache encola updateDoc; acá solo UI + gate de acciones.
 */

export type OpsNetworkKind = 'online' | 'offline' | 'syncing';

/** Acciones que requieren Functions / lecturas frescas / varios docs — no en v1 offline. */
export type OpsOfflineBlockedAction =
  | 'cobertura'
  | 'intercambio'
  | 'ausencia'
  | 'retiro'
  | 'reversion'
  | 'convocatoria'
  | 'retenes'
  | 'dual12';

const BLOCKED_LABEL: Record<OpsOfflineBlockedAction, string> = {
  cobertura: 'gestionar cobertura',
  intercambio: 'hacer un intercambio',
  ausencia: 'declarar ausencia (requiere servidor)',
  retiro: 'registrar retiro anticipado',
  reversion: 'revertir una ausencia',
  convocatoria: 'crear una convocatoria',
  retenes: 'asignar retenes',
  dual12: 'armar cobertura D12+N12',
};

export function opsOfflineBlockedMessage(action: OpsOfflineBlockedAction): string {
  return `Sin conexión: no se puede ${BLOCKED_LABEL[action]}. Esperá a que vuelva la red.`;
}

export function readNavigatorOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine !== false;
}
