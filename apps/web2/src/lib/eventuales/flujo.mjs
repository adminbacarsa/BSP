/**
 * Flujo operativo: el planificador asigna, el contrato nace confirmado
 * para la empresa convocante, y ARCA sale en lotes de esa empresa.
 */
import { fechaAltaDeJornadas, fechaBajaDeJornadas, finDeJornada, inicioDeJornada } from './jornadas.mjs';

export const DESCANSO_MIN_MINUTOS = 12 * 60;
export const TANDA_DEFAULT = { altaHora: '18:00', bajaHora: '09:00' };

/** NA = hipótesis de anulación de alta. La tabla oficial no define NA/NB; el contador tiene que confirmarlo. */
export const MOVIMIENTO_ANULACION_ALTA = 'NA';
export const ANULACION_ALTA_MAX_HORAS = 24;

function clave(fecha, minutos) {
  const [y, m, d] = String(fecha).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 60000 + minutos;
}

function intervalo(jornada) {
  const ini = inicioDeJornada(jornada);
  const fin = finDeJornada(jornada);
  return { desde: clave(ini.fecha, ini.minutos), hasta: clave(fin.fecha, fin.minutos), jornada };
}

export function habilitadoEnEmpresa(bolsa, empresaId) {
  return (bolsa?.empresasHabilitadas || []).includes(empresaId);
}

/** Cada empresa liquida solo los turnos con su empresaId. El motor de payroll ya filtra así. */
export function turnoLiquidaEnEmpresa(turno, empresaId) {
  return String(turno?.empresaId || '') === String(empresaId || '');
}

export function bloqueoCruce(nuevas, otras) {
  const a = (nuevas || []).map(intervalo);
  const b = (otras || []).map((j) => ({ ...intervalo(j), empresaId: j.empresaId }));
  for (const n of a) {
    for (const o of b) {
      if (n.desde < o.hasta && o.desde < n.hasta) {
        return {
          ok: false,
          codigo: 'SUPERPOSICION',
          mensaje: `Ya está asignado en ${o.empresaId || 'otra empresa'} el ${o.jornada.fecha} (${o.jornada.horaInicio}–${o.jornada.horaFin}). No se puede superponer.`,
        };
      }
    }
  }
  const todos = [...b, ...a.map((n) => ({ ...n, empresaId: 'NUEVA' }))].sort((x, y) => x.desde - y.desde);
  for (let i = 1; i < todos.length; i += 1) {
    const descanso = todos[i].desde - todos[i - 1].hasta;
    if (descanso < DESCANSO_MIN_MINUTOS && todos[i].empresaId !== todos[i - 1].empresaId) {
      return {
        ok: false,
        codigo: 'DESCANSO_12H',
        mensaje: `Faltan ${Math.round(descanso / 60)} h de descanso (mínimo 12 h, art. 197) entre ${todos[i - 1].jornada.fecha} y ${todos[i].jornada.fecha}.`,
      };
    }
  }
  return { ok: true };
}

function minutosHora(hhmm) {
  const [h, m] = String(hhmm || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function fechaDeMs(ms) {
  const d = new Date(ms);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}-${mm}-${dd}`;
}

function dow(fecha) {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Próximo lote de altas: 18:00 de un día hábil. El viernes cubre el fin de semana. */
export function proximoLoteAlta(ahoraMs, altaHora = TANDA_DEFAULT.altaHora) {
  const fecha = fechaDeMs(ahoraMs);
  const minutosAhora = (ahoraMs - Date.UTC(...fecha.split('-').map((n, i) => i === 1 ? Number(n) - 1 : Number(n)))) / 60000;
  let cursor = fecha;
  let guard = 0;
  while (guard < 8) {
    const dia = dow(cursor);
    const habil = dia !== 0 && dia !== 6;
    const slot = clave(cursor, minutosHora(altaHora));
    const ahoraClave = clave(fecha, minutosAhora);
    if (habil && slot > ahoraClave) return { fecha: cursor, hora: altaHora, clave: slot };
    const [y, m, d] = cursor.split('-').map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    cursor = fechaDeMs(next.getTime());
    guard += 1;
  }
  return { fecha: cursor, hora: altaHora, clave: clave(cursor, minutosHora(altaHora)) };
}

export function clasificarAlta({ jornada, ahoraMs, tanda = TANDA_DEFAULT }) {
  const lote = proximoLoteAlta(ahoraMs, tanda.altaHora || TANDA_DEFAULT.altaHora);
  const inicio = intervalo(jornada).desde;
  if (inicio < lote.clave) return { canal: 'URGENTE', lote };
  return { canal: 'LOTE', lote };
}

export function planAsignacion({ bolsa, empresaId, turnos, otrasJornadas = [], ahoraMs = Date.now(), tanda = TANDA_DEFAULT }) {
  if (!habilitadoEnEmpresa(bolsa, empresaId)) {
    return { ok: false, codigo: 'EMPRESA_NO_HABILITADA', mensaje: 'Este eventual no está habilitado para esta empresa.' };
  }
  const jornadas = (turnos || []).map((t) => ({
    fecha: t.fecha, horaInicio: t.horaInicio, horaFin: t.horaFin, horas: t.horas, empresaId,
  }));
  if (!jornadas.length) return { ok: false, codigo: 'SIN_TURNOS', mensaje: 'No hay turnos para asignar.' };
  const cruce = bloqueoCruce(jornadas, otrasJornadas);
  if (!cruce.ok) return cruce;
  const fechaAlta = fechaAltaDeJornadas(jornadas);
  const fechaBaja = fechaBajaDeJornadas(jornadas);
  const canal = clasificarAlta({ jornada: jornadas[0], ahoraMs, tanda });
  return {
    ok: true,
    contrato: {
      empresaId,
      bolsaCuil: bolsa.cuil,
      estado: 'CONFIRMADO',
      origen: 'PLANIFICADOR',
      fechaAlta,
      fechaBaja,
      jornadas,
      status: 'ACTIVE',
    },
    envioAt: { empresaId, tipo: 'AT', estado: 'PENDIENTE', canal: canal.canal, loteFecha: canal.lote.fecha },
  };
}

export function armarLote({ empresaId, tipo, envios }) {
  const incluidos = (envios || []).filter((e) => e.empresaId === empresaId && e.tipo === tipo && e.estado === 'PENDIENTE' && e.canal !== 'URGENTE' && !e.quitadoDelLote);
  return {
    empresaId,
    tipo,
    envioIds: incluidos.map((e) => e.id),
    lineas: incluidos.length,
    txt: incluidos.map((e) => e.txt).filter(Boolean).join('\n'),
  };
}

export function confirmarLote(envios, lote, nroTransaccion) {
  const ids = new Set(lote.envioIds || []);
  return (envios || []).map((e) => (ids.has(e.id)
    ? { ...e, estado: 'CONFIRMADO', nroTransaccion: String(nroTransaccion).trim(), loteId: lote.id || null }
    : e));
}

function dentroDe24h(fechaAlta, ahoraMs) {
  if (!fechaAlta) return false;
  const inicio = clave(fechaAlta, 0) * 60000;
  return ahoraMs - inicio < ANULACION_ALTA_MAX_HORAS * 3600000;
}

/**
 * Si el AT no se subió, sale del lote. Si ya se subió y no trabajó, NA dentro de las 24 h
 * del inicio (rechazo BTU pasado ese plazo). NA/NB quedan para confirmar con el contador.
 */
export function planSustitucion({ envioTitular, contratoTitular, sustituto, turnos, ahoraMs = Date.now(), tanda = TANDA_DEFAULT }) {
  const subido = envioTitular && ['SUBIENDO', 'CONFIRMADO'].includes(envioTitular.estado);
  let baja;
  if (!subido) {
    baja = { accion: 'QUITAR_DEL_LOTE', movimiento: null, envioId: envioTitular?.id || null };
  } else if (dentroDe24h(contratoTitular?.fechaAlta, ahoraMs)) {
    baja = {
      accion: 'ANULAR_ALTA',
      movimiento: MOVIMIENTO_ANULACION_ALTA,
      confirmarConContador: true,
      nota: 'NA es la hipótesis de anulación de alta. Confirmar con el contador: la tabla de rechazos habla de anular altas (BTU, 24 h) pero no publica el significado de NA/NB.',
    };
  } else {
    baja = {
      accion: 'BAJA_FUERA_DE_PLAZO',
      movimiento: 'BT',
      confirmarConContador: true,
      nota: 'Pasaron 24 h del inicio: ARCA rechaza anular el alta (BTU). La baja BT no usa el motivo 30. Confirmar el movimiento con el contador.',
    };
  }
  const alta = sustituto
    ? planAsignacion({ bolsa: sustituto, empresaId: contratoTitular.empresaId, turnos, ahoraMs, tanda })
    : null;
  return {
    baja,
    contratoTitular: { ...contratoTitular, estado: 'SUSTITUIDO' },
    historial: { at: new Date(ahoraMs).toISOString(), accion: baja.accion, sustituto: sustituto?.cuil || null },
    sustituto: alta,
  };
}
