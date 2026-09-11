export type PresenciaSource = 'PORTAL_GPS' | 'OPERATIONS' | 'VIGI' | 'DEMO' | 'MANUAL_RADIO' | 'MANUAL_PHONE';
export type RegistrarPresenciaInput = {
    shiftId: string;
    source: PresenciaSource;
    empId?: string | null;
    operatorUid?: string | null;
    actorName?: string | null;
    coords?: {
        lat?: number;
        lng?: number;
    } | null;
    recordedAt?: string | null;
    overrideRelieveShiftId?: string | null;
    skipAutoRelevo?: boolean;
};
export type RegistrarPresenciaResult = {
    success: true;
    alreadyPresent?: boolean;
    relieved: {
        shiftId: string;
        employeeId: string;
        employeeName: string;
    } | null;
};
export declare function registrarPresencia(db: FirebaseFirestore.Firestore, input: RegistrarPresenciaInput): Promise<RegistrarPresenciaResult>;
