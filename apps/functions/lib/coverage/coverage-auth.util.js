"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadDocAndAssertEmpresa = exports.docEmpresaId = exports.assertPanelTenantCallable = void 0;
exports.assertCoverageOpsCallable = assertCoverageOpsCallable;
const panel_tenant_auth_util_1 = require("../auth/panel-tenant-auth.util");
var panel_tenant_auth_util_2 = require("../auth/panel-tenant-auth.util");
Object.defineProperty(exports, "assertPanelTenantCallable", { enumerable: true, get: function () { return panel_tenant_auth_util_2.assertPanelTenantCallable; } });
Object.defineProperty(exports, "docEmpresaId", { enumerable: true, get: function () { return panel_tenant_auth_util_2.docEmpresaId; } });
Object.defineProperty(exports, "loadDocAndAssertEmpresa", { enumerable: true, get: function () { return panel_tenant_auth_util_2.loadDocAndAssertEmpresa; } });
async function assertCoverageOpsCallable(context, empresaId, resourceData) {
    await (0, panel_tenant_auth_util_1.assertPanelTenantCallable)(context, empresaId, resourceData, 'Solo operadores del panel pueden gestionar convocatorias de cobertura.');
}
//# sourceMappingURL=coverage-auth.util.js.map