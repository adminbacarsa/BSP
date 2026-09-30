import { normalizeCuil } from './cuil.mjs';
import { COTEJO_EMPRESA_IDS, GRUPO_EVENTUALES_ID, IMPORT_CREATED_BY } from './grupo.mjs';

const ABIERTOS = new Set(['BORRADOR', 'DOCUMENTADO', 'ACUSE_RECIBIDO', 'ALTA_ARCA', 'VIGENTE']);

export function classifyEstadoActual(raw) {
  const s = String(raw ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
  if (s.includes('EFECTIV')) return 'EFECTIVIZADO';
  if (s.includes('GOLONDRINA')) return 'GOLONDRINA';
  if (s.includes('BAJA')) return 'BAJA';
  if (s.includes('ACTIVO')) return 'ACTIVO';
  return 'DESCONOCIDO';
}

export function esActivo(status) {
  const s = String(status || '').trim().toLowerCase();
  return s === 'activo' || s === 'active';
}

/** Planta permanente: modalidad indeterminada, o legajo activo todavía sin modalidad. */
export function esPlantaPermanente(empleado) {
  const modalidad = String(empleado?.modalidad || '').trim();
  if (modalidad === 'INDETERMINADO') return true;
  if (!modalidad && esActivo(empleado?.status)) return true;
  return false;
}

export function esEventualCargado(empleado) {
  const modalidad = String(empleado?.modalidad || '').trim();
  return modalidad === 'EVENTUAL' || modalidad === 'PLAZO_FIJO';
}

export function claseEnEmpresa(matches) {
  if (!matches?.length) return 'NO_EXISTE';
  if (matches.some(esPlantaPermanente)) return 'PLANTA_PERMANENTE';
  if (matches.some(esEventualCargado)) return 'EVENTUAL';
  return 'NO_EXISTE';
}

/**
 * Pregunta abierta para Mauro. No es el estado ARCA.
 * Hipótesis: ACTIVO sigue convocable; BAJA queda fuera, como histórico.
 */
export const PLANILLA_ENTRA_BOLSA = {
  ACTIVO: true,
  BAJA: false,
  GOLONDRINA: true,
};

export const PLANILLA_DISPONIBILIDAD = {
  ACTIVO: 'DISPONIBLE',
  BAJA: 'NO_DISPONIBLE',
  GOLONDRINA: 'DISPONIBLE',
};

/** Las fechas de la planilla van al historial. La bolsa no guarda un alta vigente. */
export function historialPlanilla({ ingreso, fechaBaja }) {
  const historial = [];
  if (ingreso) historial.push({ estado: 'ALTA', fecha: ingreso, origen: 'IMPORT_PLANILLA', contratoId: null });
  if (fechaBaja) historial.push({ estado: 'BAJA', fecha: fechaBaja, origen: 'IMPORT_PLANILLA', contratoId: null });
  return historial;
}

/** true en la 2ª aparición (y siguientes) del mismo legajo o del mismo CUIL. */
export function repetidosEnPlanilla(rows) {
  const seenLegajo = new Set();
  const seenCuil = new Set();
  return rows.map((row) => {
    const legajo = String(row.legajo || '').trim();
    const cuil = normalizeCuil(row.cuilRaw);
    let repetido = false;
    if (legajo) {
      if (seenLegajo.has(legajo)) repetido = true;
      else seenLegajo.add(legajo);
    }
    if (cuil) {
      if (seenCuil.has(cuil)) repetido = true;
      else seenCuil.add(cuil);
    }
    return repetido;
  });
}

function dedupeEmpleados(list) {
  const byId = new Map();
  for (const item of list || []) {
    const key = `${item.empresaId}:${item.employeeId}`;
    if (!byId.has(key)) byId.set(key, item);
  }
  return [...byId.values()];
}

/** Id de `eventuales_bolsa`: el CUIL normalizado. Re-correr el import pisa el mismo doc. */
export function bolsaDocId(cuil) {
  return cuil || null;
}

/** Ficha de la bolsa. No trae legajo de empresa: eso nace con el alta (contrato + ARCA). */
export function buildBolsaDoc({ nombre, legajo, ingreso }, plan) {
  return {
    grupoId: GRUPO_EVENTUALES_ID,
    cuil: plan.cuil,
    nombre: nombre || '',
    legajoPlanilla: String(legajo || '').trim(),
    primerIngreso: ingreso || '',
    disponibilidad: plan.disponibilidad,
    riesgoEncadenamiento: Boolean(plan.riesgoEncadenamiento),
    arcaHistorial: plan.arcaHistorial || [],
    createdBy: IMPORT_CREATED_BY,
  };
}

/**
 * Qué haría el import con una fila. Solo bolsa, nunca legajos.
 * No entra quien ya es planta permanente en el cotejo, ni efectivizados, ni repetidos.
 */
export function planImportRow({
  estadoRaw,
  cuilRaw,
  ingreso,
  fechaBaja,
  matches,
  repetidoEnPlanilla,
  entraBolsaPorEstado = PLANILLA_ENTRA_BOLSA,
  disponibilidadPorEstado = PLANILLA_DISPONIBILIDAD,
}) {
  const estado = classifyEstadoActual(estadoRaw);
  const cuil = normalizeCuil(cuilRaw);
  const legajos = dedupeEmpleados(matches);
  const legajoExiste = legajos.length > 0;
  const porEmpresa = {};
  for (const empresaId of COTEJO_EMPRESA_IDS) {
    porEmpresa[empresaId] = claseEnEmpresa(legajos.filter((m) => m.empresaId === empresaId));
  }
  const duplicadoPlanta = legajos.some(esPlantaPermanente);
  const indeterminadoConFecha = legajos.some(
    (m) => m.modalidad === 'INDETERMINADO' && String(m.fechaEfectivizacion || '').trim() !== '',
  );

  const base = {
    estado,
    cuil,
    legajoExiste,
    porEmpresa,
    duplicadoPlanta,
    repetidoEnPlanilla: Boolean(repetidoEnPlanilla),
    indeterminadoConFecha,
    entraBolsa: false,
    disponibilidad: 'NO_DISPONIBLE',
    riesgoEncadenamiento: estado === 'GOLONDRINA',
    arcaHistorial: historialPlanilla({ ingreso, fechaBaja }),
  };

  if (!cuil) return { ...base, bucket: 'CUIL_INVALIDO' };
  if (estado === 'EFECTIVIZADO') return { ...base, bucket: 'EFECTIVIZADO_FUERA_DE_BOLSA' };
  if (estado === 'DESCONOCIDO') return { ...base, bucket: 'ESTADO_DESCONOCIDO' };
  if (repetidoEnPlanilla) return { ...base, bucket: 'REPETIDO_PLANILLA' };

  if (duplicadoPlanta) return { ...base, bucket: 'DUPLICADO_PLANTA' };

  const entra = Boolean(entraBolsaPorEstado[estado]);
  return {
    ...base,
    bucket: estado,
    entraBolsa: entra,
    disponibilidad: disponibilidadPorEstado[estado] || 'NO_DISPONIBLE',
  };
}

export function contratosAbiertosDeEmpresa(contratos, empresaId) {
  return (contratos || []).filter(
    (c) => c.empresaId === empresaId && c.status !== 'INACTIVE' && ABIERTOS.has(c.estado),
  );
}
