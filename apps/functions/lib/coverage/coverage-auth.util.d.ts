import * as functions from 'firebase-functions/v1';
export { assertPanelTenantCallable, docEmpresaId, loadDocAndAssertEmpresa } from '../auth/panel-tenant-auth.util';
export declare function assertCoverageOpsCallable(context: functions.https.CallableContext, empresaId: string, resourceData?: FirebaseFirestore.DocumentData): Promise<void>;
