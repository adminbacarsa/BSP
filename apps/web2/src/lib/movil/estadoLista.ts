/**
 * Pie de la lista del celular: «Actualizado hace N min · N pendientes de enviar».
 * `lastUpdateMs` = último snapshot del monitor que llegó al componente.
 */
export function formatActualizadoHace(lastUpdateMs: number, nowMs: number = Date.now()): string {
  if (!lastUpdateMs) return 'Sin datos todavía';
  const seg = Math.max(0, Math.floor((nowMs - lastUpdateMs) / 1000));
  if (seg < 60) return 'Actualizado recién';
  const min = Math.floor(seg / 60);
  if (min < 60) return `Actualizado hace ${min} min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  return `Actualizado hace ${h} h${resto ? ` ${String(resto).padStart(2, '0')} min` : ''}`;
}

export function formatPendientes(cantidad: number): string | null {
  if (cantidad <= 0) return null;
  return cantidad === 1 ? '1 pendiente de enviar' : `${cantidad} pendientes de enviar`;
}

/** Línea completa del pie. */
export function piePrincipal(lastUpdateMs: number, pendientes: number, nowMs: number = Date.now()): string {
  const partes = [formatActualizadoHace(lastUpdateMs, nowMs)];
  const p = formatPendientes(pendientes);
  if (p) partes.push(p);
  return partes.join(' · ');
}
