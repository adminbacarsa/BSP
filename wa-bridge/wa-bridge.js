/**
 * wa-bridge.js — Puente WhatsApp → HTTP para CC Modo Rápido
 * Usa @whiskeysockets/baileys (WebSocket puro, sin puppeteer)
 *
 * Setup:
 *   cd C:\APP\cronoapp\wa-bridge
 *   npm install
 *   node wa-bridge.js
 *
 * Luego en otra terminal:
 *   npx localtunnel --port 3001
 */

const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, downloadMediaMessage, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode      = require('qrcode-terminal');
const qrcodeImage = require('qrcode');
const express = require('express');
const fs      = require('fs');
const cors    = require('cors');
const pino    = require('pino');
const path    = require('path');

const PORT      = parseInt(process.env.PORT || '7291', 10);
const AUTH_DIR  = process.env.WA_AUTH_DIR || path.join(__dirname, '.wa_auth');
const MAX_MSGS  = 200;
const PUBLIC    = path.join(__dirname, 'public');
const STARTED_AT = Date.now();

const messages        = [];
let   availableGroups = [];
const monitoredGroups = new Set();
let   connected       = false;
let   sock            = null; // instancia Baileys — compartida con los endpoints HTTP
let   lastQR          = null; // último QR recibido (para el endpoint /qr del browser)
const lidToPhone      = {};   // LID numérico → teléfono real (ej: "80629488218268" → "3516294882")

// ── Express ──────────────────────────────────────────────
const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(PUBLIC));

app.get('/status', (req, res) => {
  res.json({ connected, groups: availableGroups, monitored: [...monitoredGroups], startedAt: STARTED_AT });
});

app.get('/messages', (req, res) => {
  const since  = parseInt(req.query.since) || 0;
  const result = since ? messages.filter(m => m.ts > since - 10000) : messages.slice(0, 50);
  res.json({ messages: result, ts: Date.now(), startedAt: STARTED_AT });
});

app.post('/send', async (req, res) => {
  const { phone, message } = req.body;
  if (!phone || !message) return res.status(400).json({ error: 'phone y message requeridos' });
  if (!sock) return res.status(503).json({ error: 'WhatsApp no conectado aún' });
  try {
    // Normalizar: asegurar formato 549XXXXXXXXXX@s.whatsapp.net
    const num = phone.replace(/\D/g, '');
    const jid = (num.startsWith('549') ? num : '549' + num) + '@s.whatsapp.net';
    await sock.sendMessage(jid, { text: message });
    console.log(`[send] ✓ → ${jid}: "${message.slice(0, 60)}"`);
    res.json({ ok: true, to: jid });
  } catch (e) {
    console.error(`[send] ✗ ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

app.get('/qr', async (req, res) => {
  if (connected) {
    return res.send(`<!doctype html><html><head><meta charset="utf-8"><title>WA Bridge</title>
<style>
  body{font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;background:#f0fdf4;gap:16px}
  h2{color:#16a34a;margin:0}
  p{color:#555;margin:0}
  .btns{display:flex;gap:12px;margin-top:8px}
  button{padding:10px 20px;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer}
  .btn-new{background:#2563eb;color:#fff}.btn-new:hover{background:#1d4ed8}
  .btn-out{background:#fff;color:#dc2626;border:2px solid #dc2626}.btn-out:hover{background:#fef2f2}
  .msg{font-size:13px;color:#555;min-height:20px}
</style>
</head><body>
<h2>✅ WhatsApp conectado</h2>
<p>El bridge está activo y listo.</p>
<div class="btns">
  <button class="btn-new" onclick="genQR()">🔄 Generar QR nuevo</button>
  <button class="btn-out" onclick="desvincular()">🔓 Desvincular</button>
</div>
<p class="msg" id="msg"></p>
<script>
async function genQR(){
  document.getElementById('msg').textContent='Generando QR…';
  await fetch('logout',{method:'POST'});
  document.getElementById('msg').textContent='Reiniciando — recargá en 3 s…';
  setTimeout(()=>location.reload(),3000);
}
async function desvincular(){
  if(!confirm('¿Desvincular WhatsApp? Habrá que escanear el QR de nuevo.'))return;
  document.getElementById('msg').textContent='Desvinculando…';
  await fetch('logout',{method:'POST'});
  document.getElementById('msg').textContent='Sesión cerrada — recargá en 3 s…';
  setTimeout(()=>location.reload(),3000);
}
</script>
</body></html>`);
  }
  if (!lastQR) {
    return res.send('<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="3"><title>WA Bridge — QR</title></head><body style="font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;background:#fefce8"><h2>⏳ Esperando QR…</h2><p>Esta página se recarga sola cada 3 segundos.</p></body></html>');
  }
  try {
    const svg = await qrcodeImage.toString(lastQR, { type: 'svg', width: 300 });
    res.send(`<!doctype html><html><head><meta charset="utf-8"><title>WA Bridge — Escaneá el QR</title></head><body style="font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#fff;padding:24px"><h2>📱 Escaneá con WhatsApp</h2><p style="color:#555;text-align:center">WhatsApp → ⋮ → Dispositivos vinculados → Vincular un dispositivo</p>${svg}<p style="color:#888;font-size:12px;margin-top:16px">El QR caduca en ~20 segundos. Si expiró, recargá la página.</p></body></html>`);
  } catch (e) {
    res.status(500).send('Error generando QR: ' + e.message);
  }
});

app.post('/logout', async (req, res) => {
  console.log('[logout] Desvinculando sesión WA...');
  try {
    if (sock) { try { await sock.logout(); } catch (_) {} }
  } finally {
    connected = false;
    lastQR    = null;
    sock      = null;
    if (fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    res.json({ ok: true });
    console.log('[logout] Sesión cerrada — reiniciando en 1 s...');
    setTimeout(() => startWA().catch(console.error), 1000);
  }
});

app.post('/monitor', (req, res) => {
  const { groupId, enable } = req.body;
  if (!groupId) return res.status(400).json({ error: 'groupId requerido' });
  enable ? monitoredGroups.add(groupId) : monitoredGroups.delete(groupId);
  console.log(`[monitor] ${enable ? '✓' : '✗'} ${groupId}`);
  res.json({ ok: true, monitored: [...monitoredGroups] });
});

// ── WhatsApp con Baileys ──────────────────────────────────
async function startWA() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version }          = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    auth:   state,
    printQRInTerminal:    false,
    syncFullHistory:      false,
    getMessage:           async () => undefined,  // no bajar historial
    shouldSyncHistoryMessage: () => false,
  });

  sock.ev.on('creds.update', saveCreds);

  // Mapa LID → teléfono real desde la agenda de contactos
  sock.ev.on('contacts.upsert', contacts => {
    for (const c of contacts) {
      // c.id puede ser "549XXXXXXXXXX@s.whatsapp.net", c.lid puede ser "NNNN@lid"
      if (c.lid && c.id && c.id.endsWith('@s.whatsapp.net')) {
        const lidNum   = c.lid.split('@')[0];
        const phoneNum = c.id.split('@')[0].replace(/^549/, '');
        lidToPhone[lidNum] = phoneNum;
        console.log(`  📒 contacto: ${c.notify || c.id} → LID ${lidNum} = tel ${phoneNum}`);
      }
    }
  });

  sock.ev.on('connection.update', async update => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      lastQR = qr;
      console.log('\n📱 Escaneá este QR con WhatsApp (Dispositivos vinculados → Vincular):\n');
      qrcode.generate(qr, { small: true });
      console.log(`\n   O abrí http://localhost:${PORT}/qr en el browser.\n`);
    }

    if (connection === 'open') {
      connected = true;
      lastQR = null;
      console.log('✅ WhatsApp conectado.\n');

      try {
        const chats = await sock.groupFetchAllParticipating();
        availableGroups = Object.values(chats).map(g => ({
          id:           g.id,
          name:         g.subject,
          participants: g.participants?.length || 0,
        }));
        console.log('Grupos disponibles:');
        availableGroups.forEach((g, i) =>
          console.log(`  [${i}] ${g.name} (${g.participants} miembros)`));
        console.log('\nActivá los grupos desde el artifact.\n');
      } catch (err) {
        console.warn('⚠ No se pudieron listar grupos:', err.message);
      }
    }

    if (connection === 'close') {
      connected = false;
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) {
        console.log('Reconectando…');
        startWA();
      } else {
        console.log('Sesión cerrada. Borrá .wa_auth y reiniciá.');
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages: msgs, type }) => {
    // acepta notify (entrantes) y append (mensajes de otros en grupos)
    if (type !== 'notify' && type !== 'append') return;

    for (const msg of msgs) {
      // if (msg.key.fromMe) continue;  // desactivado para pruebas

      const jid = msg.key.remoteJid || '';
      if (!jid.endsWith('@g.us')) continue; // solo grupos

      // Deduplicar: Baileys puede disparar el mismo mensaje varias veces
      if (msg.key.id && messages.some(m => m.id === msg.key.id)) continue;

      if (monitoredGroups.size > 0 && !monitoredGroups.has(jid)) continue;

      const grp       = availableGroups.find(g => g.id === jid);
      const groupName = grp?.name || jid;

      const senderJid = msg.key.participant || msg.participant || jid;
      const isLid     = senderJid.includes('@lid');
      const rawId     = senderJid.split('@')[0];
      // Resolver teléfono real: desde mapa LID→phone, o directo si es JID de teléfono
      const phone     = isLid
        ? (lidToPhone[rawId] || null)
        : rawId.replace(/^549/, '');
      const pushName  = msg.pushName || rawId;
      if (isLid && !phone) console.log(`  ⚠ LID sin mapa aún: ${rawId} (${pushName}) — esperando sync de contactos`);

      const msgType         = Object.keys(msg.message || {})[0] || '';
      const hasPhoto        = msgType === 'imageMessage';
      const hasLiveLocation = msgType === 'liveLocationMessage';
      const hasLocation     = msgType === 'locationMessage' || hasLiveLocation;
      let   photoBase64 = null;
      let   locationData = null;

      if (hasPhoto) {
        try {
          const buf  = await downloadMediaMessage(msg, 'buffer', {});
          photoBase64 = `data:image/jpeg;base64,${buf.toString('base64')}`;
          console.log(`  📸 foto descargada (${Math.round(buf.length/1024)} KB)`);
        } catch (e) {
          console.warn(`  ⚠ downloadMediaMessage falló: ${e.message}`);
        }
      }

      if (hasLocation) {
        const loc = msg.message?.locationMessage || msg.message?.liveLocationMessage;
        if (loc) {
          locationData = {
            lat:      loc.degreesLatitude,
            lng:      loc.degreesLongitude,
            accuracy: loc.accuracyInMeters || null,
          };
          console.log(`  📍 ubicación: ${locationData.lat.toFixed(5)}, ${locationData.lng.toFixed(5)}${locationData.accuracy ? ` ±${Math.round(locationData.accuracy)}m` : ''}`);
        }
      }

      const text = msg.message?.conversation
                || msg.message?.imageMessage?.caption
                || msg.message?.extendedTextMessage?.text
                || msg.message?.locationMessage?.name
                || '';

      // Check-in válido = foto (prueba visual) o ubicación en vivo (GPS real).
      // Texto solo, ubicación estática y ubicación guardada se ignoran.
      const isCheckin = hasPhoto || hasLiveLocation;
      if (!isCheckin) {
        if (msgType === 'senderKeyDistributionMessage') {
          const proto = {
            id:          msg.key.id,
            ts:          ((msg.messageTimestamp || 0) * 1000) || Date.now(),
            time:        new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }),
            phone,
            name:        pushName,
            text:        '',
            group:       groupName,
            groupId:     jid,
            hasPhoto:    false,
            hasLocation: false,
            photo:       null,
            location:    null,
            type:        'protocol',
          };
          messages.unshift(proto);
          if (messages.length > MAX_MSGS) messages.pop();
          console.log(`  [protocol] ${groupName} | ${pushName}: clave WA renovada - pedirle que reenvie`);
        }
        console.log(`  [skip] ${groupName} | ${pushName}: type=${msgType} text="${text.slice(0, 80)}"`);
        continue;
      }

      const ts   = ((msg.messageTimestamp || 0) * 1000) || Date.now();

      const entry = {
        id:       msg.key.id,
        ts,
        time:     new Date(ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }),
        phone,
        phoneRaw: senderJid,  // JID crudo para auditoría
        name:     pushName,
        text,
        group:    groupName,
        groupId:  jid,
        hasPhoto,
        hasLocation,
        photo:    photoBase64,
        location: locationData,
      };

      console.log(`[${entry.time}] [${type}] ${entry.group} | ${entry.name} (${entry.phone}): "${text.slice(0, 60)}"${hasPhoto ? ' 📸' : ''}${hasLocation ? ` 📍(${locationData?.lat?.toFixed(4)},${locationData?.lng?.toFixed(4)})` : ''}`);

      messages.unshift(entry);
      if (messages.length > MAX_MSGS) messages.pop();
    }
  });
}

// ── Iniciar ──────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🌐 Bridge HTTP corriendo en http://localhost:${PORT}`);
  console.log('Para exponer públicamente: npx localtunnel --port 3001\n');
});

console.log('Iniciando WhatsApp…');
startWA().catch(console.error);
