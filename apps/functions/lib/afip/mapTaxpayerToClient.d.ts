import type { NormalizedCuit } from './normalizeCuit';
export type AfipClientLookupResult = {
    taxId: string;
    legalName: string;
    name: string;
    address: string;
    city: string;
    state: string;
    postalCode?: string;
    ivaStatus: string;
    estadoClave?: string;
    tipoPersona?: string;
    actividadPrincipal?: string;
    mesCierre?: string;
    afipImpuestos?: string;
    afipWarning?: string;
};
export declare function mapAfipPersonaToClient(raw: unknown, cuit: NormalizedCuit): AfipClientLookupResult;
