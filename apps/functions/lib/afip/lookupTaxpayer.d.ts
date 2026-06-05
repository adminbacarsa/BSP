import { type AfipClientLookupResult } from './mapTaxpayerToClient';
export declare function lookupTaxpayerByCuit(rawCuit: unknown, empresaId?: string): Promise<AfipClientLookupResult>;
