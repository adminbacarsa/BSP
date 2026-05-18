/** Contexto de despliegue visible en UI y enviado al asistente (lab vs producción). */
export type ClientDeployEnvironment = 'emulator' | 'production';

export type ClientDeployContext = {
  environment: ClientDeployEnvironment;
  /** Etiqueta corta para badges: "Lab local" | "Producción" */
  environmentLabel: string;
  /** Línea legible: COSP V 1.0 · fbce544 · Lab local */
  versionLabel: string;
  buildHash: string;
  buildTime: string;
  appName: string;
  appVersion: string;
  firebaseProjectId: string;
};

export function getClientDeployContext(): ClientDeployContext {
  const useEmulator = process.env.NEXT_PUBLIC_USE_EMULATOR === 'true';
  const environment: ClientDeployEnvironment = useEmulator ? 'emulator' : 'production';
  const environmentLabel = useEmulator ? 'Lab local (emuladores)' : 'Producción';
  const buildHash = process.env.NEXT_PUBLIC_BUILD_HASH?.trim() || 'dev';
  const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME?.trim() || '';
  const appName = process.env.NEXT_PUBLIC_APP_NAME?.trim() || 'COSP';
  const appVersion = process.env.NEXT_PUBLIC_APP_VERSION?.trim() || '';
  const firebaseProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() || '';
  const versionCore = appVersion ? `${appName} v${appVersion}` : appName;
  const versionLabel = [versionCore, buildHash !== 'dev' ? buildHash : null, environmentLabel]
    .filter(Boolean)
    .join(' · ');

  return {
    environment,
    environmentLabel,
    versionLabel,
    buildHash,
    buildTime,
    appName,
    appVersion,
    firebaseProjectId,
  };
}

/** Payload compacto para la callable del asistente. */
export function clientDeployForAssistant(ctx: ClientDeployContext) {
  return {
    environment: ctx.environment,
    versionLabel: ctx.versionLabel,
    buildHash: ctx.buildHash,
    buildTime: ctx.buildTime || undefined,
    firebaseProjectId: ctx.firebaseProjectId || undefined,
  };
}
