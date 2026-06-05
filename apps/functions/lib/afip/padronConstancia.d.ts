import type { WsaaCredentials } from './wsaaDirect';
export declare function getTaxpayerFromPadron(creds: WsaaCredentials, cuitRepresentada: number, idPersona: number, production: boolean): Promise<unknown>;
