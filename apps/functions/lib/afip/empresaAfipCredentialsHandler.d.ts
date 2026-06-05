import * as functions from 'firebase-functions/v1';
export declare function saveEmpresaAfipCredentialsHandler(data: {
    empresaId?: string;
    certCuit?: string;
    cert?: string;
    privateKey?: string;
    production?: boolean;
}, context: functions.https.CallableContext): Promise<{
    certNotAfter?: string;
    ok: boolean;
}>;
export declare function getEmpresaAfipConfigHandler(data: {
    empresaId?: string;
}, context: functions.https.CallableContext): Promise<{
    configured: boolean;
    certCuit?: string;
    production?: boolean;
    certNotAfter?: string;
    ok: boolean;
}>;
