"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.INTEGRITY_SAMPLE_CAP = void 0;
exports.classifyTurnoFindings = classifyTurnoFindings;
exports.slaClientIsMissing = slaClientIsMissing;
exports.emptyIntegrityCounts = emptyIntegrityCounts;
exports.pushSample = pushSample;
exports.totalFindings = totalFindings;
exports.arDateKey = arDateKey;
exports.integrityReportId = integrityReportId;
exports.scanLoadedEmpresa = scanLoadedEmpresa;
exports.integrityNovedadDescription = integrityNovedadDescription;
function classifyTurnoFindings(turno, clientsById, objectiveIdsOfEmpresa) {
    const out = [];
    const empresaId = String(turno.empresaId ?? '').trim();
    const clientId = String(turno.clientId ?? '').trim();
    const objectiveId = String(turno.objectiveId ?? '').trim();
    if (!clientId) {
        out.push('turnoClienteInexistente');
    }
    else {
        const client = clientsById.get(clientId);
        if (!client || !client.exists)
            out.push('turnoClienteInexistente');
        else if (String(client.empresaId || '').trim() !== empresaId)
            out.push('turnoEmpresaDistinta');
    }
    if (!objectiveId || !objectiveIdsOfEmpresa.has(objectiveId)) {
        out.push('turnoObjetivoInexistente');
    }
    return out;
}
function slaClientIsMissing(clientId, clientsById) {
    const id = String(clientId ?? '').trim();
    if (!id)
        return true;
    const client = clientsById.get(id);
    return !client || !client.exists;
}
exports.INTEGRITY_SAMPLE_CAP = 40;
function emptyIntegrityCounts() {
    return {
        turnoClienteInexistente: 0,
        turnoObjetivoInexistente: 0,
        turnoEmpresaDistinta: 0,
        slaClienteInexistente: 0,
    };
}
function pushSample(list, id) {
    if (list.length >= exports.INTEGRITY_SAMPLE_CAP)
        return;
    if (!list.includes(id))
        list.push(id);
}
function totalFindings(counts) {
    return (counts.turnoClienteInexistente +
        counts.turnoObjetivoInexistente +
        counts.turnoEmpresaDistinta +
        counts.slaClienteInexistente);
}
function arDateKey(d = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Argentina/Buenos_Aires',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(d);
}
function integrityReportId(empresaId, date = arDateKey()) {
    return `${String(empresaId).trim()}_${date}`;
}
function scanLoadedEmpresa(input) {
    const counts = emptyIntegrityCounts();
    const samples = {
        turnoClienteInexistente: [],
        turnoObjetivoInexistente: [],
        turnoEmpresaDistinta: [],
        slaClienteInexistente: [],
    };
    for (const turno of input.turnos) {
        const findings = classifyTurnoFindings(turno, input.clientsById, input.objectiveIds);
        for (const kind of findings) {
            counts[kind] += 1;
            pushSample(samples[kind], turno.id);
        }
    }
    for (const sla of input.slas) {
        if (!slaClientIsMissing(sla.clientId, input.clientsById))
            continue;
        counts.slaClienteInexistente += 1;
        pushSample(samples.slaClienteInexistente, sla.id);
    }
    return {
        empresaId: input.empresaId,
        date: input.date,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        generatedAt: input.generatedAt,
        counts,
        samples,
        totalFindings: totalFindings(counts),
        mode: 'report_only',
    };
}
function integrityNovedadDescription(reportId, counts) {
    const n = totalFindings(counts);
    return (`Integridad de datos (${reportId}): ${n} hallazgo(s). ` +
        `Turnos sin cliente ${counts.turnoClienteInexistente}, ` +
        `objetivo inexistente ${counts.turnoObjetivoInexistente}, ` +
        `empresa distinta ${counts.turnoEmpresaDistinta}, ` +
        `SLA sin cliente ${counts.slaClienteInexistente}. ` +
        'Solo informe: no se corrigió ningún documento.');
}
//# sourceMappingURL=integrityClassify.js.map