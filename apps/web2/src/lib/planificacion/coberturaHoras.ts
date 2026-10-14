/**
 * Doble control de cobertura: si las franjas no cierran por código (P1M cubierto con P5M, una
 * extensión, otro horario), se valida por horas de reloj. Por puesto y minuto a minuto: lo que pide
 * el servicio (ventanas de sus franjas × pax) contra lo que aportan los turnos acreditados a ese puesto.
 * Lo que sobra en una ventana no tapa lo que falta en otra. Sin tope de 12:59: es lo planificado.
 */

export type FranjaHoras = { code?: string; startTime: string; endTime: string; qty: number };
export type PuestoHoras = { positionName: string; franjas: FranjaHoras[] };
export type TramoHoras = { positionName: string; startTime: string; endTime: string };

export type ResultadoHoras = {
  requeridas: number;
  cubiertas: number;
  faltan: number;
  cerrado: boolean;
  porPuesto: Array<{ positionName: string; requeridas: number; cubiertas: number; faltan: number; ventanas: Array<{ desde: string; hasta: string }> }>;
};

const DIA = 1440;

function aMin(hm: string): number | null {
  const m = String(hm || '').match(/(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function aHm(min: number): string {
  const v = ((min % DIA) + DIA) % DIA;
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}

/** Ventana del día en minutos (0–2880): si termina antes de empezar, cruza la medianoche. */
function ventana(inicio: string, fin: string): [number, number] | null {
  const a = aMin(inicio);
  let b = aMin(fin);
  if (a == null || b == null) return null;
  if (b <= a) b += DIA;
  return [a, b];
}

function norm(s: string): string {
  return String(s || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

const ALTERNATIVAS_12 = new Set(['D12', 'N12']);

export function coberturaPorHoras(puestos: readonly PuestoHoras[], tramos: readonly TramoHoras[]): ResultadoHoras {
  const porPuesto: ResultadoHoras['porPuesto'] = [];
  for (const p of puestos) {
    const conHorario = p.franjas.filter((f) => ventana(f.startTime, f.endTime));
    // D12/N12 son alternativas a M/T/N, no más demanda.
    const tieneOcho = conHorario.some((f) => !ALTERNATIVAS_12.has(norm(f.code || '')));
    const franjas = tieneOcho ? conHorario.filter((f) => !ALTERNATIVAS_12.has(norm(f.code || ''))) : conHorario;
    if (!franjas.length) continue;
    const demanda = new Array<number>(DIA * 2).fill(0);
    for (const f of franjas) {
      const [a, b] = ventana(f.startTime, f.endTime)!;
      for (let m = a; m < b; m++) demanda[m] += Math.max(1, Number(f.qty) || 1);
    }
    const oferta = new Array<number>(DIA * 2).fill(0);
    for (const t of tramos) {
      if (norm(t.positionName) !== norm(p.positionName)) continue;
      const v = ventana(t.startTime, t.endTime);
      if (!v) continue;
      for (let m = v[0]; m < v[1]; m++) oferta[m] += 1;
    }
    let req = 0;
    let cub = 0;
    const ventanas: Array<{ desde: string; hasta: string }> = [];
    let abierta: number | null = null;
    for (let m = 0; m < DIA * 2; m++) {
      req += demanda[m];
      cub += Math.min(demanda[m], oferta[m]);
      const falta = demanda[m] > oferta[m];
      if (falta && abierta == null) abierta = m;
      if (!falta && abierta != null) { ventanas.push({ desde: aHm(abierta), hasta: aHm(m) }); abierta = null; }
    }
    if (abierta != null) ventanas.push({ desde: aHm(abierta), hasta: aHm(DIA * 2) });
    porPuesto.push({ positionName: p.positionName, requeridas: req / 60, cubiertas: cub / 60, faltan: (req - cub) / 60, ventanas });
  }
  const requeridas = porPuesto.reduce((s, x) => s + x.requeridas, 0);
  const cubiertas = porPuesto.reduce((s, x) => s + x.cubiertas, 0);
  const faltan = Math.max(0, requeridas - cubiertas);
  return { requeridas, cubiertas, faltan, cerrado: requeridas > 0 && faltan < 1 / 60, porPuesto };
}

function h(x: number): string {
  const r = Math.round(x * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1).replace('.', ',');
}

export function textoHoras(r: ResultadoHoras): string {
  if (!r.requeridas) return '';
  if (r.cerrado) return `Horas ${h(r.cubiertas)}/${h(r.requeridas)}: cerrado por horas`;
  const faltas = r.porPuesto.filter((p) => p.faltan > 0)
    .map((p) => `${h(p.faltan)} h en ${p.positionName}${p.ventanas.length ? ` (${p.ventanas.slice(0, 2).map((v) => `${v.desde}–${v.hasta}`).join(', ')})` : ''}`);
  return `Horas ${h(r.cubiertas)}/${h(r.requeridas)} · falta ${faltas.join(' · ')}`;
}
