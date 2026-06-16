/**
 * fix-duplicate-shifts.js
 * Detecta y elimina documentos duplicados en la colección `turnos`.
 * Un duplicado = mismo employeeId + misma fecha de startTime + mismo objectiveId.
 *
 * Uso:
 *   node scripts/fix-duplicate-shifts.js
 *   DRY_RUN=1 node scripts/fix-duplicate-shifts.js   → solo muestra, no borra
 *   EMPLOYEE_NAME=ROMERO node scripts/fix-duplicate-shifts.js  → debug de un empleado
 *   EMPRESA_ID=xxx node scripts/fix-duplicate-shifts.js
 */

const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'comtroldata' });
const db = admin.firestore();

const DRY_RUN      = process.env.DRY_RUN === '1';
const EMPRESA_ID   = process.env.EMPRESA_ID || null;
const EMPLOYEE_NAME = (process.env.EMPLOYEE_NAME || '').toUpperCase(); // ej: ROMERO

// Ventana ampliada: últimos 5 días hasta mañana
const now   = new Date();
const start = new Date(now); start.setDate(start.getDate() - 5); start.setHours(0, 0, 0, 0);
const end   = new Date(now); end.setDate(end.getDate() + 2);     end.setHours(23, 59, 59, 999);

function getDateStr(ts) {
    if (!ts) return null;
    const d = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000);
    return d.toLocaleDateString('en-CA'); // YYYY-MM-DD
}

function statusPriority(data) {
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
    if (EMPRESA_ID)    console.log(`Filtrando empresa: ${EMPRESA_ID}`);
    if (EMPLOYEE_NAME) console.log(`DEBUG empleado: ${EMPLOYEE_NAME}`);
    console.log('');

    const snap = await db.collection('turnos')
        .where('startTime', '>=', admin.firestore.Timestamp.fromDate(start))
        .where('startTime', '<=', admin.firestore.Timestamp.fromDate(end))
        .get();

    console.log(`Total turnos cargados: ${snap.docs.length}`);

    // ── DEBUG: mostrar todos los docs del empleado filtrado ──────────────────
    if (EMPLOYEE_NAME) {
        const found = snap.docs.filter(d => {
            const data = d.data();
            const name = (data.employeeName || data.fullName || data.name || '').toUpperCase();
            const empId = (data.employeeId || '').toUpperCase();
            return name.includes(EMPLOYEE_NAME) || empId.includes(EMPLOYEE_NAME);
        });
        console.log(`\n── Docs para "${EMPLOYEE_NAME}" (${found.length} encontrados) ──`);
        found.forEach(d => {
            const data = d.data();
            const startStr = data.startTime ? getDateStr(data.startTime) : '?';
            const startFull = data.startTime ? data.startTime.toDate().toISOString() : '?';
            console.log(`  ID: ${d.id}`);
            console.log(`    empId=${data.employeeId} empName=${data.employeeName}`);
            console.log(`    startTime=${startFull} (fecha=${startStr})`);
            console.log(`    objectiveId=${data.objectiveId} objName=${data.objectiveName}`);
            console.log(`    code=${data.code} positionName=${data.positionName}`);
            console.log(`    status=${data.status} isPresent=${data.isPresent} isCompleted=${data.isCompleted}`);
            console.log(`    empresaId=${data.empresaId}`);
            console.log('');
        });
        if (!DRY_RUN && found.length === 0) {
            console.log('No se encontraron docs para ese nombre. Terminando.');
            return;
        }
        if (DRY_RUN) {
            console.log('DRY RUN — continuando igual con análisis de duplicados global...\n');
        }
    }

    // ── Agrupar por clave compuesta: employeeId_dateStr_objectiveId ──────────
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

    // ── PASE 2: agrupar también por employeeId+date SIN objectiveId ──────────
    // Captura casos donde el mismo turno fue guardado con objectiveIds distintos
    const groupsNoObj = new Map();
    snap.docs.forEach(d => {
        const data = d.data();
        if (EMPRESA_ID && data.empresaId && data.empresaId !== EMPRESA_ID) return;
        const empId = data.employeeId;
        if (!empId || empId === 'VACANTE') return;
        const dateStr = getDateStr(data.startTime);
        if (!dateStr) return;
        const keyNoObj = `${empId}|${dateStr}`;
        if (!groupsNoObj.has(keyNoObj)) groupsNoObj.set(keyNoObj, []);
        groupsNoObj.get(keyNoObj).push({ id: d.id, data });
    });

    // Detectar casos sospechosos (mismo emp+fecha, múltiples objectiveIds distintos)
    for (const [keyNoObj, docs] of groupsNoObj.entries()) {
        if (docs.length <= 1) continue;
        const objIds = [...new Set(docs.map(d => d.data.objectiveId || 'unknown'))];
        if (objIds.length > 1) {
            const [empId, dateStr] = keyNoObj.split('|');
            console.log(`⚠️  CROSS-OBJ DUPLICADO: emp=${empId} fecha=${dateStr} — objectiveIds distintos: ${objIds.join(', ')}`);
            docs.forEach(d => {
                console.log(`    ${d.id} | obj=${d.data.objectiveId} code=${d.data.code} pos=${d.data.positionName} status=${d.data.status}`);
            });
        }
    }

    let duplicateGroups = 0;
    let totalToDelete = 0;
    const toDelete = [];

    for (const [key, docs] of groups.entries()) {
        if (docs.length <= 1) continue;
        duplicateGroups++;

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
        console.log(`  CONSERVAR: ${keep.id} | status=${keep.data.status||'?'} isPresent=${keep.data.isPresent} code=${keep.data.code}`);
        remove.forEach(r => {
            console.log(`  BORRAR:    ${r.id} | status=${r.data.status||'?'} isPresent=${r.data.isPresent} code=${r.data.code}`);
            toDelete.push(db.collection('turnos').doc(r.id));
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

    // Batch en grupos de 450 para no exceder límite de 500
    const BATCH_SIZE = 450;
    for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
        const batch = db.batch();
        toDelete.slice(i, i + BATCH_SIZE).forEach(ref => batch.delete(ref));
        await batch.commit();
        console.log(`✓ Batch ${Math.floor(i/BATCH_SIZE)+1}: eliminados ${Math.min(BATCH_SIZE, toDelete.length - i)} docs`);
    }
    console.log(`✓ Total eliminados: ${totalToDelete} documentos duplicados.`);
}

main().catch(err => { console.error(err); process.exit(1); });
