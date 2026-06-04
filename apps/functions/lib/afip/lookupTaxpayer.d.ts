import { type AfipClientLookupResult } from './mapTaxpayerToClient';
export declare function lookupTaxpayerByCuit(rawCuit: unknown): Promise<AfipClientLookupResult>;
