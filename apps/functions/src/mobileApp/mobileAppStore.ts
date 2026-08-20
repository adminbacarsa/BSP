import * as admin from 'firebase-admin';

const CONFIG_DOC = 'mobile_app';
const SECRETS_DOC = 'mobile_app';

export type MobileAppPublicConfig = {
  expoAccountOwner: string;
  expoProjectSlug: string;
  expoProjectId: string;
  portalWebOrigin: string;
  githubRepo: string;
  hasExpoToken: boolean;
  expoTokenHint: string;
  lastEnvSyncAt: string | null;
  lastEnvSyncBy: string | null;
  lastEnvSyncSummary: string | null;
  lastBuildId: string | null;
  lastBuildStatus: string | null;
  lastBuildUrl: string | null;
  lastBuildAt: string | null;
  lastBuildTrigger: string | null;
  updatedAt: string | null;
};

function db() {
  return admin.firestore();
}

export async function getMobileAppPublicConfig(): Promise<MobileAppPublicConfig> {
  const snap = await db().collection('system_config').doc(CONFIG_DOC).get();
  const data = snap.exists ? snap.data() || {} : {};
  const secretSnap = await db().collection('system_secrets').doc(SECRETS_DOC).get();
  const token = String(secretSnap.data()?.expoAccessToken || '');
  const hint = token.length >= 4 ? `…${token.slice(-4)}` : '';

  return {
    expoAccountOwner: String(data.expoAccountOwner || ''),
    expoProjectSlug: String(data.expoProjectSlug || 'cosp-guardia'),
    expoProjectId: String(data.expoProjectId || '79b445af-b6a7-456b-b1be-87cf25a20bd5'),
    portalWebOrigin: String(data.portalWebOrigin || 'https://comtroldata.web.app'),
    githubRepo: String(data.githubRepo || 'adminbacarsa/BSP'),
    hasExpoToken: token.length > 8,
    expoTokenHint: hint,
    lastEnvSyncAt: (data.lastEnvSyncAt as string) || null,
    lastEnvSyncBy: (data.lastEnvSyncBy as string) || null,
    lastEnvSyncSummary: (data.lastEnvSyncSummary as string) || null,
    lastBuildId: (data.lastBuildId as string) || null,
    lastBuildStatus: (data.lastBuildStatus as string) || null,
    lastBuildUrl: (data.lastBuildUrl as string) || null,
    lastBuildAt: (data.lastBuildAt as string) || null,
    lastBuildTrigger: (data.lastBuildTrigger as string) || null,
    updatedAt: (data.updatedAt as string) || null,
  };
}

export async function saveMobileAppSettings(input: {
  expoAccountOwner: string;
  expoProjectSlug: string;
  expoProjectId?: string;
  portalWebOrigin: string;
  githubRepo: string;
  expoAccessToken?: string;
  updatedBy: string;
}): Promise<MobileAppPublicConfig> {
  const now = new Date().toISOString();
  await db()
    .collection('system_config')
    .doc(CONFIG_DOC)
    .set(
      {
        expoAccountOwner: input.expoAccountOwner.trim(),
        expoProjectSlug: input.expoProjectSlug.trim() || 'cosp-guardia',
        expoProjectId: (input.expoProjectId || '79b445af-b6a7-456b-b1be-87cf25a20bd5').trim(),
        portalWebOrigin: input.portalWebOrigin.trim(),
        githubRepo: input.githubRepo.trim(),
        updatedAt: now,
        updatedBy: input.updatedBy,
      },
      { merge: true },
    );

  if (input.expoAccessToken?.trim()) {
    await db().collection('system_secrets').doc(SECRETS_DOC).set(
      {
        expoAccessToken: input.expoAccessToken.trim(),
        updatedAt: now,
        updatedBy: input.updatedBy,
      },
      { merge: true },
    );
  }

  return getMobileAppPublicConfig();
}

export async function readExpoAccessToken(): Promise<string> {
  const snap = await db().collection('system_secrets').doc(SECRETS_DOC).get();
  return String(snap.data()?.expoAccessToken || '').trim();
}

export async function patchMobileAppBuildState(input: {
  lastBuildId?: string | null;
  lastBuildStatus?: string | null;
  lastBuildUrl?: string | null;
  lastBuildAt?: string | null;
  lastBuildTrigger?: string | null;
}): Promise<void> {
  await db()
    .collection('system_config')
    .doc(CONFIG_DOC)
    .set({ ...input, updatedAt: new Date().toISOString() }, { merge: true });
}

export async function patchMobileAppEnvSync(input: {
  lastEnvSyncAt: string;
  lastEnvSyncBy: string;
  lastEnvSyncSummary: string;
}): Promise<void> {
  await db().collection('system_config').doc(CONFIG_DOC).set(input, { merge: true });
}

export function buildEasEnvPayload(firebase: Record<string, string>, portalOrigin: string) {
  const vars: Array<{ name: string; value: string }> = [
    { name: 'EXPO_PUBLIC_USE_EMULATOR', value: 'false' },
    { name: 'EXPO_PUBLIC_FIREBASE_API_KEY', value: firebase.apiKey || '' },
    { name: 'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN', value: firebase.authDomain || '' },
    { name: 'EXPO_PUBLIC_FIREBASE_PROJECT_ID', value: firebase.projectId || 'comtroldata' },
    { name: 'EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET', value: firebase.storageBucket || '' },
    { name: 'EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID', value: firebase.messagingSenderId || '' },
    { name: 'EXPO_PUBLIC_FIREBASE_APP_ID', value: firebase.appId || '' },
    { name: 'EXPO_PUBLIC_PORTAL_WEB_ORIGIN', value: portalOrigin },
    { name: 'EXPO_PUBLIC_MOBILE_PREVIEW_LINK_BASE', value: 'cosp-guardia://preview' },
  ];

  return vars
    .filter((v) => v.value.trim())
    .map((v) => ({
      name: v.name,
      value: v.value.trim(),
      environments: ['PREVIEW' as const, 'PRODUCTION' as const],
      visibility: 'PUBLIC' as const,
      type: 'STRING' as const,
    }));
}
