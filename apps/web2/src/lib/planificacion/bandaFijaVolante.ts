/**
 * Banda fija y volante (Colegio Padre Claret).
 *
 * Del mes anterior: quien tiene ≥70 % de sus turnos de trabajo en una banda la conserva
 * al continuar y al armar. Quien no tiene banda dominante es volante y cubre el franco
 * del fijo en esa banda. Los turnos que solo existen sábado y domingo (NE) se reparten
 * por horas del ciclo 26→25, primero a quien menos tiene, para que nadie pase de 200 h.
 */
import type {
  CeldaPropuesta,
  ContinuarInput,
  PuestoSla,
  ResultadoGuardia,
  TurnoPrevio,
} from './continuarMesAnterior';
import { bandaDe } from './continuarC2';
import { cctClosingMonthForDate, cctPayrollPeriodForClosingMonth } from '@/lib/cctPayrollPeriod';
import { getEffectiveShiftQuantityOnDate } from '../slaPlanningMatch';

type LibMes = typeof import('./continuarMesAnterior');

function mes(): LibMes {
  return require('./continuarMesAnterior') as LibMes;
}

export const UMBRAL_BANDA_FIJA = 0.7;
const MIN_TURNOS = 8;
const MIN_COBERTURAS = 6;
const CORRELACION_MIN = 0.6;
const TOPE_CICLO = 200;
const TOPE_JORNADA = 12 + 59 / 60;
const DESCANSO_MS = 8 * 3600e3;
const H = 3600e3;

export type Banda = 'M' | 'T' | 'N';
export type RolBanda = {
  id: string;
  nombre: string;
  rol: 'fijo' | 'volante' | 'ayuda';
  banda: Banda | null;
  positionName: string;
  phase: number;
  work: number;
  period: number;
};

export type EntradaBandaFija = ContinuarInput & {
  ocupadoFuera?: (employeeId: string, dateStr: string) => { startTime: unknown; endTime: unknown; hours?: number } | null;
  francoFuera?: (employeeId: string, dateStr: string) => boolean;
};

type Slot = {
  pos: string;
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  hours: number;
  banda: Banda | null;
  finde: boolean;
  lv: boolean;
};

type Trabajo = {
  kind: 'W';
  code: string;
  name: string;
  pos: string;
  startTime: string;
  endTime: string;
  hours: number;
  banda: Banda | null;
  finde: boolean;
  lv: boolean;
  externo: boolean;
};

type Asig = Trabajo | { kind: 'F' } | { kind: 'RET' };

const RITMOS: Array<[number, number]> = [[6, 8], [5, 6], [6, 7], [4, 6]];

function up(v: unknown): string {
  return String(v ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

function horasEntre(a: string, b: string): number {
  const m = (t: string) => {
    const [h, mi] = t.split(':').map(Number);
    return h * 60 + (mi || 0);
  };
  const d = m(b) - m(a);
  return Math.round(((d > 0 ? d : d + 1440) / 60) * 100) / 100;
}

function hhmm(v: unknown): string {
  if (typeof v === 'string') {
    const m = v.match(/(\d{1,2}):(\d{2})/);
    return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
  }
  const d = v && typeof (v as { toDate?: () => Date }).toDate === 'function'
    ? (v as { toDate: () => Date }).toDate()
    : v instanceof Date ? v : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  const x = new Date(d.getTime() - 3 * 3600000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(x.getUTCHours())}:${p(x.getUTCMinutes())}`;
}

function horarioDe(code: string, turno: TurnoPrevio, estructura: PuestoSla[]): { start: string; end: string } {
  const start = hhmm(turno.startTime);
  const end = hhmm(turno.endTime);
  if (start) return { start, end: end || start };
  for (const pos of estructura) {
    for (const s of pos.shifts || []) {
      if (up(s.code) !== up(code) || !s.startTime) continue;
      return { start: String(s.startTime), end: String(s.endTime || s.startTime) };
    }
  }
  const b = bandaDelCodigo(code, estructura);
  if (b === 'N') return { start: '23:00', end: '08:00' };
  if (b === 'T') return { start: '15:00', end: '23:00' };
  return { start: '07:00', end: '15:00' };
}

function esFindeSolo(days: string[] | undefined): boolean {
  const d = (days || []).map((x) => up(x));
  return d.length > 0 && d.every((x) => x === 'S' || x === 'D');
}

function esLv(days: string[] | undefined): boolean {
  const d = (days || []).map((x) => up(x));
  return d.length > 0 && !d.includes('S') && !d.includes('D');
}

export function bandaDelCodigo(code: string, estructura: PuestoSla[]): Banda | null {
  const directa = bandaDe(up(code));
  if (directa) return directa;
  const c = up(code);
  let start = '';
  let finde = false;
  let visto = false;
  for (const pos of estructura) {
    for (const s of pos.shifts || []) {
      if (up(s.code) !== c) continue;
      visto = true;
      start = String(s.startTime || '');
      finde = esFindeSolo(s.days);
    }
  }
  if (finde && start) {
    for (const pos of estructura) {
      for (const s of pos.shifts || []) {
        if (esFindeSolo(s.days) || String(s.startTime || '') !== start) continue;
        const b = bandaDe(up(s.code));
        if (b) return b;
      }
    }
  }
  if (!visto && !c) return null;
  if (c.startsWith('N')) return 'N';
  if (c.startsWith('T')) return 'T';
  if (c.startsWith('M')) return 'M';
  return null;
}

function claveCiclo(ds: string): string {
  const [y, m, d] = ds.split('-').map(Number);
  const c = cctClosingMonthForDate(new Date(y, m - 1, d));
  return cctPayrollPeriodForClosingMonth(c.closingYear, c.closingMonth).start;
}

function rangoMesAnterior(primer: string): { desde: string; hasta: string } {
  const { diaIndex, ymdDeIndex } = mes();
  const hasta = ymdDeIndex(diaIndex(primer) - 1);
  const [y, m] = primer.split('-').map(Number);
  const desde = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
  return { desde, hasta };
}

function turnoDelDia(previos: TurnoPrevio[], objectiveId: string): Map<string, { code: string; turno: TurnoPrevio }> {
  const { codigoDeCiclo } = mes();
  const out = new Map<string, { code: string; turno: TurnoPrevio }>();
  const rank = (c: string) => (c === 'F' ? 1 : c === 'RET' ? 2 : 3);
  for (const t of previos || []) {
    const ds = String(t.dateStr || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) continue;
    const code = codigoDeCiclo(t, objectiveId);
    if (!code) continue;
    const prev = out.get(ds);
    if (!prev || rank(code) >= rank(prev.code)) out.set(ds, { code, turno: t });
  }
  return out;
}

function horasCodigo(code: string, turno: TurnoPrevio, estructura: PuestoSla[]): number {
  if (code === 'F' || code === 'RET') return 0;
  const h = Number(turno.hours);
  if (h > 0) return h;
  for (const pos of estructura) {
    for (const s of pos.shifts || []) {
      if (up(s.code) !== up(code)) continue;
      if (Number(s.hours) > 0) return Number(s.hours);
      if (s.startTime && s.endTime) return horasEntre(String(s.startTime), String(s.endTime));
    }
  }
  return bandaDelCodigo(code, estructura) === 'N' ? 9 : 8;
}

function mejorFase(muestras: Array<{ idx: number; on: boolean }>): { phase: number; work: number; period: number } {
  let best = { phase: 0, work: 6, period: 8, score: -1 };
  if (!muestras.length) return { phase: 0, work: 6, period: 8 };
  for (const [work, period] of RITMOS) {
    for (let phase = 0; phase < period; phase++) {
      let ok = 0;
      for (const s of muestras) if (((s.idx + phase) % period < work) === s.on) ok += 1;
      const score = ok / muestras.length;
      const prefiere62 = work === 6 && period === 8 && score === best.score;
      if (score > best.score || prefiere62) best = { phase, work, period, score };
    }
  }
  return { phase: best.phase, work: best.work, period: best.period };
}

function moda(counts: Map<string, number>): string {
  let best = '';
  let n = 0;
  for (const [k, v] of counts) if (v > n) { best = k; n = v; }
  return best;
}

/**
 * null si el objetivo no es banda fija + volante (rotación, copia por semana, un solo fijo).
 * Hace falta al menos dos fijos y un volante que cubra sus francos.
 */
export function detectarRolesBanda(input: ContinuarInput): RolBanda[] | null {
  if (!input.dias.length || input.guardias.length < 3) return null;
  const { diaIndex } = mes();
  const primer = input.dias[0];
  const { desde, hasta } = rangoMesAnterior(primer);
  const desdeFase = diaIndex(primer) - 45;
  type Lectura = { id: string; nombre: string; dias: Map<string, { code: string; turno: TurnoPrevio }> };
  const lecturas: Lectura[] = input.guardias.map((g) => ({
    id: g.id,
    nombre: g.nombre,
    dias: turnoDelDia(g.previos, input.objectiveId),
  }));
  const fijos: RolBanda[] = [];
  const volantes: Array<RolBanda & { trabajos: Array<{ ds: string; banda: Banda }> }> = [];
  const ayuda: RolBanda[] = [];
  for (const g of lecturas) {
    const bandas = new Map<Banda, number>();
    const puestos = new Map<string, number>();
    const trabajos: Array<{ ds: string; banda: Banda }> = [];
    for (const [ds, cel] of g.dias) {
      if (ds < desde || ds > hasta || cel.code === 'F' || cel.code === 'RET') continue;
      const b = bandaDelCodigo(cel.code, input.estructura);
      if (!b) continue;
      bandas.set(b, (bandas.get(b) || 0) + 1);
      const pos = String(cel.turno.positionName || '').trim();
      if (pos && up(pos) !== 'GENERAL') puestos.set(pos, (puestos.get(pos) || 0) + 1);
      trabajos.push({ ds, banda: b });
    }
    const total = trabajos.length;
    let top: Banda | null = null;
    let topN = 0;
    for (const [b, n] of bandas) if (n > topN) { top = b; topN = n; }
    const muestras: Array<{ idx: number; on: boolean }> = [];
    for (const [ds, cel] of g.dias) {
      const idx = diaIndex(ds);
      if (idx < desdeFase || ds >= primer) continue;
      muestras.push({ idx, on: cel.code !== 'F' });
    }
    const fase = mejorFase(muestras);
    const positionName = moda(puestos);
    const posOk = input.estructura.some((p) => p.positionName === positionName) ? positionName : '';
    if (total >= MIN_TURNOS && top && topN / total >= UMBRAL_BANDA_FIJA) {
      fijos.push({ id: g.id, nombre: g.nombre, rol: 'fijo', banda: top, positionName: posOk, ...fase });
    } else if (total >= MIN_TURNOS && bandas.size >= 2) {
      volantes.push({ id: g.id, nombre: g.nombre, rol: 'volante', banda: null, positionName: posOk, ...fase, trabajos });
    } else {
      ayuda.push({ id: g.id, nombre: g.nombre, rol: 'ayuda', banda: null, positionName: '', phase: 0, work: 6, period: 8 });
    }
  }
  if (fijos.length < 2 || volantes.length < 1) return null;
  const porId = new Map(lecturas.map((g) => [g.id, g.dias]));
  const cubre = volantes.some((v) => {
    let n = 0;
    let ok = 0;
    for (const t of v.trabajos) {
      const delBanda = fijos.filter((f) => f.banda === t.banda);
      if (!delBanda.length) continue;
      n += 1;
      if (delBanda.some((f) => porId.get(f.id)?.get(t.ds)?.code === 'F')) ok += 1;
    }
    return n >= MIN_COBERTURAS && ok / n >= CORRELACION_MIN;
  });
  if (!cubre) return null;
  const porOrden = new Map(input.guardias.map((g, i) => [g.id, i]));
  return [...fijos, ...volantes.map(({ trabajos: _t, ...v }) => v), ...ayuda].sort(
    (a, b) => (porOrden.get(a.id) || 0) - (porOrden.get(b.id) || 0),
  );
}

function inicioMs(ds: string, start: string): number {
  return new Date(`${ds}T${start.padStart(5, '0')}:00-03:00`).getTime();
}

function slotsDelDia(
  estructura: PuestoSla[],
  ds: string,
  habilitado: (pos: string, code: string, ds: string) => boolean,
): Slot[] {
  const out: Slot[] = [];
  for (const pos of estructura) {
    for (const s of pos.shifts || []) {
      const code = up(s.code);
      if (!code || !s.startTime || !s.endTime || /D12$|N12$/.test(code)) continue;
      if (!habilitado(pos.positionName, code, ds)) continue;
      const q = getEffectiveShiftQuantityOnDate(pos, ds, code, pos.qty) || 0;
      const hours = Number(s.hours) > 0 ? Number(s.hours) : horasEntre(String(s.startTime), String(s.endTime));
      if (!(hours > 0) || hours > TOPE_JORNADA) continue;
      const finde = esFindeSolo(s.days);
      const banda = bandaDelCodigo(code, estructura);
      for (let i = 0; i < q; i++) {
        out.push({
          pos: pos.positionName,
          code: String(s.code),
          name: String(s.name || s.code),
          startTime: String(s.startTime),
          endTime: String(s.endTime),
          hours,
          banda,
          finde,
          lv: esLv(s.days),
        });
      }
    }
  }
  return out;
}

export function planificarBandaFija(input: EntradaBandaFija): ResultadoGuardia[] | null {
  const roles = detectarRolesBanda(input);
  if (!roles) return null;
  const { diaIndex, ymdDeIndex, turnoHabilitadoPorEstructura, sinTresFrancosSeguidos } = mes();
  const dias = input.dias;
  const primero = dias[0];
  const habilitado = input.turnoHabilitado
    || ((pos: string, code: string, ds: string) => turnoHabilitadoPorEstructura(input.estructura, pos, code, ds));
  const estado = new Map<string, Map<string, Asig>>();
  const horas = new Map<string, Map<string, number>>();
  const orden = new Map(roles.map((r, i) => [r.id, i]));
  const omitidas = new Map(roles.map((r) => [r.id, { licencia: 0, ocupada: 0, bloqueada: 0, sinDato: 0, excluida: 0 }]));
  for (const r of roles) horas.set(r.id, new Map());

  const leer = (id: string, ds: string): Asig | null => estado.get(id)?.get(ds) || null;
  const poner = (id: string, ds: string, a: Asig) => {
    let row = estado.get(id);
    if (!row) { row = new Map(); estado.set(id, row); }
    row.set(ds, a);
  };
  const sumar = (id: string, ds: string, delta: number) => {
    const m = horas.get(id)!;
    const k = claveCiclo(ds);
    m.set(k, Math.round(((m.get(k) || 0) + delta) * 100) / 100);
  };
  const horasEn = (id: string, ds: string) => horas.get(id)?.get(claveCiclo(ds)) || 0;
  const rolDe = (id: string) => roles.find((r) => r.id === id)!;
  const enTrabajo = (p: RolBanda, ds: string) => p.rol !== 'ayuda' && (diaIndex(ds) + p.phase) % p.period < p.work;
  const trabajo = (id: string, ds: string): Trabajo | null => {
    const a = leer(id, ds);
    return a && a.kind === 'W' ? a : null;
  };

  const desdeHist = ymdDeIndex(diaIndex(primero) - 12);
  for (const g of input.guardias) {
    const diasT = turnoDelDia(g.previos, input.objectiveId);
    for (const [ds, cel] of diasT) {
      if (ds >= primero) continue;
      if (cel.code === 'F' || cel.code === 'RET') {
        if (ds >= desdeHist) poner(g.id, ds, { kind: cel.code === 'F' ? 'F' : 'RET' });
        continue;
      }
      const hours = horasCodigo(cel.code, cel.turno, input.estructura);
      sumar(g.id, ds, hours);
      if (ds < desdeHist) continue;
      const win = horarioDe(cel.code, cel.turno, input.estructura);
      const b = bandaDelCodigo(cel.code, input.estructura);
      poner(g.id, ds, {
        kind: 'W', code: cel.code, name: cel.code, pos: String(cel.turno.positionName || ''),
        startTime: win.start, endTime: win.end, hours, banda: b,
        finde: false, lv: b !== null, externo: true,
      });
    }
  }

  for (const ds of dias) {
    for (const p of roles) {
      const o = input.ocupadoFuera?.(p.id, ds);
      if (!o) continue;
      const start = hhmm(o.startTime) || '07:00';
      const end = hhmm(o.endTime) || start;
      const hours = Number(o.hours) > 0 ? Number(o.hours) : (hhmm(o.startTime) && hhmm(o.endTime) ? horasEntre(start, end) : 8);
      poner(p.id, ds, {
        kind: 'W', code: '', name: '', pos: '', startTime: start, endTime: end, hours,
        banda: null, finde: false, lv: false, externo: true,
      });
      sumar(p.id, ds, hours);
    }
  }

  const puede = (id: string, ds: string, slot: Slot): boolean => {
    if (trabajo(id, ds)) return false;
    if (input.diaBloqueado?.(ds)) return false;
    if (input.estadoCelda(id, ds) !== null) return false;
    if (input.francoFuera?.(id, ds)) return false;
    if (slot.hours > TOPE_JORNADA) return false;
    if (horasEn(id, ds) + slot.hours > TOPE_CICLO + 1e-6) return false;
    const ini = inicioMs(ds, slot.startTime);
    const fin = ini + slot.hours * H;
    const ayer = trabajo(id, ymdDeIndex(diaIndex(ds) - 1));
    if (ayer) {
      const finAyer = inicioMs(ymdDeIndex(diaIndex(ds) - 1), ayer.startTime) + ayer.hours * H;
      if (ini - finAyer < DESCANSO_MS) return false;
    }
    const manDs = ymdDeIndex(diaIndex(ds) + 1);
    const man = trabajo(id, manDs);
    if (man) {
      const iniMan = inicioMs(manDs, man.startTime);
      if (iniMan - fin < DESCANSO_MS) return false;
    }
    let turnos = 0;
    let acum = 0;
    for (let i = 1; i <= 8; i++) {
      const prev = trabajo(id, ymdDeIndex(diaIndex(ds) - i));
      if (!prev) break;
      turnos += 1;
      acum += prev.hours;
    }
    if (turnos + 1 > 6) return false;
    const tope = slot.lv ? 56 : 48;
    if (acum + slot.hours > tope + 1e-6) return false;
    return true;
  };

  const porHoras = (ds: string) => (a: RolBanda, b: RolBanda) => {
    const d = horasEn(a.id, ds) - horasEn(b.id, ds);
    if (d) return d;
    return (orden.get(a.id) || 0) - (orden.get(b.id) || 0);
  };

  const asignar = (p: RolBanda, ds: string, slot: Slot) => {
    poner(p.id, ds, {
      kind: 'W', code: slot.code, name: slot.name, pos: slot.pos, startTime: slot.startTime, endTime: slot.endTime,
      hours: slot.hours, banda: slot.banda, finde: slot.finde, lv: slot.lv, externo: false,
    });
    sumar(p.id, ds, slot.hours);
  };

  const libre = (p: RolBanda, ds: string) => !input.diaBloqueado?.(ds)
    && input.estadoCelda(p.id, ds) === null
    && !input.francoFuera?.(p.id, ds)
    && !trabajo(p.id, ds);

  const posOk = (p: RolBanda, slot: Slot) => !p.positionName || p.positionName === slot.pos;

  for (const ds of dias) {
    if (input.diaBloqueado?.(ds)) {
      for (const p of roles) omitidas.get(p.id)!.bloqueada += 1;
      continue;
    }
    const slots = slotsDelDia(input.estructura, ds, habilitado);
    const pendientes = [...slots];
    const tomar = (slot: Slot) => {
      const i = pendientes.indexOf(slot);
      if (i >= 0) pendientes.splice(i, 1);
    };
    for (const slot of slots.filter((s) => !s.finde)) {
      const propios = roles
        .filter((p) => p.rol === 'fijo' && p.banda === slot.banda && posOk(p, slot) && enTrabajo(p, ds) && libre(p, ds) && puede(p.id, ds, slot))
        .sort(porHoras(ds));
      if (propios[0]) { asignar(propios[0], ds, slot); tomar(slot); continue; }
      const vols = roles
        .filter((p) => (p.rol === 'volante' || p.rol === 'ayuda') && libre(p, ds) && puede(p.id, ds, slot))
        .sort((a, b) => Number(enTrabajo(b, ds)) - Number(enTrabajo(a, ds)) || porHoras(ds)(a, b));
      if (vols[0]) { asignar(vols[0], ds, slot); tomar(slot); continue; }
      const mismo = roles
        .filter((p) => p.rol === 'fijo' && p.banda === slot.banda && posOk(p, slot) && libre(p, ds) && puede(p.id, ds, slot))
        .sort(porHoras(ds));
      if (mismo[0]) { asignar(mismo[0], ds, slot); tomar(slot); }
    }
    for (const slot of pendientes.filter((s) => s.finde)) {
      const franco = !!slot.banda && roles.some((p) => p.rol === 'fijo' && p.banda === slot.banda && !enTrabajo(p, ds));
      if (franco) {
        const vols = roles
          .filter((p) => p.rol === 'volante' && libre(p, ds) && puede(p.id, ds, slot))
          .sort(porHoras(ds));
        if (vols[0]) { asignar(vols[0], ds, slot); continue; }
      }
      const cands = roles.filter((p) => libre(p, ds) && puede(p.id, ds, slot)).sort(porHoras(ds));
      if (cands[0]) asignar(cands[0], ds, slot);
    }
    for (const p of roles) {
      if (leer(p.id, ds)) continue;
      const est = input.estadoCelda(p.id, ds);
      if (input.diaBloqueado?.(ds)) continue;
      if (est === 'licencia') { omitidas.get(p.id)!.licencia += 1; continue; }
      if (est === 'ocupada') { omitidas.get(p.id)!.ocupada += 1; continue; }
      if (input.francoFuera?.(p.id, ds) || input.ocupadoFuera?.(p.id, ds)) continue;
      poner(p.id, ds, enTrabajo(p, ds) ? { kind: 'RET' } : { kind: 'F' });
    }
  }

  const quitar = (id: string, ds: string) => {
    const a = trabajo(id, ds);
    if (!a || a.externo) return null;
    sumar(id, ds, -a.hours);
    const p = rolDe(id);
    poner(id, ds, enTrabajo(p, ds) ? { kind: 'RET' } : { kind: 'F' });
    return a;
  };
  const restaurar = (id: string, ds: string, a: Trabajo) => {
    poner(id, ds, a);
    sumar(id, ds, a.hours);
  };
  for (let paso = 0; paso < 240; paso++) {
    let peor: { id: string; ciclo: string; exceso: number } | null = null;
    for (const p of roles) {
      for (const [ciclo, h] of horas.get(p.id) || []) {
        if (h > TOPE_CICLO + 0.05 && (!peor || h - TOPE_CICLO > peor.exceso)) peor = { id: p.id, ciclo, exceso: h - TOPE_CICLO };
      }
    }
    if (!peor) break;
    const candidatos = [...(estado.get(peor.id)?.entries() || [])]
      .filter(([ds, a]) => ds >= primero && a.kind === 'W' && !a.externo && claveCiclo(ds) === peor!.ciclo)
      .sort((x, y) => Number((y[1] as Trabajo).finde) - Number((x[1] as Trabajo).finde) || y[0].localeCompare(x[0]));
    let movio = false;
    for (const [ds, raw] of candidatos) {
      const a = raw as Trabajo;
      quitar(peor.id, ds);
      const slot: Slot = {
        pos: a.pos, code: a.code, name: a.name, startTime: a.startTime, endTime: a.endTime,
        hours: a.hours, banda: a.banda, finde: a.finde, lv: a.lv,
      };
      const receptores = roles
        .filter((p) => p.id !== peor!.id && libre(p, ds) && puede(p.id, ds, slot))
        .filter((p) => slot.finde || p.rol === 'volante' || p.rol === 'ayuda' || p.banda === slot.banda)
        .sort(porHoras(ds));
      if (receptores[0]) {
        asignar(receptores[0], ds, slot);
        movio = true;
        break;
      }
      restaurar(peor.id, ds, a);
    }
    if (!movio) break;
  }

  const salida: ResultadoGuardia[] = input.guardias.map((g) => {
    const p = rolDe(g.id);
    const propuestas: CeldaPropuesta[] = [];
    let horasMes = 0;
    for (const ds of dias) {
      const a = leer(g.id, ds);
      if (!a || (a.kind === 'W' && a.externo)) continue;
      if (a.kind === 'F') {
        propuestas.push({
          employeeId: g.id, dateStr: ds, code: 'F', name: 'Franco', positionName: 'General',
          startTime: '00:00', endTime: '00:00', hours: 0, isFranco: true,
        });
      } else if (a.kind === 'RET') {
        propuestas.push({
          employeeId: g.id, dateStr: ds, code: 'RET', name: 'Retén', positionName: 'Retén',
          startTime: '00:00', endTime: '00:00', hours: 0, isFranco: false,
        });
      } else {
        propuestas.push({
          employeeId: g.id, dateStr: ds, code: a.code, name: a.name, positionName: a.pos,
          startTime: a.startTime, endTime: a.endTime, hours: a.hours, isFranco: false,
        });
        horasMes += a.hours;
      }
    }
    const etiqueta = p.rol === 'fijo' ? `${p.banda} fijo` : p.rol === 'volante' ? 'volante' : 'ayuda';
    return {
      employeeId: g.id,
      nombre: g.nombre,
      ciclo: propuestas.some((c) => !c.isFranco && c.code !== 'RET') ? {
        periodo: p.period,
        fases: [],
        consistencia: 1,
        muestras: 0,
        ultimoDia: '',
        etiqueta,
      } : null,
      origenCiclo: p.rol === 'fijo' ? 'fijo' : 'armado',
      estimado: false,
      notaEstimado: p.rol === 'volante' ? 'volante: cubre francos de la banda' : null,
      continuaEn: etiqueta,
      motivoSinCiclo: propuestas.length ? null : 'Sin días para proponer',
      propuestas,
      omitidas: omitidas.get(g.id) || { licencia: 0, ocupada: 0, bloqueada: 0, sinDato: 0, excluida: 0 },
      revisar: [],
      horasPropuestas: Math.round(horasMes * 100) / 100,
      plantilla: null,
      sugerencias: [],
    };
  });
  sinTresFrancosSeguidos(salida);
  for (const r of salida) r.horasPropuestas = Math.round(r.propuestas.reduce((a, c) => a + (c.isFranco || c.code === 'RET' ? 0 : c.hours), 0) * 100) / 100;
  return salida;
}
