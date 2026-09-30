/** Un legajo de la bolsa no se elige como vigilador de planta: entra por la solapa Eventuales. */
export function esLegajoDeBolsa(data: { modalidad?: unknown; bolsaCuil?: unknown }): boolean {
  if (String(data.bolsaCuil || '').trim()) return true;
  return String(data.modalidad || '').toUpperCase() === 'EVENTUAL';
}
