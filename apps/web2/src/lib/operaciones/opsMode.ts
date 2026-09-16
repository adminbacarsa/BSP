/**
 * Modos del Centro de Control (mutuamente excluyentes a nivel EMPRESA / sala):
 * - DEMO:   mismo pipeline que Auto + generador de eventos (presente/ausente/tarde).
 * - AUTO:   pipeline sin simulador — realidad. Vale para TODOS si no hay Manual en sala.
 * - MANUAL: hay ≥1 sesión activa en el CC. A mando = primero / transferido; resto = apoyo.
 */

export type OpsMode = 'DEMO' | 'AUTO' | 'MANUAL';

export type OpsSessionRole = 'PILOTO' | 'COPILOTO';

export interface ResolveOpsModeInput {
  modoDemoEnabled?: boolean | null;
  /** Hay al menos una sesión Manual ACTIVA en la empresa (sala). */
  hasRoomManual: boolean;
  sessionLoading?: boolean;
}

export interface OpsModeCapabilities {
  mode: OpsMode;
  isDemo: boolean;
  isAuto: boolean;
  isManual: boolean;
  /**
   * Pipeline rutinario (cierres, retención T+0, autorelevo).
   * Demo / Auto / Manual asistido del operador a mando (apoyo no corre pipeline solo).
   */
  pipelineRoutine: boolean;
  /**
   * Automatismos de decisión (novedades LLEGADA_TARDE/FCM, cobertura auto-abierta).
   * Solo Demo y Auto — nunca Manual.
   */
  fullAuto: boolean;
  labels: { demo: string; auto: string; manual: string };
}

const ASSIST_STORAGE_KEY = 'cosp_ops_manual_assist';

export function resolveOpsMode(input: ResolveOpsModeInput): OpsMode {
  if (input.modoDemoEnabled === true) return 'DEMO';
  if (input.sessionLoading) {
    return input.hasRoomManual ? 'MANUAL' : 'AUTO';
  }
  if (input.hasRoomManual) return 'MANUAL';
  return 'AUTO';
}

export function getOpsCapabilities(
  mode: OpsMode,
  manualAssist: boolean,
  opts?: { isPilot?: boolean; inRoom?: boolean },
): OpsModeCapabilities {
  const isDemo = mode === 'DEMO';
  const isAuto = mode === 'AUTO';
  const isManual = mode === 'MANUAL';
  const isPilot = opts?.isPilot === true;
  const inRoom = opts?.inRoom === true;
  const assist = isManual && manualAssist && isPilot;

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
      manual: isManual
        ? (inRoom
          ? (isPilot
            ? (manualAssist ? 'ON · asistido' : 'ON · a mando')
            : 'ON · apoyo')
          : 'ON · CC activo')
        : 'OFF',
    },
  };
}

/** Sesión más antigua = piloto canónico (desempate por id). */
export function pickCanonicalPilotSession<T extends { id: string; startTime: Date; role?: OpsSessionRole | null }>(
  sessions: T[],
): T | null {
  if (!sessions.length) return null;
  const sorted = [...sessions].sort((a, b) => {
    const dt = a.startTime.getTime() - b.startTime.getTime();
    if (dt !== 0) return dt;
    return String(a.id).localeCompare(String(b.id));
  });
  return sorted[0] ?? null;
}

export function readManualAssistPreference(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = localStorage.getItem(ASSIST_STORAGE_KEY);
    if (raw === null) return true;
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
