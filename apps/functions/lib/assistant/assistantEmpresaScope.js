"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldScopeQueriesToEmpresa = shouldScopeQueriesToEmpresa;
exports.tenantEmpresaIdsMatch = tenantEmpresaIdsMatch;
exports.belongsToEmpresaView = belongsToEmpresaView;
exports.belongsToEmpresa = belongsToEmpresa;
exports.resolveAssistantEmpresaScope = resolveAssistantEmpresaScope;
exports.queryCollectionDocsScoped = queryCollectionDocsScoped;
exports.queryClientsDocsScoped = queryClientsDocsScoped;
exports.queryEmpleadosDocsScoped = queryEmpleadosDocsScoped;
exports.empresaClientIdsSetScoped = empresaClientIdsSetScoped;
exports.turnoRowBelongsToEmpresa = turnoRowBelongsToEmpresa;
function shouldScopeQueriesToEmpresa(empresaId, migracionCompleta) {
    const id = String(empresaId ?? '').trim();
    if (!id)
        return false;
    if (migracionCompleta)
        return true;
    return id.toLowerCase() !== 'bacarsa';
}
function tenantEmpresaIdsMatch(a, b) {
    const norm = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, '_');
    const x = norm(a);
    const y = norm(b);
    return !!x && !!y && x === y;
}
function belongsToEmpresaView(data, empresaId, migracionCompleta) {
    const id = String(empresaId ?? '').trim();
    const docEmp = String(data?.empresaId ?? '').trim();
    if (shouldScopeQueriesToEmpresa(id, migracionCompleta)) {
        if (id.toLowerCase() === 'bacarsa') {
            return !docEmp || tenantEmpresaIdsMatch(docEmp, id);
        }
        return tenantEmpresaIdsMatch(docEmp, id);
    }
    if (id.toLowerCase() === 'bacarsa') {
        return !docEmp || docEmp.toLowerCase() === 'bacarsa';
    }
    return !docEmp || tenantEmpresaIdsMatch(docEmp, id);
}
function belongsToEmpresa(data, empresaId, scopeEmpresa, migracionCompleta = false) {
    if (!scopeEmpresa)
        return true;
    return belongsToEmpresaView(data, empresaId, migracionCompleta);
}
async function resolveAssistantEmpresaScope(db, empresaId) {
    const id = String(empresaId ?? '').trim();
    if (!id)
        return { scopeEmpresa: false, migracionCompleta: false };
    try {
        const snap = await db.collection('empresas').doc(id).get();
        const migracionCompleta = snap.exists && snap.data()?.migracionCompleta === true;
        return {
            migracionCompleta,
            scopeEmpresa: shouldScopeQueriesToEmpresa(id, migracionCompleta),
        };
    }
    catch {
        return {
            migracionCompleta: false,
            scopeEmpresa: shouldScopeQueriesToEmpresa(id, false),
        };
    }
}
async function queryCollectionDocsScoped(db, colName, empresaId, scopeEmpresa, limit) {
    if (scopeEmpresa && String(empresaId ?? '').trim()) {
        return (await db.collection(colName).where('empresaId', '==', String(empresaId).trim()).limit(limit).get()).docs;
    }
    return (await db.collection(colName).limit(limit).get()).docs;
}
async function queryClientsDocsScoped(db, empresaId, scopeEmpresa, limit = 480) {
    return queryCollectionDocsScoped(db, 'clients', empresaId, scopeEmpresa, limit);
}
async function queryEmpleadosDocsScoped(db, empresaId, scopeEmpresa, limit = 900) {
    return queryCollectionDocsScoped(db, 'empleados', empresaId, scopeEmpresa, limit);
}
async function empresaClientIdsSetScoped(db, empresaId, scopeEmpresa) {
    const docs = await queryClientsDocsScoped(db, empresaId, scopeEmpresa, 520);
    return new Set(docs.map((d) => d.id));
}
function turnoRowBelongsToEmpresa(row, empresaId, scopeEmpresa) {
    return belongsToEmpresa(row, empresaId, scopeEmpresa);
}
//# sourceMappingURL=assistantEmpresaScope.js.map