"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadAfipConfigForEmpresa = void 0;
exports.getAfipEnvConfig = getAfipEnvConfig;
exports.isAfipConfigured = isAfipConfigured;
function readPem(name) {
    const raw = process.env[name] || '';
    return raw.replace(/\\n/g, '\n').trim();
}
function getAfipEnvConfig() {
    const cuitRaw = String(process.env.AFIP_CUIT || '').replace(/\D/g, '');
    const cert = readPem('AFIP_CERT');
    const privateKey = readPem('AFIP_PRIVATE_KEY');
    if (!cuitRaw || cuitRaw.length !== 11 || !cert || !privateKey)
        return null;
    return {
        cuit: Number(cuitRaw),
        cert,
        privateKey,
        production: String(process.env.AFIP_PRODUCTION || '').toLowerCase() === 'true',
    };
}
function isAfipConfigured() {
    return getAfipEnvConfig() !== null;
}
var empresaAfipStore_1 = require("./empresaAfipStore");
Object.defineProperty(exports, "loadAfipConfigForEmpresa", { enumerable: true, get: function () { return empresaAfipStore_1.loadAfipConfigForEmpresa; } });
//# sourceMappingURL=afipConfig.js.map