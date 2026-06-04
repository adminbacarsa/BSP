"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lookupTaxpayerByCuit = lookupTaxpayerByCuit;
const Afip = require('@afipsdk/afip.js');
const afipConfig_1 = require("./afipConfig");
const normalizeCuit_1 = require("./normalizeCuit");
const mapTaxpayerToClient_1 = require("./mapTaxpayerToClient");
let afipClient = null;
let afipClientKey = '';
function getAfipClient() {
    const cfg = (0, afipConfig_1.getAfipEnvConfig)();
    if (!cfg) {
        throw new Error('AFIP no configurado. Definí AFIP_CUIT, AFIP_CERT y AFIP_PRIVATE_KEY (Secret Manager o apps/functions/.env en emulador).');
    }
    const key = `${cfg.cuit}:${cfg.production}`;
    if (!afipClient || afipClientKey !== key) {
        afipClient = new Afip({
            CUIT: cfg.cuit,
            cert: cfg.cert,
            key: cfg.privateKey,
            production: cfg.production,
        });
        afipClientKey = key;
    }
    return afipClient;
}
async function lookupTaxpayerByCuit(rawCuit) {
    const cuit = (0, normalizeCuit_1.normalizeCuitInput)(rawCuit);
    if (!cuit) {
        throw new Error('CUIT inválido. Ingresá 11 dígitos (con o sin guiones).');
    }
    const afip = getAfipClient();
    const raw = await afip.RegisterInscriptionProof.getTaxpayerDetails(cuit.numeric);
    return (0, mapTaxpayerToClient_1.mapAfipPersonaToClient)(raw, cuit);
}
//# sourceMappingURL=lookupTaxpayer.js.map