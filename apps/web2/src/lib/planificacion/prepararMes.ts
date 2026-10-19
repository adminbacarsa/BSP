/**
 * «Preparar el mes» (pantalla principal de Planificación, sin entrar a un objetivo): corre «Continuar» y «Armar el mes»
 * en cada objetivo (o grupo, como un solo cronograma) y mide cada estrategia para elegir la mejor. Solo lectura: no
 * escribe nada. Los objetivos se simulan uno por uno y lo que propone uno cuenta en los siguientes (un guardia no queda
 * en dos lugares el mismo día y sus horas suman en todos).
 */
import {
  cupoDelServicio,
  proponerContinuacion,
  turnoHabilitadoPorEstructura,
  type CeldaPropuesta,
  type EstadoCelda,
  type PuestoSla,
  type ResultadoGuardia,
  type TurnoPrevio,
} from './continuarMesAnterior';
import { armarMesDesdeServicio, cubrirHuecosConDisponibles, type ArmarMesInput, type TipoGuardiaArmado } from './armarMesServicio';
import { sugerenciasSueltas } from './continuarSueltos';
import { getEffectiveShiftQuantityOnDate } from '../slaPlanningMatch';

export type Estrategia = 'continuar' | 'armar';

export const TOPE_HORAS_MES = 200;

/** Turno que ya está en el mes (cualquier objetivo) o que la tanda ya le dio a alguien en otro objetivo. */
export type TurnoMes = {
  code: string;
  positionName?: string;
  startTime?: unknown;
  endTime?: unknown;
  hours: number;
  isFranco: boolean;
  /** Es del objetivo (o grupo) que se está simulando. */
  enUnidad: boolean;
};

export type EntradaUnidad = {
  unidadId: string;
  dias: string[];
  estructura: PuestoSla[];
  guardias: Array<{ id: string; nombre: string; previos: TurnoPrevio[]; puestoPreferido?: string; tipo: TipoGuardiaArmado }>;
  salientes: Array<{ id: string; nombre: string; previos: TurnoPrevio[] }>;
  licencia: (employeeId: string, dateStr: string) => boolean;
  turnoDelMes: (employeeId: string, dateStr: string) => TurnoMes | null;
  /** Horas del mes en otros objetivos (cargadas + lo que la tanda ya asignó). */
  horasFueraDe: (employeeId: string) => number;
  retFuera: (dateStr: string) => Array<{ id: string; nombre: string; objetivo: string }>;
  diaBloqueado: (dateStr: string) => boolean;
  /** Habilita ese turno del puesto ese día (días de la semana, feriados, exclusiones). */
  turnoHabilitado: (positionName: string, code: string, dateStr: string) => boolean;
};

export type Metricas = {
  /** Horas que pide el servicio en el mes (sin las de 12 h, que son alternativa). */
  horasPedidas: number;
  horasSinCubrir: number;
  diasConHueco: number;
  /** Turnos D12/N12 propuestos. */
  doce: number;
  /** Lo que pasa de 200 h por guardia (contando su turno en otros objetivos). */
  horasAl50: number;
  ret: number;
  /** Cambios de puesto o banda entre un día de trabajo y el siguiente. */
  cambios: number;
  guardiasUsados: number;
  horasMin: number;
  horasMax: number;
  propuestas: number;
};

export type SimulacionUnidad = {
  continuar: { metricas: Metricas; celdas: CeldaPropuesta[] };
  armar: { metricas: Metricas; celdas: CeldaPropuesta[] };
  recomendada: Estrategia;
  porQue: string;
};

const up = (v: unknown) => String(v ?? '').trim().toUpperCase();
const esDoce = (code: string) => /D12$|N12$/.test(up(code));

function horasEntre(a: string, b: string): number {
  const m = (t: string) => { const [h, mi] = t.split(':').map(Number); return h * 60 + (mi || 0); };
  const d = m(b) - m(a);
  return Math.round(((d > 0 ? d : d + 1440) / 60) * 100) / 100;
}

function horasCelda(c: { code: string; isFranco?: boolean; hours?: number; startTime?: string; endTime?: string }): number {
  if (c.isFranco || up(c.code) === 'RET') return 0;
  if (Number(c.hours) > 0) return Number(c.hours);
  return c.startTime && c.endTime && /^\d{1,2}:\d{2}$/.test(c.startTime) ? horasEntre(c.startTime, c.endTime) : 8;
}

/** Horas que pide cada puesto ese día: franjas de 8 h (y propias) con su cantidad; D12/N12 son alternativa. */
export function horasPedidasDelDia(estructura: PuestoSla[], dateStr: string, habilitado: EntradaUnidad['turnoHabilitado']): Map<string, number> {
  const out = new Map<string, number>();
  for (const pos of estructura) {
    let h = 0;
    for (const s of pos.shifts || []) {
      if (!s.code || !s.startTime || !s.endTime || esDoce(String(s.code))) continue;
      if (!habilitado(pos.positionName, String(s.code), dateStr)) continue;
      const q = getEffectiveShiftQuantityOnDate(pos as never, dateStr, String(s.code), pos.qty) || 0;
      h += q * (Number(s.hours) || horasEntre(String(s.startTime), String(s.endTime)));
    }
    if (h > 0) out.set(pos.positionName, (out.get(pos.positionName) || 0) + h);
  }
  return out;
}

/** Celdas finales de una estrategia: propuestas + sueltos tildados + disponibles (lo que la vista previa deja tildado). */
function celdasFinales(resultados: ResultadoGuardia[], extra: CeldaPropuesta[]): CeldaPropuesta[] {
  const out = new Map<string, CeldaPropuesta>();
  for (const r of resultados) {
    for (const c of r.propuestas) out.set(`${c.employeeId}_${c.dateStr}`, c);
    for (const s of r.sugerencias || []) if (s.tipo === 'suelto') out.set(`${s.celda.employeeId}_${s.dateStr}`, s.celda);
  }
  for (const c of extra) out.set(`${c.employeeId}_${c.dateStr}`, c);
  return [...out.values()];
}

export function medirEstrategia(input: EntradaUnidad, celdas: CeldaPropuesta[]): Metricas {
  let horasPedidas = 0;
  let horasSinCubrir = 0;
  let diasConHueco = 0;
  const idsGuardias = new Set(input.guardias.map((g) => g.id));
  const porDia = new Map<string, CeldaPropuesta[]>();
  for (const c of celdas) porDia.set(c.dateStr, [...(porDia.get(c.dateStr) || []), c]);
  for (const ds of input.dias) {
    if (input.diaBloqueado(ds)) continue;
    const pide = horasPedidasDelDia(input.estructura, ds, input.turnoHabilitado);
    const hechas = new Map<string, number>();
    for (const c of porDia.get(ds) || []) hechas.set(c.positionName, (hechas.get(c.positionName) || 0) + horasCelda(c));
    // Lo que ya está cargado en el mes (borrador o licencia aparte) también cubre.
    const vistos = new Set((porDia.get(ds) || []).map((c) => c.employeeId));
    for (const id of idsGuardias) {
      if (vistos.has(id)) continue;
      const t = input.turnoDelMes(id, ds);
      if (t?.enUnidad && t.positionName && !t.isFranco) hechas.set(t.positionName, (hechas.get(t.positionName) || 0) + t.hours);
    }
    let faltaDia = 0;
    for (const [pos, h] of pide) {
      horasPedidas += h;
      faltaDia += Math.max(0, h - (hechas.get(pos) || 0));
    }
    // Media hora de tolerancia por horarios corridos.
    if (faltaDia > 0.5) { horasSinCubrir += faltaDia; diasConHueco += 1; }
  }
  const horas = new Map<string, number>();
  let cambios = 0;
  const porGuardia = new Map<string, CeldaPropuesta[]>();
  for (const c of celdas) porGuardia.set(c.employeeId, [...(porGuardia.get(c.employeeId) || []), c]);
  for (const [id, list] of porGuardia) {
    let h = 0;
    let prev: string | null = null;
    for (const c of list.sort((a, b) => a.dateStr.localeCompare(b.dateStr))) {
      h += horasCelda(c);
      if (c.isFranco || up(c.code) === 'RET') continue;
      const clave = `${c.positionName}|${up(c.code).replace(/12$/, '')}`;
      if (prev && prev !== clave) cambios += 1;
      prev = clave;
    }
    horas.set(id, h);
  }
  // Horas ya cargadas en la unidad que la estrategia no tocó.
  for (const id of idsGuardias) {
    let extra = 0;
    for (const ds of input.dias) {
      if ((porGuardia.get(id) || []).some((c) => c.dateStr === ds)) continue;
      const t = input.turnoDelMes(id, ds);
      if (t?.enUnidad && !t.isFranco) extra += t.hours;
    }
    if (extra) horas.set(id, (horas.get(id) || 0) + extra);
  }
  let horasAl50 = 0;
  const totales: number[] = [];
  for (const [id, h] of horas) {
    const total = h + input.horasFueraDe(id);
    horasAl50 += Math.max(0, total - TOPE_HORAS_MES);
    if (h > 0) totales.push(total);
  }
  const trabajo = celdas.filter((c) => !c.isFranco && up(c.code) !== 'RET');
  return {
    horasPedidas: Math.round(horasPedidas),
    horasSinCubrir: Math.round(horasSinCubrir),
    diasConHueco,
    doce: trabajo.filter((c) => esDoce(c.code)).length,
    horasAl50: Math.round(horasAl50),
    ret: celdas.filter((c) => up(c.code) === 'RET').length,
    cambios,
    guardiasUsados: new Set(trabajo.map((c) => c.employeeId)).size,
    horasMin: totales.length ? Math.round(Math.min(...totales)) : 0,
    horasMax: totales.length ? Math.round(Math.max(...totales)) : 0,
    propuestas: celdas.length,
  };
}

/**
 * La mejor: menos horas sin cubrir (con 4 h de margen), después menos horas al 50 %, después menos 12 h.
 * Si empatan, la copia: mantiene el ritmo y los puestos que la gente ya conoce.
 */
export function elegirEstrategia(c: Metricas, a: Metricas): { recomendada: Estrategia; porQue: string } {
  if (Math.abs(c.horasSinCubrir - a.horasSinCubrir) > 4) {
    const gana: Estrategia = a.horasSinCubrir < c.horasSinCubrir ? 'armar' : 'continuar';
    const [g, p] = gana === 'armar' ? [a, c] : [c, a];
    return { recomendada: gana, porQue: `deja ${g.horasSinCubrir} h sin cubrir contra ${p.horasSinCubrir} h` };
  }
  if (c.horasAl50 !== a.horasAl50) {
    const gana: Estrategia = a.horasAl50 < c.horasAl50 ? 'armar' : 'continuar';
    const [g, p] = gana === 'armar' ? [a, c] : [c, a];
    return { recomendada: gana, porQue: `${g.horasAl50} h al 50 % contra ${p.horasAl50} h` };
  }
  if (c.doce !== a.doce) {
    const gana: Estrategia = a.doce < c.doce ? 'armar' : 'continuar';
    const [g, p] = gana === 'armar' ? [a, c] : [c, a];
    return { recomendada: gana, porQue: `${g.doce} turnos de 12 h contra ${p.doce}` };
  }
  return { recomendada: 'continuar', porQue: 'cubren igual: la copia mantiene el ritmo y los puestos de cada uno' };
}

export function simularUnidad(input: EntradaUnidad): SimulacionUnidad {
  const estadoCelda = (id: string, ds: string): EstadoCelda => {
    if (input.licencia(id, ds)) return 'licencia';
    return input.turnoDelMes(id, ds) ? 'ocupada' : null;
  };
  const ocupadoFuera: ArmarMesInput['ocupadoFuera'] = (id, ds) => {
    const t = input.turnoDelMes(id, ds);
    if (!t || t.enUnidad || t.isFranco || ['RET', ''].includes(up(t.code))) return null;
    return { startTime: t.startTime, endTime: t.endTime, hours: t.hours };
  };
  const francoFuera = (id: string, ds: string) => {
    const t = input.turnoDelMes(id, ds);
    return !!t && !t.enUnidad && t.isFranco;
  };
  const cargado = (id: string, ds: string) => {
    const t = input.turnoDelMes(id, ds);
    if (!t || !t.enUnidad || t.isFranco || input.licencia(id, ds)) return null;
    return up(t.code) || null;
  };
  const tipos = new Map(input.guardias.map((g) => [g.id, g.tipo]));
  const base = {
    objectiveId: input.unidadId,
    dias: input.dias,
    guardias: input.guardias.map((g) => ({ id: g.id, nombre: g.nombre, previos: g.previos, puestoPreferido: g.puestoPreferido })),
    estructura: input.estructura,
    estadoCelda,
    diaBloqueado: input.diaBloqueado,
    turnoHabilitado: input.turnoHabilitado,
  };
  const continuar = proponerContinuacion({
    ...base,
    salientes: input.salientes,
    cupoDia: (ds) => (input.diaBloqueado(ds) ? null : cupoDelServicio(input.estructura, ds, input.turnoHabilitado)),
    punteroPrevio: null,
    cargado,
  });
  const sueltas = sugerenciasSueltas({
    dias: input.dias,
    estructura: input.estructura,
    turnoHabilitado: input.turnoHabilitado,
    historia: input.guardias.map((g) => ({ employeeId: g.id, nombre: g.nombre, previos: g.previos })),
    resultados: continuar.map((r) => {
      const rot = new Map((r.sugerencias || []).filter((x) => x.tipo === 'rotacion').map((x) => [x.dateStr, x.celda]));
      return rot.size ? { ...r, propuestas: r.propuestas.map((c) => rot.get(c.dateStr) || c) } : r;
    }),
    cargado: (id, ds) => {
      const t = input.turnoDelMes(id, ds);
      if (!t || !t.enUnidad || t.isFranco || input.licencia(id, ds) || !t.code) return null;
      return { code: up(t.code), positionName: String(t.positionName || '') };
    },
    libre: (id, ds) => estadoCelda(id, ds) === null,
    diaBloqueado: input.diaBloqueado,
    mesAnteriorLabel: '',
  });
  for (const sg of sueltas) {
    const r = continuar.find((x) => x.employeeId === sg.celda.employeeId);
    if (r && !(r.sugerencias || []).some((x) => x.tipo === 'rotacion' && x.dateStr === sg.dateStr)) r.sugerencias = [...(r.sugerencias || []), sg];
  }
  const armado = armarMesDesdeServicio({ ...base, tipoDe: (id) => tipos.get(id) || 'propio', ocupadoFuera, francoFuera });
  const disponibles = (resultados: ResultadoGuardia[]) => {
    const conSueltas = resultados.map((r) => {
      const su = new Map((r.sugerencias || []).filter((x) => x.tipo === 'suelto').map((x) => [x.dateStr, x.celda]));
      return su.size ? { ...r, propuestas: [...r.propuestas.filter((c) => !su.has(c.dateStr)), ...su.values()] } : r;
    });
    return cubrirHuecosConDisponibles({
      ...base,
      guardias: input.guardias.map((g) => ({ id: g.id, nombre: g.nombre, previos: g.previos })),
      tipoDe: (id) => tipos.get(id) || 'otro',
      ocupadoFuera,
      francoFuera,
      retFuera: input.retFuera,
      horasFueraDe: input.horasFueraDe,
    }, conSueltas).map((d) => d.celda);
  };
  const celdasC = celdasFinales(continuar, disponibles(continuar));
  const celdasA = celdasFinales(armado, disponibles(armado));
  const mc = medirEstrategia(input, celdasC);
  const ma = medirEstrategia(input, celdasA);
  return { continuar: { metricas: mc, celdas: celdasC }, armar: { metricas: ma, celdas: celdasA }, ...elegirEstrategia(mc, ma) };
}

export { turnoHabilitadoPorEstructura };
