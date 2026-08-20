import * as functions from 'firebase-functions/v1';
import { isSuperAdminRole } from '../common/role.util';
import {
  bulkUpsertEasEnvForApp,
  dispatchGithubEasWorkflow,
  fetchEasBuildById,
  resolveEasAppId,
} from './easGraphqlClient';
import {
  buildEasEnvPayload,
  getMobileAppPublicConfig,
  patchMobileAppBuildState,
  patchMobileAppEnvSync,
  readExpoAccessToken,
  saveMobileAppSettings,
} from './mobileAppStore';

function assertSuperAdmin(context: functions.https.CallableContext): void {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Autenticación requerida.');
  }
  const role = context.auth.token?.role;
  if (!isSuperAdminRole(role)) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Solo SuperAdmin puede administrar la app móvil.',
    );
  }
}

export async function getMobileAppConfigHandler(
  _data: unknown,
  context: functions.https.CallableContext,
) {
  assertSuperAdmin(context);
  const config = await getMobileAppPublicConfig();
  return { ok: true, config };
}

export async function saveMobileAppConfigHandler(
  data: {
    expoAccountOwner?: string;
    expoProjectSlug?: string;
    expoProjectId?: string;
    portalWebOrigin?: string;
    githubRepo?: string;
    expoAccessToken?: string;
  },
  context: functions.https.CallableContext,
) {
  assertSuperAdmin(context);

  const owner = String(data?.expoAccountOwner || '').trim();
  if (!owner) {
    throw new functions.https.HttpsError('invalid-argument', 'Cuenta Expo (owner) obligatoria.');
  }

  const config = await saveMobileAppSettings({
    expoAccountOwner: owner,
    expoProjectSlug: String(data?.expoProjectSlug || 'cosp-guardia'),
    expoProjectId: String(data?.expoProjectId || '79b445af-b6a7-456b-b1be-87cf25a20bd5'),
    portalWebOrigin: String(data?.portalWebOrigin || 'https://comtroldata.web.app'),
    githubRepo: String(data?.githubRepo || 'adminbacarsa/BSP'),
    expoAccessToken: data?.expoAccessToken,
    updatedBy: context.auth!.uid,
  });

  return { ok: true, config };
}

export async function syncMobileAppEasEnvHandler(
  data: {
    firebase?: {
      apiKey?: string;
      authDomain?: string;
      projectId?: string;
      storageBucket?: string;
      messagingSenderId?: string;
      appId?: string;
    };
    portalWebOrigin?: string;
  },
  context: functions.https.CallableContext,
) {
  assertSuperAdmin(context);

  const token = await readExpoAccessToken();
  if (!token) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Guardá primero el token de acceso Expo en esta pestaña.',
    );
  }

  const cfg = await getMobileAppPublicConfig();
  const fullName = `@${cfg.expoAccountOwner}/${cfg.expoProjectSlug}`;

  try {
    const { appId } = await resolveEasAppId(token, fullName, cfg.expoProjectId);

    const payload = buildEasEnvPayload(
      {
        apiKey: String(data?.firebase?.apiKey || ''),
        authDomain: String(data?.firebase?.authDomain || ''),
        projectId: String(data?.firebase?.projectId || 'comtroldata'),
        storageBucket: String(data?.firebase?.storageBucket || ''),
        messagingSenderId: String(data?.firebase?.messagingSenderId || ''),
        appId: String(data?.firebase?.appId || ''),
      },
      String(data?.portalWebOrigin || cfg.portalWebOrigin),
    );

    const missing = payload.filter((v) => !v.value);
    if (missing.length) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        `Faltan valores Firebase: ${missing.map((m) => m.name).join(', ')}`,
      );
    }

    const result = await bulkUpsertEasEnvForApp(token, appId, payload);
    const summary = `${result.created} creadas, ${result.updated} actualizadas (${payload.length} total)`;
    const now = new Date().toISOString();

    await patchMobileAppEnvSync({
      lastEnvSyncAt: now,
      lastEnvSyncBy: context.auth!.uid,
      lastEnvSyncSummary: summary,
    });

    return { ok: true, summary, appId, fullName };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new functions.https.HttpsError('failed-precondition', msg.slice(0, 480));
  }
}

export async function triggerMobileAppPreviewBuildHandler(
  _data: unknown,
  context: functions.https.CallableContext,
) {
  assertSuperAdmin(context);

  const cfg = await getMobileAppPublicConfig();
  const githubToken = String(process.env.GITHUB_DISPATCH_TOKEN || '').trim();

  if (!githubToken) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Falta GITHUB_DISPATCH_TOKEN en Firebase Secret Manager. Creá un PAT de GitHub (actions:write) y ejecutá: firebase functions:secrets:set GITHUB_DISPATCH_TOKEN',
    );
  }

  await dispatchGithubEasWorkflow({
    githubToken,
    repo: cfg.githubRepo,
    ref: 'main',
  });

  const now = new Date().toISOString();
  await patchMobileAppBuildState({
    lastBuildStatus: 'QUEUED',
    lastBuildAt: now,
    lastBuildTrigger: 'github-actions',
    lastBuildUrl: null,
  });

  return {
    ok: true,
    message: 'Build encolado en GitHub Actions (workflow eas-mobile-preview.yml).',
  };
}

export async function refreshMobileAppBuildStatusHandler(
  _data: unknown,
  context: functions.https.CallableContext,
) {
  assertSuperAdmin(context);

  const cfg = await getMobileAppPublicConfig();
  if (!cfg.lastBuildId) {
    return { ok: true, config: cfg, message: 'Sin build registrado aún.' };
  }

  const token = await readExpoAccessToken();
  if (!token) {
    return { ok: true, config: cfg, message: 'Sin token Expo para consultar EAS.' };
  }

  const build = await fetchEasBuildById(token, cfg.lastBuildId);
  if (!build) {
    return { ok: true, config: cfg, message: 'Build no encontrado en EAS.' };
  }

  await patchMobileAppBuildState({
    lastBuildStatus: build.status,
    lastBuildUrl: build.artifacts?.buildUrl || cfg.lastBuildUrl,
  });

  const updated = await getMobileAppPublicConfig();
  return { ok: true, config: updated, build };
}
