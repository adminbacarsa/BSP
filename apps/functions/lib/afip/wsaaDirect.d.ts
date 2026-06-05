export type WsaaCredentials = {
    token: string;
    sign: string;
    expirationTime: Date;
};
export declare function loginWsaaDirect(certPem: string, privateKeyPem: string, service: string, production: boolean, empresaId?: string): Promise<WsaaCredentials>;
