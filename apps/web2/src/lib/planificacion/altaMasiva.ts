/**
 * Alta de todos los guardias que no se encontraron al importar o pegar, desde el padrón.
 * Solo da de alta lo seguro (legajo o apellido+nombre exactos, activo en el padrón);
 * el resto queda para revisar uno por uno. La validación y el escritor son los del alta de RRHH.
 */
import { buscarEnPadron, estadoEsActivo, formDesdeFila, type AltaForm, type FilaPadron } from './padronAlta';

export type PedidoAltaMasiva = { clave: number; nombre: string; legajo: string };

export type PlanAltaItem =
  | { clave: number; nombre: string; tipo: 'alta'; form: AltaForm }
  | { clave: number; nombre: string; tipo: 'revisar'; motivo: string };

export type ResultadoAltaMasiva = {
  clave: number;
  nombre: string;
  estado: 'creado' | 'habilitado' | 'revisar';
  motivo?: string;
};

export function planAltaMasiva(
  padron: FilaPadron[],
  pedidos: PedidoAltaMasiva[],
  ctx: { empresaId: string; objectiveId: string; clientId: string },
): PlanAltaItem[] {
  const usados = new Map<string, string>();
  return pedidos.map((p): PlanAltaItem => {
    const hit = buscarEnPadron(padron, { legajo: p.legajo, nombre: p.nombre });
    if (!hit) return { clave: p.clave, nombre: p.nombre, tipo: 'revisar', motivo: 'No está en el padrón' };
    const enPadron = `${hit.fila.apellido}, ${hit.fila.nombre}`;
    if (hit.via === 'parecido') {
      return { clave: p.clave, nombre: p.nombre, tipo: 'revisar', motivo: `En el padrón hay uno parecido (${enPadron}): confirmalo a mano` };
    }
    if (hit.fila.estado && !estadoEsActivo(hit.fila.estado)) {
      return { clave: p.clave, nombre: p.nombre, tipo: 'revisar', motivo: `En el padrón figura «${hit.fila.estado}»` };
    }
    const id = `${hit.fila.legajo}|${hit.fila.dni}|${enPadron}`;
    const otro = usados.get(id);
    if (otro) return { clave: p.clave, nombre: p.nombre, tipo: 'revisar', motivo: `Es la misma persona del padrón que ${otro}` };
    usados.set(id, p.nombre);
    return { clave: p.clave, nombre: p.nombre, tipo: 'alta', form: formDesdeFila(hit.fila, ctx) };
  });
}

export function resumenAltaMasiva(res: ResultadoAltaMasiva[]): string {
  const creados = res.filter((r) => r.estado === 'creado').length;
  const habilitados = res.filter((r) => r.estado === 'habilitado').length;
  const revisar = res.filter((r) => r.estado === 'revisar').length;
  const partes: string[] = [];
  if (creados) partes.push(`${creados} ${creados === 1 ? 'dado de alta' : 'dados de alta'}`);
  if (habilitados) partes.push(`${habilitados} ${habilitados === 1 ? 'habilitado' : 'habilitados'} desde otra empresa`);
  if (revisar) partes.push(`${revisar} para revisar`);
  return partes.join(' · ') || 'Nada para dar de alta';
}
