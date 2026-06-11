"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkLlegadaTardeReiterada = checkLlegadaTardeReiterada;
const admin = require("firebase-admin");
async function checkLlegadaTardeReiterada(db, employeeId, employeeName, empresaId, absenceDate) {
    if (!employeeId || !absenceDate)
        return;
    const parts = absenceDate.split('-');
    const year = parts[0];
    const month = parts[1];
    if (!year || !month)
        return;
    const monthStart = `${year}-${month}-01`;
    const monthEnd = `${year}-${month}-31`;
    const snap = await db.collection('ausencias')
        .where('employeeId', '==', employeeId)
        .where('type', '==', 'Llegada Tarde')
        .where('startDate', '>=', monthStart)
        .where('startDate', '<=', monthEnd)
        .get();
    const count = snap.size;
    console.log(`[checkLlegadaTardeReiterada] ${employeeName}: ${count} tardanzas en ${year}-${month}`);
    if (count === 3) {
        const now = admin.firestore.Timestamp.now();
        const existingSnap = await db.collection('novedades')
            .where('type', '==', 'LLEGADA_TARDE_REITERADA')
            .where('employeeId', '==', employeeId)
            .where('month', '==', `${year}-${month}`)
            .limit(1)
            .get();
        if (!existingSnap.empty)
            return;
        await db.collection('novedades').add({
            type: 'LLEGADA_TARDE_REITERADA',
            title: '3ra llegada tarde en el mes',
            description: `${employeeName || 'Empleado'} acumula 3 llegadas tarde en ${month}/${year}`,
            status: 'pending',
            employeeId,
            employeeName: employeeName || '',
            empresaId: empresaId || null,
            month: `${year}-${month}`,
            tardanzaCount: count,
            urgency: 'MEDIUM',
            handledBy: 'RRHH',
            createdAt: now,
            source: 'SISTEMA',
            reportedBy: 'SISTEMA',
        });
        console.log(`[checkLlegadaTardeReiterada] Novedad creada para ${employeeName}`);
    }
}
//# sourceMappingURL=llegadaTardeUtils.js.map