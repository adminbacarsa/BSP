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

export function textoPlataforma(p: PersonaPlataforma): string {
  const leg = p.legajo ? ` (legajo ${p.legajo})` : '';
  const obj = p.objetivoNombre ? ` · está en ${p.objetivoNombre}` : '';
  return `${p.nombre}${leg}${obj}`;
}

/** Los turnos de otro objetivo no se pisan: el aviso no bloquea el pegado. */
export function avisoSolapeOtroObjetivo(nombre: string, objetivo: string, dias: number): string {
  return `${nombre} tiene turno en ${objetivo || 'otro objetivo'} en ${dias} día(s) de este pegado. Esos turnos no se pisan; el descanso y el solape quedan como aviso.`;
}

export type GuardiaConId = GuardiaPegado & { id?: string };
