import type * as functions from 'firebase-functions';
type Request = functions.https.Request;
type Response = any;
export interface ApiIntegration {
    id: string;
    name: string;
    empresaId: string;
    scopes: string[];
    status: 'ACTIVE' | 'REVOKED';
    apiKeyPrefix?: string;
    ipAllowlist?: string[];
}
export interface AuthedRequest extends Request {
    integration?: ApiIntegration;
}
export declare function requireApiKey(req: AuthedRequest, res: Response, requiredScope: string): Promise<boolean>;
export declare function generateApiKey(): {
    apiKey: string;
    salt: string;
    hash: string;
    prefix: string;
};
export {};
