// eslint-disable-next-line @typescript-eslint/no-var-requires
const Afip = require('@afipsdk/afip.js');
import { getAfipEnvConfig } from './afipConfig';
import { normalizeCuitInput } from './normalizeCuit';
import { mapAfipPersonaToClient, type AfipClientLookupResult } from './mapTaxpayerToClient';

let afipClient: any = null;
let afipClientKey = '';

function getAfipClient() {
  const cfg = getAfipEnvConfig();
  if (!cfg) {
    throw new Error(
      'AFIP no configurado. Definí AFIP_CUIT, AFIP_CERT y AFIP_PRIVATE_KEY (Secret Manager o apps/functions/.env en emulador).',
    );
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

export async function lookupTaxpayerByCuit(rawCuit: unknown): Promise<AfipClientLookupResult> {
  const cuit = normalizeCuitInput(rawCuit);
  if (!cuit) {
    throw new Error('CUIT inválido. Ingresá 11 dígitos (con o sin guiones).');
  }
  const afip = getAfipClient();
  const raw = await afip.RegisterInscriptionProof.getTaxpayerDetails(cuit.numeric);
  return mapAfipPersonaToClient(raw, cuit);
}
