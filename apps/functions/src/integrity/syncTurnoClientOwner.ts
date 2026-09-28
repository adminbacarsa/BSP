import { FieldValue } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { correctTurnoClientId, type TurnoClientPatch } from './turnoClientOwner';

function toWrite(patch: TurnoClientPatch): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (patch.clientId) out.clientId = patch.clientId;
  if (patch.integrityIssue === null) out.integrityIssue = FieldValue.delete();
  else if (patch.integrityIssue) out.integrityIssue = patch.integrityIssue;
  return out;
}

/**
 * Completa o corrige clientId según el dueño del objectiveId en la empresa.
 * Una sola escritura: si el valor ya coincide, no actualiza (el reingreso del trigger no escribe).
 */
export const syncTurnoClientOwner = onDocumentWritten(
  {
    document: 'turnos/{turnoId}',
    region: 'us-central1',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;
    const data = (after.data() || {}) as Record<string, unknown>;
    await correctTurnoClientId(
      admin.firestore(),
      after.ref,
      data,
      toWrite,
    );
  },
);
