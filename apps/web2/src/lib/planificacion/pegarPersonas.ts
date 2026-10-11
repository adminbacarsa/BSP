/**
 * Al pegar nombres que no están en la grilla del objetivo: primero la plataforma,
 * después el padrón, y si no está en ninguno queda el alta manual.
 */
import { buscarEnPadron, type FilaPadron } from './padronAlta';
import { elegirGuardia, type FilaPegadoExcel, type GuardiaPegado } from './modoRapido';

export type PersonaPlataforma = {
  id: string;
  nombre: string;
  legajo: string;
  objetivoNombre: string;
  empresaId?: string;
};

export type FilaEnPlataforma = { fila: FilaPegadoExcel; persona: PersonaPlataforma };
export type FilaParaAlta = { fila: FilaPegadoExcel; enPadron: boolean; padron: FilaPadron | null };

export type GruposPegado = {
  enGrilla: FilaPegadoExcel[];
  enPlataforma: FilaEnPlataforma[];
  paraAlta: FilaParaAlta[];
};

export function clasificarPegado(
  filas: FilaPegadoExcel[],
  plataforma: PersonaPlataforma[],
  padron: FilaPadron[] | null,
): GruposPegado {
  const enGrilla: FilaPegadoExcel[] = [];
  const enPlataforma: FilaEnPlataforma[] = [];
  const paraAlta: FilaParaAlta[] = [];
  const ocupadas = new Set<number>();
  const guardias = plataforma.map((p, i) => ({ fila: i, nombre: p.nombre, legajo: p.legajo }));
  for (const fila of filas) {
    if (fila.filaGrilla != null) {
      enGrilla.push(fila);
      continue;
    }
    const hit = elegirGuardia(fila.nombre, fila.legajo, guardias, ocupadas);
    if (hit) {
      ocupadas.add(hit.fila);
      enPlataforma.push({ fila, persona: plataforma[hit.fila] });
      continue;
    }
    const enPad = padron?.length ? buscarEnPadron(padron, { legajo: fila.legajo, nombre: fila.nombre }) : null;
    paraAlta.push({ fila, enPadron: !!enPad, padron: enPad?.fila || null });
  }
  return { enGrilla, enPlataforma, paraAlta };
}

export function textoGruposPegado(g: GruposPegado): string {
  return `En la grilla (${g.enGrilla.length}) · En la plataforma, se agregan (${g.enPlataforma.length}) · Para dar de alta (${g.paraAlta.length})`;
}

export const SIN_OBJETIVO = 'sin objetivo asignado';

export type ObjetivoCatalogo = { id: string; nombre: string; cliente: string };

export type TurnoLugar = { employeeId: string; objectiveId: string; date: string };

/** `clients.objetivos` de la empresa: id, nombre visible y cliente. */
export function catalogoObjetivos(clients: Array<{ name?: string; objetivos?: Array<{ id?: string; name?: string; nombre?: string }> }>): ObjetivoCatalogo[] {
  const out: ObjetivoCatalogo[] = [];
  for (const c of clients || []) {
    for (const o of c.objetivos || []) {
      const nombre = String(o?.name || o?.nombre || '').trim();
      const id = String(o?.id || nombre).trim();
      if (!id && !nombre) continue;
      out.push({ id: id || nombre, nombre: nombre || id, cliente: String(c?.name || '').trim() });
    }
  }
  return out;
}

/** Turnos del mapa de la grilla (clave `empleado_yyyy-mm-dd`). */
export function turnosLugarDeMapa(shiftsMap: Record<string, { employeeId?: string; objectiveId?: string; scheduleDate?: string; isDeleted?: boolean } | null | undefined>): TurnoLugar[] {
  const out: TurnoLugar[] = [];
  for (const [key, s] of Object.entries(shiftsMap || {})) {
    if (!s || s.isDeleted) continue;
    const m = key.match(/_(\d{4}-\d{2}-\d{2})$/);
    const date = String(s.scheduleDate || m?.[1] || '');
    const employeeId = String(s.employeeId || (m ? key.slice(0, key.length - 11) : ''));
    const objectiveId = String(s.objectiveId || '').trim();
    if (!employeeId || !objectiveId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    out.push({ employeeId, objectiveId, date });
  }
  return out;
}

function resolverLugar(clave: string, objetivos: ObjetivoCatalogo[]): string {
  const id = String(clave || '').trim();
  if (!id || id === 'Desconocido' || id === 'undefined') return '';
  const o = objetivos.find((x) => x.id === id || x.nombre === id);
  if (!o?.nombre) return '';
  return o.cliente ? `${o.cliente} · ${o.nombre}` : o.nombre;
}

/**
 * Dónde trabaja: si este mes tiene turnos, el objetivo de esos turnos
 * (si hay varios, el que más días tiene; empate, el preferido).
 * Si no, el objetivo preferido. Siempre resuelto contra el catálogo.
 */
export function lugarDeGuardia(input: {
  employeeId: string;
  preferredObjectiveId?: string | null;
  month: string;
  turnos: TurnoLugar[];
  objetivos: ObjetivoCatalogo[];
}): string {
  const preferido = String(input.preferredObjectiveId || '').trim();
  const conteo = new Map<string, number>();
  for (const t of input.turnos) {
    if (t.employeeId !== input.employeeId) continue;
    if (input.month && !String(t.date || '').startsWith(`${input.month}-`)) continue;
    const id = String(t.objectiveId || '').trim();
    if (!id) continue;
    conteo.set(id, (conteo.get(id) || 0) + 1);
  }
  let elegido = '';
  let max = 0;
  for (const id of [...conteo.keys()].sort()) {
    const n = conteo.get(id) || 0;
    if (n > max || (n === max && n > 0 && id === preferido)) {
      max = n;
      elegido = id;
    }
  }
  if (!elegido) elegido = preferido;
  return etiquetaLugar(resolverLugar(elegido, input.objetivos));
}

export function etiquetaLugar(nombre?: string | null): string {
  const s = String(nombre || '').trim();
  if (!s || s === 'Desconocido' || s === 'undefined') return SIN_OBJETIVO;
  return s;
}

/** Índices de las filas del pegado que ya tienen guardia en la grilla. No son las filas de la grilla. */
export function indicesAsignados(asignacion: Record<number, number | null | undefined>): Set<number> {
  return new Set(Object.entries(asignacion).filter(([, v]) => v != null).map(([k]) => Number(k)));
}

/** Quien ya está en la grilla o en la plataforma no cuenta como «sin encontrar». */
export function sinEncontrarVisibles(
  filas: Array<{ indice: number; nombre: string }>,
  asignados: ReadonlySet<number>,
  enPlataforma: ReadonlySet<number>,
): string[] {
  return filas.filter((f) => !asignados.has(f.indice) && !enPlataforma.has(f.indice)).map((f) => f.nombre);
}

export function textoPlataforma(p: PersonaPlataforma): string {
  const leg = p.legajo ? ` (legajo ${p.legajo})` : '';
  return `${p.nombre}${leg} · está en ${etiquetaLugar(p.objetivoNombre)}`;
}

/** Los turnos de otro objetivo no se pisan: el aviso no bloquea el pegado. */
export function avisoSolapeOtroObjetivo(nombre: string, objetivo: string, dias: number): string {
  return `${nombre} tiene turno en ${objetivo || 'otro objetivo'} en ${dias} día(s) de este pegado. Esos turnos no se pisan; el descanso y el solape quedan como aviso.`;
}

export type GuardiaConId = GuardiaPegado & { id?: string };
