/**
 * Servidor túnel para video en vivo y snapshot.
 * - /agent: agentes conectan (WebSocket), envían auth (nvrId + agent_secret), reciben start_stream/stop_stream y get_snapshot; envían frames o snapshot_response.
 * - /live: navegador conecta (WebSocket) con ?nvrId=&channel=&token=; servidor relée frames del agente al navegador.
 * - GET /snapshot?nvrId=&channel=: N8N u otros piden una imagen; el servidor pide al agente por WS y devuelve el JPEG (para que N8N en la nube no tenga que alcanzar la IP del NVR).
 */
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const admin = require('firebase-admin');
const { randomUUID } = require('crypto');

const PORT = parseInt(process.env.PORT || '8080', 10);
const SNAPSHOT_TIMEOUT_MS = 15000;

// Firebase Admin (usa GOOGLE_APPLICATION_CREDENTIALS o default en GCP)
if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const app = express();
app.get('/health', (req, res) => res.status(200).json({ ok: true, service: 'tunnel-server' }));

// GET /snapshot?nvrId=XXX&channel=1 (channel 1-based). Header Authorization: Bearer <agent_secret o webhook secret>.
// pendingSnapshotRequests: requestId -> { resolve, reject, timeout }
const pendingSnapshotRequests = new Map();

async function getWebhookSecret() {
  try {
    const snap = await db.doc('nvr_config/webhook').get();
    const s = snap.exists && snap.data() && typeof snap.data().secret === 'string' ? String(snap.data().secret).trim() : '';
    return s || null;
  } catch (e) {
    return null;
  }
}

async function validateSnapshotAuth(req) {
  const auth = (req.headers.authorization || '').trim();
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : null;
  if (!token) return false;
  const webhookSecret = await getWebhookSecret();
  if (webhookSecret && token === webhookSecret) return true;
  const nvrId = req.query.nvrId && String(req.query.nvrId).trim();
  if (nvrId) {
    const doc = await db.collection('nvr_devices').doc(nvrId).get();
    const secret = doc.exists && doc.data() && typeof doc.data().agent_secret === 'string' ? String(doc.data().agent_secret).trim() : '';
    if (secret && token === secret) return true;
  }
  return false;
}

app.get('/snapshot', async (req, res) => {
  const nvrId = req.query.nvrId && String(req.query.nvrId).trim();
  const channel = parseInt(req.query.channel, 10);
  if (!nvrId || !Number.isFinite(channel) || channel < 1) {
    res.status(400).json({ error: 'nvrId y channel (1-based) requeridos' });
    return;
  }
  const ok = await validateSnapshotAuth(req);
  if (!ok) {
    res.status(401).json({ error: 'Authorization Bearer requerido (agent_secret o nvr_config/webhook.secret)' });
    return;
  }
  const agent = agents.get(nvrId);
  if (!agent || !agent.ws || agent.ws.readyState !== 1) {
    res.status(503).json({ error: 'Agente no conectado', nvrId });
    return;
  }
  const requestId = randomUUID();
  const timeoutHandle = setTimeout(() => {
    const pending = pendingSnapshotRequests.get(requestId);
    if (pending) {
      pendingSnapshotRequests.delete(requestId);
      pending.reject(new Error('Timeout'));
    }
  }, SNAPSHOT_TIMEOUT_MS);
  const promise = new Promise((resolve, reject) => {
    pendingSnapshotRequests.set(requestId, { resolve, reject, timeout: timeoutHandle });
  });
  try {
    agent.ws.send(JSON.stringify({ type: 'get_snapshot', channel, requestId }));
    const imageBase64 = await promise;
    const buf = Buffer.from(imageBase64, 'base64');
    res.setHeader('Content-Type', 'image/jpeg');
    res.status(200).send(buf);
  } catch (e) {
    if (!res.headersSent) res.status(504).json({ error: 'Snapshot timeout o error', message: e.message });
  } finally {
    const pending = pendingSnapshotRequests.get(requestId);
    if (pending) {
      clearTimeout(pending.timeout);
      pendingSnapshotRequests.delete(requestId);
    }
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

// nvrId -> { ws, currentChannel }
const agents = new Map();
// "nvrId:channel" -> Set of viewer WebSockets
const viewers = new Map();

function viewerKey(nvrId, channel) {
  return `${nvrId}:${channel}`;
}

function getViewers(nvrId, channel) {
  const key = viewerKey(nvrId, channel);
  return viewers.get(key) || new Set();
}

function addViewer(nvrId, channel, ws) {
  const key = viewerKey(nvrId, channel);
  if (!viewers.has(key)) viewers.set(key, new Set());
  viewers.get(key).add(ws);
}

function removeViewer(nvrId, channel, ws) {
  const key = viewerKey(nvrId, channel);
  const set = viewers.get(key);
  if (set) {
    set.delete(ws);
    if (set.size === 0) viewers.delete(key);
  }
}

server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;
  if (pathname === '/agent') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection-agent', ws, request);
    });
  } else if (pathname === '/live') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection-live', ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection-agent', async (ws, request) => {
  let nvrId = null;
  let authenticated = false;

  ws.on('message', async (data) => {
    try {
      if (!authenticated) {
        const msg = typeof data === 'string' ? JSON.parse(data) : { type: 'auth' };
        if (msg.type !== 'auth' || !msg.nvrId || !msg.agent_secret) {
          ws.send(JSON.stringify({ type: 'auth_fail', error: 'Enviar { type: "auth", nvrId, agent_secret }' }));
          return;
        }
        const doc = await db.collection('nvr_devices').doc(String(msg.nvrId).trim()).get();
        const secret = doc.exists && doc.data() && doc.data().agent_secret ? String(doc.data().agent_secret).trim() : '';
        if (!secret || secret !== String(msg.agent_secret).trim()) {
          ws.send(JSON.stringify({ type: 'auth_fail', error: 'Secreto inválido' }));
          return;
        }
        nvrId = String(msg.nvrId).trim();
        if (agents.has(nvrId)) {
          try { agents.get(nvrId).ws.close(); } catch (e) {}
        }
        agents.set(nvrId, { ws, currentChannel: null });
        authenticated = true;
        ws.send(JSON.stringify({ type: 'auth_ok', nvrId }));
        return;
      }

      // El agente puede enviar JSON (snapshot_response) o frames binarios (JPEG).
      if (typeof data === 'string') {
        try {
          const msg = JSON.parse(data);
          if (msg.type === 'snapshot_response' && msg.requestId) {
            const pending = pendingSnapshotRequests.get(msg.requestId);
            if (pending) {
              pendingSnapshotRequests.delete(msg.requestId);
              clearTimeout(pending.timeout);
              pending.resolve(msg.imageBase64 || '');
            }
          }
        } catch (parseErr) {
          // no es JSON, ignorar
        }
        return;
      }
      const a = agents.get(nvrId);
      if (!a || a.currentChannel == null) return;
      const set = getViewers(nvrId, a.currentChannel);
      set.forEach((vws) => {
        if (vws.readyState === 1) vws.send(data);
      });
    } catch (e) {
      console.error('[agent message]', e.message);
    }
  });

  ws.on('close', () => {
    if (nvrId) agents.delete(nvrId);
  });
  ws.on('error', () => {
    if (nvrId) agents.delete(nvrId);
  });
});

wss.on('connection-live', async (ws, request) => {
  const url = new URL(request.url || '', `http://${request.headers.host}`);
  const nvrId = url.searchParams.get('nvrId') && url.searchParams.get('nvrId').trim();
  const channel = parseInt(url.searchParams.get('channel'), 10);
  const token = url.searchParams.get('token') && url.searchParams.get('token').trim();

  if (!nvrId || !Number.isFinite(channel) || channel < 1) {
    ws.close(4000, 'nvrId y channel requeridos');
    return;
  }

  if (token) {
    try {
      await admin.auth().verifyIdToken(token);
    } catch (e) {
      ws.close(4001, 'Token inválido');
      return;
    }
  }

  const agent = agents.get(nvrId);
  if (!agent || !agent.ws || agent.ws.readyState !== 1) {
    ws.send(JSON.stringify({ type: 'error', message: 'Agente no conectado' }));
    ws.close(4002, 'Agente no conectado');
    return;
  }

  addViewer(nvrId, channel, ws);
  const prevChannel = agent.currentChannel;
  if (prevChannel !== channel) {
    if (prevChannel != null && agent.ws.readyState === 1) agent.ws.send(JSON.stringify({ type: 'stop_stream', channel: prevChannel }));
    agent.currentChannel = channel;
    if (agent.ws.readyState === 1) agent.ws.send(JSON.stringify({ type: 'start_stream', channel }));
  }

  ws.on('close', () => {
    removeViewer(nvrId, channel, ws);
    const set = getViewers(nvrId, channel);
    if (set.size === 0) {
      if (agent.ws.readyState === 1) agent.ws.send(JSON.stringify({ type: 'stop_stream', channel }));
      const a = agents.get(nvrId);
      if (a && a.currentChannel === channel) a.currentChannel = null;
    }
  });
  ws.on('error', () => removeViewer(nvrId, channel, ws));
});

server.listen(PORT, () => {
  console.log(`Tunnel server listening on port ${PORT}`);
});
