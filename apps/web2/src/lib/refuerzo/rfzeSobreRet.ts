import { accionCeldaRfze } from '@/lib/planificacion/refuerzosRapido';
import {
  decisionGuardadoTurnoAjeno,
  esTurnoAjenoAlCrono,
  type TurnoGuardadoMin,
} from '@/lib/planificacion/turnoOtroObjetivo';

export type DocRetRfze = TurnoGuardadoMin & {
  isFrancoTrabajado?: boolean;
};

export type BorradoRetRfze = { id: string; objectiveId: string; empId: string; fecha: string };

export type ResolucionRetRfze =
  | { ok: true; borrar: { id: string; objectiveId: string }[] }
  | { ok: false; motivo: string };

function codigo(d: { code?: string } | null | undefined): string {
  return String(d?.code || '').trim().toUpperCase();
}

/**
 * Qué RET hay que borrar al crear el RFZE.
 * El borrado pelado (`isDeleted`) de un turno ajeno se descarta al guardar; acá se usa el mismo
 * criterio que un turno de trabajo sobre ese RET (`decisionGuardadoTurnoAjeno` con código RFZE).
 * Si el documento o el objetivo no se pueden determinar, no se borra nada y no se debe crear el RFZE.
 */
export function resolverBorradoRetParaRfze(input: {
  docs: readonly DocRetRfze[];
  permitidos: readonly string[];
  volante?: boolean;
  objetivoCrono?: string;
}): ResolucionRetRfze {
  const docs = (input.docs || []).filter((d) => d && d.isDeleted !== true);
  const rets = docs.filter((d) => codigo(d) === 'RET');
  const ajeno = (d: DocRetRfze) => esTurnoAjenoAlCrono(d.objectiveId, input.permitidos);
  const ajenosSinId = rets.filter((d) => ajeno(d) && !String(d.id || '').trim());
  const ajenosConId = rets.filter((d) => ajeno(d) && String(d.id || '').trim());
  if (ajenosSinId.length && !ajenosConId.length) {
    return { ok: false, motivo: 'No se pudo identificar el documento del RET de otro objetivo. No se creó el RFZE.' };
  }
  const conId = rets.filter((d) => String(d.id || '').trim());
  if (!conId.length) return { ok: true, borrar: [] };

  const decision = decisionGuardadoTurnoAjeno({
    cambio: { code: 'RFZE', isDeleted: false },
    docs,
    permitidos: input.permitidos,
    volante: input.volante,
  });
  if (!decision.escribir) {
    return { ok: false, motivo: 'No se puede borrar el RET de otro objetivo. No se creó el RFZE.' };
  }

  const borrar: { id: string; objectiveId: string }[] = [];
  for (const ret of conId) {
    const id = String(ret.id);
    if (!decision.borrarIds.includes(id)) {
      return { ok: false, motivo: 'No se puede borrar el RET de otro objetivo. No se creó el RFZE.' };
    }
    const ajeno = esTurnoAjenoAlCrono(ret.objectiveId, input.permitidos);
    const objectiveId = String(ret.objectiveId || '').trim() || (ajeno ? '' : String(input.objetivoCrono || '').trim());
    if (!objectiveId) {
      return { ok: false, motivo: 'No se pudo determinar el objetivo del RET. No se creó el RFZE.' };
    }
    borrar.push({ id, objectiveId });
  }
  return { ok: true, borrar };
}

export type CeldaPrepRfze = {
  empId: string;
  empName: string;
  ds: string;
  r: number;
  c: number;
  celda: { code?: string; isFranco?: boolean; isFrancoTrabajado?: boolean; isDeleted?: boolean } | null;
  docs: readonly DocRetRfze[];
};

export function prepararRfzeSobreCeldas(input: {
  celdas: readonly CeldaPrepRfze[];
  permitidos: readonly string[];
  objetivoCrono: string;
  volanteDe?: (empId: string) => boolean;
}): {
  crear: CeldaPrepRfze[];
  borrarRet: BorradoRetRfze[];
  clavesPendienteRet: string[];
  rfzf: CeldaPrepRfze[];
  avisos: string[];
  salteados: string[];
} {
  const crear: CeldaPrepRfze[] = [];
  const borrarRet: BorradoRetRfze[] = [];
  const clavesPendienteRet: string[] = [];
  const rfzf: CeldaPrepRfze[] = [];
  const avisos: string[] = [];
  const salteados: string[] = [];
  const vistos = new Set<string>();

  for (const celda of input.celdas) {
    const accion = accionCeldaRfze(celda.celda);
    const code = codigo(celda.celda);
    const quien = `${(celda.empName || 'El guardia').split(',')[0]} ${String(celda.ds || '').slice(8, 10)}`;
    if (accion === 'saltear') {
      salteados.push(`${quien} (${code})`);
      continue;
    }
    if (accion === 'reemplazar' && code === 'RET') {
      const res = resolverBorradoRetParaRfze({
        docs: celda.docs,
        permitidos: input.permitidos,
        volante: input.volanteDe?.(celda.empId) === true,
        objetivoCrono: input.objetivoCrono,
      });
      if (res.ok === false) {
        avisos.push(`${quien}: ${res.motivo}`);
        continue;
      }
      crear.push(celda);
      clavesPendienteRet.push(`${celda.empId}_${celda.ds}`);
      for (const b of res.borrar) {
        if (vistos.has(b.id)) continue;
        vistos.add(b.id);
        borrarRet.push({ ...b, empId: celda.empId, fecha: celda.ds });
      }
      continue;
    }
    if (accion === 'reemplazar') {
      rfzf.push(celda);
      crear.push(celda);
      continue;
    }
    crear.push(celda);
  }

  return { crear, borrarRet, clavesPendienteRet, rfzf, avisos, salteados };
}

export function docsRetDeCelda(
  lista: readonly DocRetRfze[] | null | undefined,
  guardado: DocRetRfze | null | undefined,
  visible: DocRetRfze | null | undefined,
): DocRetRfze[] {
  const out: DocRetRfze[] = [];
  const push = (d: DocRetRfze | null | undefined) => {
    if (!d || d.isDeleted === true) return;
    const id = String(d.id || '').trim();
    if (id && out.some((x) => x.id === id)) return;
    out.push({
      id: id || undefined,
      objectiveId: d.objectiveId,
      code: d.code,
      isDeleted: d.isDeleted,
      isSecondBlock: d.isSecondBlock,
      isFrancoTrabajado: d.isFrancoTrabajado,
    });
  };
  for (const d of lista || []) push(d);
  push(guardado);
  push(visible);
  return out;
}

export function diaSiguienteIso(ds: string): string {
  const [y, m, d] = ds.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
  dt.setDate(dt.getDate() + 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/** Reloj local del turno. El escritor lo persiste con Timestamp.fromDate, no como string. */
export function camposRelojTurnoRfze(fecha: string, inicio: string, fin: string): { startTime: Date; endTime: Date } {
  const instante = (dia: string, hm: string) => {
    const [y, m, d] = dia.split('-').map(Number);
    const [hh, mm] = hm.split(':').map(Number);
    return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0);
  };
  const cruza = fin <= inicio;
  return {
    startTime: instante(fecha, inicio),
    endTime: instante(cruza ? diaSiguienteIso(fecha) : fecha, fin),
  };
}

export type EscrituraRfze =
  | { tipo: 'delete'; id: string }
  | { tipo: 'turno'; id: string; fecha: string; startTime: Date; endTime: Date };

/** Borrado y alta juntos. Sin fechas no se emite el delete: no queda el RET borrado sin RFZE. */
export function armarEscriturasRfze(input: {
  fechas: readonly string[];
  inicio: string;
  fin: string;
  borrarTurnoIds?: readonly string[];
  turnoIds?: readonly string[];
}): EscrituraRfze[] {
  const fechas = [...input.fechas];
  if (!fechas.length) return [];
  const out: EscrituraRfze[] = [];
  const ya = new Set<string>();
  for (const id of input.borrarTurnoIds || []) {
    const limpio = String(id || '').trim();
    if (!limpio || ya.has(limpio)) continue;
    ya.add(limpio);
    out.push({ tipo: 'delete', id: limpio });
  }
  fechas.forEach((fecha, i) => {
    const reloj = camposRelojTurnoRfze(fecha, input.inicio, input.fin);
    out.push({
      tipo: 'turno',
      id: input.turnoIds?.[i] || `turno-${i}`,
      fecha,
      startTime: reloj.startTime,
      endTime: reloj.endTime,
    });
  });
  return out;
}
