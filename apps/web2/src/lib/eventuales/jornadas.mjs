/** Tope de jornada de COSP: 12 h 59 min. Descanso entre jornadas: art. 197 LCT. */
export const TOPE_JORNADA_MINUTOS = 12 * 60 + 59;
export const DESCANSO_MIN_MINUTOS = 12 * 60;

export function minutosDeHora(hhmm) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function sumarDias(fecha, dias) {
  const [y, m, d] = String(fecha).split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + dias));
  const mm = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(utc.getUTCDate()).padStart(2, '0');
  return `${utc.getUTCFullYear()}-${mm}-${dd}`;
}

function instante(fecha, minutos) {
  const [y, m, d] = String(fecha).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 60000 + minutos;
}

/** La jornada cruza medianoche si la hora de fin no es posterior a la de inicio. */
export function cruzaMedianoche(jornada) {
  const ini = minutosDeHora(jornada.horaInicio);
  const fin = minutosDeHora(jornada.horaFin);
  if (ini == null || fin == null) return false;
  return fin <= ini;
}

export function horasDeJornada(jornada) {
  if (Number.isFinite(jornada.horas) && jornada.horas > 0) return jornada.horas;
  const ini = minutosDeHora(jornada.horaInicio);
  const fin = minutosDeHora(jornada.horaFin);
  if (ini == null || fin == null) return 0;
  const span = cruzaMedianoche(jornada) ? (24 * 60 - ini) + fin : fin - ini;
  return span / 60;
}

export function finDeJornada(jornada) {
  const fin = minutosDeHora(jornada.horaFin);
  const cruza = cruzaMedianoche(jornada);
  return {
    fecha: cruza ? sumarDias(jornada.fecha, 1) : jornada.fecha,
    minutos: fin ?? 0,
    cruzaMedianoche: cruza,
  };
}

export function inicioDeJornada(jornada) {
  return { fecha: jornada.fecha, minutos: minutosDeHora(jornada.horaInicio) ?? 0 };
}

/** Alta del contrato = fecha de inicio de la primera jornada. */
export function fechaAltaDeJornadas(jornadas) {
  const orden = [...(jornadas || [])].sort((a, b) => a.fecha.localeCompare(b.fecha) || String(a.horaInicio).localeCompare(String(b.horaInicio)));
  return orden[0]?.fecha || null;
}

/** Baja = fecha calendario AR en que termina la última jornada. Si cruza medianoche, el día siguiente. */
export function fechaBajaDeJornadas(jornadas) {
  let mejor = null;
  let clave = -1;
  for (const jornada of jornadas || []) {
    const fin = finDeJornada(jornada);
    const k = instante(fin.fecha, fin.minutos);
    if (k >= clave) {
      clave = k;
      mejor = fin.fecha;
    }
  }
  return mejor;
}

function mismaFranja(turno, jornada) {
  return turno.fecha === jornada.fecha
    && turno.horaInicio === jornada.horaInicio
    && turno.horaFin === jornada.horaFin;
}

/** Un turno solo está permitido si coincide con una jornada del contrato. El día intermedio, sin jornada, bloquea. */
export function turnoDentroDeJornadas(turno, jornadas) {
  return (jornadas || []).some((jornada) => mismaFranja(turno, jornada));
}

function ordenarPorInicio(jornadas) {
  return [...jornadas].sort((a, b) => instante(a.fecha, minutosDeHora(a.horaInicio) ?? 0) - instante(b.fecha, minutosDeHora(b.horaInicio) ?? 0));
}

/**
 * Valida jornadas del contrato y el descanso contra otras jornadas del grupo.
 * altaConfirmadaAt: ISO o YYYY-MM-DD. Tiene que ser anterior al inicio de la primera jornada.
 */
export function validarJornadasContrato(jornadas, otrasDelGrupo = [], altaConfirmadaAt = null) {
  const errores = [];
  const lista = jornadas || [];
  if (!lista.length) errores.push({ codigo: 'SIN_JORNADAS' });

  const porDia = new Map();
  for (const jornada of lista) {
    const minutos = Math.round(horasDeJornada(jornada) * 60);
    if (minutos <= 0) errores.push({ codigo: 'JORNADA_INVALIDA', fecha: jornada.fecha });
    if (minutos > TOPE_JORNADA_MINUTOS) errores.push({ codigo: 'TOPE_JORNADA', fecha: jornada.fecha });
    porDia.set(jornada.fecha, (porDia.get(jornada.fecha) || 0) + minutos);
  }
  for (const [fecha, minutos] of porDia) {
    if (minutos > TOPE_JORNADA_MINUTOS) errores.push({ codigo: 'TOPE_DIA', fecha });
  }

  const todas = ordenarPorInicio([...lista, ...otrasDelGrupo]);
  for (let i = 1; i < todas.length; i += 1) {
    const prev = finDeJornada(todas[i - 1]);
    const next = inicioDeJornada(todas[i]);
    const descanso = instante(next.fecha, next.minutos) - instante(prev.fecha, prev.minutos);
    if (descanso < DESCANSO_MIN_MINUTOS) {
      errores.push({ codigo: 'DESCANSO_12H', desde: todas[i - 1].fecha, hasta: todas[i].fecha });
    }
  }

  const alta = fechaAltaDeJornadas(lista);
  const inicio = lista.length ? inicioDeJornada(ordenarPorInicio(lista)[0]) : null;
  if (!altaConfirmadaAt) {
    errores.push({ codigo: 'ALTA_NO_CONFIRMADA' });
  } else if (inicio) {
    const confirmada = String(altaConfirmadaAt);
    const confirmadaMs = confirmada.length <= 10
      ? instante(confirmada.slice(0, 10), 0)
      : Date.parse(confirmada) / 60000;
    if (!(confirmadaMs < instante(inicio.fecha, inicio.minutos))) {
      errores.push({ codigo: 'ALTA_DESPUES_DE_JORNADA', fechaAlta: alta });
    }
  }

  return { ok: errores.length === 0, errores, fechaAlta: alta, fechaBaja: fechaBajaDeJornadas(lista) };
}
