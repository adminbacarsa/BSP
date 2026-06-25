"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateLiquidacionOnTurnoComplete = updateLiquidacionOnTurnoComplete;
const admin = require("firebase-admin");
const turnoHoursCalc_1 = require("./turnoHoursCalc");
let holidaysCache = null;
async function loadHolidays(db) {
    const now = Date.now();
    if (holidaysCache && now - holidaysCache.at < 60 * 60 * 1000) {
        return holidaysCache.set;
    }
    const set = new Set();
    const snap = await db.collection('feriados').limit(400).get();
    snap.forEach((d) => {
        const v = d.data()?.date;
        if (typeof v === 'string')
            set.add(v);
    });
    holidaysCache = { at: now, set };
    return set;
}
async function updateLiquidacionOnTurnoComplete(db, turnoId, after, before) {
    if (!after)
        return;
    if (before?.isCompleted === true && after.isCompleted === true)
        return;
    if (after.isCompleted !== true)
        return;
    const holidays = await loadHolidays(db);
    const contrib = (0, turnoHoursCalc_1.calcTurnoHoursContrib)(after, holidays);
    if (!contrib)
        return;
    const empresaId = String(after.empresaId ?? 'bacarsa').trim() || 'bacarsa';
    const employeeId = String(after.employeeId ?? '').trim();
    if (!employeeId || employeeId === 'VACANTE')
        return;
    const contribRef = db.collection('liquidacion_turno_contrib').doc(turnoId);
    const existing = await contribRef.get();
    if (existing.exists)
        return;
    const monthDocId = `${empresaId}_${contrib.monthKey}`;
    const monthRef = db.collection('liquidacion_mensual').doc(monthDocId);
    const empRef = monthRef.collection('empleados').doc(employeeId);
    const inc = admin.firestore.FieldValue.increment;
    const batch = db.batch();
    batch.set(contribRef, {
        turnoId,
        empresaId,
        employeeId,
        monthKey: contrib.monthKey,
        hsTeoricas: contrib.hsTeoricas,
        hsReales: contrib.hsReales,
        diurnas: contrib.diurnas,
        nocturnas: contrib.nocturnas,
        al100FT: contrib.al100FT,
        plusFeriado: contrib.plusFeriado,
        isFT: contrib.isFT,
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    batch.set(monthRef, {
        empresaId,
        monthKey: contrib.monthKey,
        hsTeoricas: inc(contrib.hsTeoricas),
        hsReales: inc(contrib.hsReales),
        diurnas: inc(contrib.diurnas),
        nocturnas: inc(contrib.nocturnas),
        al100FT: inc(contrib.al100FT),
        plusFeriado: inc(contrib.plusFeriado),
        turnosCompletados: inc(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    batch.set(empRef, {
        employeeId,
        employeeName: after.employeeName || '',
        hsTeoricas: inc(contrib.hsTeoricas),
        hsReales: inc(contrib.hsReales),
        diurnas: inc(contrib.diurnas),
        nocturnas: inc(contrib.nocturnas),
        al100FT: inc(contrib.al100FT),
        plusFeriado: inc(contrib.plusFeriado),
        turnosCompletados: inc(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    await batch.commit();
}
//# sourceMappingURL=updateLiquidacionOnTurnoComplete.js.map