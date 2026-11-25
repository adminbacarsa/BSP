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
const STATE_TAG = String(process.env.WA_AUTH_DIR || 'default').replace(/[^\w.-]+/g, '_');
const LID_MAP_FILE = path.join(__dirname, `lid-map_${STATE_TAG}.json`);
const PHONES_FILE  = path.join(__dirname, `phones-plataforma_${STATE_TAG}.json`);
const GROUPS_FILE  = path.join(__dirname, `monitored-groups_${STATE_TAG}.json`);
// Compat: si existe el lid-map viejo sin sufijo, se usa como arranque.
const LID_MAP_LEGACY = path.join(__dirname, 'lid-map.json');

function normPhone(value) {
  return String(value || '').replace(/\D/g, '').replace(/^549/, '');
}

// Cargar mapa LID→teléfono persistido (sobrevive reinicios)
function loadLidMap() {
  try {
    const src = fs.existsSync(LID_MAP_FILE) ? LID_MAP_FILE
      : (fs.existsSync(LID_MAP_LEGACY) ? LID_MAP_LEGACY : null);
    if (src) {
      const data = JSON.parse(fs.readFileSync(src, 'utf8'));
      Object.assign(lidToPhone, data);
      console.log(`[lid-map] Cargados ${Object.keys(data).length} mapeos LID→phone desde ${path.basename(src)}`);
    }
  } catch (e) {
    console.warn('[lid-map] No se pudo cargar lid-map:', e.message);
  }
}

function saveLidMap() {
  try {
    fs.writeFileSync(LID_MAP_FILE, JSON.stringify(lidToPhone, null, 2));
  } catch (e) {
    console.warn('[lid-map] No se pudo guardar lid-map:', e.message);
  }
}

function loadPhonesPlataforma() {
  try {
    if (!fs.existsSync(PHONES_FILE)) return;
    const data = JSON.parse(fs.readFileSync(PHONES_FILE, 'utf8'));
    if (!Array.isArray(data)) return;
    for (const p of data) {
      const n = normPhone(p);
      if (n.length >= 8) phonesPlataforma.add(n);
    }
    console.log(`[phones] ${phonesPlataforma.size} teléfonos de la plataforma en disco`);
  } catch (e) {
    console.warn('[phones] No se pudo cargar phones-plataforma:', e.message);
  }
}

function savePhonesPlataforma() {
  try {
    fs.writeFileSync(PHONES_FILE, JSON.stringify([...phonesPlataforma], null, 2));
  } catch (e) {
    console.warn('[phones] No se pudo guardar phones-plataforma:', e.message);
  }
}

function recordarPhonesPlataforma(phones) {
  let nuevos = 0;
  for (const raw of phones || []) {
    const n = normPhone(raw);
    if (n.length < 8 || phonesPlataforma.has(n)) continue;
    phonesPlataforma.add(n);
    nuevos++;
  }
  if (nuevos > 0) savePhonesPlataforma();
  return nuevos;
}

function loadMonitoredGroups() {
  try {
    if (!fs.existsSync(GROUPS_FILE)) return;
    const data = JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8'));
    if (!Array.isArray(data)) return;
    for (const id of data) {
      if (typeof id === 'string' && id.endsWith('@g.us')) monitoredGroups.add(id);
    }
    console.log(`[monitor] ${monitoredGroups.size} grupos restaurados desde disco`);
  } catch (e) {
    console.warn('[monitor] No se pudo cargar monitored-groups:', e.message);
  }
}

function saveMonitoredGroups() {
  try {
    fs.writeFileSync(GROUPS_FILE, JSON.stringify([...monitoredGroups], null, 2));
  } catch (e) {
    console.warn('[monitor] No se pudo guardar monitored-groups:', e.message);
  }
}

/** Mensaje de grupo/teléfono cargado desde Modo Rápido (sync-phones / monitor). */
function grupoMonitoreado(entry) {
  if (entry?.groupId && monitoredGroups.has(entry.groupId)) return true;
  if (!entry?.groupId && entry?.group && monitoredGroups.size > 0) {
    const g = availableGroups.find((x) => x.name === entry.group);
    if (g && monitoredGroups.has(g.id)) return true;
  }
  return false;
}

function esDePlataforma(entry) {
  // Solo grupos que el operador marcó en Modo Rápido. Sin grupo activo = nadie.
  if (!grupoMonitoreado(entry)) return false;
  const ph = normPhone(entry?.phone);
  if (phonesPlataforma.size > 0) {
    if (ph && phonesPlataforma.has(ph)) return true;
    // Check-in sin LID resuelto todavía, en grupo de la planilla: no ocultar.
    if (!ph && entry?.cuenta) return true;
    return false;
  }
  return true;
}

function tieneFiltroPlataforma() {
  return phonesPlataforma.size > 0 || monitoredGroups.size > 0;
}

// ── Respuestas automáticas al guardia (opt-in: WA_RESPONDER=1) ────────────
// Avisa al guardia, por mensaje privado y no por el grupo, cuando mandó algo que no sirve
// (ubicación fija, solo texto), cuando se recibió su check-in y, desde la planilla, cuando el
// operador confirma su presencia.
const RESPONDER      = process.env.WA_RESPONDER === '1';
const rawMsgs        = new Map();   // id de mensaje → mensaje crudo (para saber quién lo mandó)
const RAW_MAX        = 300;
const ultimoAviso    = new Map();   // `${chat}|${tipo}` → ts del último aviso (anti-spam)
const AVISO_ESPERA   = 60 * 1000;

function guardarRaw(msg) {
  if (!RESPONDER || !msg?.key?.id) return;
  rawMsgs.set(msg.key.id, msg);
  if (rawMsgs.size > RAW_MAX) rawMsgs.delete(rawMsgs.keys().next().value);
}

function nombrePila(pushName) {
  const limpio = String(pushName || '').trim();
  if (!limpio) return '';
  const partes = limpio.includes(',') ? limpio.split(',')[1].trim().split(/\s+/) : limpio.split(/\s+/);
  const n = partes[0] || '';
  return n ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : '';
}

// phone → último JID real visto en un grupo (casi siempre @lid). Evita armar 549…@s.whatsapp.net
// a ciegas: eso deja en el celular del guardia "Esperando el mensaje…".
const phoneToJid = {};

function recordarJidGuardia(phone, senderJid) {
  const num = normPhone(phone);
  const jid = String(senderJid || '');
  if (num.length < 8) return;
  if (jid.endsWith('@lid') || jid.endsWith('@s.whatsapp.net')) {
    phoneToJid[num] = jid;
  }
}

// Preferir el JID del mensaje (LID). Si no está, el último LID de ese teléfono; recién después 549…
function jidDelGuardia(phone, senderJid) {
  const jid = String(senderJid || '');
  if (jid.endsWith('@lid') || jid.endsWith('@s.whatsapp.net')) return jid;
  const num = normPhone(phone);
  if (num.length >= 8 && phoneToJid[num]) return phoneToJid[num];
  if (num.length >= 8) return `549${num}@s.whatsapp.net`;
  return null;
}

// Siempre por mensaje directo al guardia, nunca al grupo.
async function responderDirecto(destJid, texto) {
  if (!RESPONDER || !sock || !connected || !destJid || !texto) return false;
  if (destJid.endsWith('@g.us')) return false;
  try {
    await sock.sendMessage(destJid, { text: texto });
    console.log(`  [reply] → ${destJid}: "${texto.slice(0, 70)}"`);
    return true;
  } catch (e) {
    console.warn(`  [reply] ✗ ${destJid}: ${e.message}`);
    return false;
  }
}

function avisarUnaVez(destJid, tipo, texto) {
  if (!RESPONDER || !destJid) return;
  const clave = `${destJid}|${tipo}`;
  const ahora = Date.now();
  if (ahora - (ultimoAviso.get(clave) || 0) < AVISO_ESPERA) return;
  ultimoAviso.set(clave, ahora);
  void responderDirecto(destJid, texto);
}

const messages        = [];
// Bitácora liviana (sin fotos) de todo lo que llega, también lo que el panel descarta.
const bitacora        = [];
const BITACORA_MAX    = 200;
let   availableGroups = [];
const monitoredGroups = new Set();
const phonesPlataforma = new Set(); // teléfonos de empleados/turnos que mandó Modo Rápido
let   connected       = false;
let   sock            = null; // instancia Baileys — compartida con los endpoints HTTP
let   lastQR          = null; // último QR recibido (para el endpoint /qr del browser)
const lidToPhone      = {};   // LID numérico → teléfono real (ej: "80629488218268" → "3516294882")
loadLidMap();
loadPhonesPlataforma();
loadMonitoredGroups();

// ── Express ──────────────────────────────────────────────
const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(PUBLIC));

app.get('/status', (req, res) => {
  res.json({
    connected,
    groups: availableGroups,
    monitored: [...monitoredGroups],
    phonesPlataforma: phonesPlataforma.size,
    startedAt: STARTED_AT,
  });
});

function anotarBitacora(entry) {
  bitacora.unshift(entry);
  if (bitacora.length > BITACORA_MAX) bitacora.pop();
}

function escHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function htmlBitacora(opts = {}) {
  const verTodo = Boolean(opts.all);
  const filtroActivo = !verTodo && tieneFiltroPlataforma();
  const lista = filtroActivo ? bitacora.filter(esDePlataforma) : bitacora;
  const filas = lista.map((m) => {
    const mapa = m.lat != null && m.lng != null
      ? `<a href="https://www.google.com/maps?q=${m.lat},${m.lng}" target="_blank" rel="noopener">${m.lat.toFixed(5)}, ${m.lng.toFixed(5)}</a>`
      : '—';
    const cuenta = m.cuenta
      ? '<span class="si">entra</span>'
      : `<span class="no">no</span>`;
    return `<tr>
      <td class="hora">${escHtml(m.time)}</td>
      <td>${escHtml(m.name)}<div class="sub">${escHtml(m.phone || 'sin teléfono')}</div></td>
      <td>${escHtml(m.group)}</td>
      <td>${escHtml(m.que)}</td>
      <td>${escHtml(m.text || '—')}</td>
      <td>${mapa}</td>
      <td>${cuenta}<div class="sub">${escHtml(m.motivo || '')}</div></td>
    </tr>`;
  }).join('');
  const desde = new Date(STARTED_AT).toLocaleString('es-AR', { hour12: false, timeZone: 'America/Argentina/Buenos_Aires' });
  const marca = String(process.env.WA_AUTH_DIR || '').replace(/^\.wa_auth_/, '') || `puerto ${PORT}`;
  const resumenFiltro = filtroActivo
    ? `${lista.length} de plataforma · ${bitacora.length} en memoria · ${phonesPlataforma.size} tel. · ${monitoredGroups.size} grupos`
    : `${bitacora.length} en memoria${tieneFiltroPlataforma() ? ' · viendo todos' : ' · sin filtro (abrí Modo Rápido para sync)'}`;
  const linkFiltro = filtroActivo
    ? `<a href="?all=1" style="color:#c7d2fe">ver todos</a>`
    : (tieneFiltroPlataforma()
      ? `<a href="?" style="color:#c7d2fe">solo plataforma</a>`
      : '');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>WA ${escHtml(marca)} · mensajes</title>
<meta http-equiv="refresh" content="20">
<style>
  body{margin:0;font-family:Segoe UI,sans-serif;background:#f8fafc;color:#0f172a}
  header{padding:16px 20px;background:#0f172a;color:#e2e8f0}
  header h1{margin:0;font-size:16px}
  header p{margin:6px 0 0;font-size:12px;color:#94a3b8}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;font-size:11px;letter-spacing:.04em;color:#64748b;padding:8px 10px;border-bottom:1px solid #e2e8f0}
  td{padding:8px 10px;border-bottom:1px solid #e2e8f0;vertical-align:top}
  tr:hover td{background:#eef2ff}
  .hora{font-variant-numeric:tabular-nums;font-weight:700}
  .sub{font-size:11px;color:#64748b;margin-top:2px}
  .si{color:#047857;font-weight:700}.no{color:#b45309;font-weight:700}
  a{color:#4338ca}
  .vacio{padding:28px;color:#64748b}
</style></head><body>
<header>
  <h1>Mensajes de WhatsApp · ${escHtml(marca)}</h1>
  <p>${escHtml(resumenFiltro)} · el bridge arrancó ${escHtml(desde)} · se actualiza solo · la hora no trae el día · ${linkFiltro}${linkFiltro ? ' · ' : ''}<a href="?format=json" style="color:#c7d2fe">JSON</a></p>
</header>
${lista.length ? `<table><thead><tr><th>Hora</th><th>Quién</th><th>Grupo</th><th>Qué mandó</th><th>Texto</th><th>Ubicación</th><th>¿Entra al CC?</th></tr></thead><tbody>${filas}</tbody></table>` : `<p class="vacio">${bitacora.length && filtroActivo ? 'Hay mensajes en memoria, pero ninguno es de un grupo monitoreado ni de un teléfono de la planilla. <a href="?all=1">Ver todos</a> o abrí Modo Rápido para sincronizar.' : 'Todavía no llegó ningún mensaje desde que arrancó este proceso.'}</p>`}
</body></html>`;
}

app.get('/log', (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(htmlBitacora({ all: req.query.all === '1' }));
});

app.get('/messages', (req, res) => {
  const since  = parseInt(req.query.since) || 0;
  const result = since ? messages.filter(m => m.ts > since - 10000) : messages.slice(0, 50);
  const accept = String(req.get('accept') || '');
  // El navegador abre esta URL para leer. Modo Rápido pide JSON (Accept */* o ?since=).
  if (!since && req.query.format !== 'json' && accept.includes('text/html')) {
    res.set('Content-Type', 'text/html; charset=utf-8');
    return res.send(htmlBitacora({ all: req.query.all === '1' }));
  }
  res.json({ messages: result, ts: Date.now(), startedAt: STARTED_AT });
});

app.post('/send', async (req, res) => {
  const { phone, message } = req.body;
  if (!phone || !message) return res.status(400).json({ error: 'phone y message requeridos' });
  if (!sock) return res.status(503).json({ error: 'WhatsApp no conectado aún' });
  try {
    // Misma resolución que /reply: preferir LID conocido (intercambio/cobertura).
    const jid = jidDelGuardia(phone, '');
    if (!jid) return res.status(400).json({ error: 'teléfono inválido' });
    await sock.sendMessage(jid, { text: message });
    console.log(`[send] ✓ → ${jid}: "${String(message).slice(0, 60)}"`);
    res.json({ ok: true, to: jid });
  } catch (e) {
    console.error(`[send] ✗ ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

// La planilla pide responderle al guardia (ej.: presencia confirmada), por mensaje privado.
// El destinatario sale del mensaje original (quotedId) o, si no está, del teléfono recibido.
app.post('/reply', async (req, res) => {
  const { quotedId, phone, text } = req.body || {};
  if (!text || (!quotedId && !phone)) return res.status(400).json({ error: 'text y (quotedId o phone) requeridos' });
  if (!RESPONDER) return res.json({ ok: false, disabled: true });
  const raw = rawMsgs.get(String(quotedId || ''));
  const senderJid = raw?.key?.participant || raw?.participant || '';
  const dest = jidDelGuardia(phone, senderJid);
  if (!dest) return res.json({ ok: false, error: 'sin destinatario' });
  // Varias pestañas de Modo Rápido o ubicación en vivo: no repetir el mismo texto al mismo destino.
  const cuerpo = String(text).slice(0, 500);
  const clave = `${dest}|${cuerpo.slice(0, 120)}`;
  const ahora = Date.now();
  if (ahora - (ultimoAviso.get(clave) || 0) < AVISO_ESPERA) {
    return res.json({ ok: true, deduped: true });
  }
  ultimoAviso.set(clave, ahora);
  const ok = await responderDirecto(dest, cuerpo);
  res.json({ ok });
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
  saveMonitoredGroups();
  console.log(`[monitor] ${enable ? '✓' : '✗'} ${groupId}`);
  res.json({ ok: true, monitored: [...monitoredGroups] });
});

// Endpoint para registrar manualmente un mapeo LID→teléfono
// cuando contacts.upsert no llega (contacto no está en la agenda del celular bridge)
app.post('/lid-map', (req, res) => {
  const { lid, phone } = req.body;
  if (!lid || !phone) return res.status(400).json({ error: 'lid y phone requeridos' });
  const nPhone = normPhone(phone);
  lidToPhone[lid] = nPhone;
  recordarPhonesPlataforma([nPhone]);
  saveLidMap();
  console.log(`[lid-map] Mapeo manual: LID ${lid} → ${nPhone}`);
  res.json({ ok: true, lid, phone: nPhone });
});

// Endpoint para ver el mapa actual
app.get('/lid-map', (req, res) => {
  res.json({ count: Object.keys(lidToPhone).length, map: lidToPhone });
});

// Actualiza el teléfono en todos los LIDs que apuntaban al número viejo
app.post('/remap-phone', (req, res) => {
  const { oldPhone, newPhone } = req.body;
  if (!oldPhone || !newPhone) return res.status(400).json({ error: 'oldPhone y newPhone requeridos' });
  const normOld = normPhone(oldPhone);
  const normNew = normPhone(newPhone);
  if (normOld === normNew) return res.json({ ok: true, updated: 0 });
  let updated = 0;
  for (const [lid, ph] of Object.entries(lidToPhone)) {
    if (ph === normOld) { lidToPhone[lid] = normNew; updated++; }
  }
  if (phonesPlataforma.has(normOld)) {
    phonesPlataforma.delete(normOld);
    phonesPlataforma.add(normNew);
    savePhonesPlataforma();
  } else {
    recordarPhonesPlataforma([normNew]);
  }
  if (updated > 0) saveLidMap();
  console.log(`[remap-phone] ${normOld} → ${normNew}: ${updated} LID(s) actualizados`);
  res.json({ ok: true, updated, oldPhone: normOld, newPhone: normNew });
});

// Sincroniza teléfonos de empleados → LID vía onWhatsApp (sin agenda del celular)
app.post('/sync-phones', async (req, res) => {
  const { phones } = req.body;
  if (!Array.isArray(phones) || phones.length === 0) {
    return res.status(400).json({ error: 'phones[] requerido' });
  }
  if (!sock || !connected) {
    return res.status(503).json({ error: 'WhatsApp no conectado aún' });
  }

  const stats = {
    resolved: 0,
    alreadyKnown: 0,
    notOnWA: 0,
    errors: 0,
    phonesPlataforma: recordarPhonesPlataforma(phones),
  };

  // Procesar en lotes de 10 para no saturar WA
  const BATCH = 10;
  for (let i = 0; i < phones.length; i += BATCH) {
    const batch = phones.slice(i, i + BATCH);
    for (const rawPhone of batch) {
      try {
        const norm = normPhone(rawPhone);
        if (!norm || norm.length < 8) continue;
        const waJid = '549' + norm + '@s.whatsapp.net';
        const results = await sock.onWhatsApp(waJid);
        const result = Array.isArray(results) ? results[0] : results;
        if (!result?.exists) { stats.notOnWA++; continue; }
        const jid = result.jid || '';
        if (jid.includes('@lid')) {
          const lidNum = jid.split('@')[0];
          if (!lidToPhone[lidNum]) {
            lidToPhone[lidNum] = norm;
            stats.resolved++;
            console.log(`  [sync] LID mapeado: ${lidNum} → ${norm}`);
          } else {
            stats.alreadyKnown++;
          }
        } else {
          // Usa JID de teléfono normal (@s.whatsapp.net) — no necesita mapa LID
          stats.alreadyKnown++;
        }
      } catch (e) {
        stats.errors++;
        console.warn(`  [sync] error para ${rawPhone}:`, e.message);
      }
    }
    // Pausa entre lotes para no saturar WA
    if (i + BATCH < phones.length) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  if (stats.resolved > 0) saveLidMap();
  console.log(`[sync-phones] +${stats.resolved} LIDs nuevos, ${stats.alreadyKnown} ya conocidos, ${stats.notOnWA} sin WA, ${stats.errors} errores, +${stats.phonesPlataforma} tel. plataforma`);
  res.json({ ok: true, ...stats, phonesTotal: phonesPlataforma.size });
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
        saveLidMap();
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
      if (msg.key.id && (messages.some(m => m.id === msg.key.id) || bitacora.some(m => m.id === msg.key.id))) continue;

      // Solo grupos marcados en Modo Rápido. Si no hay ninguno, no entra ni se contesta nada.
      if (!monitoredGroups.has(jid)) continue;

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
      if (phone) recordarJidGuardia(phone, senderJid);

      // Cuando WhatsApp renueva la clave del grupo, el mensaje real viaja junto con un
      // senderKeyDistributionMessage (a veces como primera clave). El tipo es el del contenido real;
      // solo si no hay otro contenido es un mensaje de protocolo.
      const clavesMsg       = Object.keys(msg.message || {});
      const msgType         = clavesMsg.find((k) => k !== 'senderKeyDistributionMessage' && k !== 'messageContextInfo')
                           || clavesMsg[0] || '';
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
          anotarBitacora({
            id: proto.id, ts: proto.ts, time: proto.time, name: pushName, phone,
            group: groupName, groupId: jid,
            que: 'Clave del grupo', text: '', cuenta: false, motivo: 'no es un mensaje del guardia',
          });
          console.log(`  [protocol] ${groupName} | ${pushName}: clave WA renovada - pedirle que reenvie`);
        }
        // Ubicación fija o "presente" sin foto. También si lo manda el teléfono vinculado (prueba).
        if (RESPONDER) {
          const dest   = jidDelGuardia(phone, senderJid);
          const nombre = nombrePila(pushName);
          const saludo = nombre ? `Hola ${nombre}, ` : 'Hola, ';
          if (msgType === 'locationMessage') {
            guardarRaw(msg);
            avisarUnaVez(dest, 'estatica',
              `⚠️ ${saludo}la ubicación que enviaste al grupo ${groupName} es una ubicación fija y no sirve para registrar tu ingreso. Enviá tu *ubicación en tiempo real* (Adjuntar → Ubicación → Compartir ubicación en tiempo real) o una *foto*.`);
          } else if (/presente/i.test(text) && msgType !== 'senderKeyDistributionMessage') {
            guardarRaw(msg);
            avisarUnaVez(dest, 'solo-texto',
              `⚠️ ${saludo}para registrar tu ingreso en el grupo ${groupName} enviá una *foto* o tu *ubicación en tiempo real*. El texto solo no alcanza.`);
          }
        }
        const queSkip = msgType === 'locationMessage'
          ? 'Ubicación fija'
          : msgType === 'senderKeyDistributionMessage'
            ? 'Clave del grupo'
            : 'Texto';
        const motivoSkip = msgType === 'locationMessage'
          ? 'el panel solo toma foto o ubicación en vivo'
          : msgType === 'senderKeyDistributionMessage'
            ? 'no es un mensaje del guardia'
            : 'sin foto ni ubicación en vivo';
        anotarBitacora({
          id: msg.key.id,
          ts: ((msg.messageTimestamp || 0) * 1000) || Date.now(),
          time: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }),
          name: pushName,
          phone,
          group: groupName,
          groupId: jid,
          que: queSkip,
          text: String(text || '').slice(0, 140),
          lat: locationData?.lat,
          lng: locationData?.lng,
          cuenta: false,
          motivo: motivoSkip,
        });
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

      anotarBitacora({
        id: entry.id,
        ts: entry.ts,
        time: entry.time,
        name: entry.name,
        phone: entry.phone,
        group: entry.group,
        groupId: entry.groupId,
        que: hasLiveLocation ? 'Ubicación en vivo' : 'Foto',
        text: String(text || '').slice(0, 140),
        lat: locationData?.lat,
        lng: locationData?.lng,
        cuenta: true,
        motivo: 'check-in o salida',
      });
      console.log(`[${entry.time}] [${type}] ${entry.group} | ${entry.name} (${entry.phone}): "${text.slice(0, 60)}"${hasPhoto ? ' 📸' : ''}${hasLocation ? ` 📍(${locationData?.lat?.toFixed(4)},${locationData?.lng?.toFixed(4)})` : ''}`);

      messages.unshift(entry);
      if (messages.length > MAX_MSGS) messages.pop();

      // Acuse corto: la planilla responde el caso (confirmado, lejos, ya presente, sin turno, horario).
      if (RESPONDER) {
        guardarRaw(msg);
        const nombre = nombrePila(pushName);
        avisarUnaVez(jidDelGuardia(phone, senderJid), 'recibido',
          `📥 ${nombre ? `${nombre}, r` : 'R'}ecibimos tu ${hasLiveLocation ? 'ubicación' : 'foto'} del grupo ${groupName}. Te respondemos en un momento.`);
      }
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
