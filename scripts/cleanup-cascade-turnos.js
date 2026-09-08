/**
 * cleanup-cascade-turnos.js
 * Limpia turnos OPERATIONS_COVERAGE generados por la cascada sobre objetivos BORRADOR
 * y deduplica múltiples docs del mismo (empleado × objetivo × startTime).
 *
 * Uso:
 *   node scripts/cleanup-cascade-turnos.js [--dry-run] [--empresaId=<id>] [--emulator]
 *
 * --dry-run    Solo reporta, no borra nada.
 * --emulator   Apunta al emulador local (FIRESTORE_EMULATOR_HOST 127.0.0.1:8080).
 * --empresaId  Limitar a una empresa. Sin este flag procesa todas.
 */

'use strict';
const path = require('path');

const DRY_RUN      = process.argv.includes('--dry-run');
const USE_EMULATOR = process.argv.includes('--emulator');
const empresaArg   = (process.argv.find(a => a.startsWith('--empresaId=')) || '').replace('--empresaId=', '').trim();

// ── Inicializar Firebase Admin ─────────────────────────────────────────────────
let db;
if (USE_EMULATOR) {
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  const { initializeApp } = require('firebase-admin/app');
  const { getFirestore }  = require('firebase-admin/firestore');
  initializeApp({ projectId: 'comtroldata' });
  db = getFirestore();
} else {
  const credPath = path.resolve(__dirname, '../service-account.json');
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credPath;
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore }                  = require('firebase-admin/firestore');
  if (!getApps().length) initializeApp({ credential: cert(credPath), projectId: 'comtroldata' });
  db = getFirestore();
}

const { FieldPath } = require('firebase-admin/firestore');

// ── Helpers ────────────────────────────────────────────────────────────────────
async function batchDelete(col, ids) {
  const CHUNK = 400;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const batch = db.batch();
    ids.slice(i, i + CHUNK).forEach(id => batch.delete(db.collection(col).doc(id)));
    await batch.commit();
    process.stdout.write('.');
  }
  process.stdout.write('\n');
}

function toPlanKey(empresaId, objectiveId, startTime) {
  let d;
  if (startTime?.toDate)        d = startTime.toDate();
  else if (startTime?.seconds)  d = new Date(startTime.seconds * 1000);
  else                          d = new Date();
  // Formato real en Firestore: ${empresaId}_${objectiveId}_${year}_${month}
  // Fallback sin empresa para docs legacy
  const prefix = empresaId ? `${empresaId}_` : '';
  return `${prefix}${objectiveId}_${d.getFullYear()}_${d.getMonth() + 1}`;
}

function toMillis(startTime) {
  if (startTime?.toMillis)      return startTime.toMillis();
  if (startTime?.seconds)       return startTime.seconds * 1000;
  return 0;
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function run() {
  console.log(`\n${DRY_RUN ? '🔍 DRY RUN — solo reporte' : '🗑️  LIMPIEZA EN PRODUCCIÓN'}`);
  if (USE_EMULATOR) console.log('   (apuntando al EMULADOR local)');
  if (empresaArg)   console.log(`   Empresa: ${empresaArg}`);
  console.log();

  // 1. Leer todos los turnos OPERATIONS_COVERAGE
  console.log('1. Leyendo turnos OPERATIONS_COVERAGE...');
  let q = db.collection('turnos').where('origin', '==', 'OPERATIONS_COVERAGE');
  if (empresaArg) q = q.where('empresaId', '==', empresaArg);
  const snap = await q.get();
  console.log(`   ${snap.size} docs encontrados\n`);

  if (snap.size === 0) {
    console.log('Nada que limpiar. Saliendo.');
    return;
  }

  // 2. Agrupar por planKey (objectiveId + año + mes)
  const byPlanKey = new Map(); // planKey → [{ id, data }]
  snap.docs.forEach(d => {
    const data = d.data();
    const k = toPlanKey(data.empresaId, data.objectiveId, data.startTime);
    if (!byPlanKey.has(k)) byPlanKey.set(k, []);
    byPlanKey.get(k).push({ id: d.id, data });
  });
  console.log(`2. Grupos objectiveId×mes distintos: ${byPlanKey.size}`);

  // 3. Verificar cuáles tienen planificacion_estados publicado
  const allKeys = Array.from(byPlanKey.keys());
  const publishedKeys = new Set();
  console.log('3. Verificando planificacion_estados...');
  for (let i = 0; i < allKeys.length; i += 30) {
    const chunk = allKeys.slice(i, i + 30);
    const pSnap = await db.collection('planificacion_estados')
      .where(FieldPath.documentId(), 'in', chunk)
      .get();
    pSnap.docs.forEach(d => publishedKeys.add(d.id));
  }
  console.log(`   Publicados: ${publishedKeys.size}  /  BORRADOR: ${allKeys.length - publishedKeys.size}\n`);

  // ── A: eliminar docs de grupos SIN planificacion publicada ───────────────────
  const borradorKeys = allKeys.filter(k => !publishedKeys.has(k));
  const toDeleteBorrador = [];
  borradorKeys.forEach(k => {
    byPlanKey.get(k).forEach(d => toDeleteBorrador.push(d.id));
  });

  // Mostrar muestra de lo que se va a borrar
  if (borradorKeys.length > 0) {
    console.log(`A. Docs de objetivos SIN planificacion publicada → ${toDeleteBorrador.length} turnos a eliminar`);
    borradorKeys.slice(0, 5).forEach(k => {
      const docs = byPlanKey.get(k);
      const s = docs[0].data;
      console.log(`   • ${k} — ${docs.length} docs, ej: emp=${(s.employeeId||'').slice(0,8)} ${s.startTime?.toDate?.()?.toISOString()?.slice(0,16)}`);
    });
    if (borradorKeys.length > 5) console.log(`   ... y ${borradorKeys.length - 5} grupos más`);
    if (!DRY_RUN) {
      process.stdout.write(`   Borrando `);
      await batchDelete('turnos', toDeleteBorrador);
      console.log(`   ✅ Eliminados: ${toDeleteBorrador.length}`);
    } else {
      console.log(`   ⏭  Dry-run: se eliminarían ${toDeleteBorrador.length}`);
    }
  } else {
    console.log('A. Sin docs BORRADOR que eliminar ✅');
  }
  console.log();

  // ── B: deduplicar docs en grupos PUBLICADOS ──────────────────────────────────
  const toDeleteDedup = [];
  let totalPublishedDocs = 0;
  let totalDupGroups = 0;

  publishedKeys.forEach(k => {
    const docs = byPlanKey.get(k) || [];
    totalPublishedDocs += docs.length;

    // Agrupar por (employeeId × startTime_ms) — vacantes se saltan
    const seen = new Map();
    docs.forEach(d => {
      const { employeeId, startTime } = d.data;
      if (!employeeId || employeeId === 'VACANTE') return;
      const ms  = toMillis(startTime);
      const key = `${employeeId}|${ms}`;
      if (!seen.has(key)) {
        seen.set(key, d);
      } else {
        totalDupGroups++;
        const existing = seen.get(key);
        const thisPresent     = d.data.isPresent === true;
        const existingPresent = existing.data.isPresent === true;
        if (!existingPresent && thisPresent) {
          toDeleteDedup.push(existing.id);
          seen.set(key, d);
        } else {
          toDeleteDedup.push(d.id);
        }
      }
    });
  });

  console.log(`B. Docs en objetivos publicados: ${totalPublishedDocs}  |  grupos duplicados: ${totalDupGroups}  |  a eliminar: ${toDeleteDedup.length}`);
  if (toDeleteDedup.length > 0) {
    if (!DRY_RUN) {
      process.stdout.write(`   Borrando `);
      await batchDelete('turnos', toDeleteDedup);
      console.log(`   ✅ Eliminados: ${toDeleteDedup.length}`);
    } else {
      console.log(`   ⏭  Dry-run: se eliminarían ${toDeleteDedup.length}`);
    }
  } else {
    console.log('   ✅ Sin duplicados que eliminar');
  }
  console.log();

  // ── C: deduplicar duplicados de modoDemo (mismo emp × obj × hora, sin importar planning) ──
  // Agrupa TODOS los OPERATIONS_COVERAGE por (objectiveId × employeeId × startHour).
  // Si hay > 1, prefiere el doc con ID determinístico (empieza con "demo_"); si no, el que tiene isPresent.
  const toDeleteDemoDedup = [];
  let demoDupGroups = 0;
  const demoSeen = new Map(); // `${objectiveId}|${employeeId}|${dateDay}|${startH}` → {id, data}

  snap.docs.forEach(d => {
    const { employeeId, objectiveId, startTime } = d.data;
    if (!employeeId || employeeId === 'VACANTE' || !objectiveId) return;
    const ms = toMillis(startTime);
    if (!ms) return;
    const dt = new Date(ms);
    const dateDay = `${dt.getFullYear()}${String(dt.getMonth()+1).padStart(2,'0')}${String(dt.getDate()).padStart(2,'0')}`;
    const startH  = dt.getHours();
    const key = `${objectiveId}|${employeeId}|${dateDay}|${startH}`;

    if (!demoSeen.has(key)) {
      demoSeen.set(key, { id: d.id, data: d.data });
    } else {
      demoDupGroups++;
      const existing = demoSeen.get(key);
      const thisIsDeterministic     = d.id.startsWith('demo_');
      const existingIsDeterministic = existing.id.startsWith('demo_');
      const thisPresent     = d.data.isPresent === true;
      const existingPresent = existing.data.isPresent === true;

      // Prioridad: ID determinístico > isPresent > cualquier otro
      if (thisIsDeterministic && !existingIsDeterministic) {
        toDeleteDemoDedup.push(existing.id);
        demoSeen.set(key, { id: d.id, data: d.data });
      } else if (!thisIsDeterministic && existingIsDeterministic) {
        toDeleteDemoDedup.push(d.id);
      } else if (!existingPresent && thisPresent) {
        toDeleteDemoDedup.push(existing.id);
        demoSeen.set(key, { id: d.id, data: d.data });
      } else {
        toDeleteDemoDedup.push(d.id);
      }
    }
  });

  // Quitar los que ya están en toDeleteBorrador o toDeleteDedup (no borrar dos veces)
  const alreadyMarked = new Set([...toDeleteBorrador, ...toDeleteDedup]);
  const toDeleteDemoDedupFinal = toDeleteDemoDedup.filter(id => !alreadyMarked.has(id));

  console.log(`C. Duplicados modoDemo (emp×obj×hora): ${demoDupGroups} grupos  |  a eliminar: ${toDeleteDemoDedupFinal.length}`);
  if (toDeleteDemoDedupFinal.length > 0) {
    // Mostrar muestra
    toDeleteDemoDedupFinal.slice(0, 5).forEach(id => console.log(`   • ${id}`));
    if (toDeleteDemoDedupFinal.length > 5) console.log(`   ... y ${toDeleteDemoDedupFinal.length - 5} más`);
    if (!DRY_RUN) {
      process.stdout.write(`   Borrando `);
      await batchDelete('turnos', toDeleteDemoDedupFinal);
      console.log(`   ✅ Eliminados: ${toDeleteDemoDedupFinal.length}`);
    } else {
      console.log(`   ⏭  Dry-run: se eliminarían ${toDeleteDemoDedupFinal.length}`);
    }
  } else {
    console.log('   ✅ Sin duplicados modoDemo que eliminar');
  }

  // ── Resumen ──────────────────────────────────────────────────────────────────
  const totalEliminados = DRY_RUN ? 0 : toDeleteBorrador.length + toDeleteDedup.length + toDeleteDemoDedupFinal.length;
  const totalSerían     = toDeleteBorrador.length + toDeleteDedup.length + toDeleteDemoDedupFinal.length;
  console.log('\n── RESUMEN ─────────────────────────────────────────────────────');
  console.log(`   OPERATIONS_COVERAGE leídos        : ${snap.size}`);
  console.log(`   Eliminados (BORRADOR)              : ${DRY_RUN ? `—  (serían ${toDeleteBorrador.length})` : toDeleteBorrador.length}`);
  console.log(`   Eliminados (duplicados publicados) : ${DRY_RUN ? `—  (serían ${toDeleteDedup.length})` : toDeleteDedup.length}`);
  console.log(`   Eliminados (duplicados modoDemo)   : ${DRY_RUN ? `—  (serían ${toDeleteDemoDedupFinal.length})` : toDeleteDemoDedupFinal.length}`);
  console.log(`   Total eliminados                   : ${DRY_RUN ? `—  (serían ${totalSerían})` : totalEliminados}`);
  if (DRY_RUN) console.log('\n   ℹ️  Ejecutá sin --dry-run para aplicar los cambios.');
  console.log();
}

run().catch(e => { console.error(e); process.exit(1); });
