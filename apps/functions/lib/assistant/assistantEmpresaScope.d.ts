export declare function shouldScopeQueriesToEmpresa(empresaId: string, migracionCompleta: boolean): boolean;
export declare function tenantEmpresaIdsMatch(a: unknown, b: unknown): boolean;
export declare function belongsToEmpresaView(data: {
    empresaId?: unknown;
}, empresaId: string, migracionCompleta: boolean): boolean;
export declare function belongsToEmpresa(data: {
    empresaId?: unknown;
}, empresaId: string, scopeEmpresa: boolean, migracionCompleta?: boolean): boolean;
export declare function resolveAssistantEmpresaScope(db: FirebaseFirestore.Firestore, empresaId: string): Promise<{
    scopeEmpresa: boolean;
    migracionCompleta: boolean;
}>;
export declare function queryCollectionDocsScoped(db: FirebaseFirestore.Firestore, colName: string, empresaId: string, scopeEmpresa: boolean, limit: number): Promise<FirebaseFirestore.QueryDocumentSnapshot[]>;
export declare function queryClientsDocsScoped(db: FirebaseFirestore.Firestore, empresaId: string, scopeEmpresa: boolean, limit?: number): Promise<FirebaseFirestore.QueryDocumentSnapshot[]>;
export declare function queryEmpleadosDocsScoped(db: FirebaseFirestore.Firestore, empresaId: string, scopeEmpresa: boolean, limit?: number): Promise<FirebaseFirestore.QueryDocumentSnapshot[]>;
export declare function empresaClientIdsSetScoped(db: FirebaseFirestore.Firestore, empresaId: string, scopeEmpresa: boolean): Promise<Set<string>>;
export declare function turnoRowBelongsToEmpresa(row: Record<string, unknown>, empresaId: string, scopeEmpresa: boolean): boolean;
