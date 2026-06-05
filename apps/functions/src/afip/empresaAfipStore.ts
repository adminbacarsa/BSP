import * as admin from 'firebase-admin';
import { X509Certificate } from 'crypto';
import type { AfipEnvConfig } from './afipConfig';
import { getAfipEnvConfig } from './afipConfig';

const COL = 'empresa_afip_credentials';

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

function db() {
  return admin.firestore();
}

function normalizeEmpresaId(empresaId: unknown): string {
  return String(empresaId ?? '').trim().toLowerCase();
}

function readPem(raw: unknown): string {
  return String(raw ?? '').replace(/\\n/g, '\n').trim();
}

export function parseCertNotAfter(certPem: string): string | undefined {
  try {
    const x = new X509Certificate(readPem(certPem));
    return x.validTo;
  } catch {
    return undefined;
  }
}

export async function saveEmpresaAfipCredentials(input: {
  empresaId: string;
  certCuit: string;
  cert: string;
  privateKey: string;
  production: boolean;
}): Promise<{ certNotAfter?: string }> {
  const empresaId = normalizeEmpresaId(input.empresaId);
  const certCuit = String(input.certCuit ?? '').replace(/\D/g, '');
  const cert = readPem(input.cert);
  const privateKey = readPem(input.privateKey);
  if (!empresaId) throw new Error('empresaId requerido.');
  if (certCuit.length !== 11) throw new Error('CUIT del certificado inválido (11 dígitos).');
  if (!cert.includes('BEGIN CERTIFICATE') || !privateKey.includes('BEGIN')) {
    throw new Error('Certificado o clave privada con formato PEM inválido.');
  }

  const certNotAfter = parseCertNotAfter(cert);
  const doc: EmpresaAfipDoc = {
    certCuit,
    cert,
    privateKey,
    production: !!input.production,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    certNotAfter,
  };

  await db().collection(COL).doc(empresaId).set(doc, { merge: false });
  await db().collection(COL).doc(empresaId).update({
    taToken: admin.firestore.FieldValue.delete(),
    taSign: admin.firestore.FieldValue.delete(),
    taExpirationMs: admin.firestore.FieldValue.delete(),
  });

  await db().collection('empresas').doc(empresaId).set(
    {
      afipConfigured: true,
      afipCertCuit: certCuit,
      afipProduction: !!input.production,
      afipCertNotAfter: certNotAfter || null,
      afipUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return { certNotAfter };
}

export async function getEmpresaAfipStatus(empresaId: string): Promise<{
  configured: boolean;
  certCuit?: string;
  production?: boolean;
  certNotAfter?: string;
}> {
  const id = normalizeEmpresaId(empresaId);
  if (!id) return { configured: false };
  const snap = await db().collection(COL).doc(id).get();
  if (!snap.exists) return { configured: false };
  const d = snap.data() as EmpresaAfipDoc;
  return {
    configured: true,
    certCuit: d.certCuit,
    production: d.production,
    certNotAfter: d.certNotAfter,
  };
}

export async function loadAfipConfigForEmpresa(empresaId: unknown): Promise<AfipEnvConfig | null> {
  const id = normalizeEmpresaId(empresaId);
  if (id) {
    const snap = await db().collection(COL).doc(id).get();
    if (snap.exists) {
      const d = snap.data() as EmpresaAfipDoc;
      const cert = readPem(d.cert);
      const privateKey = readPem(d.privateKey);
      const cuitRaw = String(d.certCuit ?? '').replace(/\D/g, '');
      if (cuitRaw.length === 11 && cert && privateKey) {
        return {
          cuit: Number(cuitRaw),
          cert,
          privateKey,
          production: !!d.production,
        };
      }
    }
  }
  return getAfipEnvConfig();
}

export async function loadEmpresaAfipTaCache(empresaId: string): Promise<{
  token: string;
  sign: string;
  expirationTime: Date;
} | null> {
  const id = normalizeEmpresaId(empresaId);
  if (!id) return null;
  const snap = await db().collection(COL).doc(id).get();
  if (!snap.exists) return null;
  const d = snap.data() as EmpresaAfipDoc;
  if (!d.taToken || !d.taSign || !d.taExpirationMs) return null;
  if (d.taExpirationMs <= Date.now() + 60_000) return null;
  return {
    token: d.taToken,
    sign: d.taSign,
    expirationTime: new Date(d.taExpirationMs),
  };
}

export async function saveEmpresaAfipTaCache(
  empresaId: string,
  ta: { token: string; sign: string; expirationTime: Date },
): Promise<void> {
  const id = normalizeEmpresaId(empresaId);
  if (!id) return;
  await db().collection(COL).doc(id).set(
    {
      taToken: ta.token,
      taSign: ta.sign,
      taExpirationMs: ta.expirationTime.getTime(),
    },
    { merge: true },
  );
}
