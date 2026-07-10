/**
 * S5 — Inferir cobertura en feriados desde el contrato SLA.
 *
 * Genera la lista de feriados nacionales argentinos del año y determina,
 * para cada uno, si el servicio opera ese día (FF) o descansa.
 *
 * Regla por defecto: si `operaFeriados` no está definido en la posición,
 * se asume que el servicio opera (la mayoría de servicios de seguridad son 24/7).
 *
 * Feriados variables (Semana Santa, Carnaval) se calculan con el
 * algoritmo de Meeus/Jones/Butcher para Pascua.
 */

import { CerebroSLA, CoberturaFeriado } from '../types';

// ─── Cálculo de Pascua (Meeus/Jones/Butcher) ─────────────────────────────────

function calcularPascua(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + n);
  return d;
}

function toDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Traslada al lunes más cercano (para feriados trasladables argentinos). */
function trasladarLunes(date: Date): Date {
  const dow = date.getDay(); // 0=Dom … 6=Sab
  if (dow === 1) return date;
  // Regla Argentina: si cae mar/mie → lunes anterior; si jue/vie/sab → lunes siguiente
  if (dow === 2 || dow === 3) return addDays(date, 1 - dow);
  return addDays(date, 8 - dow);
}

// ─── Calendario de feriados nacionales ───────────────────────────────────────

interface FeriadoBase {
  nombre: string;
  esNacional: boolean;
  esProvincial: boolean;
}

function obtenerFeriadosAnio(year: number): Map<string, FeriadoBase> {
  const pascua = calcularPascua(year);
  const mapa = new Map<string, FeriadoBase>();

  function add(date: Date, nombre: string, provincial = false): void {
    mapa.set(toDateStr(date), { nombre, esNacional: !provincial, esProvincial: provincial });
  }

  // ── Fijos nacionales ──────────────────────────────────────────────────────
  add(new Date(year, 0, 1),   'Año Nuevo');
  add(new Date(year, 2, 24),  'Día Nacional de la Memoria por la Verdad y la Justicia');
  add(new Date(year, 3, 2),   'Día del Veterano y de los Caídos en la Guerra de Malvinas');
  add(new Date(year, 4, 1),   'Día Internacional de las/los Trabajadoras/es');
  add(new Date(year, 4, 25),  'Día de la Revolución de Mayo');
  add(new Date(year, 6, 9),   'Día de la Independencia');
  add(new Date(year, 11, 8),  'Inmaculada Concepción de María');
  add(new Date(year, 11, 25), 'Navidad');

  // ── Trasladables ──────────────────────────────────────────────────────────
  // Belgrano: 20/6
  const belgrano = new Date(year, 5, 20);
  add(
    belgrano.getDay() === 1 ? belgrano : trasladarLunes(belgrano),
    'Paso a la Inmortalidad del Gral. Manuel Belgrano',
  );

  // Güemes: 17/6 (si es lunes) o trasladado
  const guemes = new Date(year, 5, 17);
  add(
    guemes.getDay() === 1 ? guemes : trasladarLunes(guemes),
    'Paso a la Inmortalidad del Gral. Martín Miguel de Güemes',
  );

  // San Martín: 17/8 (si es lunes) o trasladado
  const sanMartin = new Date(year, 7, 17);
  add(
    sanMartin.getDay() === 1 ? sanMartin : trasladarLunes(sanMartin),
    'Paso a la Inmortalidad del Gral. José de San Martín',
  );

  // Diversidad Cultural: 12/10 (si es lunes) o trasladado
  const diversidad = new Date(year, 9, 12);
  add(
    diversidad.getDay() === 1 ? diversidad : trasladarLunes(diversidad),
    'Día del Respeto a la Diversidad Cultural',
  );

  // Soberanía Nacional: 20/11 (si es lunes) o trasladado
  const soberania = new Date(year, 10, 20);
  add(
    soberania.getDay() === 1 ? soberania : trasladarLunes(soberania),
    'Día de la Soberanía Nacional',
  );

  // ── Variables (Semana Santa y Carnaval) ───────────────────────────────────
  add(addDays(pascua, -48), 'Lunes de Carnaval');
  add(addDays(pascua, -47), 'Martes de Carnaval');
  add(addDays(pascua, -2),  'Viernes Santo');

  return mapa;
}

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * @param sla   SLA del servicio (normalizado con `normalizarSlaDeFirestore`)
 * @param year  Año a evaluar (ej: 2026)
 * @returns     Lista de feriados del año con flag `requiereCobertura` y código
 */
export function inferirCoberturaFeriados(
  sla: CerebroSLA,
  year: number,
): CoberturaFeriado[] {
  // Determinar si el servicio opera en feriados.
  // Si al menos una posición tiene operaFeriados=true → opera.
  // Si ninguna tiene el campo definido → asumimos que opera (default seguridad privada).
  // Si todas tienen operaFeriados=false → no opera.
  const todasDefinidas = sla.positions.every(p => p.operaFeriados !== undefined);
  const operaFeriados = todasDefinidas
    ? sla.positions.some(p => p.operaFeriados === true)
    : true; // default: sí opera

  const excludedGlobal = new Set(sla.excludedDates ?? []);
  const feriados = obtenerFeriadosAnio(year);
  const resultado: CoberturaFeriado[] = [];

  for (const [fecha, info] of feriados.entries()) {
    const excluido = excludedGlobal.has(fecha);
    const requiereCobertura = operaFeriados && !excluido;

    resultado.push({
      fecha,
      nombreFeriado: info.nombre,
      requiereCobertura,
      tipoCodigo: requiereCobertura ? 'FF' : 'normal',
      esFeriadoNacional: info.esNacional,
      esFeriadoProvincial: info.esProvincial,
    });
  }

  return resultado.sort((a, b) => a.fecha.localeCompare(b.fecha));
}

// ─── Utilidades exportadas ────────────────────────────────────────────────────

/** Devuelve solo los feriados donde el servicio trabaja (FF). */
export function feriadosConCobertura(feriados: CoberturaFeriado[]): CoberturaFeriado[] {
  return feriados.filter(f => f.requiereCobertura);
}

/** Devuelve las fechas ISO de los feriados que requieren cobertura. */
export function fechasFeriadosConCobertura(feriados: CoberturaFeriado[]): string[] {
  return feriadosConCobertura(feriados).map(f => f.fecha);
}

/** Indica si una fecha específica es feriado que requiere cobertura FF. */
export function esFeriadoConCobertura(feriados: CoberturaFeriado[], fecha: string): boolean {
  return feriados.some(f => f.fecha === fecha && f.requiereCobertura);
}
