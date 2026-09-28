"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OBJETIVO_SIN_CLIENTE = void 0;
exports.resetObjectiveOwnerCache = resetObjectiveOwnerCache;
exports.buildObjectiveOwnerMap = buildObjectiveOwnerMap;
exports.loadObjectiveOwnerMap = loadObjectiveOwnerMap;
exports.planTurnoClientPatch = planTurnoClientPatch;
exports.correctTurnoClientId = correctTurnoClientId;
exports.OBJETIVO_SIN_CLIENTE = 'OBJETIVO_SIN_CLIENTE';
const CACHE_TTL_MS = 5 * 60 * 1000;
const ownerCache = new Map();
function resetObjectiveOwnerCache() {
    ownerCache.clear();
}
function buildObjectiveOwnerMap(docs) {
    const owners = new Map();
    for (const doc of docs) {
        const data = doc.data() || {};
        const raw = data.objetivos || data.objectives || [];
        for (const row of raw) {
            const objectiveId = String(row?.id ?? row?.objectiveId ?? '').trim();
            if (!objectiveId)
                continue;
            const list = owners.get(objectiveId) || [];
            if (!list.includes(doc.id))
                list.push(doc.id);
            owners.set(objectiveId, list);
        }
    }
    return owners;
}
async function loadObjectiveOwnerMap(db, empresaId, now = Date.now()) {
    const empresa = String(empresaId || '').trim();
    if (!empresa)
        return new Map();
    const hit = ownerCache.get(empresa);
    if (hit && now - hit.at < CACHE_TTL_MS)
        return hit.owners;
    const snap = await db.collection('clients').where('empresaId', '==', empresa).get();
    const owners = buildObjectiveOwnerMap(snap.docs);
    ownerCache.set(empresa, { at: now, owners });
    return owners;
}
function planTurnoClientPatch(turno, owners) {
    const empresaId = String(turno.empresaId ?? '').trim();
    const objectiveId = String(turno.objectiveId ?? '').trim();
    if (!empresaId || !objectiveId)
        return null;
    const clientId = String(turno.clientId ?? '').trim();
    const issue = String(turno.integrityIssue ?? '').trim();
    const ownerIds = owners.get(objectiveId) || [];
    if (ownerIds.length === 1) {
        if (clientId === ownerIds[0])
            return null;
        const patch = { clientId: ownerIds[0] };
        if (issue)
            patch.integrityIssue = null;
        return patch;
    }
    if (ownerIds.length === 0) {
        if (issue === exports.OBJETIVO_SIN_CLIENTE)
            return null;
        return { integrityIssue: exports.OBJETIVO_SIN_CLIENTE };
    }
    return null;
}
async function correctTurnoClientId(db, ref, data, writePatch) {
    const empresaId = String(data.empresaId ?? '').trim();
    if (!empresaId)
        return 'noop';
    const owners = await loadObjectiveOwnerMap(db, empresaId);
    const patch = planTurnoClientPatch(data, owners);
    if (!patch)
        return 'noop';
    await ref.update(writePatch(patch));
    return 'updated';
}
//# sourceMappingURL=turnoClientOwner.js.map