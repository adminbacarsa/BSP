/** «miércoles 1 de octubre» — línea gris bajo la barra superior de cada módulo. */
export function movilFechaCorta(ms: number): string {
  return new Date(ms).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
}
