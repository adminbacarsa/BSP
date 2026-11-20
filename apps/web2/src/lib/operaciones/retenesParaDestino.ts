/**
 * Evaluación de retenes para un destino (hueco u objetivo): distancia al objetivo, si conoce el
 * objetivo (titular / conocido / escuela) y orden sugerido. Lógica pura, sin Firestore.
 */

import {
  COVERAGE_RADIUS_EXTENDED_KM,
  COVERAGE_RADIUS_PRIMARY_KM,
  coverageGeoForEmployee,
  type CoverageGeoFields,
} from './coverageGeo';
import {
  computeExperienciaNivel,
  experienciaNivelLabel,
  type ExperienciaNivel,
  type ExperienciaObjetivosMap,
} from '../planificacion/experienciaObjetivos';

/** Datos del legajo que hacen falta para evaluar un retén. */
export interface EmpleadoRetenInfo {
  lat?: number | null;
  lng?: number | null;
  preferredObjectiveId?: string | null;
  experienciaObjetivos?: ExperienciaObjetivosMap;
}

/** Objetivo (y puesto) donde se piensa usar al retén. */
export interface DestinoRetenEval {
  objectiveId: string;
  lat?: number | null;
  lng?: number | null;
  positionName?: string;
}

export type OrdenRetenes = 'cercania' | 'conocimiento';

export interface RetenEvaluado extends CoverageGeoFields {
  employeeId: string;
  nivel: ExperienciaNivel;
  nivelLabel: string;
  esTitular: boolean;
  /** Turnos trabajados en el objetivo destino (regulares + refuerzo + escuela + convocado). */
  turnosEnObjetivo: number;
  /** El legajo registra el puesto exacto entre los que conoce de ese objetivo. */
  conocePuesto: boolean;
  /** Última presencia en el objetivo (ms epoch), si el legajo la tiene. */
  ultimaPresenciaMs: number | null;
  /** Dentro del radio primario (15 km); sin distancia no se descarta. */
  dentroRadio: boolean;
  /** Dentro del radio extendido (30 km); sin distancia no se descarta. */
  dentroRadioExtendido: boolean;
}

const NIVEL_ORDEN: Record<ExperienciaNivel, number> = {
  TITULAR: 3,
  CONOCIDO: 2,
  ESCUELA: 1,
  NINGUNO: 0,
};

function aMs(valor: unknown): number | null {
  if (valor == null) return null;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  if (valor instanceof Date) return valor.getTime();
  const conToMillis = valor as { toMillis?: () => number; toDate?: () => Date; seconds?: number; _seconds?: number };
  if (typeof conToMillis.toMillis === 'function') return conToMillis.toMillis();
  if (typeof conToMillis.toDate === 'function') return conToMillis.toDate().getTime();
  const seg = conToMillis.seconds ?? conToMillis._seconds;
  if (typeof seg === 'number') return seg * 1000;
  if (typeof valor === 'string') {
    const t = Date.parse(valor);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

export function evaluarRetenParaDestino(
  employeeId: string,
  info: EmpleadoRetenInfo | undefined,
  destino: DestinoRetenEval,
): RetenEvaluado {
  const geo = coverageGeoForEmployee(
    { lat: destino.lat ?? undefined, lng: destino.lng ?? undefined, objectiveId: destino.objectiveId },
    info ? { lat: info.lat ?? undefined, lng: info.lng ?? undefined } : undefined,
  );
  const entrada = info?.experienciaObjetivos?.[destino.objectiveId];
  const esTitular = !!destino.objectiveId && info?.preferredObjectiveId === destino.objectiveId;
  const nivel = computeExperienciaNivel(entrada, esTitular);
  const turnosEnObjetivo =
    (entrada?.turnosRegulares ?? 0) +
    (entrada?.turnosRefuerzo ?? 0) +
    (entrada?.turnosEscuela ?? 0) +
    (entrada?.turnosConvocado ?? 0);
  const conocePuesto =
    !!destino.positionName && !!entrada?.posicionesConocidas?.includes(destino.positionName);
  const km = geo.distanceKm;
  return {
    ...geo,
    employeeId,
    nivel,
    nivelLabel: experienciaNivelLabel(nivel),
    esTitular,
    turnosEnObjetivo,
    conocePuesto,
    ultimaPresenciaMs: aMs(entrada?.ultimaPresencia),
    dentroRadio: km == null || km <= COVERAGE_RADIUS_PRIMARY_KM,
    dentroRadioExtendido: km == null || km <= COVERAGE_RADIUS_EXTENDED_KM,
  };
}

/**
 * Orden sugerido. «cercania»: dentro del radio primero, luego distancia, luego conocimiento.
 * «conocimiento»: nivel (titular > conocido > escuela > ninguno), luego distancia.
 * Quien no tiene distancia (sin domicilio geocodificado) queda después de los que sí la tienen.
 */
export function compararRetenesEvaluados(a: RetenEvaluado, b: RetenEvaluado, orden: OrdenRetenes): number {
  const distA = a.distanceKm ?? Number.POSITIVE_INFINITY;
  const distB = b.distanceKm ?? Number.POSITIVE_INFINITY;
  const porDistancia = (): number => {
    if (distA === distB) return 0;
    return distA < distB ? -1 : 1;
  };
  const porNivel = (): number => NIVEL_ORDEN[b.nivel] - NIVEL_ORDEN[a.nivel];
  if (orden === 'conocimiento') {
    return porNivel() || porDistancia() || (b.turnosEnObjetivo - a.turnosEnObjetivo);
  }
  if (a.dentroRadio !== b.dentroRadio) return a.dentroRadio ? -1 : 1;
  return porDistancia() || porNivel() || (b.turnosEnObjetivo - a.turnosEnObjetivo);
}

export function formatearDistancia(ev: Pick<RetenEvaluado, 'distanceKm' | 'etaMinutes' | 'hasGeo' | 'geoMiss'>): string {
  if (ev.hasGeo && ev.distanceKm != null) {
    if (ev.distanceKm < 0.05) return 'En el objetivo';
    const km = ev.distanceKm < 10 ? ev.distanceKm.toFixed(1).replace('.', ',') : String(Math.round(ev.distanceKm));
    return `${km} km · ~${ev.etaMinutes ?? 0} min`;
  }
  if (ev.geoMiss === 'objetivo') return 'Objetivo sin ubicación';
  if (ev.geoMiss === 'legajo') return 'Sin domicilio geocodificado';
  return 'Sin dato de distancia';
}
