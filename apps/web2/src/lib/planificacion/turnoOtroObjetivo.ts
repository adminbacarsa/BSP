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
};

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
  return esTurnoAjenoAlCrono(shift.objectiveId, permitidos);
}

/** Pegar y la asignación masiva saltean esa celda. */
export function saltearEscrituraTurnoAjeno(
  existente: { objectiveId?: string | null; isDeleted?: boolean; isSecondBlock?: boolean } | null | undefined,
  permitidos: readonly string[],
): boolean {
  return celdaOtroObjetivoBloqueada(existente, permitidos);
}

export function textoAvisoTurnoAjeno(nombre: string, objetivo: string): string {
  const n = (nombre || 'El guardia').trim() || 'El guardia';
  const o = (objetivo || 'otro objetivo').trim() || 'otro objetivo';
  return `${n} tiene turno en ${o} ese día`;
}

export type DecisionGuardadoAjeno = {
  escribir: boolean;
  /** Docs de ESTE cronograma que se pueden borrar antes de reescribir. Los ajenos no entran. */
  borrarIds: string[];
  rechazado: boolean;
};

/**
 * Antes de escribir: si el doc de Firestore es de otro objetivo, no se pisa.
 * Un segundo bloque válido crea un doc nuevo y deja el ajeno. Si no, se rechaza.
 */
export function decisionGuardadoTurnoAjeno(input: {
  cambio: { isDeleted?: boolean; isSecondBlock?: boolean } | null | undefined;
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
}): { changes: Record<string, any>; rechazadas: { key: string; objectiveId: string }[] } {
  const prev = input.prev || {};
  const next = input.next || {};
  const rechazadas: { key: string; objectiveId: string }[] = [];
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
      },
      docs,
      permitidos: input.permitidos,
    });
    if (!decision.escribir) {
      if (changes === next) changes = { ...next };
      if (prev[key] !== undefined) changes[key] = prev[key];
      else delete changes[key];
      const ajeno = docs.find((d) => esTurnoAjenoAlCrono(d.objectiveId, input.permitidos) && !d.isSecondBlock);
      rechazadas.push({ key, objectiveId: String(ajeno?.objectiveId || '') });
    }
  }
  return { changes, rechazadas };
}
