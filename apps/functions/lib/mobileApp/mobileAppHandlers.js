"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMobileAppConfigHandler = getMobileAppConfigHandler;
exports.saveMobileAppConfigHandler = saveMobileAppConfigHandler;
exports.syncMobileAppEasEnvHandler = syncMobileAppEasEnvHandler;
exports.triggerMobileAppPreviewBuildHandler = triggerMobileAppPreviewBuildHandler;
exports.refreshMobileAppBuildStatusHandler = refreshMobileAppBuildStatusHandler;
const functions = require("firebase-functions/v1");
const role_util_1 = require("../common/role.util");
const easGraphqlClient_1 = require("./easGraphqlClient");
const mobileAppStore_1 = require("./mobileAppStore");
function assertSuperAdmin(context) {
    if (!context.auth?.uid) {
        throw new functions.https.HttpsError('unauthenticated', 'Autenticación requerida.');
    }
    const role = context.auth.token?.role;
    if (!(0, role_util_1.isSuperAdminRole)(role)) {
        throw new functions.https.HttpsError('permission-denied', 'Solo SuperAdmin puede administrar la app móvil.');
    }
}
async function getMobileAppConfigHandler(_data, context) {
    assertSuperAdmin(context);
    const config = await (0, mobileAppStore_1.getMobileAppPublicConfig)();
    return { ok: true, config };
}
async function saveMobileAppConfigHandler(data, context) {
    assertSuperAdmin(context);
    const owner = String(data?.expoAccountOwner || '').trim();
    if (!owner) {
        throw new functions.https.HttpsError('invalid-argument', 'Cuenta Expo (owner) obligatoria.');
    }
    const config = await (0, mobileAppStore_1.saveMobileAppSettings)({
        expoAccountOwner: owner,
        expoProjectSlug: String(data?.expoProjectSlug || 'cosp-guardia'),
        expoProjectId: String(data?.expoProjectId || '79b445af-b6a7-456b-b1be-87cf25a20bd5'),
        portalWebOrigin: String(data?.portalWebOrigin || 'https://comtroldata.web.app'),
        githubRepo: String(data?.githubRepo || 'adminbacarsa/BSP'),
        expoAccessToken: data?.expoAccessToken,
        updatedBy: context.auth.uid,
    });
    return { ok: true, config };
}
async function syncMobileAppEasEnvHandler(data, context) {
    assertSuperAdmin(context);
    const token = await (0, mobileAppStore_1.readExpoAccessToken)();
    if (!token) {
        throw new functions.https.HttpsError('failed-precondition', 'Guardá primero el token de acceso Expo en esta pestaña.');
    }
    const cfg = await (0, mobileAppStore_1.getMobileAppPublicConfig)();
    const fullName = `@${cfg.expoAccountOwner}/${cfg.expoProjectSlug}`;
    try {
        const { appId } = await (0, easGraphqlClient_1.resolveEasAppId)(token, fullName, cfg.expoProjectId);
        const payload = (0, mobileAppStore_1.buildEasEnvPayload)({
            apiKey: String(data?.firebase?.apiKey || ''),
            authDomain: String(data?.firebase?.authDomain || ''),
            projectId: String(data?.firebase?.projectId || 'comtroldata'),
            storageBucket: String(data?.firebase?.storageBucket || ''),
            messagingSenderId: String(data?.firebase?.messagingSenderId || ''),
            appId: String(data?.firebase?.appId || ''),
        }, String(data?.portalWebOrigin || cfg.portalWebOrigin));
        const missing = payload.filter((v) => !v.value);
        if (missing.length) {
            throw new functions.https.HttpsError('invalid-argument', `Faltan valores Firebase: ${missing.map((m) => m.name).join(', ')}`);
        }
        const result = await (0, easGraphqlClient_1.bulkUpsertEasEnvForApp)(token, appId, payload);
        const summary = `${result.created} creadas, ${result.updated} actualizadas (${payload.length} total)`;
        const now = new Date().toISOString();
        await (0, mobileAppStore_1.patchMobileAppEnvSync)({
            lastEnvSyncAt: now,
            lastEnvSyncBy: context.auth.uid,
            lastEnvSyncSummary: summary,
        });
        return { ok: true, summary, appId, fullName };
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new functions.https.HttpsError('failed-precondition', msg.slice(0, 480));
    }
}
async function triggerMobileAppPreviewBuildHandler(_data, context) {
    assertSuperAdmin(context);
    const cfg = await (0, mobileAppStore_1.getMobileAppPublicConfig)();
    const githubToken = String(process.env.GITHUB_DISPATCH_TOKEN || '').trim();
    if (!githubToken) {
        throw new functions.https.HttpsError('failed-precondition', 'Falta GITHUB_DISPATCH_TOKEN en Firebase Secret Manager. Creá un PAT de GitHub (actions:write) y ejecutá: firebase functions:secrets:set GITHUB_DISPATCH_TOKEN');
    }
    await (0, easGraphqlClient_1.dispatchGithubEasWorkflow)({
        githubToken,
        repo: cfg.githubRepo,
        ref: 'main',
    });
    const now = new Date().toISOString();
    await (0, mobileAppStore_1.patchMobileAppBuildState)({
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
async function refreshMobileAppBuildStatusHandler(_data, context) {
    assertSuperAdmin(context);
    const cfg = await (0, mobileAppStore_1.getMobileAppPublicConfig)();
    if (!cfg.lastBuildId) {
        return { ok: true, config: cfg, message: 'Sin build registrado aún.' };
    }
    const token = await (0, mobileAppStore_1.readExpoAccessToken)();
    if (!token) {
        return { ok: true, config: cfg, message: 'Sin token Expo para consultar EAS.' };
    }
    const build = await (0, easGraphqlClient_1.fetchEasBuildById)(token, cfg.lastBuildId);
    if (!build) {
        return { ok: true, config: cfg, message: 'Build no encontrado en EAS.' };
    }
    await (0, mobileAppStore_1.patchMobileAppBuildState)({
        lastBuildStatus: build.status,
        lastBuildUrl: build.artifacts?.buildUrl || cfg.lastBuildUrl,
    });
    const updated = await (0, mobileAppStore_1.getMobileAppPublicConfig)();
    return { ok: true, config: updated, build };
}
//# sourceMappingURL=mobileAppHandlers.js.map