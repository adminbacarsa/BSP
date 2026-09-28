/**
 * Baja de cliente CRM: desactivar (INACTIVE) es la operación normal.
 * El borrado físico solo es válido si no quedan turnos, SLA ni órdenes de compra.
 */

export type ClientRelatedPresence = {
  turnos: boolean;
  serviciosSla: boolean;
  ordenesCompra: boolean;
};

export function isClientInactive(status: unknown): boolean {
  const u = String(status ?? '').trim().toUpperCase();
  return u === 'INACTIVE' || u === 'INACTIVO';
}

/** Sin status, ACTIVE o ACTIVO: sigue en selectores operativos. */
export function isClientOperational(status: unknown): boolean {
  return !isClientInactive(status);
}

/**
 * Mensaje de bloqueo del borrado físico. `null` = se puede borrar el documento del cliente.
 * No describe un cascade: turnos y contratos no se eliminan.
 */
export function clientPhysicalDeleteBlockMessage(
  name: string,
  related: ClientRelatedPresence,
): string | null {
  const parts: string[] = [];
  if (related.turnos) parts.push('turnos');
  if (related.serviciosSla) parts.push('servicios SLA');
  if (related.ordenesCompra) parts.push('órdenes de compra');
  if (parts.length === 0) return null;
  const label = String(name || 'este cliente').trim() || 'este cliente';
  return (
    `No se puede eliminar «${label}»: tiene ${parts.join(', ')} vinculados. ` +
    'Desactivalo para sacarlo de las listas. Los turnos, contratos y órdenes no se borran.'
  );
}
