/**
 * Informe analítico gerencial: balance vendido / plan / realizado / bolsa CCT
 * y conclusiones determinísticas. Sin I/O.
 */

import {
  type AusenciasStats,
  type DemandaObjectiveRow,
  coverageHoursFromShift,
  isFrancoTrabajadoShift,
  isVacantShift,
} from './analisisQueries';
import { CCT_HS_TECHO_MENSUAL } from './analisisBolsa';

export type InformeBalanceRow = {
  concepto: string;
  horas: number;
  observacion: string;
};

export type InformeNovedadRow = {
  rubro: string;
  code: string;
  horas: number;
  eventos: number;
  impacto: string;
};

export type InformeConclusion = {
  tipo: 'ok' | 'warn' | 'risk';
  titulo: string;
  texto: string;
};

export type InformeAnalitico = {
  dotacionActiva: number;
  hsVendidas: number;
  hsPlanificadas: number;
  hsRealizadas: number;
  hsPendientesFichada: number;
  hsNormales: number;
  hsExtras50: number;
  hsFT100: number;
  hsOps: number;
  hsVacante: number;
  hsAusencias: number;
  hsAusenciasCubiertas: number;
  bolsaInicial: number;
  bolsaConsumida: number;
  bolsaDisponible: number;
  sobreBolsa: number;
  bolsaTecho: number;
  bolsaIndicePct: number;
  bolsaHsEfectivasGuardia: number;
  bolsaLookbackLabel: string;
  bolsaTieneHistorial: boolean;
  bolsaModo: 'con_indice' | 'sin_indice';
  coberturaPlanPct: number;
  coberturaEfectivaPct: number;
  desvioRealVsVendido: number;
  desvioExtras: number;
  balance: InformeBalanceRow[];
  novedades: InformeNovedadRow[];
  conclusiones: InformeConclusion[];
};

const LEAVE_CODES = new Set(['V', 'L', 'E', 'A', 'AA', 'PG', 'SGS', 'SUS']);
const FRANCO_CODES = new Set(['F', 'FF', 'FP']);

function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

function isLeaveOrFranco(t: any): boolean {
  const code = String(t?.code || '').trim().toUpperCase();
  if (LEAVE_CODES.has(code) || FRANCO_CODES.has(code)) return true;
  if (t?.isFranco === true && !isFrancoTrabajadoShift(t)) return true;
  return false;
}

function isFichado(t: any): boolean {
  const st = String(t?.status || '').toUpperCase();
  return t?.isPresent === true || t?.isCompleted === true || st === 'PRESENT' || st === 'COMPLETED';
}

function isAusenteTurno(t: any): boolean {
  const st = String(t?.status || '').toUpperCase();
  return t?.isAbsent === true || st === 'ABSENT';
}

export function buildInformeAnalitico(opts: {
  plantel: number;
  capHsPerGuardPeriod: number;
  demandaTotals: DemandaObjectiveRow;
  ausenciasStats: AusenciasStats | null;
  turnos: any[];
  bolsa?: {
    inicial: number;
    techo: number;
    indicePct: number;
    hsEfectivasGuardia: number;
    lookbackLabel: string;
    tieneHistorial: boolean;
    modo?: 'con_indice' | 'sin_indice';
  };
}): InformeAnalitico {
  const { plantel, demandaTotals: d, ausenciasStats, turnos, bolsa } = opts;
  const hsVendidas = r1(d.slaHours);
  const hsPlanificadas = r1(d.planHours);
  const hsExtras50 = r1(d.extHours + d.adelHours);
  const hsFT100 = r1(d.ftHours);
  const hsOps = r1(d.opsHours);
  const hsVacante = r1(d.vacantHours);
  const hsAusencias = r1(d.absenceHours);
  const hsAusenciasCubiertas = r1(d.absenceCoveredHours);

  let hsRealizadas = 0;
  let hsPendientesFichada = 0;
  let hsNormales = 0;

  turnos.forEach((t: any) => {
    if (isVacantShift(t) || isLeaveOrFranco(t)) return;
    const hs = coverageHoursFromShift(t);
    if (hs <= 0) return;
    if (isAusenteTurno(t)) return;
    if (isFichado(t)) {
      hsRealizadas += hs;
      if (!isFrancoTrabajadoShift(t)) hsNormales += hs;
    } else if (t.employeeId && t.employeeId !== 'VACANTE') {
      hsPendientesFichada += hs;
    }
  });

  hsRealizadas = r1(hsRealizadas);
  hsPendientesFichada = r1(hsPendientesFichada);
  hsNormales = r1(hsNormales);

  const techoFallback = Math.max(0, plantel) * CCT_HS_TECHO_MENSUAL;
  const bolsaInicial = r1(bolsa ? bolsa.inicial : techoFallback);
  const bolsaTecho = r1(bolsa ? bolsa.techo : techoFallback);
  const bolsaIndicePct = bolsa ? bolsa.indicePct : 0;
  const bolsaHsEfectivasGuardia = r1(bolsa ? bolsa.hsEfectivasGuardia : CCT_HS_TECHO_MENSUAL);
  const bolsaLookbackLabel = bolsa?.lookbackLabel || '';
  const bolsaTieneHistorial = bolsa?.tieneHistorial === true;
  const bolsaModo = bolsa?.modo || (bolsaTieneHistorial ? 'con_indice' : 'sin_indice');
  const bolsaConsumida = r1(hsNormales > 0 ? hsNormales : hsPlanificadas);
  const bolsaDisponible = r1(Math.max(0, bolsaInicial - bolsaConsumida));
  const sobreBolsa = r1(Math.max(0, bolsaConsumida - bolsaInicial));
  const desvioRealVsVendido = r1((hsRealizadas > 0 ? hsRealizadas : d.resultante) - hsVendidas);
  const desvioExtras = r1(hsExtras50 + hsFT100 + hsOps);
  const coberturaPlanPct = hsVendidas > 0 ? Math.round((hsPlanificadas / hsVendidas) * 1000) / 10 : 0;
  const coberturaEfectivaPct = hsVendidas > 0
    ? Math.round(((hsRealizadas > 0 ? hsRealizadas : d.resultante) / hsVendidas) * 1000) / 10
    : 0;

  const balance: InformeBalanceRow[] = [
    {
      concepto: 'Horas vendidas (contrato / SLA)',
      horas: hsVendidas,
      observacion: 'Compromiso asumido con los clientes en el período.',
    },
    {
      concepto: 'Horas planificadas',
      horas: hsPlanificadas,
      observacion: 'Malla de cobertura crono (sin FT ni tramos extra).',
    },
    {
      concepto: bolsaModo === 'sin_indice' ? 'Bolsa de horas (techo 200, sin índice)' : 'Bolsa de horas (capacidad realista)',
      horas: bolsaInicial,
      observacion: bolsaModo === 'sin_indice'
        ? `Sin índice: no hay ausencias en ${bolsaLookbackLabel || 'los 3 meses cerrados previos'}. Se muestra el techo ${plantel} × 200 = ${bolsaTecho.toLocaleString('es-AR')} hs, no una capacidad realista.`
        : (bolsa
          ? `No es ${plantel} × 200 como promedio. Techo ${bolsaTecho.toLocaleString('es-AR')} hs · índice ausencia ${bolsaLookbackLabel} = ${bolsaIndicePct}% · ${bolsaHsEfectivasGuardia} hs efectivas/guardia.`
          : `Plantel ${plantel} × ${CCT_HS_TECHO_MENSUAL} hs techo (sin índice). La jornada de referencia 192 no entra en esta KPI.`),
    },
    {
      concepto: 'Horas realizadas (efectivas)',
      horas: hsRealizadas,
      observacion: hsRealizadas > 0
        ? 'Turnos con presencia o cierre (fichada).'
        : (hsPendientesFichada > 0
          ? `Sin fichadas aún · ${hsPendientesFichada} hs asignadas pendientes de marcar.`
          : 'Sin turnos fichados en el período.'),
    },
    {
      concepto: 'Diferencia (real/resultante vs vendido)',
      horas: desvioRealVsVendido,
      observacion: desvioRealVsVendido > 4
        ? 'Sobre-cobertura: se operó más de lo vendido (presión de margen).'
        : desvioRealVsVendido < -4
          ? 'Déficit de servicio frente al contrato (riesgo de reclamo).'
          : 'Alineado al compromiso comercial.',
    },
    {
      concepto: 'Bolsa disponible / remanente',
      horas: bolsaDisponible,
      observacion: sobreBolsa > 0
        ? `Consumo por encima del cupo CCT: +${sobreBolsa} hs (candidatas a extra al 50%).`
        : 'Remanente para absorber vacaciones, enfermedad y picos.',
    },
  ];

  const det = ausenciasStats?.detalle || [];
  const countCat = (cat: string) => det.filter((e) => e.category === cat).length;
  const codeOf = (e: { code?: string }) => String(e.code || '').toUpperCase();
  const hsCode = (code: string) => det.filter((e) => codeOf(e) === code).reduce((s, e) => s + (Number(e.hs) || 0), 0);
  const nCode = (code: string) => det.filter((e) => codeOf(e) === code).length;
  const novedades: InformeNovedadRow[] = [
    {
      rubro: 'Vacaciones',
      code: 'V',
      horas: ausenciasStats?.vacHs ?? 0,
      eventos: countCat('vac'),
      impacto: 'Licencia legal anual paga. Suele cubrirse con FT, bolsa o personal sin turno.',
    },
    {
      rubro: 'Enfermedad / certificado',
      code: 'E',
      horas: ausenciasStats?.enfHs ?? 0,
      eventos: countCat('enf'),
      impacto: 'Parte de enfermo: activa coberturas de emergencia (ext, ops o FT).',
    },
    {
      rubro: 'ART / autorizada',
      code: 'A',
      horas: ausenciasStats?.artHs ?? 0,
      eventos: countCat('art'),
      impacto: 'Carga legal. No computa como injustificada; igual deja el puesto a cubrir.',
    },
    {
      rubro: 'Ausencias injustificadas',
      code: 'AA',
      horas: ausenciasStats?.injHs ?? 0,
      eventos: countCat('inj'),
      impacto: 'Impacta presentismo y liquidación. Incluye AUTO_T30 e isAbsent operativo.',
    },
    {
      rubro: 'Suspensión',
      code: 'SUS',
      horas: hsCode('SUS'),
      eventos: nCode('SUS'),
      impacto: 'Medida disciplinaria (art. 218 LCT). Jornada del turno (8 o 12 hs), no 24 hs de calendario.',
    },
    {
      rubro: 'Licencias especiales / PG / otros',
      code: 'L/PG',
      horas: Math.max(0, (ausenciasStats?.otrosHs ?? 0) - hsCode('SUS')),
      eventos: Math.max(0, countCat('otros') - nCode('SUS')),
      impacto: 'Casamiento, nacimiento, duelo, examen, MAVIC, permiso gremial (CCT SUVICO).',
    },
    {
      rubro: 'Francos trabajados (FT)',
      code: 'FT',
      horas: hsFT100,
      eventos: turnos.filter((t) => isFrancoTrabajadoShift(t) && !isVacantShift(t)).length,
      impacto: 'Horas críticas: recargo al 100% (hábil/sábado/domingo según convenio).',
    },
  ];

  const conclusiones = buildInformeConclusions({
    hsVendidas,
    hsPlanificadas,
    hsRealizadas,
    hsPendientesFichada,
    hsVacante,
    hsAusencias,
    hsAusenciasCubiertas,
    hsFT100,
    hsExtras50,
    bolsaDisponible,
    sobreBolsa,
    desvioRealVsVendido,
    coberturaPlanPct,
    coberturaEfectivaPct,
    plantel,
  });

  return {
    dotacionActiva: plantel,
    hsVendidas,
    hsPlanificadas,
    hsRealizadas,
    hsPendientesFichada,
    hsNormales,
    hsExtras50,
    hsFT100,
    hsOps,
    hsVacante,
    hsAusencias,
    hsAusenciasCubiertas,
    bolsaInicial,
    bolsaConsumida,
    bolsaDisponible,
    sobreBolsa,
    bolsaTecho,
    bolsaIndicePct,
    bolsaHsEfectivasGuardia,
    bolsaLookbackLabel,
    bolsaTieneHistorial,
    bolsaModo,
    coberturaPlanPct,
    coberturaEfectivaPct,
    desvioRealVsVendido,
    desvioExtras,
    balance,
    novedades,
    conclusiones,
  };
}

export function buildInformeConclusions(p: {
  hsVendidas: number;
  hsPlanificadas: number;
  hsRealizadas: number;
  hsPendientesFichada: number;
  hsVacante: number;
  hsAusencias: number;
  hsAusenciasCubiertas: number;
  hsFT100: number;
  hsExtras50: number;
  bolsaDisponible: number;
  sobreBolsa: number;
  desvioRealVsVendido: number;
  coberturaPlanPct: number;
  coberturaEfectivaPct: number;
  plantel: number;
}): InformeConclusion[] {
  const out: InformeConclusion[] = [];

  if (p.hsVendidas <= 0) {
    out.push({
      tipo: 'warn',
      titulo: 'Sin horas vendidas en el período',
      texto: 'No hay SLA vigente con horas en este rango. Revisá vigencia de contratos o el recorte de fechas.',
    });
    return out;
  }

  if (p.desvioRealVsVendido > 8) {
    out.push({
      tipo: 'risk',
      titulo: 'Se operó más de lo vendido',
      texto: `Hay ${p.desvioRealVsVendido.toLocaleString('es-AR')} hs por encima del contrato. Eso comprime el margen: extras, FT u ops no estaban en el precio vendido.`,
    });
  } else if (p.desvioRealVsVendido < -8) {
    out.push({
      tipo: 'risk',
      titulo: 'Se operó menos de lo vendido',
      texto: `Faltan ${Math.abs(p.desvioRealVsVendido).toLocaleString('es-AR')} hs respecto del SLA. Riesgo de reclamo o multa del cliente si hubo puestos acéfalos.`,
    });
  } else {
    out.push({
      tipo: 'ok',
      titulo: 'Balance comercial alineado',
      texto: `La diferencia real/resultante vs vendido es de ${p.desvioRealVsVendido > 0 ? '+' : ''}${p.desvioRealVsVendido.toLocaleString('es-AR')} hs. El servicio está cerca del compromiso.`,
    });
  }

  if (p.hsVacante > 4) {
    out.push({
      tipo: 'risk',
      titulo: 'Puestos acéfalos (vacantes)',
      texto: `${p.hsVacante.toLocaleString('es-AR')} hs de malla sin titular. Priorizá cobertura con retención, personal sin turno o FT validado.`,
    });
  }

  if (p.sobreBolsa > 0) {
    out.push({
      tipo: 'warn',
      titulo: 'Bolsa CCT insuficiente',
      texto: `El consumo supera el cupo agregado en ${p.sobreBolsa.toLocaleString('es-AR')} hs. Esas horas son candidatas a extra al 50% si no se compensan en el ciclo.`,
    });
  } else if (p.bolsaDisponible >= p.hsAusencias && p.hsAusencias > 0) {
    out.push({
      tipo: 'ok',
      titulo: 'La bolsa absorbe el ausentismo',
      texto: `Remanente ${p.bolsaDisponible.toLocaleString('es-AR')} hs vs ${p.hsAusencias.toLocaleString('es-AR')} hs de novedades. La flexibilidad CCT mitiga vacaciones y bajas sin un aluvión de extras.`,
    });
  } else if (p.hsAusencias > p.bolsaDisponible + 8) {
    out.push({
      tipo: 'warn',
      titulo: 'Ausentismo por encima de la bolsa',
      texto: `Novedades ${p.hsAusencias.toLocaleString('es-AR')} hs y remanente ${p.bolsaDisponible.toLocaleString('es-AR')} hs. Parte de la cobertura va a FT o extras.`,
    });
  }

  if (p.hsFT100 > 16) {
    out.push({
      tipo: 'warn',
      titulo: 'Alta dependencia de franco trabajado',
      texto: `${p.hsFT100.toLocaleString('es-AR')} hs FT (recargo 100%). Revisá malla de francos y redistribución de la dotación (${p.plantel} guardias) antes de presupuestar más extra preventiva.`,
    });
  }

  if (p.hsPendientesFichada > 0 && p.hsRealizadas === 0) {
    out.push({
      tipo: 'warn',
      titulo: 'Efectivas aún no fichadas',
      texto: `Hay ${p.hsPendientesFichada.toLocaleString('es-AR')} hs asignadas sin presencia/cierre. El KPI de realizadas va a subir a medida que Operaciones marque el período.`,
    });
  }

  if (p.coberturaPlanPct < 90) {
    out.push({
      tipo: 'risk',
      titulo: 'Cobertura planificada bajo el 90%',
      texto: `La malla cubre ${p.coberturaPlanPct}% de las horas vendidas. Completá vacantes o ajustá el SLA si el servicio se redujo.`,
    });
  }

  out.push({
    tipo: p.hsExtras50 + p.hsFT100 > 24 ? 'warn' : 'ok',
    titulo: 'Sugerencia de planificación',
    texto: p.hsVacante > 0 || p.hsFT100 > 8
      ? 'Optimizá francos del objetivo con más vacante, usá retención/ESC antes que FT, y presupuestá un colchón de extras solo en los puestos con historial de enfermedad.'
      : 'Mantener la malla actual. Si el trimestre/semestre se carga de vacaciones, reservá bolsa y no adelantes FT masivo.',
  });

  return out;
}

export function estimarCostoInforme(
  informe: InformeAnalitico,
  valorHoraBasica: number,
): {
  normales: number;
  extras50: number;
  ft100: number;
  ausentismo: number;
  total: number;
} | null {
  if (!Number.isFinite(valorHoraBasica) || valorHoraBasica <= 0) return null;
  const v = valorHoraBasica;
  const normales = r1(informe.hsNormales * v);
  const extras50 = r1(informe.hsExtras50 * v * 1.5);
  const ft100 = r1(informe.hsFT100 * v * 2);
  const ausentismo = r1((informe.hsAusencias + informe.hsFT100) * v);
  return {
    normales,
    extras50,
    ft100,
    ausentismo,
    total: r1(normales + extras50 + ft100),
  };
}

export function formatArs(n: number): string {
  return n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
}

export type InformeSeriesBucket = 'hour' | 'day' | 'week' | 'month';

export type InformeSeriesPoint = {
  key: string;
  label: string;
  Vendidas: number;
  Plan: number;
  Realizadas: number;
  Extras: number;
  Vacante: number;
};

export type InformeBucket = {
  key: string;
  label: string;
  start: Date;
  end: Date;
};

export function chooseInformeSeriesBucket(daysCount: number): InformeSeriesBucket {
  if (daysCount <= 1) return 'hour';
  if (daysCount <= 45) return 'day';
  if (daysCount <= 120) return 'week';
  return 'month';
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function iterateInformeBuckets(start: Date, end: Date, bucket: InformeSeriesBucket): InformeBucket[] {
  const out: InformeBucket[] = [];
  if (bucket === 'hour') {
    const y = start.getFullYear();
    const m = start.getMonth();
    const d = start.getDate();
    for (let h = 0; h < 24; h++) {
      const s = new Date(y, m, d, h, 0, 0, 0);
      const e = new Date(y, m, d, h, 59, 59, 999);
      out.push({ key: `h${pad2(h)}`, label: `${pad2(h)}:00`, start: s, end: e });
    }
    return out;
  }
  if (bucket === 'month') {
    let y = start.getFullYear();
    let m = start.getMonth();
    const endY = end.getFullYear();
    const endM = end.getMonth();
    while (y < endY || (y === endY && m <= endM)) {
      const s = new Date(y, m, 1, 0, 0, 0, 0);
      const e = new Date(y, m + 1, 0, 23, 59, 59, 999);
      const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
      out.push({ key: `${y}-${pad2(m + 1)}`, label: `${months[m]} ${y}`, start: s, end: e });
      m += 1;
      if (m > 11) { m = 0; y += 1; }
    }
    return out;
  }
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, 0);
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999);
  const step = bucket === 'week' ? 7 : 1;
  while (cursor <= last) {
    const s = new Date(cursor);
    const e = new Date(cursor);
    e.setDate(e.getDate() + step - 1);
    e.setHours(23, 59, 59, 999);
    if (e > last) {
      e.setTime(last.getTime());
    }
    const key = `${s.getFullYear()}-${pad2(s.getMonth() + 1)}-${pad2(s.getDate())}`;
    const label = bucket === 'week'
      ? `${pad2(s.getDate())}/${pad2(s.getMonth() + 1)}`
      : `${pad2(s.getDate())}/${pad2(s.getMonth() + 1)}`;
    out.push({ key, label, start: s, end: e });
    cursor.setDate(cursor.getDate() + step);
  }
  return out;
}

export function shiftStartDate(t: any): Date | null {
  const st = t?.startTime;
  if (st != null) {
    if (typeof st.seconds === 'number') return new Date(st.seconds * 1000);
    if (typeof st._seconds === 'number') return new Date(st._seconds * 1000);
    if (typeof st.toMillis === 'function') {
      const ms = st.toMillis();
      if (Number.isFinite(ms)) return new Date(ms);
    }
    if (typeof st.toDate === 'function') {
      try {
        const d = st.toDate();
        if (d instanceof Date && !Number.isNaN(d.getTime())) return d;
      } catch {
        /* ignore */
      }
    }
    if (typeof st === 'string' && !/^\d{1,2}:\d{2}/.test(st.trim())) {
      const d = new Date(st);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  const dateStr = String(t?.date || t?.scheduleDate || t?.shiftDate || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [y, mo, d] = dateStr.split('-').map(Number);
    let h = 12;
    let min = 0;
    const clock = String(typeof st === 'string' ? st : (t?.startHour || '')).match(/^(\d{1,2}):(\d{2})/);
    if (clock) {
      h = Number(clock[1]);
      min = Number(clock[2]);
    }
    return new Date(y, mo - 1, d, h, min, 0, 0);
  }
  return null;
}

function bucketKeyForShift(t: any, buckets: InformeBucket[], mode: InformeSeriesBucket): string | null {
  const d = shiftStartDate(t);
  if (!d) return null;
  if (mode === 'hour') return `h${pad2(d.getHours())}`;
  const ms = d.getTime();
  for (const b of buckets) {
    if (ms >= b.start.getTime() && ms <= b.end.getTime()) return b.key;
  }
  return null;
}

export function buildInformeSeries(opts: {
  turnos: any[];
  buckets: InformeBucket[];
  bucket: InformeSeriesBucket;
  slaByKey?: Record<string, number>;
  hoursOf?: (t: any) => number;
  extraHoursOf?: (t: any) => number;
  isPlannedCoverage?: (t: any) => boolean;
}): InformeSeriesPoint[] {
  const {
    turnos,
    buckets,
    bucket,
    slaByKey = {},
    hoursOf = coverageHoursFromShift,
    extraHoursOf,
    isPlannedCoverage,
  } = opts;
  const acc = new Map<string, InformeSeriesPoint>();
  buckets.forEach((b) => {
    acc.set(b.key, {
      key: b.key,
      label: b.label,
      Vendidas: r1(slaByKey[b.key] || 0),
      Plan: 0,
      Realizadas: 0,
      Extras: 0,
      Vacante: 0,
    });
  });

  turnos.forEach((t: any) => {
    const key = bucketKeyForShift(t, buckets, bucket);
    if (!key) return;
    const row = acc.get(key);
    if (!row) return;
    const gross = hoursOf(t);
    const extra = extraHoursOf ? Math.max(0, extraHoursOf(t)) : 0;
    const base = Math.max(0, r1(gross - extra));
    const planned = isPlannedCoverage
      ? isPlannedCoverage(t)
      : (!isLeaveOrFranco(t) && !isFrancoTrabajadoShift(t));

    if (isFrancoTrabajadoShift(t) && !isVacantShift(t)) {
      const ftHs = gross > 0 ? gross : coverageHoursFromShift(t);
      if (ftHs > 0) row.Extras += ftHs;
      if (isFichado(t)) row.Realizadas += ftHs;
      return;
    }

    if (planned) {
      if (isVacantShift(t)) {
        if (base > 0) row.Vacante += base;
      } else if (base > 0) {
        row.Plan += base;
      }
      if (extra > 0 && !isVacantShift(t)) row.Extras += extra;
    }

    if (isFichado(t) && !isVacantShift(t) && !isLeaveOrFranco(t)) {
      const done = gross > 0 ? gross : coverageHoursFromShift(t);
      if (done > 0) row.Realizadas += done;
    }
  });

  return buckets.map((b) => {
    const row = acc.get(b.key)!;
    return {
      ...row,
      Vendidas: r1(row.Vendidas),
      Plan: r1(row.Plan),
      Realizadas: r1(row.Realizadas),
      Extras: r1(row.Extras),
      Vacante: r1(row.Vacante),
    };
  });
}
