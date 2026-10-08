/**
 * Selección de la grilla cuando hay celdas de licencia.
 * Un solo predicado: V, L, E, A, PG, ART, SGS, SUS, AA, LT, ausencia con aviso
 * y cualquier código extra del catálogo tipos_novedad. Franco y turno de trabajo no.
 */

const LICENCIA = new Set(['V', 'L', 'E', 'A', 'PG', 'ART', 'SGS', 'SUS', 'AA', 'LT']);
const NO_ES = new Set(['M', 'T', 'N', 'D12', 'N12', 'F', 'FF', 'FP', 'FT', 'RET', 'ESC', 'REF']);

function up(v: unknown): string {
  return String(v || '').trim().toUpperCase();
}

export function esCeldaLicencia(input: {
  code?: unknown;
  tieneAusencia?: boolean;
  codigosCatalogo?: Iterable<string> | null;
}): boolean {
  if (input.tieneAusencia) return true;
  const c = up(input.code);
  if (!c || NO_ES.has(c)) return false;
  if (LICENCIA.has(c)) return true;
  if (!input.codigosCatalogo) return false;
  for (const x of input.codigosCatalogo) {
    if (up(x) === c && !NO_ES.has(c)) return true;
  }
  return false;
}

export type CeldaSeleccion = {
  empId: string;
  dateStr: string;
  code?: string | null;
  tieneAusencia?: boolean;
};

export type SeleccionLicencia = {
  licencias: CeldaSeleccion[];
  normales: CeldaSeleccion[];
  dias: string[];
  soloLicencias: boolean;
  mezcla: boolean;
  mismoTitular: boolean;
  titularId: string | null;
  textoCubrir: string;
  salteadas: number;
  motivoTurno: string;
};

function fechaCorta(iso: string): string {
  const p = String(iso || '').split('-');
  if (p.length < 3) return iso;
  return `${p[2]}/${p[1]}`;
}

export function textoCubrirDias(dias: readonly string[]): string {
  if (!dias.length) return '';
  if (dias.length === 1) return `Cubrir 1 día (${fechaCorta(dias[0])})`;
  return `Cubrir ${dias.length} días (${fechaCorta(dias[0])} → ${fechaCorta(dias[dias.length - 1])})`;
}

export function clasificarSeleccionLicencia(
  celdas: readonly CeldaSeleccion[],
  codigosCatalogo?: Iterable<string> | null,
): SeleccionLicencia {
  const licencias: CeldaSeleccion[] = [];
  const normales: CeldaSeleccion[] = [];
  for (const c of celdas) {
    if (esCeldaLicencia({ code: c.code, tieneAusencia: c.tieneAusencia, codigosCatalogo })) licencias.push(c);
    else normales.push(c);
  }
  const dias = [...new Set(licencias.map((c) => c.dateStr))].sort();
  const titulares = [...new Set(licencias.map((c) => c.empId))];
  const codigo = up(licencias[0]?.code) || 'licencia';
  return {
    licencias,
    normales,
    dias,
    soloLicencias: licencias.length > 0 && normales.length === 0,
    mezcla: licencias.length > 0 && normales.length > 0,
    mismoTitular: titulares.length === 1,
    titularId: titulares.length === 1 ? titulares[0] : null,
    textoCubrir: textoCubrirDias(dias),
    salteadas: licencias.length,
    motivoTurno: `Tiene ${codigo}: se cubre, no se le asigna turno`,
  };
}

export type RecorridoDias = {
  dias: string[];
  indice: number;
  hechos: string[];
};

export function iniciarRecorrido(dias: readonly string[]): RecorridoDias | null {
  const unicos = [...new Set(dias)].sort();
  if (unicos.length < 2) return null;
  return { dias: unicos, indice: 0, hechos: [] };
}

export function diaRecorrido(r: RecorridoDias): string {
  return r.dias[r.indice] || '';
}

export function siguienteRecorrido(r: RecorridoDias, hecho: boolean): RecorridoDias | null {
  const hechos = hecho ? [...r.hechos, r.dias[r.indice]].filter(Boolean) : r.hechos;
  const indice = r.indice + 1;
  if (indice >= r.dias.length) return null;
  return { dias: r.dias, indice, hechos };
}

export function diasQueQuedaron(r: RecorridoDias, cubierto: (d: string) => boolean): string[] {
  const hechos = new Set(r.hechos);
  return r.dias.filter((d) => !hechos.has(d) && !cubierto(d));
}

/** «Día 1 de 10 · 11/10 · N 23:00–07:00 · elegí quién cubre». */
export function textoFranjaRecorrido(r: RecorridoDias, banda: string, horario: string | null | undefined, verbo: string): string {
  const h = horario && horario !== '—' ? ` ${horario}` : '';
  return `Día ${r.indice + 1} de ${r.dias.length} · ${fechaCorta(diaRecorrido(r))} · ${banda}${h} · ${verbo}`;
}

export function textoRepetirQuedaron(dias: readonly string[]): string {
  if (!dias.length) return '';
  if (dias.length === 1) return `Repetir con la misma persona en el día que quedó (${fechaCorta(dias[0])})`;
  return `Repetir con la misma persona en los ${dias.length} días que quedaron (${fechaCorta(dias[0])} → ${fechaCorta(dias[dias.length - 1])})`;
}
