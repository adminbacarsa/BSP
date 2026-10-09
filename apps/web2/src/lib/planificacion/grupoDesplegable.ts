export type OpcionGrupoVista = {
  id: 'todos' | 'objetivo' | 'salir';
  objectiveId?: string;
  nombre: string;
  subtitulo: string;
  activa: boolean;
};

/** Rótulo del botón: el grupo, o «grupo › objetivo» si se está viendo uno solo. */
export function rotuloGrupoVista(
  nombreGrupo: string,
  vistaAgrupada: boolean,
  nombreObjetivo?: string | null,
): string {
  const grupo = String(nombreGrupo || '').trim();
  if (vistaAgrupada) return grupo;
  const obj = String(nombreObjetivo || '').trim();
  return obj ? `${grupo} › ${obj}` : grupo;
}

/**
 * Todos, cada objetivo y Salir. El cliente va de subtítulo solo si no es el del grupo
 * o si los objetivos del grupo no comparten cliente.
 */
export function opcionesGrupoVista(input: {
  objectiveIds: readonly string[];
  objectiveNames: readonly string[];
  clientes?: readonly (string | null | undefined)[];
  clienteGrupo?: string | null;
  vistaAgrupada: boolean;
  objectiveIdActivo?: string | null;
}): OpcionGrupoVista[] {
  const ids = input.objectiveIds;
  const nombres = ids.map((id, i) => String(input.objectiveNames[i] || id).trim() || id);
  const clientes = ids.map((_, i) => String(input.clientes?.[i] || '').trim());
  const grupoCli = String(input.clienteGrupo || '').trim();
  const distintos = new Set(clientes.filter(Boolean));
  const mostrarCliente = distintos.size > 1 || clientes.some((c) => c && grupoCli && c !== grupoCli);
  const opciones: OpcionGrupoVista[] = [{
    id: 'todos',
    nombre: 'Todos (vista agrupada)',
    subtitulo: nombres.join(' · '),
    activa: !!input.vistaAgrupada,
  }];
  ids.forEach((id, i) => {
    const cliente = clientes[i];
    opciones.push({
      id: 'objetivo',
      objectiveId: id,
      nombre: nombres[i],
      subtitulo: mostrarCliente && cliente ? cliente : 'Ver este objetivo',
      activa: !input.vistaAgrupada && input.objectiveIdActivo === id,
    });
  });
  opciones.push({
    id: 'salir',
    nombre: 'Salir del grupo',
    subtitulo: 'Vuelve a ver un objetivo',
    activa: false,
  });
  return opciones;
}
