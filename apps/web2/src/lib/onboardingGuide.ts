export type OnboardingTrack = 'OPERATIONS' | 'PLANNING';

export type OnboardingStatus =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'COMPLETED';

export type OnboardingGuideState = {
  required: boolean;
  track: OnboardingTrack;
  status: OnboardingStatus;
  progressPct: number;
  currentStepId: string | null;
  startedAt?: unknown;
  completedAt?: unknown;
  lastEventAt?: unknown;
};

export const ONBOARDING_TRACK_LABEL: Record<OnboardingTrack, string> = {
  OPERATIONS: 'Operaciones',
  PLANNING: 'Planificación',
};

export const ONBOARDING_STATUS_LABEL: Record<OnboardingStatus, string> = {
  NOT_STARTED: 'No iniciado',
  IN_PROGRESS: 'En curso',
  COMPLETED: 'Completado',
};

export function normalizeOnboardingTrack(raw: unknown): OnboardingTrack {
  return String(raw ?? '').toUpperCase() === 'PLANNING' ? 'PLANNING' : 'OPERATIONS';
}

export function normalizeOnboardingStatus(raw: unknown): OnboardingStatus {
  const value = String(raw ?? '').toUpperCase();
  if (value === 'IN_PROGRESS') return 'IN_PROGRESS';
  if (value === 'COMPLETED') return 'COMPLETED';
  return 'NOT_STARTED';
}

export function normalizeOnboardingGuideState(raw: unknown): OnboardingGuideState | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const progressRaw = Number(source.progressPct ?? 0);
  const progressPct = Number.isFinite(progressRaw) ? Math.min(100, Math.max(0, Math.round(progressRaw))) : 0;
  return {
    required: source.required === true,
    track: normalizeOnboardingTrack(source.track),
    status: normalizeOnboardingStatus(source.status),
    progressPct,
    currentStepId: typeof source.currentStepId === 'string' && source.currentStepId.trim()
      ? source.currentStepId.trim()
      : null,
    startedAt: source.startedAt,
    completedAt: source.completedAt,
    lastEventAt: source.lastEventAt,
  };
}

export function needsMandatoryOnboarding(state: OnboardingGuideState | null): boolean {
  return state?.required === true && state.status !== 'COMPLETED';
}
