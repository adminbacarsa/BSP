import { normalizeCuil } from './cuil.mjs';
import { PLANILLA_EMPRESA_ALTA } from './grupo.mjs';

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

/**
 * Qué haría el import con una fila. No escribe.
 * EFECTIVIZADOS no entran a la bolsa: ya son planta permanente.
 */
export function planImportRow({ estadoRaw, cuilRaw, matches }) {
  const estado = classifyEstadoActual(estadoRaw);
  const cuil = normalizeCuil(cuilRaw);
  const legajos = Array.isArray(matches) ? matches : [];
  const legajoExiste = legajos.length > 0;

  if (!cuil) {
    return { estado, cuil: null, entraBolsa: false, creaLegajo: false, legajoExiste, bucket: 'CUIL_INVALIDO' };
  }

  if (estado === 'EFECTIVIZADO') {
    const indeterminadoConFecha = legajos.some(
      (m) => m.modalidad === 'INDETERMINADO' && String(m.fechaEfectivizacion || '').trim() !== '',
    );
    return {
      estado,
      cuil,
      entraBolsa: false,
      creaLegajo: false,
      legajoExiste,
      indeterminadoConFecha,
      bucket: 'EFECTIVIZADO_FUERA_DE_BOLSA',
    };
  }

  if (estado === 'ACTIVO') {
    return {
      estado,
      cuil,
      entraBolsa: true,
      bolsaEstado: 'ACTIVA',
      asignable: true,
      riesgoEncadenamiento: false,
      modalidadLegajo: 'EVENTUAL',
      creaLegajo: !legajoExiste,
      empresaAlta: legajoExiste ? null : PLANILLA_EMPRESA_ALTA,
      legajoExiste,
      bucket: 'ACTIVO',
    };
  }

  if (estado === 'BAJA') {
    return {
      estado,
      cuil,
      entraBolsa: true,
      bolsaEstado: 'BAJA',
      asignable: false,
      riesgoEncadenamiento: false,
      creaLegajo: false,
      legajoExiste,
      bucket: 'BAJA',
    };
  }

  if (estado === 'GOLONDRINA') {
    return {
      estado,
      cuil,
      entraBolsa: true,
      bolsaEstado: 'ACTIVA',
      asignable: true,
      riesgoEncadenamiento: true,
      creaLegajo: false,
      legajoExiste,
      bucket: 'GOLONDRINA',
    };
  }

  return { estado, cuil, entraBolsa: false, creaLegajo: false, legajoExiste, bucket: 'ESTADO_DESCONOCIDO' };
}

export function contratosAbiertosDeEmpresa(contratos, empresaId) {
  return (contratos || []).filter(
    (c) => c.empresaId === empresaId && c.status !== 'INACTIVE' && ABIERTOS.has(c.estado),
  );
}
