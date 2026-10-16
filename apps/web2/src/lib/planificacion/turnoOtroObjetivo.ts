/**
 * Un turno cuyo objetivo no es el del cronograma abierto (ni uno del grupo, en la vista
 * mezclada) se ve y no se toca. La clave de la grilla es empId_fecha: pisarla borra
 * el turno del otro objetivo.
 */

export type TurnoGuardadoMin = {
  id?: string;
  objectiveId?: string | null;
  isSecondBlock?: boolean;
  isDeleted?: boolean;
  code?: string;
  isFrancoTrabajado?: boolean;
};

const FRANCOS = new Set(['F', 'FF', 'FP']);

function codigoDe(d: { code?: string } | null | undefined): string {
  return String(d?.code || '').trim().toUpperCase();
}

/**
 * Franco o RET de otro objetivo (el que trabaja de lunes a viernes en otro lado y está de franco el finde):
 * desde este cronograma se puede pasar F ↔ RET (no es franco trabajado) y al RET asignarle un turno de acá.
 * Sus turnos de trabajo siguen sin tocarse.
 */
export function esAjenoFlexible(d: { code?: string; isFrancoTrabajado?: boolean } | null | undefined): boolean {
  if (!d || d.isFrancoTrabajado) return false;
  const c = codigoDe(d);
  return FRANCOS.has(c) || c === 'RET';
}

export function idsObjetivosDelCrono(
  objetivoActual: string | null | undefined,
  objetivosGrupo: readonly string[] | null | undefined,
  grupoUnificado: boolean,
): string[] {
  if (grupoUnificado && objetivosGrupo && objetivosGrupo.length > 0) {
    return objetivosGrupo.map((id) => String(id));
  }
  return objetivoActual ? [String(objetivoActual)] : [];
}

/** Sin objectiveId no es ajeno: el turno viejo pertenece a este cronograma. */
export function esTurnoAjenoAlCrono(
  objectiveId: string | null | undefined,
  permitidos: readonly string[],
): boolean {
  if (objectiveId == null || String(objectiveId).trim() === '') return false;
  if (!permitidos.length) return false;
  return !permitidos.includes(String(objectiveId));
}

/** Celda de otro objetivo: no se edita, ni en la vista simple ni en la agrupada. */
export function celdaOtroObjetivoBloqueada(
  shift: { objectiveId?: string | null; isDeleted?: boolean; isSecondBlock?: boolean } | null | undefined,
  permitidos: readonly string[],
): boolean {
  if (!shift || shift.isDeleted || shift.isSecondBlock) return false;
  if (esAjenoFlexible(shift as { code?: string; isFrancoTrabajado?: boolean })) return false;
  return esTurnoAjenoAlCrono(shift.objectiveId, permitidos);
}

/** Pegar y la asignación masiva saltean esa celda. */
export function saltearEscrituraTurnoAjeno(
  existente: { objectiveId?: string | null; isDeleted?: boolean; isSecondBlock?: boolean } | null | undefined,
  permitidos: readonly string[],
): boolean {
  return celdaOtroObjetivoBloqueada(existente, permitidos);
}

export function textoAvisoFrancoAjeno(nombre: string, objetivo: string): string {
  const n = (nombre || 'El guardia').trim() || 'El guardia';
  const o = (objetivo || 'otro objetivo').trim() || 'otro objetivo';
  return `${n} está de franco en ${o}: pasalo a RET y asignale el turno, o cargalo como franco trabajado (FT)`;
}

export function textoAvisoTurnoAjeno(nombre: string, objetivo: string): string {
  const n = (nombre || 'El guardia').trim() || 'El guardia';
  const o = (objetivo || 'otro objetivo').trim() || 'otro objetivo';
  return `${n} tiene turno en ${o} ese día`;
}

export type DecisionGuardadoAjeno = {
  escribir: boolean;
  /** Docs que se borran antes de reescribir: los de este cronograma y, si corresponde, el F/RET ajeno. */
  borrarIds: string[];
  rechazado: boolean;
  /** F ↔ RET de otro objetivo: el turno se reescribe en ese objetivo, no en este. */
  objetivoAjeno?: string;
  /** El doc ajeno que se reemplaza (para conservar su borrador/publicado). */
  ajeno?: TurnoGuardadoMin;
  /** Rechazo por turno de trabajo sobre un franco ajeno: primero RET. */
  motivo?: 'franco';
};

/**
 * Antes de escribir: si el doc de Firestore es de otro objetivo, no se pisa.
 * Un segundo bloque válido crea un doc nuevo y deja el ajeno. Si no, se rechaza.
 */
export function decisionGuardadoTurnoAjeno(input: {
  cambio: { isDeleted?: boolean; isSecondBlock?: boolean; code?: string; isFrancoTrabajado?: boolean } | null | undefined;
  docs: readonly TurnoGuardadoMin[];
  permitidos: readonly string[];
}): DecisionGuardadoAjeno {
  const docs = (input.docs || []).filter((d) => d && d.isDeleted !== true);
  const ajeno = (d: TurnoGuardadoMin) => esTurnoAjenoAlCrono(d.objectiveId, input.permitidos);
  const ajenosPrimarios = docs.filter((d) => ajeno(d) && !d.isSecondBlock);
  const propios = docs.filter((d) => !ajeno(d));
  const ids = (lista: TurnoGuardadoMin[]) => lista.map((d) => d.id).filter((id): id is string => !!id);

  if (!ajenosPrimarios.length) {
    return { escribir: true, borrarIds: ids(propios), rechazado: false };
  }

  // F/RET de otro objetivo: F ↔ RET queda en su objetivo; un turno de trabajo reemplaza al RET (no al F).
  if (ajenosPrimarios.every((d) => esAjenoFlexible(d)) && input.cambio?.isDeleted !== true && input.cambio?.isSecondBlock !== true) {
    const ajeno = ajenosPrimarios[0];
    const nuevo = codigoDe(input.cambio);
    const borrar = ids([...ajenosPrimarios, ...propios]);
    if ((FRANCOS.has(nuevo) || nuevo === 'RET') && !input.cambio?.isFrancoTrabajado) {
      return { escribir: true, borrarIds: borrar, rechazado: false, objetivoAjeno: String(ajeno.objectiveId || ''), ajeno };
    }
    // Turno directo sobre su F: vale solo como franco trabajado (FT, horas extra); si no, primero RET.
    if (ajenosPrimarios.some((d) => FRANCOS.has(codigoDe(d))) && !input.cambio?.isFrancoTrabajado) {
      return { escribir: false, borrarIds: [], rechazado: true, motivo: 'franco' };
    }
    return { escribir: true, borrarIds: borrar, rechazado: false, ajeno };
  }

  const segundo = input.cambio?.isSecondBlock === true && input.cambio?.isDeleted !== true;
  if (segundo) {
    return {
      escribir: true,
      borrarIds: ids(propios.filter((d) => d.isSecondBlock)),
      rechazado: false,
    };
  }

  if (propios.some((d) => !d.isSecondBlock)) {
    return { escribir: true, borrarIds: ids(propios), rechazado: false };
  }

  return { escribir: false, borrarIds: [], rechazado: true };
}

export function sanearPendientesTurnoAjeno(input: {
  prev: Record<string, any>;
  next: Record<string, any>;
  docsPorClave: Record<string, readonly TurnoGuardadoMin[]>;
  permitidos: readonly string[];
}): { changes: Record<string, any>; rechazadas: { key: string; objectiveId: string; motivo?: 'franco' }[] } {
  const prev = input.prev || {};
  const next = input.next || {};
  const rechazadas: { key: string; objectiveId: string; motivo?: 'franco' }[] = [];
  let changes: Record<string, any> = next;
  for (const key of Object.keys(next)) {
    if (prev[key] === next[key]) continue;
    const cambio = next[key];
    if (cambio == null) continue;
    const docsKey = key.endsWith('_B2') ? key.slice(0, -3) : key;
    const docs = input.docsPorClave[docsKey] || [];
    const decision = decisionGuardadoTurnoAjeno({
      cambio: {
        isDeleted: cambio.isDeleted === true,
        isSecondBlock: cambio.isSecondBlock === true || key.endsWith('_B2'),
        code: cambio.code,
        isFrancoTrabajado: cambio.isFrancoTrabajado === true,
      },
      docs,
      permitidos: input.permitidos,
    });
    if (!decision.escribir) {
      if (changes === next) changes = { ...next };
      if (prev[key] !== undefined) changes[key] = prev[key];
      else delete changes[key];
      const ajeno = docs.find((d) => esTurnoAjenoAlCrono(d.objectiveId, input.permitidos) && !d.isSecondBlock);
      rechazadas.push({ key, objectiveId: String(ajeno?.objectiveId || ''), ...(decision.motivo ? { motivo: decision.motivo } : {}) });
    }
  }
  return { changes, rechazadas };
}
