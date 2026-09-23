"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.markShiftAbsent = markShiftAbsent;
const firestore_1 = require("firebase-admin/firestore");
function shiftEmpresaId(shift) {
    return String(shift.empresaId || '').trim() || 'bacarsa';
}
function arDateStrFromStartMs(startMs) {
    const arDate = new Date(startMs - 3 * 60 * 60 * 1000);
    return `${arDate.getUTCFullYear()}-${String(arDate.getUTCMonth() + 1).padStart(2, '0')}-${String(arDate.getUTCDate()).padStart(2, '0')}`;
}
function buildHorario(shift, startMs) {
    const st = shift.startTime?.toDate?.() ?? new Date(startMs);
    const etMs = shift.endTime?.toMillis?.() ?? 0;
    const et = etMs ? new Date(etMs) : null;
    const fmtT = (d) => d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Cordoba' });
    return et ? `${fmtT(st)} - ${fmtT(et)}` : fmtT(st);
}
async function markShiftAbsent(db, shiftId, opts) {
    const sid = String(shiftId || '').trim();
    if (!sid)
        return { applied: false };
    const ref = db.collection('turnos').doc(sid);
    const snap = await ref.get();
    if (!snap.exists)
        return { applied: false };
    const shift = snap.data();
    if (shift.isAbsent === true || String(shift.status || '').toUpperCase() === 'ABSENT') {
        if (shift.absenceDetectedAt)
            return { applied: false, alreadyAbsent: true };
    }
    const now = firestore_1.Timestamp.now();
    const startMs = shift.startTime?.toMillis?.() ?? 0;
    const dateStr = startMs ? arDateStrFromStartMs(startMs) : arDateStrFromStartMs(Date.now());
    const horario = startMs ? buildHorario(shift, startMs) : '';
    const reason = opts.reason;
    const detectedBy = reason;
    const actorBy = opts.by || 'SYSTEM';
    await ref.update({
        status: 'ABSENT',
        isAbsent: true,
        absenceType: 'AA',
        absenceDetectedAt: shift.absenceDetectedAt || now,
        absenceDetectedBy: reason,
    });
    const ausSnap = await db.collection('ausencias').where('shiftId', '==', sid).limit(1).get();
    if (ausSnap.empty) {
        await db.collection('ausencias').add({
            employeeId: shift.employeeId || null,
            employeeName: shift.employeeName || '',
            startDate: dateStr,
            endDate: dateStr,
            type: 'No Presentacion',
            absenceType: 'AA',
            origin: reason,
            shiftId: sid,
            objectiveId: shift.objectiveId || null,
            objectiveName: shift.objectiveName || '',
            clientId: shift.clientId || null,
            empresaId: shiftEmpresaId(shift),
            positionName: shift.positionName || '',
            shiftCode: String(shift.code || '').toUpperCase() || null,
            reason: `No presentacion al turno ${horario} - ${shift.objectiveName || ''} (${shift.positionName || ''})`,
            status: 'Confirmada',
            hasCertificate: false,
            createdAt: now,
            source: actorBy,
        });
    }
    const novSnap = await db
        .collection('novedades')
        .where('shiftId', '==', sid)
        .where('type', '==', 'AUSENCIA_AUTO')
        .limit(1)
        .get();
    if (novSnap.empty) {
        const elapsedMin = startMs > 0 ? Math.round((now.toMillis() - startMs) / 60000) : 0;
        await db.collection('novedades').add({
            type: 'AUSENCIA_AUTO',
            status: 'PENDIENTE',
            shiftId: sid,
            employeeId: shift.employeeId || null,
            employeeName: shift.employeeName || '',
            objectiveId: shift.objectiveId || null,
            objectiveName: shift.objectiveName || '',
            clientId: shift.clientId || null,
            empresaId: shiftEmpresaId(shift),
            positionName: shift.positionName || '',
            shiftCode: String(shift.code || '').toUpperCase() || null,
            description: `${shift.employeeName || 'Empleado'} no se presentó — ${String(shift.code || '').toUpperCase() || '—'} ${horario} · ${shift.positionName || 'Puesto'} · ${shift.objectiveName || ''}${elapsedMin ? ` (T+${elapsedMin} min).` : '.'}`,
            createdAt: now,
            source: actorBy,
            absenceReason: reason,
        });
    }
    return { applied: true };
}
//# sourceMappingURL=markShiftAbsent.js.map