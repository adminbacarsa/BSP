import * as admin from 'firebase-admin';

export interface ILaborAgreement {
    id: string;
    name: string;           // Ej: "Seguridad Privada 422/05"
    code: string;           // Ej: "SUVICO"
    
    // Reglas de Negocio
    maxHoursWeekly: number; // 48
    maxHoursMonthly: number;// 204
    
    // Configuración de Extras
    saturdayCutoffHour: number; // 13
    nightShiftStart: number;    // 21
    nightShiftEnd: number;      // 6
    
    isActive: boolean;
    createdAt?: admin.firestore.Timestamp;
}



