/**
 * En la vista agrupada el puesto pertenece al objetivo cuyo SLA lo tiene.
 * No se guarda en el primer objetivo del grupo si ese SLA no incluye el puesto.
 */

import { normalizePlanningPositionName } from './positionCoverageUnits';

export type ObjetivoConPuestos = {
  id: string;
  name?: string;
  puestos: readonly string[];
};

export type CandidatoObjetivo = { id: string; name: string };

export type DecisionObjetivoPuesto =
  | { ok: true; objectiveId: string; motivo: 'unico' | 'preferido' | 'turno-mes' | 'elegido' | 'sin-puesto' }
  | { ok: false; motivo: 'ambiguo'; candidatos: CandidatoObjetivo[]; puesto: string }
  | { ok: false; motivo: 'fuera'; puesto: string };

const SIN_PUESTO = new Set(['', 'general']);

export function esPuestoReal(name: unknown): boolean {
  const n = normalizePlanningPositionName(name);
  return n.length > 0 && !SIN_PUESTO.has(n);
}

export function empIdDeClaveTurno(key: string): string {
  const m = String(key).match(/^(.*)_(\d{4}-\d{2}-\d{2})(?:_B2)?$/);
  return m ? m[1] : String(key).split('_')[0];
}

export function fechaDeClaveTurno(key: string): string {
  const m = String(key).match(/_(\d{4}-\d{2}-\d{2})(?:_B2)?$/);
  return m ? m[1] : '';
}

export function clavePuestoGuardia(empId: string, positionName: unknown): string {
  return `${empId}|${normalizePlanningPositionName(positionName)}`;
}

export function objetivosConElPuesto(
  positionName: unknown,
  objetivos: readonly ObjetivoConPuestos[],
): CandidatoObjetivo[] {
  const n = normalizePlanningPositionName(positionName);
  if (!n) return [];
  const out: CandidatoObjetivo[] = [];
  for (const obj of objetivos) {
    const tiene = (obj.puestos || []).some((p) => normalizePlanningPositionName(p) === n);
    if (tiene) out.push({ id: String(obj.id), name: String(obj.name || obj.id) });
  }
  return out;
}

/**
 * Un puesto en un solo objetivo del grupo va a ese objetivo, aunque el guardia
 * prefiera otro. Si está en varios, manda la elección, después el preferido y
 * después el objetivo de sus turnos del mes. Si no se puede, hay que elegir.
 * General / vacío no es un puesto del SLA.
 */
export function resolverObjetivoDelPuesto(input: {
  positionName: unknown;
  objetivos: readonly ObjetivoConPuestos[];
  preferidoId?: string | null;
  objetivosDelMes?: readonly string[] | null;
  elegidoId?: string | null;
  respaldoId?: string | null;
}): DecisionObjetivoPuesto {
  const puesto = String(input.positionName ?? '').trim();
  if (!esPuestoReal(puesto)) {
    const id = String(input.respaldoId || input.preferidoId || '').trim();
    return { ok: true, objectiveId: id, motivo: 'sin-puesto' };
  }
  const candidatos = objetivosConElPuesto(puesto, input.objetivos);
  if (candidatos.length === 0) return { ok: false, motivo: 'fuera', puesto };
  const elegido = String(input.elegidoId || '').trim();
  if (elegido && candidatos.some((c) => c.id === elegido)) {
    return { ok: true, objectiveId: elegido, motivo: 'elegido' };
  }
  if (candidatos.length === 1) {
    return { ok: true, objectiveId: candidatos[0].id, motivo: 'unico' };
  }
  const preferido = String(input.preferidoId || '').trim();
  if (preferido && candidatos.some((c) => c.id === preferido)) {
    return { ok: true, objectiveId: preferido, motivo: 'preferido' };
  }
  const delMes = [...new Set(
    (input.objetivosDelMes || []).map(String).filter((id) => candidatos.some((c) => c.id === id)),
  )];
  if (delMes.length === 1) return { ok: true, objectiveId: delMes[0], motivo: 'turno-mes' };
  return { ok: false, motivo: 'ambiguo', candidatos, puesto };
}

export type CambioConPuesto = {
  isDeleted?: boolean;
  positionName?: string | null;
  objectiveId?: string | null;
  puestoObjetivoElegido?: string | null;
};

export type AmbiguoPuesto = {
  key: string;
  empId: string;
  puesto: string;
  candidatos: CandidatoObjetivo[];
  clave: string;
};

export type FilaElegirPuesto = {
  clave: string;
  empId: string;
  puesto: string;
  candidatos: CandidatoObjetivo[];
  keys: string[];
  fechas: string[];
};

/**
 * Reescribe objectiveId de cada cambio según el puesto.
 * Un objectiveId ya cargado (el primero del grupo) no se conserva si el SLA no tiene ese puesto.
 */
export function aplicarObjetivosDePuesto<T extends CambioConPuesto>(
  changes: Record<string, T>,
  ctx: {
    objetivos: readonly ObjetivoConPuestos[];
    preferidoDe: (empId: string) => string | null | undefined;
    objetivosDelMesDe: (empId: string) => readonly string[];
    respaldoDe?: (empId: string) => string | null | undefined;
    elecciones?: Record<string, string> | null;
  },
): {
  changes: Record<string, T>;
  fuera: { key: string; empId: string; puesto: string }[];
  ambiguos: AmbiguoPuesto[];
} {
  const next: Record<string, T> = { ...changes };
  const fuera: { key: string; empId: string; puesto: string }[] = [];
  const ambiguos: AmbiguoPuesto[] = [];
  for (const [key, change] of Object.entries(changes)) {
    if (!change || change.isDeleted) continue;
    const empId = empIdDeClaveTurno(key);
    const puesto = String(change.positionName || '').trim();
    const clave = clavePuestoGuardia(empId, puesto);
    const decision = resolverObjetivoDelPuesto({
      positionName: puesto,
      objetivos: ctx.objetivos,
      preferidoId: ctx.preferidoDe(empId),
      objetivosDelMes: ctx.objetivosDelMesDe(empId),
      elegidoId: ctx.elecciones?.[clave] || change.puestoObjetivoElegido || null,
      respaldoId: ctx.respaldoDe?.(empId) || change.objectiveId || null,
    });
    if (!decision.ok && decision.motivo === 'fuera') {
      fuera.push({ key, empId, puesto: decision.puesto });
      continue;
    }
    if (!decision.ok && decision.motivo === 'ambiguo') {
      ambiguos.push({ key, empId, puesto: decision.puesto, candidatos: decision.candidatos, clave });
      continue;
    }
    if (decision.ok && decision.motivo !== 'sin-puesto' && decision.objectiveId) {
      if (String(change.objectiveId || '') !== decision.objectiveId) {
        next[key] = { ...change, objectiveId: decision.objectiveId };
      }
    }
  }
  return { changes: next, fuera, ambiguos };
}

export function agruparAmbiguos(items: readonly AmbiguoPuesto[]): FilaElegirPuesto[] {
  const map = new Map<string, FilaElegirPuesto>();
  for (const item of items) {
    const prev = map.get(item.clave);
    if (!prev) {
      map.set(item.clave, {
        clave: item.clave,
        empId: item.empId,
        puesto: item.puesto,
        candidatos: item.candidatos,
        keys: [item.key],
        fechas: [fechaDeClaveTurno(item.key)].filter(Boolean),
      });
      continue;
    }
    prev.keys.push(item.key);
    const fecha = fechaDeClaveTurno(item.key);
    if (fecha && !prev.fechas.includes(fecha)) prev.fechas.push(fecha);
  }
  return [...map.values()];
}

/** El turno está en un objetivo del grupo cuyo SLA no tiene el puesto, y otro del grupo sí. */
export function turnoPuestoDeOtroObjetivoDelGrupo(input: {
  objectiveId: unknown;
  positionName: unknown;
  objetivos: readonly ObjetivoConPuestos[];
}): { otros: CandidatoObjetivo[] } | null {
  if (!esPuestoReal(input.positionName)) return null;
  const propioId = String(input.objectiveId || '');
  const propio = input.objetivos.find((o) => String(o.id) === propioId);
  if (!propio) return null;
  if (objetivosConElPuesto(input.positionName, [propio]).length > 0) return null;
  const otros = objetivosConElPuesto(
    input.positionName,
    input.objetivos.filter((o) => String(o.id) !== propioId),
  );
  if (!otros.length) return null;
  return { otros };
}
