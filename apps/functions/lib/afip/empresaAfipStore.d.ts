import * as admin from 'firebase-admin';
import type { AfipEnvConfig } from './afipConfig';
export type EmpresaAfipDoc = {
    certCuit: string;
    cert: string;
    privateKey: string;
    production: boolean;
    updatedAt: admin.firestore.FieldValue | admin.firestore.Timestamp;
    certNotAfter?: string;
    taToken?: string;
    taSign?: string;
    taExpirationMs?: number;
};
export declare function parseCertNotAfter(certPem: string): string | undefined;
export declare function saveEmpresaAfipCredentials(input: {
    empresaId: string;
    certCuit: string;
    cert: string;
    privateKey: string;
    production: boolean;
}): Promise<{
    certNotAfter?: string;
}>;
export declare function getEmpresaAfipStatus(empresaId: string): Promise<{
    configured: boolean;
    certCuit?: string;
    production?: boolean;
    certNotAfter?: string;
}>;
export declare function loadAfipConfigForEmpresa(empresaId: unknown): Promise<AfipEnvConfig | null>;
export declare function loadEmpresaAfipTaCache(empresaId: string): Promise<{
    token: string;
    sign: string;
    expirationTime: Date;
} | null>;
export declare function saveEmpresaAfipTaCache(empresaId: string, ta: {
    token: string;
    sign: string;
    expirationTime: Date;
}): Promise<void>;
