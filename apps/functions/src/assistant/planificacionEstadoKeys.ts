/** Claves planificacion_estados: tenant `${empresaId}_${objectiveId}_${year}_${month}` + legacy `${objectiveId}_${year}_${month}`. */

export function ymCordobaParts(dt: Date): { year: number; month: number; ym: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Argentina/Cordoba',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(dt);
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  return { year, month, ym: `${year}_${month}` };
}

export function buildPlanificacionEstadoDocId(
  empresaId: string,
  objectiveId: string,
  year: number,
  month: number,
): string {
  const e = String(empresaId ?? '').trim();
  const o = String(objectiveId ?? '').trim();
  if (e) return `${e}_${o}_${year}_${month}`;
  return `${o}_${year}_${month}`;
}

/** IDs a consultar (tenant primero, legacy si hay tenant). */
export function planificacionEstadoLookupDocIds(
  empresaId: string,
  objectiveId: string,
  year: number,
  month: number,
): string[] {
  const primary = buildPlanificacionEstadoDocId(empresaId, objectiveId, year, month);
  const legacy = buildPlanificacionEstadoDocId('', objectiveId, year, month);
  if (legacy === primary) return [primary];
  return [primary, legacy];
}

export function planificacionEstadoLookupKey(objectiveId: string, ym: string): string {
  return `${String(objectiveId ?? '').trim()}_${ym}`;
}
