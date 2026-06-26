/**
 * Completa empresaId en turnos RFZ/TURA legacy usando el cliente vinculado.
 *
 * Contexto: algunas solicitudes del portal generaron turnos RFZ/TURA sin empresaId.
 * Planificacion filtra turnos por empresaId, por eso esos refuerzos no aparecen.
 *
 * Uso:
 *   node scripts/backfill-rfz-tura-empresa.js           # dry-run
 *   node scripts/backfill-rfz-tura-empresa.js --apply   # actualiza Firestore
 */
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');
const PROJECT_ID = process.env.GCLOUD_PROJECT || 'comtroldata';
const BATCH_SIZE = 490;

if (!getApps().length) {
  initializeApp({ projectId: PROJECT_ID });
}

const db = getFirestore();

function clean(v) {
  return String(v ?? '').trim();
}

function hasEmpresaId(data) {
  return !!clean(data?.empresaId);
}

async function loadClientEmpresaMap() {
  const map = new Map();

  for (const col of ['clients', 'clientes']) {
    const snap = await db.collection(col).get();
    for (const d of snap.docs) {
      const data = d.data();
      const empresaId = clean(data.empresaId);
      if (!empresaId) continue;
      map.set(d.id, {
        empresaId,
        clientName: clean(data.name || data.razonSocial || data.nombre || d.id),
        source: col,
      });
    }
  }

  return map;
}

async function collectTargets(clientMap) {
  const targets = [];
  const unresolved = [];
  const seen = new Set();

  for (const code of ['RFZ', 'TURA']) {
    const snap = await db.collection('turnos').where('code', '==', code).get();
    for (const d of snap.docs) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      const data = d.data();
      if (hasEmpresaId(data)) continue;

      const clientId = clean(data.clientId);
      const resolved = clientMap.get(clientId);
      const row = {
        id: d.id,
        ref: d.ref,
        code,
        clientId,
        objectiveId: clean(data.objectiveId),
        fecha: clean(data.fecha),
        employeeId: clean(data.employeeId),
        employeeName: clean(data.employeeName),
        currentEmpresaId: clean(data.empresaId),
      };

      if (!clientId || !resolved) {
        unresolved.push(row);
        continue;
      }

      targets.push({
        ...row,
        empresaId: resolved.empresaId,
        clientName: resolved.clientName,
        clientSource: resolved.source,
      });
    }
  }

  targets.sort((a, b) =>
    `${a.empresaId}_${a.clientName}_${a.fecha}_${a.code}`.localeCompare(`${b.empresaId}_${b.clientName}_${b.fecha}_${b.code}`),
  );
  unresolved.sort((a, b) => `${a.fecha}_${a.code}_${a.clientId}`.localeCompare(`${b.fecha}_${b.code}_${b.clientId}`));
  return { targets, unresolved };
}

async function applyTargets(targets) {
  let updated = 0;
  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = targets.slice(i, i + BATCH_SIZE);
    for (const t of chunk) {
      batch.update(t.ref, {
        empresaId: t.empresaId,
        empresaIdBackfilledAt: FieldValue.serverTimestamp(),
        empresaIdBackfilledBy: 'scripts/backfill-rfz-tura-empresa.js',
      });
    }
    await batch.commit();
    updated += chunk.length;
  }
  return updated;
}

async function main() {
  console.log(`\n=== Backfill empresaId RFZ/TURA — ${APPLY ? 'APLICAR' : 'DRY-RUN'} ===`);
  console.log(`Proyecto: ${PROJECT_ID}\n`);

  const clientMap = await loadClientEmpresaMap();
  const { targets, unresolved } = await collectTargets(clientMap);

  if (targets.length === 0 && unresolved.length === 0) {
    console.log('No hay turnos RFZ/TURA legacy sin empresaId.');
    return;
  }

  if (targets.length > 0) {
    console.log(`Turnos a actualizar: ${targets.length}\n`);
    for (const t of targets) {
      console.log(
        `✓ ${t.code} ${t.fecha || '-'} turno=${t.id} cliente="${t.clientName}" (${t.clientId}) → empresaId=${t.empresaId}` +
        `${t.employeeName ? ` guardia="${t.employeeName}"` : ''}`,
      );
    }
  }

  if (unresolved.length > 0) {
    console.log(`\nTurnos omitidos (no se pudo resolver clientId): ${unresolved.length}\n`);
    for (const t of unresolved) {
      console.log(`! ${t.code} ${t.fecha || '-'} turno=${t.id} clientId="${t.clientId || '-'}" objectiveId="${t.objectiveId || '-'}"`);
    }
  }

  if (!APPLY) {
    console.log('\nDry-run: no se escribió nada. Ejecutá con --apply para actualizar.');
    if (unresolved.length > 0) process.exitCode = 1;
    return;
  }

  if (unresolved.length > 0) {
    console.error('\nHay turnos sin clientId resoluble. No aplico cambios para evitar inconsistencias.');
    process.exit(1);
  }

  const updated = await applyTargets(targets);
  console.log(`\nListo. ${updated} turnos RFZ/TURA actualizados.\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
