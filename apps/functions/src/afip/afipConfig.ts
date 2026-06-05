export type AfipEnvConfig = {
  cuit: number;
  cert: string;
  privateKey: string;
  production: boolean;
};

function readPem(name: string): string {
  const raw = process.env[name] || '';
  return raw.replace(/\\n/g, '\n').trim();
}

export function getAfipEnvConfig(): AfipEnvConfig | null {
  const cuitRaw = String(process.env.AFIP_CUIT || '').replace(/\D/g, '');
  const cert = readPem('AFIP_CERT');
  const privateKey = readPem('AFIP_PRIVATE_KEY');
  if (!cuitRaw || cuitRaw.length !== 11 || !cert || !privateKey) return null;
  return {
    cuit: Number(cuitRaw),
    cert,
    privateKey,
    production: String(process.env.AFIP_PRODUCTION || '').toLowerCase() === 'true',
  };
}

export function isAfipConfigured(): boolean {
  return getAfipEnvConfig() !== null;
}

export { loadAfipConfigForEmpresa } from './empresaAfipStore';
