/**
 * S2 — Calcular masa crítica de empleados por banda.
 *
 * Dado el ciclo CCT 6+2 (o 4+2 para 12h), calcula cuántos empleados
 * son necesarios para garantizar cobertura continua sin huecos.
 *
 * Fórmula: ceil(cantSimultaneos × cicloDias / diasTrabajo)
 *   → Ciclo 8h (6+2): ceil(n × 8/6) ≈ ceil(n × 1.333)
 *   → Ciclo 12h (4+2): ceil(n × 6/4) = ceil(n × 1.5)
 */

import {
  CoverageNeed,
  MasaCritica,
  CICLO_ESTANDAR,
  CICLO_12H,
} from '../types';

type Ciclo = { diasTrabajo: number; cicloDias: number };

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * Calcula la masa crítica para cada banda presente en los CoverageNeed.
 *
 * @param needs        Necesidades de cobertura del SLA (salida de s1)
 * @param empleadosPorBanda  Mapa banda → cantidad actual (para calcular déficit)
 */
export function calcularMasaCritica(
  needs: CoverageNeed[],
  empleadosPorBanda: Record<string, number> = {},
): MasaCritica[] {
  const porBanda = new Map<string, { cantSimultaneos: number; ciclo: Ciclo }>();

  for (const need of needs) {
    if (!porBanda.has(need.banda)) {
      porBanda.set(need.banda, {
        cantSimultaneos: need.cantSimultaneos,
        ciclo: need.esBanda12h ? CICLO_12H : CICLO_ESTANDAR,
      });
    } else {
      // Si la banda aparece en múltiples puestos, tomar el máximo simultáneo
      const prev = porBanda.get(need.banda)!;
      if (need.cantSimultaneos > prev.cantSimultaneos) {
        porBanda.set(need.banda, { ...prev, cantSimultaneos: need.cantSimultaneos });
      }
    }
  }

  return Array.from(porBanda.entries()).map(([banda, { cantSimultaneos, ciclo }]) => {
    const empleadosMinimos = calcularMinimoPorCiclo(cantSimultaneos, ciclo);
    const empleadosActuales = empleadosPorBanda[banda];
    const tieneActuales = empleadosActuales !== undefined;
    const enDeficit = tieneActuales && empleadosActuales < empleadosMinimos;

    return {
      banda,
      cantSimultaneos,
      empleadosMinimos,
      ciclo,
      empleadosActuales: tieneActuales ? empleadosActuales : undefined,
      enDeficit,
      faltante: enDeficit ? empleadosMinimos - empleadosActuales : undefined,
    };
  });
}

// ─── Función de bajo nivel ────────────────────────────────────────────────────

/** Masa crítica para una sola banda con ciclo explícito. */
export function calcularMinimoPorCiclo(cantSimultaneos: number, ciclo: Ciclo): number {
  return Math.ceil(cantSimultaneos * ciclo.cicloDias / ciclo.diasTrabajo);
}

/** Versión simplificada: ciclo inferido desde horas de la banda. */
export function calcularMinimoParaBanda(cantSimultaneos: number, esBanda12h: boolean): number {
  const ciclo = esBanda12h ? CICLO_12H : CICLO_ESTANDAR;
  return calcularMinimoPorCiclo(cantSimultaneos, ciclo);
}

// ─── Utilidades exportadas ────────────────────────────────────────────────────

/** Agrega una alerta por cada banda en déficit. */
export function generarAlertasDeficit(masas: MasaCritica[]): string[] {
  return masas
    .filter(m => m.enDeficit)
    .map(m =>
      `Banda ${m.banda}: necesita ${m.empleadosMinimos} empleados, ` +
      `tiene ${m.empleadosActuales ?? 0} → faltan ${m.faltante}.`,
    );
}

/** True si al menos una banda está en déficit. */
export function hayDeficit(masas: MasaCritica[]): boolean {
  return masas.some(m => m.enDeficit);
}
