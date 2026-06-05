"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseCertNotAfter = parseCertNotAfter;
exports.saveEmpresaAfipCredentials = saveEmpresaAfipCredentials;
exports.getEmpresaAfipStatus = getEmpresaAfipStatus;
exports.loadAfipConfigForEmpresa = loadAfipConfigForEmpresa;
exports.loadEmpresaAfipTaCache = loadEmpresaAfipTaCache;
exports.saveEmpresaAfipTaCache = saveEmpresaAfipTaCache;
const admin = require("firebase-admin");
const crypto_1 = require("crypto");
const afipConfig_1 = require("./afipConfig");
const COL = 'empresa_afip_credentials';
function db() {
    return admin.firestore();
}
function normalizeEmpresaId(empresaId) {
    return String(empresaId ?? '').trim().toLowerCase();
}
function readPem(raw) {
    return String(raw ?? '').replace(/\\n/g, '\n').trim();
}
function parseCertNotAfter(certPem) {
    try {
        const x = new crypto_1.X509Certificate(readPem(certPem));
        return x.validTo;
    }
    catch {
        return undefined;
    }
}
async function saveEmpresaAfipCredentials(input) {
    const empresaId = normalizeEmpresaId(input.empresaId);
    const certCuit = String(input.certCuit ?? '').replace(/\D/g, '');
    const cert = readPem(input.cert);
    const privateKey = readPem(input.privateKey);
    if (!empresaId)
        throw new Error('empresaId requerido.');
    if (certCuit.length !== 11)
        throw new Error('CUIT del certificado inválido (11 dígitos).');
    if (!cert.includes('BEGIN CERTIFICATE') || !privateKey.includes('BEGIN')) {
        throw new Error('Certificado o clave privada con formato PEM inválido.');
    }
    const certNotAfter = parseCertNotAfter(cert);
    const doc = {
        certCuit,
        cert,
        privateKey,
        production: !!input.production,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        certNotAfter,
    };
    await db().collection(COL).doc(empresaId).set(doc, { merge: false });
    await db().collection(COL).doc(empresaId).update({
        taToken: admin.firestore.FieldValue.delete(),
        taSign: admin.firestore.FieldValue.delete(),
        taExpirationMs: admin.firestore.FieldValue.delete(),
    });
    await db().collection('empresas').doc(empresaId).set({
        afipConfigured: true,
        afipCertCuit: certCuit,
        afipProduction: !!input.production,
        afipCertNotAfter: certNotAfter || null,
        afipUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return { certNotAfter };
}
async function getEmpresaAfipStatus(empresaId) {
    const id = normalizeEmpresaId(empresaId);
    if (!id)
        return { configured: false };
    const snap = await db().collection(COL).doc(id).get();
    if (!snap.exists)
        return { configured: false };
    const d = snap.data();
    return {
        configured: true,
        certCuit: d.certCuit,
        production: d.production,
        certNotAfter: d.certNotAfter,
    };
}
async function loadAfipConfigForEmpresa(empresaId) {
    const id = normalizeEmpresaId(empresaId);
    if (id) {
        const snap = await db().collection(COL).doc(id).get();
        if (snap.exists) {
            const d = snap.data();
            const cert = readPem(d.cert);
            const privateKey = readPem(d.privateKey);
            const cuitRaw = String(d.certCuit ?? '').replace(/\D/g, '');
            if (cuitRaw.length === 11 && cert && privateKey) {
                return {
                    cuit: Number(cuitRaw),
                    cert,
                    privateKey,
                    production: !!d.production,
                };
            }
        }
    }
    return (0, afipConfig_1.getAfipEnvConfig)();
}
async function loadEmpresaAfipTaCache(empresaId) {
    const id = normalizeEmpresaId(empresaId);
    if (!id)
        return null;
    const snap = await db().collection(COL).doc(id).get();
    if (!snap.exists)
        return null;
    const d = snap.data();
    if (!d.taToken || !d.taSign || !d.taExpirationMs)
        return null;
    if (d.taExpirationMs <= Date.now() + 60_000)
        return null;
    return {
        token: d.taToken,
        sign: d.taSign,
        expirationTime: new Date(d.taExpirationMs),
    };
}
async function saveEmpresaAfipTaCache(empresaId, ta) {
    const id = normalizeEmpresaId(empresaId);
    if (!id)
        return;
    await db().collection(COL).doc(id).set({
        taToken: ta.token,
        taSign: ta.sign,
        taExpirationMs: ta.expirationTime.getTime(),
    }, { merge: true });
}
//# sourceMappingURL=empresaAfipStore.js.map