import * as functions from 'firebase-functions/v1';
import { assertPanelTenantCallable } from '../auth/panel-tenant-auth.util';

export { assertPanelTenantCallable, docEmpresaId, loadDocAndAssertEmpresa } from '../auth/panel-tenant-auth.util';

export async function assertCoverageOpsCallable(
  context: functions.https.CallableContext,
  empresaId: string,
  resourceData?: FirebaseFirestore.DocumentData,
): Promise<void> {
  await assertPanelTenantCallable(
    context,
    empresaId,
    resourceData,
    'Solo operadores del panel pueden gestionar convocatorias de cobertura.',
  );
}
