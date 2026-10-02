import type { Firestore } from 'firebase-admin/firestore';

/** Misma regla que `packages/ops-core/src/excluirDeOperacion.ts`. */
export function isExcluidoDeOperacion(
  data: { excluirDeOperacion?: unknown } | null | undefined,
): boolean {
  return data?.excluirDeOperacion === true;
}

export function turnoFueraDeCentroDeControl(
  shift: { excluirDeOperacion?: unknown; objectiveId?: unknown } | null | undefined,
  excludedObjectiveIds?: ReadonlySet<string>,
): boolean {
  if (isExcluidoDeOperacion(shift)) return true;
  const id = String(shift?.objectiveId ?? '').trim();
  return id.length > 0 && excludedObjectiveIds?.has(id) === true;
}

export async function loadObjectiveIdsExcluidos(db: Firestore): Promise<Set<string>> {
  const snap = await db.collection('objetivos').where('excluirDeOperacion', '==', true).get();
  return new Set(snap.docs.map((d) => d.id));
}
