"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertAfipCertCurrentlyValid = assertAfipCertCurrentlyValid;
exports.formatAfipCallError = formatAfipCallError;
const crypto_1 = require("crypto");
function assertAfipCertCurrentlyValid(certPem) {
    const pem = certPem.replace(/\\n/g, '\n').trim();
    if (!pem.includes('BEGIN CERTIFICATE')) {
        throw new Error('AFIP_CERT inválido en el servidor (formato PEM).');
    }
    const x = new crypto_1.X509Certificate(pem);
    const now = Date.now();
    const from = Date.parse(x.validFrom);
    const to = Date.parse(x.validTo);
    if (Number.isFinite(from) && now < from) {
        throw new Error(`Certificado AFIP aún no vigente (válido desde ${x.validFrom}). Esperá a esa fecha o subí el certificado activo en AFIP.`);
    }
    if (Number.isFinite(to) && now > to) {
        throw new Error(`Certificado AFIP vencido (${x.validTo}). Generá uno nuevo en AFIP y ejecutá npm run afip:secrets.`);
    }
}
function formatAfipCallError(e, production) {
    const err = e;
    const status = err.response?.status;
    const msg = String(err.message || '');
    const body = typeof err.response?.data === 'string'
        ? err.response.data
        : JSON.stringify(err.response?.data ?? '');
    if (/cms\.cert\.untrusted|no válido en AFIP producción/i.test(msg)) {
        return msg;
    }
    if (status === 401 || /\b401\b/.test(msg)) {
        if (/afipsdk|access_token/i.test(msg)) {
            return ('El SDK anterior requería access_token de afipsdk.com. Ya usamos WSAA directo; ' +
                'redeploy de functions:lookupClientByCuit y probá de nuevo.');
        }
        const env = production ? 'producción' : 'homologación';
        return (`AFIP rechazó el certificado (401, entorno ${env}). Revisá: (1) certificado vigente y clave del mismo CSR, ` +
            `(2) autorización ws_sr_constancia_inscripcion, (3) AFIP_PRODUCTION=${production ? 'true' : 'false'} ` +
            'coincide con el ambiente del cert (prod ≠ homo).');
    }
    if (status === 403 || /\b403\b/.test(msg)) {
        return 'AFIP denegó el acceso (403). Falta autorizar el servicio ws_sr_constancia_inscripcion al alias del certificado.';
    }
    if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED|timeout/i.test(msg)) {
        return 'No se pudo conectar con los servidores de AFIP. Reintentá en unos minutos.';
    }
    if (body && body.length > 0 && body !== '""' && body.length < 200) {
        return `${msg} — ${body}`.trim();
    }
    return msg || 'Error al consultar AFIP.';
}
//# sourceMappingURL=afipErrors.js.map