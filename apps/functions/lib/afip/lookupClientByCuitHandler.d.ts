import * as functions from 'firebase-functions/v1';
export declare function lookupClientByCuitHandler(data: {
    cuit?: string;
}, context: functions.https.CallableContext): Promise<{
    taxId: string;
    legalName: string;
    name: string;
    address: string;
    city: string;
    state: string;
    ivaStatus: string;
    estadoClave?: string;
    tipoPersona?: string;
    ok: boolean;
}>;
