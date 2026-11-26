import type { Firestore } from 'firebase-admin/firestore';
import { leerTokenWaCloud } from './waCloudToken';

const GRAPH_VERSION = 'v21.0';

export type WaCloudSendResult =
  | { ok: true; messageId?: string }
  | { ok: false; error: string; status?: number };

async function phoneNumberIdDeConfig(db: Firestore, empresaId: string): Promise<string> {
  const cfg = await db.collection('empresas').doc(empresaId).collection('config').doc('whatsapp').get();
  return String(cfg.data()?.cloud?.phoneNumberId || '').trim();
}

export async function enviarTextoWaCloud(
  db: Firestore,
  opts: { empresaId: string; toPhone: string; text: string; phoneNumberId?: string },
): Promise<WaCloudSendResult> {
  const empresaId = String(opts.empresaId || '').trim();
  const to = String(opts.toPhone || '')
    .replace(/\D/g, '')
    .replace(/^0+/, '');
  const text = String(opts.text || '').trim().slice(0, 4096);
  if (!empresaId || to.length < 8 || !text) {
    return { ok: false, error: 'empresaId, teléfono o texto inválidos' };
  }
  const token = await leerTokenWaCloud(db, empresaId);
  if (!token) return { ok: false, error: 'Sin token Cloud para la empresa' };
  const phoneNumberId =
    String(opts.phoneNumberId || '').trim() || (await phoneNumberIdDeConfig(db, empresaId));
  if (!phoneNumberId) return { ok: false, error: 'Falta phoneNumberId' };

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { preview_url: false, body: text },
    }),
  });
  const raw = await res.text();
  let json: { messages?: Array<{ id?: string }>; error?: { message?: string } } = {};
  try {
    json = JSON.parse(raw) as typeof json;
  } catch {
    json = {};
  }
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: json.error?.message || `Graph HTTP ${res.status}`,
    };
  }
  return { ok: true, messageId: json.messages?.[0]?.id };
}
