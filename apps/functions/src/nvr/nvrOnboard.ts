import * as admin from 'firebase-admin';
import { onRequest, HttpsError } from 'firebase-functions/v2/https';
import { randomBytes } from 'crypto';

function ensureAdmin() {
  if (!admin.apps.length) admin.initializeApp();
}

function getHeader(req: { headers: Record<string, string | string[] | undefined> }, name: string): string | null {
  const v = req.headers[name.toLowerCase()] ?? (req as { get?: (n: string) => string | string[] | undefined }).get?.(name);
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s.trim() ? s.trim() : null;
}

function getRegistrationToken(req: { headers: Record<string, string | string[] | undefined> }): string | null {
  const fromHeader = getHeader(req, 'x-registration-token');
  if (fromHeader) return fromHeader;
  const auth = getHeader(req, 'authorization');
  if (auth && auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return null;
}

type OnboardBody = {
  nvr_id?: string;
  nvr_name?: string;
  nvr_ip?: string;
  nvr_port?: number;
  nvr_user?: string;
  nvr_password?: string;
  channel_count?: number;
  channel_names?: string[];
  client_id?: string;
  objective_id?: string;
};

/**
 * Registro de NVR desde el agente (onboarding).
 * Crea nvr_devices + camera_routes y devuelve agent_secret para que el agente lo use en todas las llamadas.
 */
export const nvrOnboard = onRequest(
  { timeoutSeconds: 30, memory: '256MiB' },
  async (req, res) => {
    try {
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
      if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
      }

      const receivedToken = getRegistrationToken(req);
      if (!receivedToken) {
        res.status(401).json({ error: 'Falta token de registro (Header: X-Registration-Token o Authorization: Bearer <token>)' });
        return;
      }

      ensureAdmin();
      const db = admin.firestore();

      const regSnap = await db.doc('nvr_config/registration').get();
      const expectedToken = regSnap.exists && typeof regSnap.data()?.token === 'string'
        ? String(regSnap.data()?.token).trim()
        : '';
      if (!expectedToken || receivedToken !== expectedToken) {
        res.status(401).json({ error: 'Token de registro inválido.' });
        return;
      }

      const body = (req.body || {}) as OnboardBody;
      const nvrId = (body.nvr_id && String(body.nvr_id).trim()) || '';
      if (!nvrId || nvrId.length > 128) {
        res.status(400).json({ error: 'nvr_id obligatorio y debe ser un string válido (máx 128 caracteres).' });
        return;
      }
      const nvrIp = (body.nvr_ip && String(body.nvr_ip).trim()) || '';
      if (!nvrIp) {
        res.status(400).json({ error: 'nvr_ip obligatorio para conexión de video en vivo.' });
        return;
      }
      const channelCount = Math.max(1, Math.min(64, typeof body.channel_count === 'number' ? body.channel_count : parseInt(String(body.channel_count), 10) || 16));
      const nvrPort = typeof body.nvr_port === 'number' ? body.nvr_port : parseInt(String(body.nvr_port), 10) || 80;
      const nvrUser = (body.nvr_user && String(body.nvr_user).trim()) || 'admin';
      const nvrPassword = (body.nvr_password != null ? String(body.nvr_password) : '') || '';
      const nvrName = (body.nvr_name && String(body.nvr_name).trim()) || null;
      const channelNames = Array.isArray(body.channel_names) ? body.channel_names : [];
      const clientId = (body.client_id && String(body.client_id).trim()) || null;
      const objectiveId = (body.objective_id && String(body.objective_id).trim()) || null;

      const agentSecret = randomBytes(32).toString('base64url');

      const nvrRef = db.collection('nvr_devices').doc(nvrId);
      const existing = await nvrRef.get();

      await nvrRef.set(
        {
          serial_number: nvrId,
          name: nvrName || nvrId,
          channel_count: channelCount,
          stream_ip: nvrIp,
          stream_port: nvrPort,
          stream_user: nvrUser,
          stream_password: nvrPassword,
          client_id: clientId,
          objective_id: objectiveId,
          agent_secret: agentSecret,
          agent_registered: true,
          stream_via_tunnel: true,
          enabled: true,
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
          ...(existing.exists ? {} : { first_seen_at: admin.firestore.FieldValue.serverTimestamp() }),
        },
        { merge: true }
      );

      for (let ch = 1; ch <= channelCount; ch++) {
        const routeKey = `${nvrId}__${ch}`;
        const cameraName = channelNames[ch - 1] && String(channelNames[ch - 1]).trim()
          ? String(channelNames[ch - 1]).trim()
          : `Canal ${ch}`;
        await db.collection('camera_routes').doc(routeKey).set(
          {
            enabled: true,
            camera_name: cameraName,
            nvr_serial: nvrId,
            objective_id: objectiveId,
            client_id: clientId,
            post_id: null,
            event_type: 'Tripwire',
            updated_at: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      res.status(200).json({ ok: true, nvr_id: nvrId, agent_secret: agentSecret });
    } catch (e: unknown) {
      const err = e as { message?: string };
      console.error('[NVR_ONBOARD]', err?.message || e);
      res.status(500).json({ error: (err?.message as string) || 'Error interno' });
    }
  }
);
