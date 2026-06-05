"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lookupTaxpayerByCuit = lookupTaxpayerByCuit;
const afipConfig_1 = require("./afipConfig");
const afipErrors_1 = require("./afipErrors");
const padronConstancia_1 = require("./padronConstancia");
const normalizeCuit_1 = require("./normalizeCuit");
const mapTaxpayerToClient_1 = require("./mapTaxpayerToClient");
const wsaaDirect_1 = require("./wsaaDirect");
const WS_CONSTANCIA = 'ws_sr_constancia_inscripcion';
async function lookupTaxpayerByCuit(rawCuit, empresaId) {
    const cuit = (0, normalizeCuit_1.normalizeCuitInput)(rawCuit);
    if (!cuit) {
        throw new Error('CUIT inválido. Ingresá 11 dígitos (con o sin guiones).');
    }
    const cfg = await (0, afipConfig_1.loadAfipConfigForEmpresa)(empresaId);
    if (!cfg) {
        throw new Error('AFIP no configurado para esta empresa. Cargá certificado en Configuración → Empresas.');
    }
    (0, afipErrors_1.assertAfipCertCurrentlyValid)(cfg.cert);
    try {
        const creds = await (0, wsaaDirect_1.loginWsaaDirect)(cfg.cert, cfg.privateKey, WS_CONSTANCIA, cfg.production, empresaId);
        const padron = (await (0, padronConstancia_1.getTaxpayerFromPadron)(creds, cfg.cuit, cuit.numeric, cfg.production));
        const warning = String(padron.afipWarning ?? '').trim();
        const result = (0, mapTaxpayerToClient_1.mapAfipPersonaToClient)(padron, cuit);
        if (warning)
            result.afipWarning = warning;
        return result;
    }
    catch (e) {
        throw new Error((0, afipErrors_1.formatAfipCallError)(e, cfg.production));
    }
}
//# sourceMappingURL=lookupTaxpayer.js.map