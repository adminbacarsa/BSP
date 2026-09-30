/**
 * Eventuales en Planificación: candidatos de la bolsa para un hueco y
 * sincronización del contrato con los turnos del eventual en una empresa.
 *
 * Funciones puras. El servidor (apps/functions/src/eventuales/planificacionEventuales.ts)
 * las alimenta con Firestore y escribe el resultado.
 */
import { bloqueoCruce, clasificarAlta, habilitadoEnEmpresa, MOVIMIENTO_ANULACION_ALTA, ANULACION_ALTA_MAX_HORAS, TANDA_DEFAULT } from './flujo.mjs';
import { fechaAltaDeJornadas, fechaBajaDeJornadas, horasDeJornada } from './jornadas.mjs';
import { vencePronto } from './ficha.mjs';

/** Códigos que no son jornada de trabajo del eventual (licencias, francos). */
export const CODIGOS_SIN_JORNADA = new Set(['F', 'FF', 'FP', 'V', 'L', 'E', 'A', 'ART', 'AA', 'PG', 'SGS', 'SUS']);

const AR_OFFSET_MIN = -3 * 60;

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Timestamp Firestore, {seconds}, ms, ISO o Date → ms. `null` si no se puede. */
export function aMs(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value === 'object') {
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.seconds === 'number') return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
    if (typeof value._seconds === 'number') return value._seconds * 1000;
  }
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/** Fecha y hora en calendario AR (UTC−3, sin DST). */
export function fechaHoraAr(ms) {
  const d = new Date(ms + AR_OFFSET_MIN * 60000);
  return {
    fecha: `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`,
    hora: `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`,
  };
}

/**
 * Turno → jornada del contrato. Acepta startTime/endTime Timestamp o
 * scheduleDate + horas "HH:MM". Devuelve null si el turno no es jornada.
 */
export function turnoAJornada(turno) {
  if (!turno || turno.isDeleted || turno.isUnassigned) return null;
  const code = String(turno.code || '').toUpperCase();
  if (CODIGOS_SIN_JORNADA.has(code) || turno.isFranco === true) return null;
  const startMs = aMs(turno.startTime);
  const endMs = aMs(turno.endTime);
  let fecha;
  let horaInicio;
  let horaFin;
  if (startMs != null && endMs != null && !/^\d{1,2}:\d{2}$/.test(String(turno.startTime))) {
    const ini = fechaHoraAr(startMs);
    const fin = fechaHoraAr(endMs);
    fecha = ini.fecha;
    horaInicio = ini.hora;
    horaFin = fin.hora;
  } else {
    fecha = String(turno.scheduleDate || turno.fecha || '');
    horaInicio = String(turno.startTime || '');
    horaFin = String(turno.endTime || '');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^\d{1,2}:\d{2}$/.test(horaInicio) || !/^\d{1,2}:\d{2}$/.test(horaFin)) return null;
  const base = { fecha, horaInicio, horaFin, horas: Number(turno.hours) > 0 ? Number(turno.hours) : 0 };
  const horas = base.horas || horasDeJornada(base);
  return {
    ...base,
    horas,
    empresaId: turno.empresaId || null,
    objectiveId: turno.objectiveId || null,
    turnoId: turno.id || null,
    code,
    publicada: turno.draft !== true,
  };
}

export function jornadasDeTurnos(turnos) {
  return (turnos || []).map(turnoAJornada).filter(Boolean)
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.horaInicio.localeCompare(b.horaInicio));
}

/** Haversine en km. Acepta {lat, lon} o {lat, lng} (números o strings). */
export function distanciaKm(a, b) {
  const la1 = Number(a?.lat);
  const lo1 = Number(a?.lon ?? a?.lng);
  const la2 = Number(b?.lat);
  const lo2 = Number(b?.lon ?? b?.lng);
  if (![la1, lo1, la2, lo2].every(Number.isFinite) || (la1 === 0 && lo1 === 0) || (la2 === 0 && lo2 === 0)) return null;
  const R = 6371;
  const dLat = ((la2 - la1) * Math.PI) / 180;
  const dLon = ((lo2 - lo1) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((la1 * Math.PI) / 180) * Math.cos((la2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s)) * 10) / 10;
}

/** Confiabilidad 0–100 desde la ficha (número directo) o desde contratos/ausencias. `null` sin datos. */
export function confiabilidadDe(bolsa) {
  if (Number.isFinite(Number(bolsa?.confiabilidad)) && bolsa?.confiabilidad !== null && bolsa?.confiabilidad !== '') {
    return Math.max(0, Math.min(100, Math.round(Number(bolsa.confiabilidad))));
  }
  const contratos = Number(bolsa?.estadisticas?.contratos ?? bolsa?.contratosCumplidos ?? 0);
  const ausencias = Number(bolsa?.estadisticas?.ausencias ?? bolsa?.ausenciasInjustificadas ?? 0);
  if (!(contratos > 0)) return null;
  return Math.max(0, Math.min(100, Math.round(100 - (ausencias / contratos) * 100)));
}

const TIPOS_VENCIMIENTO = [
  ['credencial', (b) => b?.credencialVencimiento],
  ['apto', (b) => b?.aptoPsicofisico?.vencimiento ?? b?.aptoVencimiento],
  ['habilitacion', (b) => b?.habilitacion9236?.vencimiento ?? b?.habilitacionVencimiento],
];

export function vencimientosDe(bolsa, hoy, dias = 30) {
  return TIPOS_VENCIMIENTO.map(([tipo, get]) => {
    const fecha = String(get(bolsa) ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { tipo, fecha: null, estado: 'SIN_DATO' };
    if (fecha < hoy) return { tipo, fecha, estado: 'VENCIDO' };
    if (vencePronto(fecha, hoy, dias)) return { tipo, fecha, estado: 'PRONTO' };
    return { tipo, fecha, estado: 'OK' };
  });
}

const MOTIVOS = {
  NO_DISPONIBLE: 'No está disponible en la bolsa.',
  EMPRESA_NO_HABILITADA: 'No está habilitado para esta empresa.',
  CREDENCIAL_VENCIDA: 'Credencial vencida.',
  APTO_VENCIDO: 'Apto psicofísico vencido.',
  HABILITACION_VENCIDA: 'Habilitación 9236 vencida.',
};

/**
 * Evalúa un eventual de la bolsa para un hueco (jornadas nuevas) en la empresa del objetivo.
 * `otrasJornadas` = lo que ya tiene asignado en cualquier empresa del grupo.
 */
export function evaluarCandidato({ bolsa, empresaId, jornadas, otrasJornadas = [], hoy, objetivoGeo = null, diasAviso = 30 }) {
  const vencimientos = vencimientosDe(bolsa, hoy, diasAviso);
  const base = {
    cuil: bolsa?.cuil || null,
    nombre: bolsa?.nombre || '',
    telefono: bolsa?.telefono || '',
    distanciaKm: distanciaKm(bolsa?.domicilioGeo, objetivoGeo),
    confiabilidad: confiabilidadDe(bolsa),
    vencimientos,
    alertas: vencimientos.filter((v) => v.estado === 'PRONTO').map((v) => `${v.tipo} vence ${v.fecha}`),
    legajos: bolsa?.legajos || [],
  };
  const bloquear = (codigo, mensaje) => ({ ...base, elegible: false, motivoCodigo: codigo, motivo: mensaje || MOTIVOS[codigo] || codigo });
  if (bolsa?.disponibilidad === 'NO_DISPONIBLE') return bloquear('NO_DISPONIBLE');
  if (!habilitadoEnEmpresa(bolsa, empresaId)) return bloquear('EMPRESA_NO_HABILITADA');
  const vencido = vencimientos.find((v) => v.estado === 'VENCIDO');
  if (vencido) {
    const codigo = vencido.tipo === 'credencial' ? 'CREDENCIAL_VENCIDA' : vencido.tipo === 'apto' ? 'APTO_VENCIDO' : 'HABILITACION_VENCIDA';
    return bloquear(codigo);
  }
  const nuevas = (jornadas || []).map((j) => ({ ...j, empresaId }));
  const cruce = bloqueoCruce(nuevas, otrasJornadas);
  if (!cruce.ok) return bloquear(cruce.codigo, cruce.mensaje);
  return { ...base, elegible: true, motivoCodigo: null, motivo: null };
}

/** Elegibles primero; después distancia (sin dato al final), confiabilidad y nombre. */
export function ordenarCandidatos(lista) {
  return [...(lista || [])].sort((a, b) => {
    if (a.elegible !== b.elegible) return a.elegible ? -1 : 1;
    if (a.distanciaKm != null && b.distanciaKm != null && a.distanciaKm !== b.distanciaKm) return a.distanciaKm - b.distanciaKm;
    if ((a.distanciaKm == null) !== (b.distanciaKm == null)) return a.distanciaKm == null ? 1 : -1;
    if ((a.confiabilidad ?? -1) !== (b.confiabilidad ?? -1)) return (b.confiabilidad ?? -1) - (a.confiabilidad ?? -1);
    return String(a.nombre).localeCompare(String(b.nombre), 'es');
  });
}

function jornadaLimpia(j) {
  return { fecha: j.fecha, horaInicio: j.horaInicio, horaFin: j.horaFin, horas: j.horas };
}

function atSubido(envio) {
  return !!envio && ['SUBIENDO', 'CONFIRMADO'].includes(envio.estado);
}

function dentroDe24h(fechaAlta, ahoraMs) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fechaAlta || ''))) return false;
  const [y, m, d] = String(fechaAlta).split('-').map(Number);
  const inicio = Date.UTC(y, m - 1, d) - AR_OFFSET_MIN * 60000;
  return ahoraMs - inicio < ANULACION_ALTA_MAX_HORAS * 3600000;
}

/**
 * Contrato de una empresa según los turnos del eventual en esa empresa.
 *
 * - Sin turnos publicados y con borradores → contrato BORRADOR (no sube a ARCA).
 * - Con turnos publicados → CONFIRMADO; jornadas = publicadas; nace envío AT si no existe.
 * - AT ya subido y cambian las fechas → envío MR.
 * - Sin turnos: AT no subido → ANULADO y el AT sale del lote; AT subido → NA (24 h) o BT.
 *
 * Devuelve `{ accion, contrato, envios: [nuevo...], patchesEnvios: [{id, patch}] }`.
 */
export function planContratoDesdeTurnos({
  empresaId, bolsa, employeeId = null, turnos, contratoActual = null, enviosActuales = [], ahoraMs = Date.now(), tanda = TANDA_DEFAULT,
}) {
  const todas = jornadasDeTurnos((turnos || []).filter((t) => String(t?.empresaId || '') === String(empresaId)));
  const publicadas = todas.filter((j) => j.publicada);
  const borradores = todas.filter((j) => !j.publicada);
  const envioAt = (enviosActuales || []).find((e) => e.tipo === 'AT' && !e.quitadoDelLote) || null;
  const objetivos = [...new Set(todas.map((j) => j.objectiveId).filter(Boolean))];
  const actual = contratoActual || null;
  const comun = {
    empresaId,
    bolsaCuil: bolsa?.cuil || actual?.bolsaCuil || null,
    employeeId: employeeId || actual?.employeeId || null,
    origen: 'PLANIFICADOR',
    causa: actual?.causa || 'Cobertura planificada',
    objetivos,
    status: 'ACTIVE',
  };
  const envios = [];
  const patchesEnvios = [];

  if (!todas.length) {
    if (!actual || ['ANULADO', 'FINALIZADO', 'SUSTITUIDO'].includes(actual.estado)) return { accion: 'SIN_CAMBIOS', contrato: actual, envios, patchesEnvios };
    if (!atSubido(envioAt)) {
      if (envioAt?.id) patchesEnvios.push({ id: envioAt.id, patch: { quitadoDelLote: true, quitadoMotivo: 'SIN_TURNOS' } });
      return { accion: 'CERRAR', contrato: { ...actual, ...comun, estado: 'ANULADO', jornadas: [], cierre: { motivo: 'SIN_TURNOS', at: new Date(ahoraMs).toISOString() } }, envios, patchesEnvios };
    }
    if (dentroDe24h(actual.fechaAlta, ahoraMs)) {
      envios.push({ empresaId, tipo: MOVIMIENTO_ANULACION_ALTA, estado: 'PENDIENTE', canal: 'URGENTE', fechaAlta: actual.fechaAlta, fechaBaja: actual.fechaBaja, confirmarConContador: true });
      return { accion: 'CERRAR', contrato: { ...actual, ...comun, estado: 'ANULADO', jornadas: [], cierre: { motivo: 'ANULAR_ALTA', at: new Date(ahoraMs).toISOString() } }, envios, patchesEnvios };
    }
    envios.push({ empresaId, tipo: 'BT', estado: 'PENDIENTE', canal: 'URGENTE', fechaAlta: actual.fechaAlta, fechaBaja: actual.fechaBaja, confirmarConContador: true });
    return { accion: 'CERRAR', contrato: { ...actual, ...comun, estado: 'FINALIZADO', cierre: { motivo: 'BAJA_FUERA_DE_PLAZO', at: new Date(ahoraMs).toISOString() } }, envios, patchesEnvios };
  }

  if (!publicadas.length) {
    if (actual && atSubido(envioAt)) {
      // Ya está en ARCA: despublicar el cronograma no anula el alta. Se mantiene el contrato.
      return { accion: 'SIN_CAMBIOS', contrato: actual, envios, patchesEnvios };
    }
    if (envioAt?.id) patchesEnvios.push({ id: envioAt.id, patch: { quitadoDelLote: true, quitadoMotivo: 'CRONOGRAMA_BORRADOR' } });
    const jornadas = borradores.map(jornadaLimpia);
    const contrato = {
      ...(actual || {}), ...comun,
      estado: 'BORRADOR',
      fechaAlta: fechaAltaDeJornadas(jornadas),
      fechaBaja: fechaBajaDeJornadas(jornadas),
      jornadas,
      jornadasBorrador: [],
    };
    return { accion: actual ? 'ACTUALIZAR' : 'CREAR', contrato, envios, patchesEnvios };
  }

  const jornadas = publicadas.map(jornadaLimpia);
  const fechaAlta = fechaAltaDeJornadas(jornadas);
  const fechaBaja = fechaBajaDeJornadas(jornadas);
  const contrato = {
    ...(actual || {}), ...comun,
    estado: 'CONFIRMADO',
    fechaAlta,
    fechaBaja,
    jornadas,
    jornadasBorrador: borradores.map(jornadaLimpia),
    confirmadoAt: actual?.confirmadoAt || new Date(ahoraMs).toISOString(),
  };
  const fechasCambian = actual?.fechaAlta !== fechaAlta || actual?.fechaBaja !== fechaBaja;
  if (!envioAt) {
    const canal = clasificarAlta({ jornada: jornadas[0], ahoraMs, tanda });
    envios.push({ empresaId, tipo: 'AT', estado: 'PENDIENTE', canal: canal.canal, loteFecha: canal.lote.fecha, fechaAlta, fechaBaja });
  } else if (!atSubido(envioAt)) {
    if (fechasCambian || envioAt.fechaAlta !== fechaAlta || envioAt.fechaBaja !== fechaBaja) {
      patchesEnvios.push({ id: envioAt.id, patch: { fechaAlta, fechaBaja, regenerarTxt: true } });
    }
  } else if (fechasCambian) {
    const yaMr = (enviosActuales || []).some((e) => e.tipo === 'MR' && e.estado === 'PENDIENTE' && e.fechaAlta === fechaAlta && e.fechaBaja === fechaBaja);
    if (!yaMr) envios.push({ empresaId, tipo: 'MR', estado: 'PENDIENTE', canal: 'LOTE', fechaAlta, fechaBaja, confirmarConContador: true });
  }
  const sinCambios = actual
    && actual.estado === 'CONFIRMADO'
    && !fechasCambian
    && JSON.stringify(actual.jornadas || []) === JSON.stringify(jornadas)
    && JSON.stringify(actual.jornadasBorrador || []) === JSON.stringify(contrato.jornadasBorrador)
    && envios.length === 0 && patchesEnvios.length === 0;
  return { accion: sinCambios ? 'SIN_CAMBIOS' : actual ? 'ACTUALIZAR' : 'CREAR', contrato, envios, patchesEnvios };
}

/** Id estable del contrato: una empresa, un CUIL, un mes calendario. */
export function contratoIdDe(empresaId, cuil, periodo) {
  return `${empresaId}_${cuil}_${periodo}`;
}

/** Mes calendario `yyyy-mm` de una fecha AR. */
export function periodoDe(fecha) {
  return String(fecha || '').slice(0, 7);
}
