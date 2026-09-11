/**
 * Modos del Centro de Control (mutuamente excluyentes):
 * - DEMO:   mismo pipeline que Auto + generador de eventos (presente/ausente/tarde).
 *           Escribe datos reales en la empresa de prueba para validar circuitos.
 * - AUTO:   mismo pipeline que Demo, sin simulador — realidad (prod).
 * - MANUAL: operador en guardia. Opcional "asistido": cierres/retención rutinarios;
 *           coberturas y decisiones quedan al operador.
 */

export type OpsMode = 'DEMO' | 'AUTO' | 'MANUAL';

export interface ResolveOpsModeInput {
  modoDemoEnabled?: boolean | null;
  hasManualSession: boolean;
  sessionLoading?: boolean;
}

export interface OpsModeCapabilities {
  mode: OpsMode;
  /** Demo ON */
  isDemo: boolean;
  /** Auto ON (sin Demo ni Manual) */
  isAuto: boolean;
  /** Manual ON */
  isManual: boolean;
  /**
   * Pipeline rutinario (cierres, retención T+0, autorelevo).
   * Activo en Demo, Auto y Manual asistido.
   */
  pipelineRoutine: boolean;
  /**
   * Automatismos de decisión (novedades LLEGADA_TARDE/FCM, cobertura auto-abierta).
   * Solo Demo y Auto — no Manual (ni asistido).
   */
  fullAuto: boolean;
  /** Badge labels */
  labels: { demo: string; auto: string; manual: string };
}

const ASSIST_STORAGE_KEY = 'cosp_ops_manual_assist';

export function resolveOpsMode(input: ResolveOpsModeInput): OpsMode {
  if (input.modoDemoEnabled === true) return 'DEMO';
  if (input.sessionLoading) {
    // Evitar flash AUTO mientras carga la sesión
    return input.hasManualSession ? 'MANUAL' : 'AUTO';
  }
  if (input.hasManualSession) return 'MANUAL';
  return 'AUTO';
}

export function getOpsCapabilities(
  mode: OpsMode,
  manualAssist: boolean,
): OpsModeCapabilities {
  const isDemo = mode === 'DEMO';
  const isAuto = mode === 'AUTO';
  const isManual = mode === 'MANUAL';
  const assist = isManual && manualAssist;

  return {
    mode,
    isDemo,
    isAuto,
    isManual,
    pipelineRoutine: isDemo || isAuto || assist,
    fullAuto: isDemo || isAuto,
    labels: {
      demo: isDemo ? 'ON' : 'OFF',
      auto: isAuto ? 'ON' : 'OFF',
      manual: isManual ? (assist ? 'ON · asistido' : 'ON') : 'OFF',
    },
  };
}

export function readManualAssistPreference(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = localStorage.getItem(ASSIST_STORAGE_KEY);
    if (raw === null) return true; // default: asistido ON en Manual
    return raw === '1' || raw === 'true';
  } catch {
    return true;
  }
}

export function writeManualAssistPreference(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(ASSIST_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    /* ignore */
  }
}
