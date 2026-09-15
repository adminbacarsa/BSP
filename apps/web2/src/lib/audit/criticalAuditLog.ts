import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { stampEmpresaId } from '@/lib/multiempresa';

export class CriticalAuditError extends Error {
  readonly causeError: unknown;

  constructor(message: string, causeError: unknown) {
    super(message);
    this.name = 'CriticalAuditError';
    this.causeError = causeError;
  }
}

export type CriticalAuditPayload = {
  empresaId: string;
  action: string;
  module: string;
  details: string;
  actorUid?: string | null;
  actorName?: string | null;
  extra?: Record<string, unknown>;
};

/**
 * Auditoría que debe completarse para considerar válida una operación crítica.
 * Si falla la escritura, lanza `CriticalAuditError` (el caller debe revertir o avisar).
 */
export async function writeCriticalAuditLog(payload: CriticalAuditPayload): Promise<void> {
  const empresaId = String(payload.empresaId || '').trim();
  if (!empresaId) {
    throw new CriticalAuditError('Auditoría crítica sin empresaId', null);
  }
  try {
    const body: Record<string, unknown> = {
      action: payload.action,
      module: payload.module,
      details: payload.details,
      timestamp: serverTimestamp(),
      actorUid: payload.actorUid ?? null,
      actorName: payload.actorName ?? 'Sistema',
      ...payload.extra,
    };
    await addDoc(collection(db, 'audit_logs'), stampEmpresaId(body, empresaId));
  } catch (e) {
    throw new CriticalAuditError('No se pudo registrar la auditoría crítica', e);
  }
}
