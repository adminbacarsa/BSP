/**
 * S4 — Reconocer bandas especiales D12/N12 y jornadas de 12h.
 *
 * Analiza el SLA para detectar si el servicio requiere o permite turnos
 * de 12 horas, y ajusta los parámetros de ciclo y restricciones CCT.
 *
 * Diferencias clave respecto a bandas estándar (8h):
 *   - Masa crítica: ceil(n × 6/4) en lugar de ceil(n × 8/6)
 *   - Máximo días consecutivos: 3 en lugar de 6 (CCT art. 17 adaptado)
 *   - Ciclo base: 4+2 en lugar de 6+2
 */

import { CerebroSLA, BandaEspecialInfo, CICLO_ESTANDAR, CICLO_12H } from '../types';

const BANDAS_12H_CONOCIDAS = new Set(['D12', 'N12']);

// ─── Función principal ────────────────────────────────────────────────────────

export function detectarBandasEspeciales(sla: CerebroSLA): BandaEspecialInfo {
  const bandas12h = new Set<string>();
  const notas: string[] = [];

  for (const pos of sla.positions) {
    // Detección por coverageType
    if (pos.coverageType === '12hs_diurno') bandas12h.add('D12');
    if (pos.coverageType === '12hs_nocturno') bandas12h.add('N12');

    // Detección por shifts explícitos
    for (const shift of pos.shifts) {
      if (BANDAS_12H_CONOCIDAS.has(shift.code)) {
        bandas12h.add(shift.code);
      } else if (shift.hours >= 12) {
        // Turno custom de 12h o más → registrar con su código original
        bandas12h.add(shift.code);
        notas.push(`Turno ${shift.code} (${shift.name}) tiene ${shift.hours}h — tratado como jornada 12h.`);
      }
    }
  }

  const esBanda12h = bandas12h.size > 0;

  if (esBanda12h) {
    const lista = [...bandas12h].join(', ');
    notas.unshift(`Servicio con jornadas de 12h detectadas: ${lista}`);
    notas.push('Ciclo adaptado a 4+2 (4 días trabajo + 2 francos).');
    notas.push('Máximo 3 días consecutivos de 12h antes del descanso (vs 6 en ciclo estándar).');
    notas.push('Masa crítica: ceil(n × 6/4) en lugar de ceil(n × 8/6).');
  }

  return {
    esBanda12h,
    bandas12h: [...bandas12h],
    cicloAdaptado: esBanda12h ? CICLO_12H : CICLO_ESTANDAR,
    maxDiasConsecutivos: esBanda12h ? 3 : 6,
    notas,
  };
}

// ─── Utilidades exportadas ────────────────────────────────────────────────────

/** True si el código de turno corresponde a una jornada de 12h. */
export function esBandaDe12h(code: string): boolean {
  return BANDAS_12H_CONOCIDAS.has(code);
}

/**
 * Convierte un SLA de 8h a propuesta de cobertura con 12h cuando hay déficit.
 * Devuelve las bandas 12h equivalentes a las bandas 8h actuales.
 */
export function proponer12hEquivalente(bandas8h: string[]): Record<string, string> {
  const mapa: Record<string, string> = {};
  for (const b of bandas8h) {
    if (b === 'M' || b === 'T') mapa[b] = 'D12';
    if (b === 'N') mapa[b] = 'N12';
  }
  return mapa;
}
