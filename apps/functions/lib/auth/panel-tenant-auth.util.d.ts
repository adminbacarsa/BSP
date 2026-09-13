import * as functions from 'firebase-functions/v1';
export declare function docEmpresaId(data: FirebaseFirestore.DocumentData): string;
export declare function assertPanelTenantCallable(context: functions.https.CallableContext, empresaId: string, resourceData?: FirebaseFirestore.DocumentData, deniedMessage?: string): Promise<void>;
export declare function loadDocAndAssertEmpresa(collection: string, docId: string, empresaId: string): Promise<FirebaseFirestore.DocumentData>;
