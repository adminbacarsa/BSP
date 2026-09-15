export const ONBOARDING_TRACKS = ['OPERATIONS', 'PLANNING', 'CRM', 'SERVICES', 'RRHH'] as const;

export type OnboardingTrack = (typeof ONBOARDING_TRACKS)[number];

export type OnboardingStatus =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'COMPLETED';

export type OnboardingGuideState = {
  required: boolean;
  /** Recorrido activo / primario (compatibilidad). */
  track: OnboardingTrack;
  /** Recorridos exigidos (uno o varios). */
  tracks: OnboardingTrack[];
  /** Recorridos ya completados dentro de `tracks`. */
  completedTracks: OnboardingTrack[];
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
  CRM: 'CRM',
  SERVICES: 'Servicios',
  RRHH: 'RRHH',
};

export const ONBOARDING_STATUS_LABEL: Record<OnboardingStatus, string> = {
  NOT_STARTED: 'No iniciado',
  IN_PROGRESS: 'En curso',
  COMPLETED: 'Completado',
};

const TRACK_SET = new Set<string>(ONBOARDING_TRACKS);

export function normalizeOnboardingTrack(raw: unknown): OnboardingTrack {
  const value = String(raw ?? '').trim().toUpperCase();
  if (TRACK_SET.has(value)) return value as OnboardingTrack;
  // aliases legacy / UI
  if (value === 'CLIENTS' || value === 'CLIENTES') return 'CRM';
  if (value === 'SERVICIOS' || value === 'SLA') return 'SERVICES';
  if (value === 'PERSONAL' || value === 'HR') return 'RRHH';
  if (value === 'PLANIFICACION' || value === 'PLAN') return 'PLANNING';
  if (value === 'OPERACIONES' || value === 'OPS') return 'OPERATIONS';
  return 'OPERATIONS';
}

export function normalizeOnboardingTracks(raw: unknown, fallbackTrack?: unknown): OnboardingTrack[] {
  const fromArray = Array.isArray(raw)
    ? raw.map((x) => normalizeOnboardingTrack(x))
    : [];
  const unique: OnboardingTrack[] = [];
  for (const t of fromArray) {
    if (!unique.includes(t)) unique.push(t);
  }
  if (unique.length) return unique;
  return [normalizeOnboardingTrack(fallbackTrack)];
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
  const tracks = normalizeOnboardingTracks(source.tracks, source.track);
  const completedRaw = Array.isArray(source.completedTracks) ? source.completedTracks : [];
  const completedTracks = completedRaw
    .map((x) => normalizeOnboardingTrack(x))
    .filter((t, idx, arr) => tracks.includes(t) && arr.indexOf(t) === idx);
  const track = normalizeOnboardingTrack(source.track ?? tracks[0]);
  return {
    required: source.required === true,
    track: tracks.includes(track) ? track : tracks[0],
    tracks,
    completedTracks,
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

export function onboardingTracksProgress(state: OnboardingGuideState | null): {
  total: number;
  done: number;
  pending: OnboardingTrack[];
} {
  const tracks = state?.tracks?.length ? state.tracks : state?.track ? [state.track] : [];
  const doneSet = new Set(state?.completedTracks ?? []);
  const pending = tracks.filter((t) => !doneSet.has(t));
  return { total: tracks.length, done: tracks.length - pending.length, pending };
}

export function formatOnboardingTracksLabel(tracks: OnboardingTrack[]): string {
  if (!tracks.length) return '—';
  if (tracks.length === ONBOARDING_TRACKS.length) return 'Todos';
  return tracks.map((t) => ONBOARDING_TRACK_LABEL[t]).join(' + ');
}
