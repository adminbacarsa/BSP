/**
 * Bruto del contrato eventual. No hay monto fijo.
 * Diurna / nocturna / feriado salen de hours-core (getNightDuration, dateKeyAR),
 * el mismo corte 21:00–06:00 AR que liquida. El divisor 200 es el techo CCT de COSP.
 */
import { createRequire } from 'node:module';
import { cruzaMedianoche, sumarDias } from './jornadas.mjs';

const require = createRequire(import.meta.url);
const { getNightDuration, dateKeyAR } = require('../../../../../packages/hours-core/src/motors/server/payrollTurnoAccumulator.ts');

export const DIVISOR_HORAS_COSP = 200;
export const JORNADA_ORDINARIA_HORAS = 8;

export function redondear(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function escalaDocId(escala) {
  return `${escala.convenio}_${escala.categoria}_${escala.vigenciaDesde}`;
}

export function escalaVigente(escalas, categoria, fecha) {
  const lista = (escalas || []).filter((e) => {
    if (e.status === 'INACTIVE') return false;
    if (e.categoria !== categoria) return false;
    if (String(e.vigenciaDesde) > fecha) return false;
    if (e.vigenciaHasta && String(e.vigenciaHasta) < fecha) return false;
    return true;
  });
  lista.sort((a, b) => String(b.vigenciaDesde).localeCompare(String(a.vigenciaDesde)));
  return lista[0] || null;
}

function feriadosSet(feriados) {
  if (!feriados) return new Set();
  if (feriados instanceof Set) return feriados;
  if (Array.isArray(feriados)) return new Set(feriados.map((f) => String(f).slice(0, 10)));
  return new Set(Object.keys(feriados).filter((k) => feriados[k]).map((k) => k.slice(0, 10)));
}

function instanteAR(fecha, hhmm) {
  const [h, m] = String(hhmm).split(':');
  return new Date(`${fecha}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000-03:00`);
}

function horaAR(d) {
  return new Date(d.getTime() - 3 * 3600 * 1000).getUTCHours();
}

function dowAR(d) {
  const [y, m, day] = dateKeyAR(d).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day)).getUTCDay();
}

function finJornada(jornada) {
  const fechaFin = cruzaMedianoche(jornada) ? sumarDias(jornada.fecha, 1) : jornada.fecha;
  return instanteAR(fechaFin, jornada.horaFin);
}

function pctDe(recargos, clave, fallback) {
  const n = recargos?.[clave];
  return Number.isFinite(n) ? n : fallback;
}

/** Minuto a minuto, la noche la marca hours-core. Sábado >13 y domingo son el recargo de suvicoPolicy. */
export function clasificarJornada(jornada, feriados) {
  const start = instanteAR(jornada.fecha, jornada.horaInicio);
  const end = finJornada(jornada);
  const feriadosOk = feriadosSet(feriados);
  const tramos = [];
  let cursor = start.getTime();
  const endMs = end.getTime();
  while (cursor < endMs) {
    const a = new Date(cursor);
    const b = new Date(Math.min(cursor + 60000, endMs));
    const horas = (b.getTime() - a.getTime()) / 3600000;
    const esNoche = getNightDuration(a, b) > 0;
    const dow = dowAR(a);
    const feriado = feriadosOk.has(dateKeyAR(a));
    tramos.push({
      horas,
      esNoche,
      feriado,
      domingo: dow === 0,
      sabado13: dow === 6 && horaAR(a) >= 13,
    });
    cursor = b.getTime();
  }
  return { start, end, tramos, total: getNightDuration(start, end) + Math.max(0, (endMs - start.getTime()) / 3600000 - getNightDuration(start, end)) };
}

function aplicarTramo(acc, tramo, esExceso, vh, recargos, avisoNoche) {
  const h = tramo.horas;
  if (h <= 0) return;
  const especialPct = Math.max(
    tramo.feriado ? pctDe(recargos, 'feriadoPct', 100) : 0,
    tramo.domingo ? pctDe(recargos, 'domingoPct', 100) : 0,
    tramo.sabado13 ? pctDe(recargos, 'sabado13Pct', 100) : 0,
  );
  acc.base += vh * h;
  if (tramo.esNoche) {
    acc.horasNocturnas += h;
    if (recargos?.nocturnoPct == null) avisoNoche.falta = true;
    else acc.recargoNocturno += vh * h * (recargos.nocturnoPct / 100);
  } else {
    acc.horasDiurnas += h;
  }
  if (tramo.feriado) acc.horasFeriado += h;
  if (tramo.domingo) acc.horasDomingo += h;
  if (tramo.sabado13) acc.horasSabado13 += h;
  if (!esExceso && especialPct > 0) acc.recargoEspecial += vh * h * (especialPct / 100);
  if (esExceso && especialPct > 0) {
    acc.horasExtra100 += h;
    acc.extra100 += vh * h * (pctDe(recargos, 'extra100Pct', 100) / 100);
  }
  if (esExceso && especialPct === 0) {
    acc.horasExtra50 += h;
    acc.extra50 += vh * h * (pctDe(recargos, 'extra50Pct', 50) / 100);
  }
}

function vacioAcc() {
  return {
    base: 0,
    recargoNocturno: 0,
    recargoEspecial: 0,
    extra50: 0,
    extra100: 0,
    horasDiurnas: 0,
    horasNocturnas: 0,
    horasSabado13: 0,
    horasDomingo: 0,
    horasFeriado: 0,
    horasExtra50: 0,
    horasExtra100: 0,
  };
}

function valorHoraDe(escala) {
  const divisor = Number(escala.divisorHoras) > 0 ? Number(escala.divisorHoras) : DIVISOR_HORAS_COSP;
  return { valorHora: escala.basicoMensual / divisor, divisor };
}

export function calcularJornada(jornada, escala, feriados) {
  const { valorHora, divisor } = valorHoraDe(escala);
  const ordinaria = Number(escala.jornadaOrdinariaHoras) > 0 ? Number(escala.jornadaOrdinariaHoras) : JORNADA_ORDINARIA_HORAS;
  const { tramos } = clasificarJornada(jornada, feriados);
  const acc = vacioAcc();
  const avisoNoche = { falta: false };
  let usadas = 0;
  for (const tramo of tramos) {
    const cupo = Math.max(0, ordinaria - usadas);
    const dentro = Math.min(tramo.horas, cupo);
    const exceso = tramo.horas - dentro;
    if (dentro > 0) aplicarTramo(acc, { ...tramo, horas: dentro }, false, valorHora, escala.recargos, avisoNoche);
    if (exceso > 0) aplicarTramo(acc, { ...tramo, horas: exceso }, true, valorHora, escala.recargos, avisoNoche);
    usadas += dentro;
  }
  const monto = redondear(acc.base + acc.recargoNocturno + acc.recargoEspecial + acc.extra50 + acc.extra100);
  return {
    fecha: jornada.fecha,
    horaInicio: jornada.horaInicio,
    horaFin: jornada.horaFin,
    escalaId: escalaDocId(escala),
    valorHora: redondear(valorHora),
    divisorHoras: divisor,
    horasDiurnas: redondear(acc.horasDiurnas),
    horasNocturnas: redondear(acc.horasNocturnas),
    horasSabado13: redondear(acc.horasSabado13),
    horasDomingo: redondear(acc.horasDomingo),
    horasFeriado: redondear(acc.horasFeriado),
    horasExtra50: redondear(acc.horasExtra50),
    horasExtra100: redondear(acc.horasExtra100),
    base: redondear(acc.base),
    recargoNocturno: redondear(acc.recargoNocturno),
    recargoEspecial: redondear(acc.recargoEspecial),
    extra50: redondear(acc.extra50),
    extra100: redondear(acc.extra100),
    monto,
    avisoNocturnoSinPorcentaje: avisoNoche.falta,
  };
}

function montoAdicional(ad, dias, horas) {
  if (ad.modo === 'POR_HORA') return ad.monto * horas;
  if (ad.modo === 'POR_JORNADA' || ad.modo === 'POR_DIA') return ad.monto * dias;
  return ad.monto;
}

function pesos(n) {
  const negativo = n < 0;
  const [ent, dec] = Math.abs(redondear(n)).toFixed(2).split('.');
  const miles = ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negativo ? '-' : ''}$${miles},${dec}`;
}

export function clausulaRemuneracion(resultado) {
  const lineas = (resultado.conceptos || [])
    .filter((c) => c.monto !== 0)
    .map((c) => `${c.nombre}: ${pesos(c.monto)}`)
    .join('; ');
  const cierre = resultado.cierre
    ? ` Al cierre se adicionan SAC proporcional ${pesos(resultado.cierre.sac)} y vacaciones no gozadas proporcionales ${pesos(resultado.cierre.vacaciones)} (${resultado.cierre.vacacionesDias} días).`
    : '';
  return `La remuneración bruta de este período es ${pesos(resultado.bruto)}, calculada según la escala vigente del CCT 422/05 (SUVICO) a la fecha de cada jornada, categoría ${resultado.categoriaLabel}. Valor hora = básico mensual / ${resultado.divisorHoras} h. Desglose: ${lineas}. No es un monto fijo pactado: si cambia la escala vigente, se recalcula.${cierre}`;
}

/**
 * @param {{ jornadas: object[], categoria: string, escalas: object[], feriados?: Set<string>|string[]|Record<string, boolean>, incluirCierre?: boolean }} input
 */
export function calcularRemuneracionContrato(input) {
  const jornadas = input.jornadas || [];
  const conceptos = [];
  const detalle = [];
  const advertencias = [];
  let remunerativo = 0;
  let noRemunerativo = 0;
  const escalasUsadas = [];

  for (const jornada of jornadas) {
    const escala = escalaVigente(input.escalas, input.categoria, jornada.fecha);
    if (!escala) {
      return { ok: false, codigo: 'SIN_ESCALA', fecha: jornada.fecha, categoria: input.categoria };
    }
    if (!escalasUsadas.some((e) => escalaDocId(e) === escalaDocId(escala))) escalasUsadas.push(escala);
    const item = calcularJornada(jornada, escala, input.feriados);
    if (item.avisoNocturnoSinPorcentaje) advertencias.push({ codigo: 'RECARGO_NOCTURNO_SIN_PORCENTAJE', fecha: jornada.fecha });
    detalle.push(item);
    remunerativo += item.monto;
  }

  const suma = (clave) => redondear(detalle.reduce((n, j) => n + j[clave], 0));
  const pushSi = (codigo, nombre, monto, esRemunerativo) => {
    const m = redondear(monto);
    if (m === 0) return;
    conceptos.push({ codigo, nombre, monto: m, remunerativo: esRemunerativo });
  };
  pushSi('HORAS', 'Horas normales', suma('base'), true);
  pushSi('NOCTURNO', 'Recargo nocturno 21:00–06:00', suma('recargoNocturno'), true);
  pushSi('ESPECIAL', 'Recargo sábado >13 / domingo / feriado', suma('recargoEspecial'), true);
  pushSi('EXTRA50', 'Horas extra al 50%', suma('extra50'), true);
  pushSi('EXTRA100', 'Horas extra al 100%', suma('extra100'), true);

  const dias = new Set(jornadas.map((j) => j.fecha)).size;
  const horas = redondear(detalle.reduce((n, j) => n + j.horasDiurnas + j.horasNocturnas, 0));
  const escalaCierre = jornadas.length
    ? escalaVigente(input.escalas, input.categoria, detalle[detalle.length - 1].fecha)
    : null;

  if (escalaCierre?.presentismo?.pct != null) {
    const divisorDias = Number(escalaCierre.presentismo.divisorDias) > 0 ? Number(escalaCierre.presentismo.divisorDias) : 30;
    const monto = redondear(escalaCierre.basicoMensual * (escalaCierre.presentismo.pct / 100) * (dias / divisorDias));
    pushSi('PRESENTISMO', 'Presentismo proporcional', monto, escalaCierre.presentismo.tipo !== 'NO_REMUNERATIVO');
    if (escalaCierre.presentismo.tipo === 'NO_REMUNERATIVO') noRemunerativo += monto;
    else remunerativo += monto;
  }

  for (const ad of escalaCierre?.adicionales || []) {
    const monto = redondear(montoAdicional(ad, dias, horas));
    const remunerativoAd = ad.tipo !== 'NO_REMUNERATIVO' && ad.tipo !== 'VIATICO';
    pushSi(ad.codigo, ad.nombre, monto, remunerativoAd);
    if (remunerativoAd) remunerativo += monto;
    else noRemunerativo += monto;
  }

  remunerativo = redondear(remunerativo);
  noRemunerativo = redondear(noRemunerativo);
  const bruto = redondear(remunerativo + noRemunerativo);

  let cierre = null;
  if (input.incluirCierre !== false && escalaCierre && dias > 0) {
    const sacDivisor = Number(escalaCierre.sac?.divisor) > 0 ? Number(escalaCierre.sac.divisor) : 12;
    const unDiaCada = Number(escalaCierre.vacaciones?.unDiaCada) > 0 ? Number(escalaCierre.vacaciones.unDiaCada) : 20;
    const divisorMes = Number(escalaCierre.vacaciones?.divisorDiasMes) > 0 ? Number(escalaCierre.vacaciones.divisorDiasMes) : 30;
    const sac = redondear(remunerativo / sacDivisor);
    const vacacionesDias = redondear(dias / unDiaCada);
    const vacaciones = redondear(vacacionesDias * (escalaCierre.basicoMensual / divisorMes));
    cierre = {
      sac,
      vacacionesDias,
      vacaciones,
      brutoConCierre: redondear(bruto + sac + vacaciones),
    };
    pushSi('SAC', 'SAC proporcional', sac, true);
    pushSi('VACACIONES', 'Vacaciones no gozadas proporcionales', vacaciones, true);
  }

  const resultado = {
    ok: true,
    categoria: input.categoria,
    categoriaLabel: escalaCierre?.categoriaLabel || input.categoria,
    divisorHoras: escalaCierre ? valorHoraDe(escalaCierre).divisor : DIVISOR_HORAS_COSP,
    escalas: escalasUsadas.map(escalaDocId),
    bruto,
    remunerativo,
    noRemunerativo,
    conceptos,
    jornadas: detalle,
    cierre,
    advertencias,
  };
  resultado.clausula = clausulaRemuneracion(resultado);
  return resultado;
}
