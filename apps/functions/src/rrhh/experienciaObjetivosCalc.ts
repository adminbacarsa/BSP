/**
 * Experiencia del guardia por objetivo (legajo → pestaña Experiencia), calculada desde el historial de turnos.
 * Lógica pura (sin Firestore): la usa el job programado `scheduledExperienciaObjetivos`.
 *
 * Espejo de `scripts/backfill-experiencia-objetivos.mjs` y de las reglas de
 * `apps/web2/src/lib/planificacion/experienciaObjetivos.ts` (3 turnos para pasar a «Conocido»):
 * si cambia una, cambian las tres.
 */

export const ESCUELA_TURNOS_PARA_CONOCIDO = 3;

export type ExperienciaNivel = 'NINGUNO' | 'ESCUELA' | 'CONOCIDO' | 'TITULAR';

export interface ExperienciaEntry {
  nivel?: ExperienciaNivel;
  turnosEscuela?: number;
  turnosRegulares?: number;
  turnosRefuerzo?: number;
  turnosConvocado?: number;
  posicionesConocidas?: string[];
  /** Milisegundos epoch de la última presencia; el job lo convierte a Timestamp al escribir. */
  ultimaPresenciaMs?: number;
  [otro: string]: unknown;
}

export type ExperienciaMap = Record<string, ExperienciaEntry>;

/** Campos del turno que hacen falta (se piden con select() para no leer documentos enteros). */
export interface TurnoExperiencia {
  employeeId?: unknown;
  objectiveId?: unknown;
  code?: unknown;
  status?: unknown;
  origin?: unknown;
  draft?: unknown;
  isDeleted?: unknown;
  coverageSuperseded?: unknown;
  isAbsent?: unknown;
  deploymentRole?: unknown;
  positionName?: unknown;
  startMs: number | null;
}

const CODIGOS_SIN_TRABAJO = new Set(['F', 'FF', 'FP', 'V', 'L', 'E', 'A', 'AA', 'PG', 'ART', 'LT', 'SUS']);
const ESTADOS_NO_TRABAJADOS = new Set([
  'ABSENT',
  'SUPERSEDED',
  'CANCELLED',
  'CANCELED',
  'SIN_COBERTURA',
  'UNCOVERED_REPORTED',
  'REPORTED_TO_PLANNING',
  'REJECTED',
]);
const ORIGENES_CONVOCADO = new Set(['OPERATIONS_COVERAGE', 'RET_COBERTURA', 'RETEN']);
const POSICIONES_IGNORADAS = new Set(['General', 'Retén', '']);

const up = (s: unknown): string => String(s ?? '').trim().toUpperCase();

type CampoContador = 'turnosEscuela' | 'turnosRegulares' | 'turnosRefuerzo' | 'turnosConvocado';
const CAMPOS: CampoContador[] = ['turnosEscuela', 'turnosRegulares', 'turnosRefuerzo', 'turnosConvocado'];

export interface TurnoClasificado {
  empleadoId: string;
  objetivoId: string;
  inicioMs: number;
  campo: CampoContador;
  puesto: string;
}

/** null si el turno no cuenta como trabajado; si cuenta, qué contador suma. */
export function clasificarTurnoExperiencia(t: TurnoExperiencia, ahoraMs: number): TurnoClasificado | null {
  if (t.draft === true || t.isDeleted === true || t.coverageSuperseded === true) return null;
  if (t.isAbsent === true) return null;
  if (ESTADOS_NO_TRABAJADOS.has(up(t.status))) return null;
  const empleadoId = String(t.employeeId ?? '').trim();
  const objetivoId = String(t.objectiveId ?? '').trim();
  if (!empleadoId || empleadoId === 'VACANTE' || !objetivoId) return null;
  if (t.startMs == null || !Number.isFinite(t.startMs) || t.startMs >= ahoraMs) return null;
  const code = up(t.code);
  if (CODIGOS_SIN_TRABAJO.has(code)) return null;
  const role = up(t.deploymentRole);
  const origen = up(t.origin);
  let campo: CampoContador;
  if (code === 'ESC' || role === 'TRAINING') campo = 'turnosEscuela';
  else if (code === 'REF' || role === 'SURPLUS') campo = 'turnosRefuerzo';
  else if (ORIGENES_CONVOCADO.has(origen) || code === 'FT') campo = 'turnosConvocado';
  else if (code === 'RET') return null;
  else campo = 'turnosRegulares';
  return {
    empleadoId,
    objetivoId,
    inicioMs: t.startMs,
    campo,
    puesto: String(t.positionName ?? '').trim(),
  };
}

export function nivelExperiencia(entry: ExperienciaEntry, esTitular: boolean): ExperienciaNivel {
  if (esTitular) return 'TITULAR';
  const esc = entry.turnosEscuela ?? 0;
  if (esc >= ESCUELA_TURNOS_PARA_CONOCIDO) return 'CONOCIDO';
  if (esc > 0) return 'ESCUELA';
  const total = (entry.turnosRegulares ?? 0) + (entry.turnosRefuerzo ?? 0) + (entry.turnosConvocado ?? 0);
  if (total >= ESCUELA_TURNOS_PARA_CONOCIDO) return 'CONOCIDO';
  return 'NINGUNO';
}

interface Acumulado {
  turnosEscuela: number;
  turnosRegulares: number;
  turnosRefuerzo: number;
  turnosConvocado: number;
  puestos: Set<string>;
  ultimaMs: number;
}

/** Suma por guardia y objetivo los turnos que cuentan como trabajados. */
export function acumularExperiencia(
  turnos: TurnoExperiencia[],
  ahoraMs: number,
  empleadosValidos?: Set<string>,
): Map<string, Map<string, Acumulado>> {
  const calculado = new Map<string, Map<string, Acumulado>>();
  for (const t of turnos) {
    const c = clasificarTurnoExperiencia(t, ahoraMs);
    if (!c) continue;
    if (empleadosValidos && !empleadosValidos.has(c.empleadoId)) continue;
    let porObjetivo = calculado.get(c.empleadoId);
    if (!porObjetivo) {
      porObjetivo = new Map();
      calculado.set(c.empleadoId, porObjetivo);
    }
    const acc: Acumulado = porObjetivo.get(c.objetivoId) ?? {
      turnosEscuela: 0,
      turnosRegulares: 0,
      turnosRefuerzo: 0,
      turnosConvocado: 0,
      puestos: new Set<string>(),
      ultimaMs: 0,
    };
    acc[c.campo] += 1;
    if (c.puesto && !POSICIONES_IGNORADAS.has(c.puesto)) acc.puestos.add(c.puesto);
    if (c.inicioMs > acc.ultimaMs) acc.ultimaMs = c.inicioMs;
    porObjetivo.set(c.objetivoId, acc);
  }
  return calculado;
}

export interface LegajoExperiencia {
  preferredObjectiveId?: string | null;
  experienciaObjetivos?: Record<string, ExperienciaEntry> | null;
  /** Última presencia ya guardada por objetivo (ms), porque en el legajo es un Timestamp. */
  ultimaPresenciaPrevia?: Record<string, number>;
}

/**
 * Mezcla lo calculado con lo que ya tiene el legajo. Nunca baja un contador (usa el máximo) para no
 * perder lo que Planificación sumó al guardar ESC/REF. Devuelve null si no hay nada que cambiar.
 */
export function mezclarExperiencia(
  legajo: LegajoExperiencia,
  porObjetivo: Map<string, Acumulado>,
): { experiencia: ExperienciaMap; ultimaPresenciaMs: Record<string, number> } | null {
  const actual: ExperienciaMap = { ...((legajo.experienciaObjetivos as ExperienciaMap | null) ?? {}) };
  const ultimas: Record<string, number> = {};
  let toco = false;
  for (const [objetivoId, acc] of porObjetivo) {
    const previa = actual[objetivoId] ?? {};
    const entry: ExperienciaEntry = { ...previa };
    for (const campo of CAMPOS) {
      const antes = Number(previa[campo]) || 0;
      const nuevo = Math.max(antes, acc[campo]);
      if (nuevo !== antes) toco = true;
      if (nuevo > 0 || previa[campo] !== undefined) entry[campo] = nuevo;
    }
    const puestosPrevios = previa.posicionesConocidas ?? [];
    const puestos = new Set<string>([...puestosPrevios, ...acc.puestos]);
    if (puestos.size !== puestosPrevios.length) toco = true;
    if (puestos.size > 0) entry.posicionesConocidas = [...puestos];
    const previaMs = legajo.ultimaPresenciaPrevia?.[objetivoId] ?? 0;
    if (acc.ultimaMs > previaMs) {
      ultimas[objetivoId] = acc.ultimaMs;
      toco = true;
    }
    entry.nivel = nivelExperiencia(entry, String(legajo.preferredObjectiveId ?? '') === objetivoId);
    if (previa.nivel !== entry.nivel) toco = true;
    actual[objetivoId] = entry;
  }
  return toco ? { experiencia: actual, ultimaPresenciaMs: ultimas } : null;
}
