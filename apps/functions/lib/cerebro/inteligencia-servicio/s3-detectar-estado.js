"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectarEstadoServicio = detectarEstadoServicio;
exports.detectarEstadoDesdeMemoria = detectarEstadoDesdeMemoria;
async function detectarEstadoServicio(db, objetivoId, yearMonth) {
    const snap = await db.collection('turnos')
        .where('objectiveId', '==', objetivoId)
        .where('draft', '!=', true)
        .get();
    const turnosMes = snap.docs.filter(d => {
        const st = d.data().startTime;
        return typeof st === 'string' && st.startsWith(yearMonth);
    });
    const empleadosSet = new Set();
    const posicionesSet = new Set();
    let ultimaFecha;
    for (const doc of turnosMes) {
        const data = doc.data();
        if (data.employeeId)
            empleadosSet.add(data.employeeId);
        if (data.positionName)
            posicionesSet.add(data.positionName);
        const fecha = typeof data.startTime === 'string' ? data.startTime.slice(0, 10) : undefined;
        if (fecha && (!ultimaFecha || fecha > ultimaFecha))
            ultimaFecha = fecha;
    }
    return {
        esNuevo: turnosMes.length === 0,
        turnosExistentes: turnosMes.length,
        empleadosAsignados: [...empleadosSet],
        posicionesCubiertas: [...posicionesSet],
        ultimaFechaGeneracion: ultimaFecha,
    };
}
function detectarEstadoDesdeMemoria(turnos, objetivoId, yearMonth) {
    const turnosMes = turnos.filter(t => t.objectiveId === objetivoId && !t.draft && t.startTime.startsWith(yearMonth));
    const empleadosSet = new Set();
    const posicionesSet = new Set();
    let ultimaFecha;
    for (const t of turnosMes) {
        if (t.employeeId)
            empleadosSet.add(t.employeeId);
        if (t.positionName)
            posicionesSet.add(t.positionName);
        const fecha = t.startTime.slice(0, 10);
        if (!ultimaFecha || fecha > ultimaFecha)
            ultimaFecha = fecha;
    }
    return {
        esNuevo: turnosMes.length === 0,
        turnosExistentes: turnosMes.length,
        empleadosAsignados: [...empleadosSet],
        posicionesCubiertas: [...posicionesSet],
        ultimaFechaGeneracion: ultimaFecha,
    };
}
//# sourceMappingURL=s3-detectar-estado.js.map