/**
 * Callable SuperAdmin: guarda la clave fiscal en Secret Manager y metadatos sin la clave.
 */
import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { FieldValue } from 'firebase-admin/firestore';
import {
  ClaveFiscalError,
  ejecutarClaveFiscal,
  manejarCredencial,
  metaPublica,
  secretIdDe,
  type MetaClave,
  type PortsClave,
} from './arcaClaveFiscal';
import { crearSecretManagerReal, leerClaveSecreta } from './arcaClaveFiscalSecret';

function db() {
  return admin.firestore();
}

async function rolDe(uid: string): Promise<string> {
  const sys = await db().collection('system_users').doc(uid).get();
  return String(sys.data()?.role || '');
}

async function nombreDe(uid: string): Promise<string> {
  const sys = await db().collection('system_users').doc(uid).get();
  const data = sys.data() || {};
  return String(data.name || data.displayName || data.email || uid);
}

function metaDe(data: FirebaseFirestore.DocumentData | undefined): MetaClave | null {
  const raw = data?.arcaRobotAcceso;
  if (!raw || typeof raw !== 'object') return null;
  const vista = metaPublica(raw as MetaClave);
  if (!vista.configurada) return null;
  return {
    cuitLogin: String(vista.cuitLogin || ''),
    cuitRepresentado: String(vista.cuitRepresentado || ''),
    configuradoAt: String(vista.configuradoAt || ''),
    configuradoPor: String(vista.configuradoPor || ''),
    secretVersion: String(vista.secretVersion || ''),
  };
}

function portsReales(): PortsClave {
  return {
    lookupRole: rolDe,
    store: crearSecretManagerReal(),
    meta: {
      async leer(empresaId) {
        const snap = await db().collection('empresas').doc(empresaId).get();
        return metaDe(snap.data());
      },
      async guardar(empresaId, meta) {
        await db().collection('empresas').doc(empresaId).set({ arcaRobotAcceso: meta }, { merge: true });
      },
      async borrar(empresaId) {
        await db().collection('empresas').doc(empresaId).set(
          { arcaRobotAcceso: FieldValue.delete() },
          { merge: true },
        );
      },
    },
    audit: {
      async add(entry) {
        await db().collection('audit_logs').add({
          ...entry,
          module: 'EVENTUALES',
          timestamp: FieldValue.serverTimestamp(),
        });
      },
    },
  };
}

export const gestionarClaveFiscalArca = functions.https.onCall(async (data, context) => {
  try {
    const uid = context.auth?.uid || '';
    return await ejecutarClaveFiscal({
      auth: context.auth ? { uid, token: context.auth.token as Record<string, unknown> } : null,
      data: (data || {}) as Record<string, unknown>,
      ahoraMs: Date.now(),
      actorName: uid ? await nombreDe(uid) : '',
      emulator: process.env.FUNCTIONS_EMULATOR === 'true',
    }, portsReales());
  } catch (e) {
    if (e instanceof ClaveFiscalError) throw new functions.https.HttpsError(e.codigo, e.message);
    throw e;
  }
});

export async function leerCredencialParaRobot(input: {
  key: string;
  expectedKey: string;
  empresaId: string;
  nowMs: number;
}): Promise<{ status: number; body: Record<string, unknown>; audit?: { action: string; details: string } }> {
  const empresaId = String(input.empresaId || '').trim();
  if (!input.key || input.key !== input.expectedKey) {
    return manejarCredencial({
      key: input.key,
      expectedKey: input.expectedKey,
      empresaId,
      nowMs: input.nowMs,
      meta: null,
      leerClave: async () => '',
    });
  }
  let meta: MetaClave | null = null;
  if (empresaId) {
    const snap = await db().collection('empresas').doc(empresaId).get();
    meta = metaDe(snap.data());
  }
  const out = await manejarCredencial({
    key: input.key,
    expectedKey: input.expectedKey,
    empresaId,
    nowMs: input.nowMs,
    meta,
    leerClave: async () => leerClaveSecreta(secretIdDe(empresaId)),
  });
  if (out.audit) {
    await db().collection('audit_logs').add({
      action: out.audit.action,
      actorName: 'Robot ARCA',
      actorUid: 'SYSTEM',
      module: 'EVENTUALES',
      empresaId,
      details: out.audit.details,
      timestamp: FieldValue.serverTimestamp(),
    });
  }
  return out;
}