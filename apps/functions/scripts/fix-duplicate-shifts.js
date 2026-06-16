/**
 * fix-duplicate-shifts.js
 * Detecta y elimina documentos duplicados en la colección `turnos`.
 * Un duplicado = mismo employeeId + misma fecha de startTime + mismo objectiveId.
 * Cuando hay >1 doc para esa clave, conserva el más "útil" (PRESENT > COMPLETED > resto)
 * y borra los demás.
 *
 * Uso:
 *   GOOGLE_APPLICATION_CREDENTIALS=./serviceAccount.json node scripts/fix-duplicate-shifts.js
 *   o con ADC:
 *   node scripts/fix-duplicate-shifts.js
 *
 * Flags opcionales (env):
 *   DRY_RUN=1   → solo muestra, no borra
 *   EMPRESA_ID=xxx → filtra por empresa
 */

const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'comtroldata' });
const db = admin.firestore();

const DRY_RUN   = process.env.DRY_RUN === '1';
const EMPRESA_ID = process.env.EMPRESA_ID || null;

// Ventana: últimos 3 días hasta mañana (mismo rango que el monitor de operaciones)
const now   = new Date();
const start = new Date(now); start.setDate(start.getDate() - 3); start.setHours(0, 0, 0, 0);
const end   = new Date(now); end.setDate(end.getDate() + 2);     end.setHours(23, 59, 59, 999);

function getDateStr(ts) {
    if (!ts) return null;
    const d = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000);
    return d.toLocaleDateString('en-CA'); // YYYY-MM-DD en timezone local
}

function statusPriority(data) {
    // Mayor prioridad = conservar ese doc
    if (data.isPresent && !data.isCompleted) return 4;  // PRESENTE activo
    if (data.isPresent && data.isCompleted)  return 3;  // completado con presente
    if (data.isCompleted)                    return 2;  // completado
    if (data.status === 'PRESENT')           return 4;
    if (data.status === 'COMPLETED')         return 2;
    return 1; // PENDING / borrador
}

async function main() {
    console.log(`\n=== fix-duplicate-shifts ${DRY_RUN ? '[DRY RUN]' : '[WRITE MODE]'} ===`);
    console.log(`Ventana: ${start.toISOString().slice(0,10)} → ${end.toISOString().slice(0,10)}`);
    if (EMPRESA_ID) console.log(`Filtrando empresa: ${EMPRESA_ID}`);
    console.log('');

    const snap = await db.collection('turnos')
        .where('startTime', '>=', admin.firestore.Timestamp.fromDate(start))
        .where('startTime', '<=', admin.firestore.Timestamp.fromDate(end))
        .get();

    console.log(`Total turnos cargados: ${snap.docs.length}`);

    // Agrupar por clave compuesta: employeeId_dateStr_objectiveId
    const groups = new Map();
    snap.docs.forEach(d => {
        const data = d.data();
        if (EMPRESA_ID && data.empresaId && data.empresaId !== EMPRESA_ID) return;
        const empId = data.employeeId;
        if (!empId || empId === 'VACANTE') return;
        const dateStr = getDateStr(data.startTime);
        if (!dateStr) return;
        const objId = data.objectiveId || 'unknown';
        const key = `${empId}|${dateStr}|${objId}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ id: d.id, data });
    });

    let duplicateGroups = 0;
    let totalToDelete = 0;
    const batch = db.batch();
    let batchCount = 0;

    for (const [key, docs] of groups.entries()) {
        if (docs.length <= 1) continue;
        duplicateGroups++;

        // Ordenar por prioridad DESC, luego por createdAt DESC (más reciente primero)
        docs.sort((a, b) => {
            const pa = statusPriority(a.data);
            const pb = statusPriority(b.data);
            if (pb !== pa) return pb - pa;
            const ta = a.data.createdAt?.seconds ?? 0;
            const tb = b.data.createdAt?.seconds ?? 0;
            return tb - ta;
        });

        const keep   = docs[0];
        const remove = docs.slice(1);

        const [empId, dateStr, objId] = key.split('|');
        console.log(`DUPLICADO: emp=${empId} fecha=${dateStr} obj=${objId} (${docs.length} docs)`);
        console.log(`  CONSERVAR: ${keep.id} | status=${keep.data.status||'?'} isPresent=${keep.data.isPresent} code=${keep.data.code} pos=${keep.data.positionName}`);
        remove.forEach(r => {
            console.log(`  BORRAR:    ${r.id} | status=${r.data.status||'?'} isPresent=${r.data.isPresent} code=${r.data.code} pos=${r.data.positionName}`);
            if (!DRY_RUN) {
                batch.delete(db.collection('turnos').doc(r.id));
                batchCount++;
                // Firestore batch tiene límite de 500 ops — commit intermedio si hace falta
            }
        });
        totalToDelete += remove.length;
    }

    console.log(`\nResumen: ${duplicateGroups} grupos duplicados, ${totalToDelete} docs a eliminar`);

    if (DRY_RUN) {
        console.log('DRY RUN — no se eliminó nada.');
        return;
    }

    if (totalToDelete === 0) {
        console.log('Nada para eliminar.');
        return;
    }

    if (batchCount > 500) {
        console.error('ERROR: más de 500 operaciones en el batch. Dividí la ejecución por empresa o reducí la ventana.');
        process.exit(1);
    }

    await batch.commit();
    console.log(`✓ Eliminados ${totalToDelete} documentos duplicados.`);
}

main().catch(err => { console.error(err); process.exit(1); });
