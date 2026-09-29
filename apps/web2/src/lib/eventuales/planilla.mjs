import { normalizeCuil } from './cuil.mjs';
import { COTEJO_EMPRESA_IDS, PLANILLA_EMPRESA_ALTA } from './grupo.mjs';

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
 * ACTIVO y BAJA de la planilla son el estado en ARCA.
 * Golondrina usa la fecha de baja si la tiene; si no, queda en alta.
 */
export function arcaDePlanilla({ estado, ingreso, fechaBaja }) {
  const riesgoEncadenamiento = estado === 'GOLONDRINA';
  const enBaja = estado === 'BAJA' || (estado === 'GOLONDRINA' && Boolean(fechaBaja));
  if (enBaja) {
    const historial = [];
    if (ingreso) historial.push({ estado: 'ALTA', fecha: ingreso, origen: 'IMPORT_PLANILLA' });
    historial.push({ estado: 'BAJA', fecha: fechaBaja || '', origen: 'IMPORT_PLANILLA' });
    return {
      estadoArca: 'BAJA',
      fechaArca: fechaBaja || '',
      requiereAltaNueva: true,
      riesgoEncadenamiento,
      arcaHistorial: historial,
    };
  }
  return {
    estadoArca: 'ALTA',
    fechaArca: ingreso || '',
    requiereAltaNueva: false,
    riesgoEncadenamiento,
    arcaHistorial: [{ estado: 'ALTA', fecha: ingreso || '', origen: 'IMPORT_PLANILLA' }],
  };
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

/**
 * Qué haría el import con una fila. No escribe.
 * EFECTIVIZADOS, planta permanente y quien ya está en pruebas_sa no se suben.
 */
export function planImportRow({
  estadoRaw,
  cuilRaw,
  ingreso,
  fechaBaja,
  matches,
  repetidoEnPlanilla,
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
  const yaEnPruebasSa = legajos.some((m) => m.empresaId === 'pruebas_sa');
  const yaEventual = legajos.some(esEventualCargado);
  const indeterminadoConFecha = legajos.some(
    (m) => m.modalidad === 'INDETERMINADO' && String(m.fechaEfectivizacion || '').trim() !== '',
  );

  const base = {
    estado,
    cuil,
    legajoExiste,
    porEmpresa,
    duplicadoPlanta,
    yaEnPruebasSa,
    yaEventual,
    repetidoEnPlanilla: Boolean(repetidoEnPlanilla),
    indeterminadoConFecha,
    entraBolsa: false,
    creaLegajo: false,
    disponibilidad: 'NO_DISPONIBLE',
    estadoArca: null,
    fechaArca: '',
    requiereAltaNueva: false,
    riesgoEncadenamiento: false,
    arcaHistorial: [],
    empresaAlta: null,
  };

  if (!cuil) return { ...base, bucket: 'CUIL_INVALIDO' };
  if (estado === 'EFECTIVIZADO') return { ...base, bucket: 'EFECTIVIZADO_FUERA_DE_BOLSA' };
  if (estado === 'DESCONOCIDO') return { ...base, bucket: 'ESTADO_DESCONOCIDO' };
  if (repetidoEnPlanilla) return { ...base, bucket: 'REPETIDO_PLANILLA' };

  const arca = arcaDePlanilla({ estado, ingreso, fechaBaja });
  const conArca = { ...base, ...arca };

  if (duplicadoPlanta) return { ...conArca, bucket: 'DUPLICADO_PLANTA' };
  if (yaEnPruebasSa) return { ...conArca, bucket: 'YA_EN_PRUEBAS_SA' };
  if (yaEventual) return { ...conArca, bucket: 'YA_EVENTUAL' };

  return {
    ...conArca,
    bucket: estado,
    entraBolsa: true,
    creaLegajo: true,
    disponibilidad: 'DISPONIBLE',
    empresaAlta: PLANILLA_EMPRESA_ALTA,
  };
}

export function contratosAbiertosDeEmpresa(contratos, empresaId) {
  return (contratos || []).filter(
    (c) => c.empresaId === empresaId && c.status !== 'INACTIVE' && ABIERTOS.has(c.estado),
  );
}
