import type { NormalizedCuit } from './normalizeCuit';
export type AfipClientLookupResult = {
    taxId: string;
    legalName: string;
    name: string;
    address: string;
    city: string;
    state: string;
    ivaStatus: string;
    estadoClave?: string;
    tipoPersona?: string;
};
export declare function mapAfipPersonaToClient(raw: unknown, cuit: NormalizedCuit): AfipClientLookupResult;
