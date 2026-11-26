/**
 * Webhook Meta Cloud API → inbox Firestore (misma forma que el bridge).
 * GET: verificación hub.challenge
 * POST: mensajes entrantes (ubicación / imagen / texto)
 *
 * URL prod: https://us-central1-comtroldata.cloudfunctions.net/whatsappCloudWebhook
 */
import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { encolarMensajeWaCloud, resolverEmpresaPorPhoneNumberId } from './waCloudInbox';
import { horaArFromMs, normPhoneWa, type WaCloudNormalizedMessage } from './waCloudTypes';

const VERIFY_DEFAULT = 'cosp-wa-cloud-verify';

type MetaLocation = { latitude?: number; longitude?: number };
type MetaImage = { id?: string; caption?: string; mime_type?: string };
type MetaText = { body?: string };
type MetaMsg = {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: MetaText;
  location?: MetaLocation;
  image?: MetaImage;
};

async function verifyTokenEsperado(): Promise<string> {
  const fromEnv = String(process.env.WA_CLOUD_VERIFY_TOKEN || '').trim();
  if (fromEnv) return fromEnv;
  try {
    const snap = await admin.firestore().collection('system_secrets').doc('wa_cloud_webhook').get();
    const t = String(snap.data()?.verifyToken || '').trim();
    if (t) return t;
  } catch {
    /* ignore */
  }
  return VERIFY_DEFAULT;
}

function parseMetaMessages(body: unknown): Array<{
  phoneNumberId: string;
  displayPhone?: string;
  msg: MetaMsg;
  contactName: string;
}> {
  const out: Array<{
    phoneNumberId: string;
    displayPhone?: string;
    msg: MetaMsg;
    contactName: string;
  }> = [];
  const root = body as {
    entry?: Array<{
      changes?: Array<{
        value?: {
          metadata?: { phone_number_id?: string; display_phone_number?: string };
          contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
          messages?: MetaMsg[];
        };
      }>;
    }>;
  };
  for (const entry of root.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value;
      if (!value?.messages?.length) continue;
      const phoneNumberId = String(value.metadata?.phone_number_id || '').trim();
      const displayPhone = String(value.metadata?.display_phone_number || '').trim();
      const nameByWa = new Map<string, string>();
      for (const c of value.contacts || []) {
        const wa = normPhoneWa(c.wa_id);
        if (wa) nameByWa.set(wa, String(c.profile?.name || '').trim());
      }
      for (const msg of value.messages) {
        const from = normPhoneWa(msg.from);
        out.push({
          phoneNumberId,
          displayPhone: displayPhone || undefined,
          msg,
          contactName: nameByWa.get(from) || from,
        });
      }
    }
  }
  return out;
}

function metaToNormalized(
  empresaId: string,
  phoneNumberId: string,
  contactName: string,
  msg: MetaMsg,
): WaCloudNormalizedMessage | null {
  const id = String(msg.id || '').trim();
  const phone = normPhoneWa(msg.from);
  if (!id || !phone) return null;
  const tsSec = Number(msg.timestamp);
  const ts = Number.isFinite(tsSec) && tsSec > 0 ? tsSec * 1000 : Date.now();
  const type = String(msg.type || 'text').toLowerCase();
  let location: WaCloudNormalizedMessage['location'] = null;
  let text = '';
  let hasPhoto = false;
  if (type === 'location' && msg.location) {
    const lat = Number(msg.location.latitude);
    const lng = Number(msg.location.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      location = { lat, lng };
    }
  }
  if (type === 'text') text = String(msg.text?.body || '').trim();
  if (type === 'image') {
    hasPhoto = true;
    text = String(msg.image?.caption || '').trim();
  }
  return {
    id,
    ts,
    time: horaArFromMs(ts),
    phone,
    name: contactName || phone,
    text,
    type: type === 'location' ? 'location' : type === 'image' ? 'image' : type,
    hasPhoto,
    hasLocation: !!location,
    photo: null,
    location,
    groupId: null,
    group: null,
    source: 'cloud',
    phoneNumberId,
    empresaId,
  };
}

export const whatsappCloudWebhook = functions
  .region('us-central1')
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .https.onRequest(async (req, res) => {
    // Verificación Meta
    if (req.method === 'GET') {
      const mode = String(req.query['hub.mode'] || '');
      const token = String(req.query['hub.verify_token'] || '');
      const challenge = String(req.query['hub.challenge'] || '');
      const expected = await verifyTokenEsperado();
      if (mode === 'subscribe' && token && token === expected) {
        res.status(200).send(challenge);
        return;
      }
      res.status(403).send('Forbidden');
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const db = admin.firestore();
    const parsed = parseMetaMessages(req.body);
    let written = 0;
    for (const item of parsed) {
      if (!item.phoneNumberId) continue;
      const empresaId = await resolverEmpresaPorPhoneNumberId(db, item.phoneNumberId);
      if (!empresaId) {
        console.warn(
          `[whatsappCloudWebhook] phoneNumberId sin empresa: ${item.phoneNumberId}`,
        );
        continue;
      }
      const norm = metaToNormalized(empresaId, item.phoneNumberId, item.contactName, item.msg);
      if (!norm) continue;
      // Cloud 1:1: ubicación fija sí vale (a diferencia del bridge de grupos).
      const cuenta =
        norm.hasLocation ||
        norm.hasPhoto ||
        (norm.type === 'text' && /presente/i.test(norm.text));
      if (!cuenta && norm.type !== 'text') continue;
      const r = await encolarMensajeWaCloud(db, norm);
      if (r.written) written += 1;
    }
    // Meta exige 200 rápido.
    res.status(200).json({ ok: true, written });
  });
