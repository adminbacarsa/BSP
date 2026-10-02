/**
 * Hueco de evento en el CC. Espejo en functions/src/eventos/eventoCoverage.ts.
 * Un evento es `code === 'EV'` u `origin === 'EVENTO'`. Un eventoId suelto en M/T/N no lo es.
 */

/**
 * Hueco de evento: el eventual va primero (no genera recargo de FT).
 * Hueco de objetivo: RET, REF, ESC, Ext + Adel, eventuales y después FT.
 * Son constantes para poder invertirlas si Mauro confirma otro orden.
 */
export const EVENT_COVERAGE_CASCADE_ORDER = ['EVENTUAL', 'REF', 'ESC', 'EXTEND', 'ADVANCE', 'FT'] as const;

export const OBJECTIVE_COVERAGE_WITH_EVENTUAL = ['RET', 'REF', 'ESC', 'EXTEND', 'ADVANCE', 'EVENTUAL', 'FT'] as const;

/** Por qué un eventual no es candidato. `null` = elegible. */
export type EventualMotivoCodigo =
  | 'NO_DISPONIBLE'
  | 'EMPRESA_NO_HABILITADA'
  | 'SIN_MARCO'
  | 'CREDENCIAL_VENCIDA'
  | 'APTO_VENCIDO'
  | 'NO_APTO'
  | 'HABILITACION_VENCIDA'
  | 'SUPERPOSICION'
  | 'DESCANSO_12H'
  | 'GENERO_SIN_ESPECIFICAR'
  | 'GENERO_NO_COINCIDE'
  | 'TOPE_HORAS';

/** Género de la ficha / legajo: 'M' | 'F' | '' (sin especificar). Mismos valores que `cupoGenero.mjs`. */
export type GeneroEventual = 'M' | 'F' | '';

export function normalizarGeneroEventual(valor: unknown): GeneroEventual {
  const v = String(valor ?? '').trim().toUpperCase();
  if (!v) return '';
  if (v === 'M' || v === 'H' || v.startsWith('MASC') || v.startsWith('HOM') || v === 'VARON' || v === 'VARÓN' || v === 'MALE') return 'M';
  if (v === 'F' || v.startsWith('FEM') || v.startsWith('MUJ') || v === 'FEMALE') return 'F';
  return '';
}

export type EventualVencimientoTipo = 'credencial' | 'apto' | 'habilitacion';

export type EventualVencimiento = {
  tipo: EventualVencimientoTipo;
  fecha: string | null;
  estado: 'OK' | 'PRONTO' | 'VENCIDO' | 'SIN_DATO';
};

/**
 * Candidato eventual: la misma fila para el CC (`employeeName`, `distanceKm`) y para
 * Planificación (`nombre`, `distanciaKm`, `vencimientos`, `alertas`, `motivoCodigo`).
 */
export type EventualCandidato = {
  /** Legajo en la empresa del hueco; si no tiene, el CUIL. */
  employeeId: string;
  employeeName: string;
  /** Alias de `employeeName` (paneles de Planificación). */
  nombre: string;
  cuil: string;
  uid?: string;
  telefono: string;
  distanceKm: number | null;
  /** Alias de `distanceKm`. */
  distanciaKm: number | null;
  /** 0–100. Sin dato en la ficha vale 0 para ordenar; `confiabilidadInformada` dice si es real. */
  confiabilidad: number;
  confiabilidadInformada: boolean;
  /** Desempate después de la distancia y la confiabilidad. */
  puntaje?: number;
  elegible: boolean;
  motivoCodigo: EventualMotivoCodigo | null;
  motivo: string | null;
  vencimientos: EventualVencimiento[];
  /** Vencimientos próximos, marco por vencer y etiqueta de pruebas. */
  alertas: string[];
  legajos: { employeeId?: string; empresaId?: string }[];
  /** Ficha con «Exigir contrato marco y habilitación» en OFF: convocable sin marco ni empresa habilitada. */
  pruebasSinMarco?: boolean;
  /** Género de la ficha ('' = sin especificar). Cupo por género en eventos. */
  genero: GeneroEventual;
  /** Horas ya usadas en el período de la empresa contra el tope. `aviso` = ≥ 80% y todavía entra. */
  horasMes?: { usadas: number; tope: number; texto: string; aviso: boolean } | null;
};

export type EventualBolsaRow = {
  cuil: string;
  nombre?: string;
  telefono?: string;
  /** 'M' | 'F' | '' (sin especificar). */
  genero?: string;
  disponibilidad?: string;
  empresasHabilitadas?: string[];
  credencialVencimiento?: string;
  aptoPsicofisico?: { estado?: string; vencimiento?: string };
  /** Alias histórico de `aptoPsicofisico.vencimiento`. */
  aptoVencimiento?: string;
  habilitacion9236?: { vencimiento?: string };
  /** Alias histórico de `habilitacion9236.vencimiento`. */
  habilitacionVencimiento?: string;
  domicilioGeo?: { lat?: number | string; lng?: number | string; lon?: number | string } | null;
  confiabilidad?: number | string | null;
  estadisticas?: { contratos?: number; ausencias?: number };
  contratosCumplidos?: number;
  ausenciasInjustificadas?: number;
  puntaje?: number;
  uid?: string;
  legajos?: { employeeId?: string; empresaId?: string }[];
  marcos?: Record<string, { firmado?: boolean; vencimiento?: string; estado?: string; fechaFirma?: string; vigenciaDias?: number }>;
  /** Switch de pruebas de la ficha. Ausente = true. */
  exigirMarco?: boolean;
  /**
   * Tope del período de esta empresa, ya resuelto (excepción o default) con las horas usadas
   * y las del turno que se evalúa. Lo carga el servidor; sin esto el motor no limita.
   */
  topeHoras?: { usadas: number; tope: number; horasTurno: number } | null;
};

export type EventualTramo = { startMs: number; endMs: number; /** Horas del turno (bruto/anexo). */ horas?: number; /** YYYY-MM-DD del tramo. */ fecha?: string };

export type EventualHueco = {
  empresaId: string;
  startMs: number;
  endMs: number;
  /** Varias jornadas (Planificación multi-día). Si viene, manda sobre `startMs`/`endMs` para el cruce. */
  jornadas?: EventualTramo[];
  lat?: number | null;
  lng?: number | null;
  /** Día AR YYYY-MM-DD para vigencia de credencial y apto. */
  hoyYmd: string;
  /**
   * Hueco de un servicio con cupo por género: solo candidatos de ese grupo (la cascada reconvoca
   * al mismo género que faltó). Sin dato en la ficha bloquea. `null`/ausente = indistinto.
   */
  generoRequerido?: 'M' | 'F' | null;
};

export type EventualJornadaOcupada = {
  cuil: string;
  empresaId?: string;
  startMs: number;
  endMs: number;
};

export type EventualesHuecoInput = {
  bolsa?: EventualBolsaRow[];
  hueco?: EventualHueco;
  otrasJornadas?: EventualJornadaOcupada[];
  /**
   * false (CC, cascada): solo elegibles, más los que faltan de marco (se muestran bloqueados).
   * true (Planificación): toda la bolsa con su motivo.
   */
  incluirNoElegibles?: boolean;
  /** Días de anticipación para avisar vencimientos. Default 30. */
  diasAviso?: number;
};

/** Mismos valores que `marcoAnexoConst.mjs` (el .mjs no se importa desde ops-core). */
export const EVENTUAL_VIGENCIA_MARCO_DIAS = 365;
export const EVENTUAL_AVISO_MARCO_DIAS = 30;
export const EVENTUAL_MOTIVO_SIN_MARCO = 'Sin contrato marco';
/** Igual a `ETIQUETA_PRUEBAS_SIN_MARCO` de `pruebasSwitch.mjs`. */
export const EVENTUAL_ETIQUETA_PRUEBAS_SIN_MARCO = 'Pruebas: sin exigir marco';

export const EVENTUAL_MOTIVOS: Record<EventualMotivoCodigo, string> = {
  NO_DISPONIBLE: 'No está disponible en la bolsa.',
  EMPRESA_NO_HABILITADA: 'No está habilitado para esta empresa.',
  SIN_MARCO: EVENTUAL_MOTIVO_SIN_MARCO,
  CREDENCIAL_VENCIDA: 'Credencial vencida.',
  APTO_VENCIDO: 'Apto psicofísico vencido.',
  NO_APTO: 'Apto psicofísico: no apto.',
  HABILITACION_VENCIDA: 'Habilitación 9236 vencida.',
  SUPERPOSICION: 'Ya está asignado en ese horario. No se puede superponer.',
  DESCANSO_12H: 'Faltan horas de descanso (mínimo 12 h, art. 197).',
  GENERO_SIN_ESPECIFICAR: 'Sin género en la ficha: no cuenta para el cupo por género.',
  GENERO_NO_COINCIDE: 'El hueco es de otro grupo (género).',
  TOPE_HORAS: 'Supera el tope mensual.',
};

function fmtHorasTope(n: number): string {
  const r = Math.round(Number(n) * 100) / 100;
  return Number.isFinite(r) ? String(r) : '0';
}

/** Mismo texto que `motivoTopeHoras` (`topeHoras.mjs`). */
export function textoTopeHoras(usadas: number, tope: number, horasTurno: number): string {
  return `Supera el tope mensual (${fmtHorasTope(usadas)}/${fmtHorasTope(tope)} h, este turno ${fmtHorasTope(horasTurno)} h)`;
}

export function resumenHorasMes(usadas: number, tope: number): { texto: string; aviso: boolean } {
  const u = Number(usadas) || 0;
  const t = Number(tope) || 0;
  return { texto: `${fmtHorasTope(u)}/${fmtHorasTope(t)} h este mes`, aviso: t > 0 && u / t >= 0.8 };
}

export function isEventoShift(shift: object | null | undefined): boolean {
  if (!shift) return false;
  const row = shift as { code?: unknown; origin?: unknown };
  const code = String(row.code || '').trim().toUpperCase();
  const origin = String(row.origin || '').trim().toUpperCase();
  return code === 'EV' || origin === 'EVENTO';
}

/** Solo si el evento define franjas encadenadas aplica la serie/relevo. Si no, no se retiene. */
export function eventoTieneFranjasEncadenadas(shift: object | null | undefined): boolean {
  if (!shift) return false;
  return (shift as { eventoFranjasEncadenadas?: unknown }).eventoFranjasEncadenadas === true;
}

const REST_MS = 12 * 60 * 60 * 1000;

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(s)));
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function esYmd(v: unknown): v is string {
  return YMD.test(String(v || ''));
}

/** Suma días a YYYY-MM-DD en UTC (sin TZ: la fecha es un día calendario). */
export function sumarDiasYmd(ymd: string, dias: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + dias));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Marco de la ficha en una empresa: igual que `planMarco` (`marcoTexto.mjs`): firmado + fecha de
 * firma + vigencia (default 365) → vencimiento. Sin fecha de firma vale el `vencimiento` guardado.
 */
export function marcoEventual(
  marco: { firmado?: boolean; fechaFirma?: string; vigenciaDias?: number; vencimiento?: string; estado?: string } | null | undefined,
  hoy: string,
): { estado: 'SIN_MARCO' | 'VENCIDO' | 'MARCO_VIGENTE'; vencimiento: string | null; avisar: boolean } {
  if (!marco || marco.firmado !== true) return { estado: 'SIN_MARCO', vencimiento: null, avisar: false };
  let vencimiento: string | null = null;
  if (esYmd(marco.fechaFirma)) {
    const dias = Number(marco.vigenciaDias) > 0 ? Number(marco.vigenciaDias) : EVENTUAL_VIGENCIA_MARCO_DIAS;
    vencimiento = sumarDiasYmd(marco.fechaFirma, dias);
  } else if (esYmd(marco.vencimiento)) {
    vencimiento = marco.vencimiento;
  } else {
    return { estado: 'SIN_MARCO', vencimiento: null, avisar: false };
  }
  if (!esYmd(hoy)) return { estado: 'MARCO_VIGENTE', vencimiento, avisar: false };
  if (vencimiento < hoy) return { estado: 'VENCIDO', vencimiento, avisar: false };
  return { estado: 'MARCO_VIGENTE', vencimiento, avisar: vencimiento <= sumarDiasYmd(hoy, EVENTUAL_AVISO_MARCO_DIAS) };
}

/** Credencial, apto y habilitación 9236 con estado OK / PRONTO / VENCIDO / SIN_DATO. */
export function vencimientosEventual(row: EventualBolsaRow | null | undefined, hoy: string, dias = 30): EventualVencimiento[] {
  const fuentes: [EventualVencimientoTipo, unknown][] = [
    ['credencial', row?.credencialVencimiento],
    ['apto', row?.aptoPsicofisico?.vencimiento ?? row?.aptoVencimiento],
    ['habilitacion', row?.habilitacion9236?.vencimiento ?? row?.habilitacionVencimiento],
  ];
  return fuentes.map(([tipo, raw]) => {
    const fecha = String(raw ?? '').trim();
    if (!esYmd(fecha)) return { tipo, fecha: null, estado: 'SIN_DATO' };
    if (!esYmd(hoy)) return { tipo, fecha, estado: 'OK' };
    if (fecha < hoy) return { tipo, fecha, estado: 'VENCIDO' };
    if (fecha <= sumarDiasYmd(hoy, dias)) return { tipo, fecha, estado: 'PRONTO' };
    return { tipo, fecha, estado: 'OK' };
  });
}

/** Confiabilidad 0–100 de la ficha (número directo) o desde contratos/ausencias. `null` sin datos. */
export function confiabilidadEventual(row: EventualBolsaRow | null | undefined): number | null {
  const directo = row?.confiabilidad;
  if (directo !== null && directo !== undefined && directo !== '' && Number.isFinite(Number(directo))) {
    return Math.max(0, Math.min(100, Math.round(Number(directo))));
  }
  const contratos = Number(row?.estadisticas?.contratos ?? row?.contratosCumplidos ?? 0);
  const ausencias = Number(row?.estadisticas?.ausencias ?? row?.ausenciasInjustificadas ?? 0);
  if (!(contratos > 0)) return null;
  return Math.max(0, Math.min(100, Math.round(100 - (ausencias / contratos) * 100)));
}

/** Haversine en km con un decimal. Acepta lat/lng o lat/lon, número o string. `null` sin geo. */
export function distanciaEventualKm(
  a: { lat?: number | string; lng?: number | string; lon?: number | string } | null | undefined,
  b: { lat?: number | string | null; lng?: number | string | null } | null | undefined,
): number | null {
  const la1 = Number(a?.lat);
  const lo1 = Number(a?.lon ?? a?.lng);
  const la2 = Number(b?.lat);
  const lo2 = Number(b?.lng);
  if (a?.lat == null || (a?.lon ?? a?.lng) == null || b?.lat == null || b?.lng == null) return null;
  if (![la1, lo1, la2, lo2].every(Number.isFinite) || (la1 === 0 && lo1 === 0) || (la2 === 0 && lo2 === 0)) return null;
  return Math.round(haversineKm(la1, lo1, la2, lo2) * 10) / 10;
}

const AR_FMT = new Intl.DateTimeFormat('es-AR', {
  timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});

function tramoAr(startMs: number, endMs: number): string {
  const a = AR_FMT.formatToParts(new Date(startMs));
  const b = AR_FMT.formatToParts(new Date(endMs));
  const get = (parts: Intl.DateTimeFormatPart[], t: string) => (parts.find((p) => p.type === t)?.value || '').padStart(2, '0');
  return `${get(a, 'day')}/${get(a, 'month')} ${get(a, 'hour')}:${get(a, 'minute')}–${get(b, 'hour')}:${get(b, 'minute')}`;
}

/**
 * Misma regla que `bloqueoCruce` (`flujo.mjs`): las jornadas nuevas se marcan como otra empresa,
 * así el descanso de 12 h corre contra cualquier jornada del grupo. Superposición siempre bloquea.
 * Acepta un tramo o varios (Planificación multi-día).
 */
export function bloqueoCruceEventual(
  nueva: { empresaId: string; startMs: number; endMs: number } | { empresaId: string; jornadas: EventualTramo[] },
  otras: { empresaId?: string; startMs: number; endMs: number }[],
): { ok: boolean; codigo?: 'SUPERPOSICION' | 'DESCANSO_12H'; mensaje?: string } {
  const tramos: EventualTramo[] = 'jornadas' in nueva ? nueva.jornadas : [{ startMs: nueva.startMs, endMs: nueva.endMs }];
  if (!tramos.length || tramos.some((t) => !t.startMs || !t.endMs || t.endMs <= t.startMs)) {
    return { ok: false, codigo: 'SUPERPOSICION', mensaje: EVENTUAL_MOTIVOS.SUPERPOSICION };
  }
  const ocupadas = otras
    .filter((o) => o.startMs && o.endMs && o.endMs > o.startMs)
    .map((o) => ({ startMs: o.startMs, endMs: o.endMs, empresaId: String(o.empresaId || '') }));
  for (const n of tramos) {
    for (const o of ocupadas) {
      if (n.startMs < o.endMs && o.startMs < n.endMs) {
        return {
          ok: false,
          codigo: 'SUPERPOSICION',
          mensaje: `Ya está asignado en ${o.empresaId || 'otra empresa'} el ${tramoAr(o.startMs, o.endMs)}. No se puede superponer.`,
        };
      }
    }
  }
  const todos = [...ocupadas, ...tramos.map((t) => ({ ...t, empresaId: 'NUEVA' }))].sort((a, b) => a.startMs - b.startMs);
  for (let i = 1; i < todos.length; i += 1) {
    const descanso = todos[i].startMs - todos[i - 1].endMs;
    const tocaNueva = todos[i].empresaId === 'NUEVA' || todos[i - 1].empresaId === 'NUEVA';
    if (tocaNueva && descanso >= 0 && descanso < REST_MS && todos[i].empresaId !== todos[i - 1].empresaId) {
      return {
        ok: false,
        codigo: 'DESCANSO_12H',
        mensaje: `Faltan ${Math.round(descanso / 3600000)} h de descanso (mínimo 12 h, art. 197) entre ${tramoAr(todos[i - 1].startMs, todos[i - 1].endMs)} y ${tramoAr(todos[i].startMs, todos[i].endMs)}.`,
      };
    }
  }
  return { ok: true };
}

/**
 * Evalúa una ficha de la bolsa para un hueco (uno o varios tramos). Es el ÚNICO criterio de
 * candidatura eventual: lo usan el CC, la cascada, la convocatoria de evento y Planificación.
 *
 * Orden de bloqueo: disponibilidad → empresa habilitada (si exige marco) → marco vigente (si exige)
 * → credencial / apto / habilitación 9236 → apto no apto → cruce (superposición, 12 h).
 * Credencial y apto sin fecha bloquean (SIN_DATO); la habilitación 9236 solo bloquea vencida.
 */
export function evaluarEventualParaHueco(
  row: EventualBolsaRow,
  hueco: EventualHueco,
  otrasDelCuil: { empresaId?: string; startMs: number; endMs: number }[] = [],
  diasAviso = 30,
): EventualCandidato | null {
  const cuil = String(row.cuil || '').trim();
  if (!cuil) return null;
  const hoy = String(hueco.hoyYmd || '');
  const exigeMarco = row.exigirMarco !== false;
  const vencimientos = vencimientosEventual(row, hoy, diasAviso);
  const confiabilidad = confiabilidadEventual(row);
  const legajo = (row.legajos || []).find((l) => String(l.empresaId || '') === hueco.empresaId && String(l.employeeId || '').trim());
  const distanceKm = distanciaEventualKm(row.domicilioGeo, hueco.lat != null && hueco.lng != null ? { lat: hueco.lat, lng: hueco.lng } : null);
  const alertas = vencimientos.filter((v) => v.estado === 'PRONTO').map((v) => `${v.tipo} vence ${v.fecha}`);
  if (!exigeMarco) alertas.push(EVENTUAL_ETIQUETA_PRUEBAS_SIN_MARCO);
  const genero = normalizarGeneroEventual(row.genero);
  const base: EventualCandidato = {
    employeeId: String(legajo?.employeeId || cuil),
    employeeName: String(row.nombre || cuil),
    nombre: String(row.nombre || cuil),
    cuil,
    ...(row.uid ? { uid: String(row.uid) } : {}),
    telefono: String(row.telefono || ''),
    distanceKm,
    distanciaKm: distanceKm,
    confiabilidad: confiabilidad ?? 0,
    confiabilidadInformada: confiabilidad != null,
    ...(typeof row.puntaje === 'number' ? { puntaje: row.puntaje } : {}),
    elegible: true,
    motivoCodigo: null,
    motivo: null,
    vencimientos,
    alertas,
    legajos: row.legajos || [],
    ...(exigeMarco ? {} : { pruebasSinMarco: true }),
    genero,
  };
  const bloquear = (codigo: EventualMotivoCodigo, mensaje?: string): EventualCandidato => ({
    ...base, elegible: false, motivoCodigo: codigo, motivo: mensaje || EVENTUAL_MOTIVOS[codigo],
  });
  if (String(row.disponibilidad || 'DISPONIBLE').toUpperCase() !== 'DISPONIBLE') return bloquear('NO_DISPONIBLE');
  const generoRequerido = hueco.generoRequerido === 'M' || hueco.generoRequerido === 'F' ? hueco.generoRequerido : null;
  if (generoRequerido) {
    if (!genero) return bloquear('GENERO_SIN_ESPECIFICAR');
    if (genero !== generoRequerido) return bloquear('GENERO_NO_COINCIDE');
  }
  if (exigeMarco && !(row.empresasHabilitadas || []).includes(hueco.empresaId)) return bloquear('EMPRESA_NO_HABILITADA');
  if (exigeMarco) {
    const marco = marcoEventual((row.marcos || {})[hueco.empresaId], hoy);
    if (marco.estado !== 'MARCO_VIGENTE') return bloquear('SIN_MARCO');
    if (marco.avisar) base.alertas.push(`contrato marco vence ${marco.vencimiento}`);
  }
  const porTipo = (tipo: EventualVencimientoTipo) => vencimientos.find((v) => v.tipo === tipo)!;
  const credencial = porTipo('credencial');
  if (credencial.estado === 'VENCIDO' || credencial.estado === 'SIN_DATO') return bloquear('CREDENCIAL_VENCIDA', credencial.estado === 'SIN_DATO' ? 'Credencial sin fecha de vencimiento.' : undefined);
  const apto = porTipo('apto');
  if (apto.estado === 'VENCIDO' || apto.estado === 'SIN_DATO') return bloquear('APTO_VENCIDO', apto.estado === 'SIN_DATO' ? 'Apto psicofísico sin fecha de vencimiento.' : undefined);
  const aptoEstado = String(row.aptoPsicofisico?.estado || '').trim().toUpperCase();
  if (aptoEstado && aptoEstado !== 'APTO') return bloquear('NO_APTO');
  if (porTipo('habilitacion').estado === 'VENCIDO') return bloquear('HABILITACION_VENCIDA');
  const tramos = hueco.jornadas?.length ? hueco.jornadas : [{ startMs: hueco.startMs, endMs: hueco.endMs }];
  const cruce = bloqueoCruceEventual({ empresaId: hueco.empresaId, jornadas: tramos }, otrasDelCuil);
  if (!cruce.ok) return bloquear(cruce.codigo || 'SUPERPOSICION', cruce.mensaje);
  const tope = row.topeHoras;
  if (tope && Number(tope.tope) > 0) {
    const usadas = Number(tope.usadas) || 0;
    const topeN = Number(tope.tope);
    const horasTurno = Number(tope.horasTurno) || 0;
    const resumen = resumenHorasMes(usadas, topeN);
    const supera = usadas + horasTurno > topeN + 1e-9;
    base.horasMes = { usadas, tope: topeN, texto: resumen.texto, aviso: !supera && resumen.aviso };
    if (supera) return bloquear('TOPE_HORAS', textoTopeHoras(usadas, topeN, horasTurno));
    if (base.horasMes.aviso) base.alertas.push(resumen.texto);
  }
  return base;
}

/** Elegibles primero; después distancia (sin dato al final), confiabilidad, puntaje y nombre. */
export function ordenarEventuales(lista: EventualCandidato[]): EventualCandidato[] {
  return [...lista].sort((a, b) => {
    if (a.elegible !== b.elegible) return a.elegible ? -1 : 1;
    const da = a.distanceKm == null ? Number.POSITIVE_INFINITY : a.distanceKm;
    const db = b.distanceKm == null ? Number.POSITIVE_INFINITY : b.distanceKm;
    if (da !== db) return da - db;
    const ca = a.confiabilidadInformada ? a.confiabilidad : -1;
    const cb = b.confiabilidadInformada ? b.confiabilidad : -1;
    if (ca !== cb) return cb - ca;
    if (typeof a.puntaje === 'number' && typeof b.puntaje === 'number' && a.puntaje !== b.puntaje) return b.puntaje - a.puntaje;
    return a.employeeName.localeCompare(b.employeeName, 'es');
  });
}

/**
 * Candidatos de la bolsa para un hueco. Sin input, lista vacía.
 * Por defecto (CC / cascada) devuelve los elegibles y, bloqueados, los que faltan de marco.
 * Con `incluirNoElegibles` (Planificación) devuelve toda la bolsa con su motivo.
 */
export function eventualesParaHueco(input?: EventualesHuecoInput | null): EventualCandidato[] {
  const hueco = input?.hueco;
  const bolsa = input?.bolsa || [];
  if (!hueco?.empresaId) return [];
  const tramos = hueco.jornadas?.length ? hueco.jornadas : [{ startMs: hueco.startMs, endMs: hueco.endMs }];
  if (tramos.some((t) => !t.startMs || !t.endMs)) return [];
  const otras = input?.otrasJornadas || [];
  const diasAviso = input?.diasAviso ?? 30;
  const out: EventualCandidato[] = [];
  for (const row of bolsa) {
    const cuil = String(row.cuil || '').trim();
    const delCuil = otras.filter((j) => j.cuil === cuil);
    const cand = evaluarEventualParaHueco(row, hueco, delCuil, diasAviso);
    if (!cand) continue;
    if (!cand.elegible && !input?.incluirNoElegibles) {
      if (cand.motivoCodigo !== 'SIN_MARCO') continue;
      // El CC muestra «Sin contrato marco» solo si no hay otro bloqueo (vencido, cruce): se revisa sin marco.
      const resto = evaluarEventualParaHueco({ ...row, exigirMarco: false }, hueco, delCuil, diasAviso);
      if (!resto?.elegible) continue;
    }
    out.push(cand);
  }
  return ordenarEventuales(out);
}

/**
 * Qué hacer con ARCA cuando el eventual no va a trabajar.
 * `puedeAnular` lo calcula `plazoAnulacionAlta` (RG 2988/2010 art. 9). La anulación es el
 * módulo de Anulación de Incorporaciones: no lleva código de motivo. Vencida la ventana, baja.
 */
export type EventualAusenteArca = {
  accion: 'CANCELAR_AT' | 'ANULACION' | 'BAJA';
  tipo: 'ANULACION' | 'BAJA_NO_PRESENTACION' | null;
  movimiento: string | null;
  canal: 'URGENTE' | null;
  /** Anulación: sin remuneración. */
  bruto: number | null;
  fechaBaja: string | null;
  revista: string | null;
  motivo: string | null;
  modulo: string | null;
  constanciaInterna: string | null;
};

export type DesempenoEventualTipo = 'CANCELACION_ANTICIPADA' | 'CANCELACION_TARDIA' | 'FALTA_SIN_AVISO';

export type EventualAusentePlan = {
  employeeId: string;
  empresaAltaId: string;
  eventoId: string;
  shiftId: string;
  neverStarted: boolean;
  /** No se paga la jornada (AA / turno cancelado). */
  descuentaLiquidacion: true;
  confiabilidadDelta: -1;
  arcaBajaPendiente: boolean;
  aviso: boolean;
  desempeno: DesempenoEventualTipo;
  arca: EventualAusenteArca;
};

export function planEventualAusente(input: {
  employeeId?: string;
  empresaAltaId?: string;
  eventoId?: string;
  shiftId?: string;
  isEventual?: boolean;
  punched?: boolean;
  /** Avisó que no va (app), antes del inicio. Sin esto es falta sin aviso. */
  aviso?: boolean;
  /** El AT ya se subió (SUBIENDO o CONFIRMADO). */
  atSubido?: boolean;
  inicioMs?: number;
  ahoraMs?: number;
  /** YYYY-MM-DD del inicio fijado. La baja usa este día, no el fin del contrato. */
  fechaInicio?: string;
  /** Resultado de `plazoAnulacionAlta`. Sin este dato no se anula: queda la baja. */
  puedeAnular?: boolean;
  /** Código de revista de la baja por desistimiento. `empresas.arcaEventuales.situacionRevistaDesistimiento`. */
  revistaDesistimiento?: string;
  /** Alias histórico del código de revista. */
  revistaNoInicio?: string;
}): EventualAusentePlan | null {
  if (input.isEventual !== true) return null;
  const employeeId = String(input.employeeId || '').trim();
  const empresaAltaId = String(input.empresaAltaId || '').trim();
  if (!employeeId || !empresaAltaId) return null;
  const neverStarted = input.punched !== true;
  const aviso = input.aviso === true;
  const inicioMs = Number(input.inicioMs) || 0;
  const ahoraMs = Number(input.ahoraMs) || 0;
  const vacio = { modulo: null, constanciaInterna: null };
  const arca: EventualAusenteArca = input.atSubido !== true
    ? { accion: 'CANCELAR_AT', tipo: null, movimiento: null, canal: null, bruto: null, fechaBaja: null, revista: null, motivo: null, ...vacio }
    : input.puedeAnular === true
      ? {
        accion: 'ANULACION', tipo: 'ANULACION', movimiento: null, canal: 'URGENTE', bruto: 0,
        fechaBaja: null, revista: null, motivo: null, modulo: 'ANULACION_INCORPORACIONES', constanciaInterna: 'NO_SE_PRESENTO',
      }
      : {
        accion: 'BAJA',
        tipo: 'BAJA_NO_PRESENTACION',
        movimiento: 'BT',
        canal: 'URGENTE',
        bruto: null,
        fechaBaja: String(input.fechaInicio || ''),
        revista: String(input.revistaDesistimiento || input.revistaNoInicio || '30'),
        motivo: 'desistimiento / sin efectivización de tareas',
        modulo: null,
        constanciaInterna: 'NO_SE_PRESENTO',
      };
  const horasAntes = inicioMs > 0 ? (inicioMs - ahoraMs) / 3600000 : 0;
  const desempeno: DesempenoEventualTipo = aviso
    ? (horasAntes >= 24 ? 'CANCELACION_ANTICIPADA' : 'CANCELACION_TARDIA')
    : 'FALTA_SIN_AVISO';
  return {
    employeeId,
    empresaAltaId,
    eventoId: String(input.eventoId || ''),
    shiftId: String(input.shiftId || ''),
    neverStarted,
    descuentaLiquidacion: true,
    confiabilidadDelta: -1,
    arcaBajaPendiente: neverStarted,
    aviso,
    desempeno,
    arca,
  };
}
