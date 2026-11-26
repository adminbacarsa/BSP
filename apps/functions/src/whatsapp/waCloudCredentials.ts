/**
 * Token Meta Cloud API por empresa.
 * Credencial: empresa_wa_cloud_credentials/{empresaId} (solo Admin SDK).
 * Metadato tokenConfigured: empresas/{id}/config/whatsapp.cloud.tokenConfigured
 */
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as functions from 'firebase-functions/v1';
import { isSuperAdminRole, normalizeRoleId } from '../common/role.util';
import { resolvePanelUserForUid } from '../ops/staffPermissions';
import { WA_CLOUD_CRED_COL as CRED_COL, leerTokenWaCloud } from './waCloudToken';
import { encolarMensajeWaCloud, upsertPhoneIndex } from './waCloudInbox';
import { enviarTextoWaCloud } from './waCloudGraph';
import { horaArFromMs, normPhoneWa } from './waCloudTypes';

const GRAPH_VERSION = 'v21.0';

export { leerTokenWaCloud };

function esAdminOSuper(role: unknown): boolean {
  const r = normalizeRoleId(role);
  return r === 'ADMIN' || isSuperAdminRole(r);
}

async function exigirAdminEmpresa(
  data: { empresaId?: string },
  context: functions.https.CallableContext,
): Promise<{ empresaId: string; db: admin.firestore.Firestore; uid: string }> {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Autenticación requerida.');
  }
  const empresaId = String(data?.empresaId || '').trim();
  if (!empresaId) {
    throw new functions.https.HttpsError('invalid-argument', 'empresaId requerido');
  }
  const db = admin.firestore();
  const claimRole = context.auth.token?.role;
  const panel = await resolvePanelUserForUid(
    db,
    context.auth.uid,
    claimRole,
    String(context.auth.token?.email || context.auth.token?.name || ''),
  );
  const habilitado = esAdminOSuper(claimRole) || esAdminOSuper(panel?.roleName);
  if (!habilitado) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Solo admin o superadmin puede gestionar WhatsApp Cloud.',
    );
  }
  const superadmin =
    isSuperAdminRole(claimRole) || panel?.isSuperAdmin === true || panel?.allEmpresas === true;
  if (!superadmin) {
    const propia = String(panel?.empresaId || context.auth.token?.empresaId || '').trim();
    if (!propia || propia !== empresaId) {
      throw new functions.https.HttpsError('permission-denied', 'Empresa no permitida.');
    }
  }
  return { empresaId, db, uid: context.auth.uid };
}

function maskToken(token: string): string {
  const t = String(token || '');
  if (t.length < 8) return '••••';
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
}

async function marcarTokenConfigured(
  db: admin.firestore.Firestore,
  empresaId: string,
  configured: boolean,
  by: string,
): Promise<void> {
  const ref = db.collection('empresas').doc(empresaId).collection('config').doc('whatsapp');
  // Dot paths: no pisar phoneNumberId / plantillas ya guardadas en cloud.
  await ref.set(
    {
      'cloud.tokenConfigured': configured,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: by,
    },
    { merge: true },
  );
}

/** Guarda o rota el token permanente de Cloud API (no se vuelve a leer en el cliente). */
export const setWhatsAppCloudToken = functions
  .region('us-central1')
  .runWith({ timeoutSeconds: 30, memory: '256MB' })
  .https.onCall(async (data, context) => {
    const payload = (data || {}) as { empresaId?: string; accessToken?: string };
    const { empresaId, db, uid } = await exigirAdminEmpresa(payload, context);
    const accessToken = String(payload.accessToken || '').trim();
    if (accessToken.length < 20) {
      throw new functions.https.HttpsError('invalid-argument', 'Token inválido o demasiado corto.');
    }
    const by = String(
      context.auth!.token?.email || context.auth!.token?.name || uid,
    );
    await db
      .collection(CRED_COL)
      .doc(empresaId)
      .set(
        {
          accessToken,
          maskedToken: maskToken(accessToken),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: by,
        },
        { merge: true },
      );
    await marcarTokenConfigured(db, empresaId, true, by);
    return { ok: true, maskedToken: maskToken(accessToken) };
  });

export const getWhatsAppCloudTokenStatus = functions
  .region('us-central1')
  .runWith({ timeoutSeconds: 15, memory: '256MB' })
  .https.onCall(async (data, context) => {
    const { empresaId, db } = await exigirAdminEmpresa(
      (data || {}) as { empresaId?: string },
      context,
    );
    const snap = await db.collection(CRED_COL).doc(empresaId).get();
    if (!snap.exists) {
      return { hasToken: false, maskedToken: '', updatedAt: null, updatedBy: '' };
    }
    const d = snap.data() || {};
    return {
      hasToken: typeof d.accessToken === 'string' && d.accessToken.length > 0,
      maskedToken: String(d.maskedToken || ''),
      updatedAt: d.updatedAt ?? null,
      updatedBy: String(d.updatedBy || ''),
    };
  });

export const clearWhatsAppCloudToken = functions
  .region('us-central1')
  .runWith({ timeoutSeconds: 30, memory: '256MB' })
  .https.onCall(async (data, context) => {
    const { empresaId, db, uid } = await exigirAdminEmpresa(
      (data || {}) as { empresaId?: string },
      context,
    );
    const by = String(context.auth!.token?.email || context.auth!.token?.name || uid);
    await db.collection(CRED_COL).doc(empresaId).delete();
    await marcarTokenConfigured(db, empresaId, false, by);
    return { ok: true };
  });

/**
 * Prueba Graph API: manda el template hello_world al número indicado (E.164 sin +).
 * Usa phoneNumberId de config/whatsapp si no viene en el payload.
 */
export const testWhatsAppCloudSend = functions
  .region('us-central1')
  .runWith({ timeoutSeconds: 30, memory: '256MB' })
  .https.onCall(async (data, context) => {
    const payload = (data || {}) as {
      empresaId?: string;
      toPhone?: string;
      phoneNumberId?: string;
    };
    const { empresaId, db } = await exigirAdminEmpresa(payload, context);
    const toPhone = String(payload.toPhone || '')
      .replace(/\D/g, '')
      .replace(/^0+/, '');
    if (toPhone.length < 8) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Indicá un celular de prueba (solo dígitos, con código de país).',
      );
    }
    const cred = await db.collection(CRED_COL).doc(empresaId).get();
    const token = String(cred.data()?.accessToken || '').trim();
    if (!token) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'No hay token Cloud configurado para esta empresa.',
      );
    }
    let phoneNumberId = String(payload.phoneNumberId || '').trim();
    if (!phoneNumberId) {
      const cfg = await db
        .collection('empresas')
        .doc(empresaId)
        .collection('config')
        .doc('whatsapp')
        .get();
      phoneNumberId = String(cfg.data()?.cloud?.phoneNumberId || '').trim();
    }
    if (!phoneNumberId) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Falta phoneNumberId en la config Cloud de la empresa.',
      );
    }
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;
    const body = {
      messaging_product: 'whatsapp',
      to: toPhone,
      type: 'template',
      template: { name: 'hello_world', language: { code: 'en_US' } },
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
    if (!res.ok) {
      const errMsg =
        typeof json === 'object' &&
        json &&
        'error' in json &&
        typeof (json as { error?: { message?: string } }).error?.message === 'string'
          ? (json as { error: { message: string } }).error.message
          : `Graph HTTP ${res.status}`;
      throw new functions.https.HttpsError('internal', errMsg);
    }
    return { ok: true, graph: json };
  });

/** Texto libre al guardia (ventana 24 h). Sin token Meta falla con error claro. */
export const sendWhatsAppCloudText = functions
  .region('us-central1')
  .runWith({ timeoutSeconds: 30, memory: '256MB' })
  .https.onCall(async (data, context) => {
    const payload = (data || {}) as { empresaId?: string; phone?: string; text?: string };
    const { empresaId, db } = await exigirAdminEmpresa(payload, context);
    const result = await enviarTextoWaCloud(db, {
      empresaId,
      toPhone: String(payload.phone || ''),
      text: String(payload.text || ''),
    });
    if (result.ok === false) {
      throw new functions.https.HttpsError('failed-precondition', result.error);
    }
    return result;
  });

/**
 * Simula un inbound Cloud (ubicación o texto) sin Meta.
 * Escribe en wa_cloud_inbox para que Modo Rápido (provider cloud) lo consuma.
 */
export const simulateWhatsAppCloudInbound = functions
  .region('us-central1')
  .runWith({ timeoutSeconds: 30, memory: '256MB' })
  .https.onCall(async (data, context) => {
    const payload = (data || {}) as {
      empresaId?: string;
      phone?: string;
      name?: string;
      lat?: number;
      lng?: number;
      text?: string;
      kind?: 'location' | 'text';
    };
    const { empresaId, db } = await exigirAdminEmpresa(payload, context);
    const phone = normPhoneWa(payload.phone);
    if (phone.length < 8) {
      throw new functions.https.HttpsError('invalid-argument', 'Teléfono de prueba inválido');
    }
    const kind = payload.kind === 'text' ? 'text' : 'location';
    const ts = Date.now();
    const id = `sim-${ts}-${phone.slice(-4)}`;
    let location: { lat: number; lng: number } | null = null;
    if (kind === 'location') {
      const lat = Number(payload.lat);
      const lng = Number(payload.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'Para ubicación simulada hace falta lat y lng',
        );
      }
      location = { lat, lng };
    }
    const cfg = await db.collection('empresas').doc(empresaId).collection('config').doc('whatsapp').get();
    const phoneNumberId = String(cfg.data()?.cloud?.phoneNumberId || '').trim();
    if (phoneNumberId) await upsertPhoneIndex(db, phoneNumberId, empresaId);

    const r = await encolarMensajeWaCloud(db, {
      id,
      ts,
      time: horaArFromMs(ts),
      phone,
      name: String(payload.name || phone).trim() || phone,
      text: String(payload.text || (kind === 'location' ? '' : 'presente')).trim(),
      type: kind === 'location' ? 'location' : 'text',
      hasPhoto: false,
      hasLocation: !!location,
      photo: null,
      location,
      groupId: null,
      group: null,
      source: 'simulate',
      phoneNumberId: phoneNumberId || undefined,
      empresaId,
    });
    return { ok: true, id, written: r.written };
  });

/** Sincroniza phoneNumberId → empresaId (índice del webhook). */
export const syncWhatsAppCloudPhoneIndex = functions
  .region('us-central1')
  .runWith({ timeoutSeconds: 15, memory: '256MB' })
  .https.onCall(async (data, context) => {
    const payload = (data || {}) as { empresaId?: string; phoneNumberId?: string };
    const { empresaId, db } = await exigirAdminEmpresa(payload, context);
    const phoneNumberId = String(payload.phoneNumberId || '').trim();
    if (!phoneNumberId) {
      throw new functions.https.HttpsError('invalid-argument', 'phoneNumberId requerido');
    }
    await upsertPhoneIndex(db, phoneNumberId, empresaId);
    return { ok: true };
  });
