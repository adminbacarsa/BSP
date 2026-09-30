"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.acusarReciboContrato = void 0;
exports.acusarReciboContratoHandler = acusarReciboContratoHandler;
const admin = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
const functions = require("firebase-functions/v1");
const SUPER = ['superadmin', 'super_admin', 'sp'];
function db() {
    return admin.firestore();
}
function esSuperAdmin(token) {
    const role = String(token?.role || '').toLowerCase();
    const type = String(token?.type || '').toLowerCase();
    return SUPER.includes(role) || SUPER.includes(type);
}
function clientIp(raw) {
    const fwd = String(raw?.headers?.['x-forwarded-for'] || '');
    const first = fwd.split(',')[0].trim();
    return first || String(raw?.ip || '').trim() || 'desconocida';
}
function dispositivoDe(data, raw) {
    const explicit = String(data?.dispositivo || data?.deviceId || '').trim();
    if (explicit)
        return explicit.slice(0, 300);
    return String(raw?.headers?.['user-agent'] || '').trim().slice(0, 300);
}
function hashPdf(contrato) {
    const doc = (contrato.documento || null);
    const hash = String(doc?.sha256 || doc?.hash || '').trim();
    return hash || null;
}
async function esDelEventual(uid, token, contrato) {
    const cuil = String(contrato.bolsaCuil || '').trim();
    if (cuil && String(token.bolsaCuil || '') === cuil)
        return true;
    if (cuil) {
        const bolsa = await db().collection('eventuales_bolsa').doc(cuil).get();
        if (bolsa.exists && String(bolsa.data()?.uid || '') === uid)
            return true;
    }
    const employeeId = String(contrato.employeeId || '').trim();
    if (employeeId) {
        const emp = await db().collection('empleados').doc(employeeId).get();
        if (emp.exists && String(emp.data()?.uid || '') === uid)
            return true;
    }
    return false;
}
async function acusarReciboContratoHandler(data, context) {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Tenés que iniciar sesión.');
    const contratoId = String(data?.contratoId || '').trim();
    if (!contratoId)
        throw new functions.https.HttpsError('invalid-argument', 'contratoId requerido.');
    const ref = db().collection('contratos_eventuales').doc(contratoId);
    const snap = await ref.get();
    if (!snap.exists)
        throw new functions.https.HttpsError('not-found', 'Contrato inexistente.');
    const contrato = snap.data();
    const token = (context.auth.token || {});
    if (!esSuperAdmin(token) && !(await esDelEventual(context.auth.uid, token, contrato))) {
        throw new functions.https.HttpsError('permission-denied', 'Este contrato no es tuyo.');
    }
    if (contrato.acuseReciboAt)
        return { ok: true, already: true, pdfHash: hashPdf(contrato) };
    const pdfHash = hashPdf(contrato);
    const ip = clientIp(context.rawRequest);
    const dispositivo = dispositivoDe(data, context.rawRequest);
    const estado = String(contrato.estado || '');
    const patch = {
        acuseReciboAt: firestore_1.FieldValue.serverTimestamp(),
        dispositivo,
        ip,
        acuse: {
            at: firestore_1.FieldValue.serverTimestamp(),
            uid: context.auth.uid,
            deviceId: dispositivo,
            metodo: 'SESION',
            docSha256: pdfHash,
            ip,
        },
    };
    if (pdfHash)
        patch.pdfHash = pdfHash;
    if (estado === 'BORRADOR' || estado === 'DOCUMENTADO' || !estado)
        patch.estado = 'ACUSE_RECIBIDO';
    await ref.set(patch, { merge: true });
    await db().collection('audit_logs').add({
        action: 'EVENTUAL_ACUSE_RECIBO',
        module: 'EVENTUALES',
        actorUid: context.auth.uid,
        actorName: String(token.name || token.email || context.auth.uid),
        empresaId: contrato.empresaId || null,
        bolsaCuil: contrato.bolsaCuil || null,
        contratoId,
        dispositivo,
        ip,
        pdfHash,
        details: `Acuse de recibo del contrato ${contratoId}`,
        timestamp: firestore_1.FieldValue.serverTimestamp(),
    });
    return { ok: true, pdfHash };
}
exports.acusarReciboContrato = functions.https.onCall(acusarReciboContratoHandler);
//# sourceMappingURL=acusarReciboContrato.js.map