import { loadAfipConfigForEmpresa } from './afipConfig';
import { assertAfipCertCurrentlyValid, formatAfipCallError } from './afipErrors';
import { getTaxpayerFromPadron } from './padronConstancia';
import { normalizeCuitInput } from './normalizeCuit';
import { mapAfipPersonaToClient, type AfipClientLookupResult } from './mapTaxpayerToClient';
import { loginWsaaDirect } from './wsaaDirect';

const WS_CONSTANCIA = 'ws_sr_constancia_inscripcion';

export async function lookupTaxpayerByCuit(
  rawCuit: unknown,
  empresaId?: string,
): Promise<AfipClientLookupResult> {
  const cuit = normalizeCuitInput(rawCuit);
  if (!cuit) {
    throw new Error('CUIT inválido. Ingresá 11 dígitos (con o sin guiones).');
  }
  const cfg = await loadAfipConfigForEmpresa(empresaId);
  if (!cfg) {
    throw new Error(
      'AFIP no configurado para esta empresa. Cargá certificado en Configuración → Empresas.',
    );
  }
  assertAfipCertCurrentlyValid(cfg.cert);

  try {
    const creds = await loginWsaaDirect(
      cfg.cert,
      cfg.privateKey,
      WS_CONSTANCIA,
      cfg.production,
      empresaId,
    );
    const padron = (await getTaxpayerFromPadron(
      creds,
      cfg.cuit,
      cuit.numeric,
      cfg.production,
    )) as Record<string, unknown>;
    const warning = String(padron.afipWarning ?? '').trim();
    const result = mapAfipPersonaToClient(padron, cuit);
    if (warning) result.afipWarning = warning;
    return result;
  } catch (e: unknown) {
    throw new Error(formatAfipCallError(e, cfg.production));
  }
}
