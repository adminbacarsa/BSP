/**
 * Objetivo de revisión (Play) u otro que no debe entrar al Centro de Control ni a los crons.
 * El turno puede traer el flag copiado; si no, el id está en el set cargado desde `objetivos`.
 */
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
