"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMobileAppPublicConfig = getMobileAppPublicConfig;
exports.saveMobileAppSettings = saveMobileAppSettings;
exports.readExpoAccessToken = readExpoAccessToken;
exports.patchMobileAppBuildState = patchMobileAppBuildState;
exports.patchMobileAppEnvSync = patchMobileAppEnvSync;
exports.buildEasEnvPayload = buildEasEnvPayload;
const admin = require("firebase-admin");
const CONFIG_DOC = 'mobile_app';
const SECRETS_DOC = 'mobile_app';
function db() {
    return admin.firestore();
}
async function getMobileAppPublicConfig() {
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
        lastEnvSyncAt: data.lastEnvSyncAt || null,
        lastEnvSyncBy: data.lastEnvSyncBy || null,
        lastEnvSyncSummary: data.lastEnvSyncSummary || null,
        lastBuildId: data.lastBuildId || null,
        lastBuildStatus: data.lastBuildStatus || null,
        lastBuildUrl: data.lastBuildUrl || null,
        lastBuildAt: data.lastBuildAt || null,
        lastBuildTrigger: data.lastBuildTrigger || null,
        updatedAt: data.updatedAt || null,
    };
}
async function saveMobileAppSettings(input) {
    const now = new Date().toISOString();
    await db()
        .collection('system_config')
        .doc(CONFIG_DOC)
        .set({
        expoAccountOwner: input.expoAccountOwner.trim(),
        expoProjectSlug: input.expoProjectSlug.trim() || 'cosp-guardia',
        expoProjectId: (input.expoProjectId || '79b445af-b6a7-456b-b1be-87cf25a20bd5').trim(),
        portalWebOrigin: input.portalWebOrigin.trim(),
        githubRepo: input.githubRepo.trim(),
        updatedAt: now,
        updatedBy: input.updatedBy,
    }, { merge: true });
    if (input.expoAccessToken?.trim()) {
        await db().collection('system_secrets').doc(SECRETS_DOC).set({
            expoAccessToken: input.expoAccessToken.trim(),
            updatedAt: now,
            updatedBy: input.updatedBy,
        }, { merge: true });
    }
    return getMobileAppPublicConfig();
}
async function readExpoAccessToken() {
    const snap = await db().collection('system_secrets').doc(SECRETS_DOC).get();
    return String(snap.data()?.expoAccessToken || '').trim();
}
async function patchMobileAppBuildState(input) {
    await db()
        .collection('system_config')
        .doc(CONFIG_DOC)
        .set({ ...input, updatedAt: new Date().toISOString() }, { merge: true });
}
async function patchMobileAppEnvSync(input) {
    await db().collection('system_config').doc(CONFIG_DOC).set(input, { merge: true });
}
function buildEasEnvPayload(firebase, portalOrigin) {
    const vars = [
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
        environments: ['PREVIEW', 'PRODUCTION'],
        visibility: 'PUBLIC',
        type: 'STRING',
    }));
}
//# sourceMappingURL=mobileAppStore.js.map