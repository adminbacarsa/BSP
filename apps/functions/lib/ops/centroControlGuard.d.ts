export declare function isCentroControlEnabled(data: FirebaseFirestore.DocumentData | undefined): boolean;
export declare function loadCentroControlState(db: FirebaseFirestore.Firestore): Promise<{
    anyEnabled: boolean;
    isEnabled: (empresaId: string | null | undefined) => boolean;
}>;
