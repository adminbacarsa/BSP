/**
 * Limpieza de documentos SLA_VIRTUAL basura en la colección `turnos`.
 *
 * Estos docs son creados por el auto-notificador cuando detecta una vacante.
 * Con el fix aplicado (countsForCoverage excluye SLA_VIRTUAL), ya no son
 * necesarios — y los viejos con horarios incorrectos generan tarjetas fantasma.
 *
 * USO:
 *   npx tsx scripts/cleanup-sla-virtual.ts          → DRY RUN (solo lista)
 *   npx tsx scripts/cleanup-sla-virtual.ts --delete  → BORRA los docs
 *
 * REQUIERE estar autenticado con Firebase CLI:
 *   firebase login  (si no lo hiciste)
 *   export GOOGLE_CLOUD_PROJECT=comtroldata  (o queda del login)
 */

// ⚠️  NO poner FIRESTORE_EMULATOR_HOST → conecta a producción
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

// Inicializar con credenciales de Application Default (Firebase CLI)
if (!getApps().length) {
    initializeApp({ projectId: 'comtroldata' });
}
const db = getFirestore();

const DELETE_MODE = process.argv.includes('--delete');
const EMPRESA_ID = 'pruebas_sa'; // ← cambiar si hay múltiples empresas

async function main() {
    console.log('\n══════════════════════════════════════════');
    console.log(' LIMPIEZA SLA_VIRTUAL — comtroldata');
    console.log(` Empresa: ${EMPRESA_ID}`);
    console.log(` Modo: ${DELETE_MODE ? '🗑️  BORRAR' : '🔍 DRY RUN (solo lista)'}`);
    console.log(' Sin filtro de fecha → borra TODOS los históricos');
    console.log('══════════════════════════════════════════\n');

    // Buscar TODOS los SLA_VIRTUAL sin filtro de fecha.
    // El filtro anterior (últimos 30 días) dejaba pasar docs con startTime nulo
    // o con fechas incorrectas (ej. Rondín con startTime = medianoche).
    const snap = await db.collection('turnos')
        .where('origin', '==', 'SLA_VIRTUAL')
        .where('empresaId', '==', EMPRESA_ID)
        .get();

    if (snap.empty) {
        console.log('✅ No se encontraron documentos SLA_VIRTUAL.\n');
        return;
    }

    const filteredDocs = snap.docs;

    // Agrupar por objectiveName + positionName para mejor visualización
    const byObjective: Record<string, any[]> = {};
    filteredDocs.forEach(doc => {
        const d = doc.data();
        const key = `${d.objectiveName || d.objectiveId} > ${d.positionName}`;
        if (!byObjective[key]) byObjective[key] = [];
        byObjective[key].push({ id: doc.id, ref: doc.ref, ...d });
    });

    let totalCount = 0;
    Object.entries(byObjective).forEach(([key, docs]) => {
        console.log(`📍 ${key}  (${docs.length} doc${docs.length > 1 ? 's' : ''})`);
        docs.forEach(d => {
            const start = d.startTime?.toDate?.()?.toLocaleString('es-AR') ?? '?';
            const end   = d.endTime?.toDate?.()?.toLocaleString('es-AR') ?? '?';
            const emp   = d.employeeName ?? d.employeeId ?? '—';
            const rep   = d.reportedAt?.toDate?.()?.toLocaleString('es-AR') ?? '?';
            console.log(`   [${d.id}]`);
            console.log(`     👤 ${emp}  |  ⏰ ${start} → ${end}`);
            console.log(`     📅 Creado: ${rep}  |  Status: ${d.status}`);
        });
        console.log();
        totalCount += docs.length;
    });

    console.log(`─────────────────────────────────────────`);
    console.log(`Total SLA_VIRTUAL: ${totalCount} docs`);

    if (!DELETE_MODE) {
        console.log('\n💡 Para borrar, corré:');
        console.log('   npx tsx scripts/cleanup-sla-virtual.ts --delete\n');
        return;
    }

    // ── BORRAR ──────────────────────────────────────────────────────────
    console.log('\n⚠️  Borrando en lotes de 500...\n');

    const batchSize = 500;
    const allDocs = filteredDocs;
    let deleted = 0;

    for (let i = 0; i < allDocs.length; i += batchSize) {
        const batch = db.batch();
        const chunk = allDocs.slice(i, i + batchSize);
        chunk.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        deleted += chunk.length;
        console.log(`   ✓ Borrados ${deleted}/${allDocs.length}`);
    }

    console.log(`\n✅ Limpieza completa. ${deleted} documentos eliminados.\n`);
}

main().catch(err => {
    console.error('\n❌ Error:', err.message);
    console.error('   Asegurate de estar autenticado: firebase login\n');
    process.exit(1);
});
