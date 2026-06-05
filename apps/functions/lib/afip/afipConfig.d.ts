export type AfipEnvConfig = {
    cuit: number;
    cert: string;
    privateKey: string;
    production: boolean;
};
export declare function getAfipEnvConfig(): AfipEnvConfig | null;
export declare function isAfipConfigured(): boolean;
export { loadAfipConfigForEmpresa } from './empresaAfipStore';
