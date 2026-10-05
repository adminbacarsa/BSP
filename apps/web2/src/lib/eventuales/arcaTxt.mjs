import { calcularRemuneracionContrato } from './remuneracion.mjs';

/**
 * TXT de carga masiva ARCA. El formato de la línea vive en `arcaLinea.mjs` (puro, lo usa el front);
 * acá queda lo que necesita el motor de remuneración (Node), y se reexporta todo para los callers viejos.
 */
export {
  ARCA_EVENTUALES_DEFAULT,
  CATEGORIA_VIGILADOR,
  EMPRESAS_CATEGORIA_VIGILADOR,
  LARGO_REGISTRO_ARCA,
  RNOS_SUVICO,
  arcaEventualesDe,
  lineaMovimientoArca,
  lineasCargaMasiva,
} from './arcaLinea.mjs';

/**
 * Retribución pactada del TXT (posiciones 58-72). Solo entra una escala ACTIVE.
 * Sin devengamiento (no se presentó) el bruto es 0 y no exige escala.
 * Sin escala aprobada el envío no se manda.
 */
export function jornadasDevengables(jornadas) {
  return (jornadas || []).filter((j) => j && j.noSePresento !== true && j.pagaJornada !== false && j.sinDevengamiento !== true);
}

export function brutoParaTxt({ contrato, escalas, hoy }) {
  if (contrato?.sinDevengamiento === true || contrato?.noSePresento === true) {
    return { ok: true, codigo: 'SIN_DEVENGAMIENTO', bruto: 0, sinDevengamiento: true };
  }
  const activas = (escalas || []).filter((e) => e && e.status === 'ACTIVE');
  if (!activas.length) return { ok: false, codigo: 'RETRIBUCION_PENDIENTE', bruto: 0 };
  const r = calcularRemuneracionContrato({
    jornadas: jornadasDevengables(contrato?.jornadas),
    categoria: contrato?.categoria || 'VIGILADOR_GENERAL',
    escalas: activas,
    incluirCierre: false,
    hoy: hoy || hoyAr(),
  });
  if (!r.ok || !(Number(r.bruto) > 0)) return { ok: false, codigo: 'RETRIBUCION_PENDIENTE', bruto: 0 };
  return { ok: true, bruto: r.bruto, escalas: r.escalas, escalaRespaldo: r.escalaRespaldo === true, advertencias: r.advertencias || [] };
}

function hoyAr() {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}
