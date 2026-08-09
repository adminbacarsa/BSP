/**
 * Audita bloques «Objetivo sin nombre» de pre-factura.
 *
 * El ID que muestra la UI es el **canónico** (CRM/alias), no siempre el objectiveId crudo del turno.
 * Por eso buscar turnos con objectiveId == id de la grilla suele dar 0.
 *
 * Uso:
 *   node scripts/audit-proforma-objective-ids.js
 *   node scripts/audit-proforma-objective-ids.js --clientId=NS0UBtf6zkHsm2iRRo9W --year=2026 --month=7
 *
 * Emulador:
 *   set FIRESTORE_EMULATOR_HOST=localhost:8080
 */

const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');

const DEFAULT_CANONICAL_IDS = [
  '1qacDotjkCbxp6W4fsqj',
  'ihrxtrt5q5dylsSUMu9M',
  'vb2fmgf2w7u9z1OqPiO7',
];

const KNOWN_ORPHAN_CLIENT_IDS = {
  FzAowOV93fHQcxZhHfjN: 'NS0UBtf6zkHsm2iRRo9W',
};

function getClientIdAliases(canonicalId) {
  const id = String(canonicalId ?? '').trim();
  if (!id) return [];
  const ids = new Set([id]);
  for (const [orphan, target] of Object.entries(KNOWN_ORPHAN_CLIENT_IDS)) {
    if (target === id) ids.add(orphan);
    if (orphan === id) ids.add(target);
  }
  return [...ids];
}

function parseArgs(argv) {
  const out = {
    client: '',
    clientId: '',
    year: 2026,
    month: 7,
    canonicalIds: [],
  };
  for (const a of argv) {
    if (a.startsWith('--client=')) out.client = a.slice(9).trim();
    else if (a.startsWith('--clientId=')) out.clientId = a.slice(11).trim();
    else if (a.startsWith('--year=')) out.year = Number(a.slice(7));
    else if (a.startsWith('--month=')) out.month = Number(a.slice(8));
    else if (!a.startsWith('--')) out.canonicalIds.push(a);
  }
  if (!out.canonicalIds.length) out.canonicalIds = [...DEFAULT_CANONICAL_IDS];
  if (!out.clientId && !out.client) out.client = 'loteria';
  return out;
}

function fallbackObjectiveKey(clientId, objectiveName) {
  return `${clientId}_${objectiveName}`;
}

function registerAlias(aliases, meta, key) {
  const k = String(key || '').trim();
  if (!k) return;
  aliases[k] = meta;
}

function buildObjectiveAliasMap(clientId, objetivos = [], slas = []) {
  const aliases = {};
  for (const obj of objetivos) {
    const canonicalId = String(obj.id || obj.objectiveId || obj.name || '').trim();
    if (!canonicalId) continue;
    const name = String(obj.name || canonicalId).trim();
    const meta = { canonicalId, name, clientId };
    registerAlias(aliases, meta, canonicalId);
    if (obj.id) registerAlias(aliases, meta, obj.id);
    if (obj.name) registerAlias(aliases, meta, obj.name);
    registerAlias(aliases, meta, fallbackObjectiveKey(clientId, name));
  }
  for (const sla of slas) {
    const objName = String(sla.objectiveName ?? '').trim();
    const oid = String(sla.objectiveId ?? '').trim();
    const cid = String(sla.clientId ?? clientId).trim();
    let canonicalId = oid || (objName && cid ? fallbackObjectiveKey(cid, objName) : '');
    if (!canonicalId && sla.id) canonicalId = sla.id;
    if (!canonicalId) continue;
    const existing = aliases[canonicalId] || (oid ? aliases[oid] : undefined);
    const meta = existing || { canonicalId, name: objName || canonicalId, clientId: cid || clientId };
    if (objName && meta.name === canonicalId) meta.name = objName;
    registerAlias(aliases, meta, canonicalId);
    if (oid) registerAlias(aliases, meta, oid);
    if (objName) registerAlias(aliases, meta, objName);
    if (cid && objName) registerAlias(aliases, meta, fallbackObjectiveKey(cid, objName));
    if (sla.id) registerAlias(aliases, meta, sla.id);
  }
  return aliases;
}

function objectiveMatchCandidates(row) {
  const cid = String(row.clientId ?? '').trim();
  const oid = String(row.objectiveId ?? '').trim();
  const name = String(row.objectiveName ?? '').trim();
  const keys = [];
  if (oid) keys.push(oid);
  if (name) keys.push(name);
  if (cid && name) keys.push(fallbackObjectiveKey(cid, name));
  return keys;
}

function resolveCanonicalObjectiveId(row, aliases) {
  for (const key of objectiveMatchCandidates(row)) {
    if (aliases[key]) return aliases[key].canonicalId;
  }
  const oid = String(row.objectiveId ?? '').trim();
  if (oid) return oid;
  const cid = String(row.clientId ?? '').trim();
  const name = String(row.objectiveName ?? '').trim();
  if (cid && name) return fallbackObjectiveKey(cid, name);
  if (name) return name;
  return null;
}

function resolveObjectiveDisplayName(row, aliases) {
  for (const key of objectiveMatchCandidates(row)) {
    if (aliases[key]?.name) return aliases[key].name;
  }
  const name = String(row.objectiveName ?? '').trim();
  if (name) return name;
  return 'Objetivo sin nombre';
}

function toDateSafe(val) {
  if (!val) return null;
  if (typeof val.toDate === 'function') return val.toDate();
  if (typeof val.seconds === 'number') return new Date(val.seconds * 1000);
  if (val instanceof Date) return val;
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? null : d;
}

function scheduleDateKey(t) {
  for (const field of ['scheduleDate', 'planningDate', 'fecha']) {
    const raw = String(t[field] ?? '').trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  }
  const st = toDateSafe(t.startTime);
  if (!st) return null;
  return st.toISOString().slice(0, 10);
}

function shiftBillableHours(t) {
  const code = String(t.code || t.type || '').toUpperCase();
  const non = new Set(['F', 'FF', 'V', 'L', 'A', 'E', 'AA', 'PG', 'RET', 'ESC']);
  if (non.has(code)) return 0;
  const lookup = { M: 8, T: 8, N: 8, D12: 12, N12: 12 };
  if (lookup[code]) return lookup[code];
  const st = toDateSafe(t.startTime);
  const en = toDateSafe(t.endTime);
  if (st && en) {
    let h = (en - st) / 3600000;
    if (h < 0) h += 24;
    if (h > 0 && h <= 24) return h;
  }
  return 8;
}

function normSearch(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '');
}

const DEFAULT_LOTERIA_CLIENT_ID = 'NS0UBtf6zkHsm2iRRo9W';

async function resolveClient(db, args) {
  if (args.clientId) {
    for (const col of ['clients', 'clientes']) {
      const doc = await db.collection(col).doc(args.clientId).get();
      if (doc.exists) return { id: doc.id, data: doc.data(), collection: col };
    }
  }
  const needle = normSearch(args.client);
  const hits = [];
  for (const col of ['clients', 'clientes']) {
    const snap = await db.collection(col).get();
    snap.docs.forEach((d) => {
      const n = normSearch(d.data().name || d.data().fantasyName || '');
      if (!needle || n.includes(needle)) hits.push({ id: d.id, data: d.data(), collection: col });
    });
  }
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    console.log('Varios clientes coinciden con --client:');
    hits.forEach((d) => console.log(' ', d.id, '|', d.data.name || d.data.fantasyName, `(${d.collection})`));
    console.log('Usá --clientId=...\n');
    return null;
  }
  if (normSearch(args.client).includes('loter') && DEFAULT_LOTERIA_CLIENT_ID) {
    for (const col of ['clients', 'clientes']) {
      const doc = await db.collection(col).doc(DEFAULT_LOTERIA_CLIENT_ID).get();
      if (doc.exists) {
        console.log('(Respaldo: cliente Lotería por id conocido', DEFAULT_LOTERIA_CLIENT_ID + ')\n');
        return { id: doc.id, data: doc.data(), collection: col };
      }
    }
  }
  return null;
}

/** IDs que pueden estar guardados en turnos.objectiveId y resuelven al canónico de la UI. */
function rawObjectiveIdsForCanonical(canonicalId, slas, aliases) {
  const raw = new Set([canonicalId]);
  for (const sla of slas) {
    const slaId = String(sla.id ?? '').trim();
    const slaOid = String(sla.objectiveId ?? '').trim();
    if (slaOid === canonicalId && slaId) raw.add(slaId);
    if (slaId === canonicalId) raw.add(slaId);
  }
  for (const [key, meta] of Object.entries(aliases)) {
    if (meta.canonicalId === canonicalId && key !== canonicalId) raw.add(key);
  }
  return [...raw];
}

async function countTurnosByObjectiveIds(db, ids, year, month) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59, 999);
  let total = 0;
  const samples = [];
  for (const oid of ids) {
    if (!oid || oid === '(vacío)') continue;
    const snap = await db
      .collection('turnos')
      .where('objectiveId', '==', oid)
      .where('startTime', '>=', Timestamp.fromDate(start))
      .where('startTime', '<=', Timestamp.fromDate(end))
      .limit(5)
      .get();
    total += snap.size;
    snap.docs.forEach((d) => {
      const t = d.data();
      if (samples.length < 8) {
        samples.push({
          turnoId: d.id,
          rawObjectiveId: t.objectiveId,
          objectiveName: t.objectiveName,
          clientId: t.clientId,
          employeeId: t.employeeId,
          fecha: scheduleDateKey(t),
        });
      }
    });
  }
  return { total, samples };
}

async function loadTurnosForClient(db, clientId, year, month) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59, 999);
  const rangeStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const rangeEnd = `${year}-${String(month).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
  const byId = new Map();
  const aliases = getClientIdAliases(clientId);

  const addIfInRange = (id, data) => {
    const st = toDateSafe(data.startTime);
    const sk = scheduleDateKey(data);
    const inRange =
      (st && st >= start && st <= end) ||
      (sk && sk >= rangeStart && sk <= rangeEnd);
    if (inRange) byId.set(id, { id, ...data });
  };

  for (const cid of aliases) {
    const snap = await db.collection('turnos').where('clientId', '==', cid).get();
    snap.docs.forEach((d) => addIfInRange(d.id, d.data()));
  }

  return [...byId.values()];
}

async function loadSlas(db, clientId) {
  const rows = [];
  for (const cid of getClientIdAliases(clientId)) {
    const snap = await db.collection('servicios_sla').where('clientId', '==', cid).get();
    snap.docs.forEach((d) => rows.push({ id: d.id, ...d.data() }));
  }
  return rows;
}

async function auditDirect(db, objectiveId) {
  const turnoSnap = await db.collection('turnos').where('objectiveId', '==', objectiveId).limit(3).get();
  const countSnap = await db.collection('turnos').where('objectiveId', '==', objectiveId).count().get();
  console.log(`  Búsqueda directa turnos.objectiveId == id: ${countSnap.data().count} docs`);
  if (!turnoSnap.empty) {
    turnoSnap.docs.forEach((d) => {
      const t = d.data();
      console.log(`    raw objectiveId=${t.objectiveId} | name=${t.objectiveName || '—'}`);
    });
  }
}

async function diagnoseDbAccess(db) {
  const [c, t, ce] = await Promise.all([
    db.collection('clients').limit(1).get(),
    db.collection('turnos').limit(1).get(),
    db.collection('clientes').limit(1).get(),
  ]);
  console.log(
    'Diagnóstico Admin SDK:',
    `clients=${c.empty ? 'vacío' : 'OK'}`,
    `| clientes=${ce.empty ? 'vacío' : 'OK'}`,
    `| turnos=${t.empty ? 'vacío' : 'OK'}`,
  );
  if (c.empty && ce.empty && t.empty) {
    console.log(
      '  → Sin lectura de datos. Usá cuenta de servicio de comtroldata:\n' +
        '     set GOOGLE_APPLICATION_CREDENTIALS=ruta\\al\\json-de-service-account.json\n' +
        '     (o gcloud auth application-default login con usuario que tenga acceso al proyecto)\n',
    );
  }
  console.log('');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!getApps().length) {
    initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'comtroldata' });
  }
  const db = getFirestore();

  console.log('Script audit-proforma-objective-ids.js — v2 (agrupación canónica, NO busca solo [SLA]/[CRM])\n');
  console.log('Proyecto:', process.env.GCLOUD_PROJECT || 'comtroldata');
  console.log('Emulador:', process.env.FIRESTORE_EMULATOR_HOST || '(no — producción)');
  console.log('IDs canónicos (UI pre-factura):', args.canonicalIds.join(', '));
  if (args.client) console.log('Cliente (--client):', args.client);
  if (args.clientId) console.log('Cliente (--clientId):', args.clientId);
  console.log('Período:', `${args.month}/${args.year}`);
  console.log('');

  await diagnoseDbAccess(db);

  const client = await resolveClient(db, args);
  if (!client) {
    console.log('No se encontró cliente. Ej: --client=loteria o --clientId=<id>');
    console.log('\nSolo búsqueda directa por objectiveId (suele dar 0 si el ID es canónico):\n');
    for (const id of args.canonicalIds) {
      console.log('---', id);
      await auditDirect(db, id);
    }
    return;
  }

  const clientName = client.data.name || client.data.fantasyName || client.id;
  const objetivos = client.data.objetivos || client.data.objectives || [];
  const slas = await loadSlas(db, client.id);
  const aliases = buildObjectiveAliasMap(client.id, objetivos, slas);
  const turnos = await loadTurnosForClient(db, client.id, args.year, args.month);

  console.log('Cliente:', clientName, `(${client.id})`);
  console.log(`Turnos en ${args.month}/${args.year} (clientId + rango):`, turnos.length);
  console.log('Objetivos en CRM:', objetivos.length, '| SLAs:', slas.length);
  console.log('');

  const groups = new Map();
  for (const t of turnos) {
    const row = { objectiveId: t.objectiveId, objectiveName: t.objectiveName, clientId: client.id };
    const canonical = resolveCanonicalObjectiveId(row, aliases) || String(t.objectiveId || 'sin-id');
    const display = resolveObjectiveDisplayName(row, aliases);
    let g = groups.get(canonical);
    if (!g) {
      g = {
        canonical,
        display,
        rawObjectiveIds: new Set(),
        rawObjectiveNames: new Set(),
        turnoCount: 0,
        hours: 0,
      };
      groups.set(canonical, g);
    }
    g.rawObjectiveIds.add(String(t.objectiveId ?? '').trim() || '(vacío)');
    if (t.objectiveName) g.rawObjectiveNames.add(String(t.objectiveName).trim());
    g.turnoCount += 1;
    g.hours += shiftBillableHours(t);
  }

  const sorted = [...groups.values()].sort((a, b) => b.hours - a.hours);
  console.log('=== Agrupación como pre-factura (canónico → datos crudos en turnos) ===\n');
  for (const g of sorted) {
    const orphan = g.display === 'Objetivo sin nombre' || !objetivos.some((o) => String(o.id) === g.canonical);
    const flag = orphan ? '⚠ HUÉRFANO' : '✓ CRM';
    console.log(`${flag} | canónico: ${g.canonical}`);
    console.log(`       nombre UI: ${g.display}`);
    console.log(`       turnos: ${g.turnoCount} | hs aprox: ${Math.round(g.hours)}`);
    console.log(`       objectiveId en Firestore: ${[...g.rawObjectiveIds].join(' | ')}`);
    console.log(`       objectiveName en Firestore: ${[...g.rawObjectiveNames].join(' | ') || '—'}`);
    console.log('');
  }

  console.log('=== Detalle de los 3 bloques de la captura ===\n');
  for (const target of args.canonicalIds) {
    const g = groups.get(target);
    console.log('--- Canónico (grilla):', target);
    const rawIds = client
      ? rawObjectiveIdsForCanonical(target, slas, aliases)
      : [target];
    console.log('  IDs a buscar en turnos (crudo + SLA/alias):', rawIds.join(', '));
    const { total, samples } = await countTurnosByObjectiveIds(db, rawIds, args.year, args.month);
    console.log('  Turnos en mes con alguno de esos objectiveId (muestra):', total);
    samples.forEach((s) => {
      console.log(
        `    ${s.turnoId.slice(0, 14)}… | raw=${s.rawObjectiveId} | name=${s.objectiveName || '—'} | emp=${s.employeeId} | ${s.fecha}`,
      );
    });
    if (!g) {
      if (!total) await auditDirect(db, target);
      console.log('');
      continue;
    }
    console.log('  objectiveName en turnos:', [...g.rawObjectiveNames].join(' | ') || '—');
    console.log('  objectiveId REAL en turnos (para batch update):', [...g.rawObjectiveIds].join(', '));
    console.log('  turnos:', g.turnoCount, '| hs ~', Math.round(g.hours));
    console.log('');
  }

  console.log(
    'Siguiente paso: re-etiquetar turnos poniendo objectiveId = id del objetivo en CRM y objectiveName = nombre sede.',
  );
  console.log('Listo.\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
