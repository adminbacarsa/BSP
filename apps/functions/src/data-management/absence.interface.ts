import * as admin from 'firebase-admin';

/**
 * Estructura de la entidad Ausencia almacenada en Firestore.
 */
export interface IAbsence {
    id: string; 
    employeeId: string;
    employeeName: string;
    clientId: string; 
    type: 'VACATION' | 'SICK_LEAVE' | 'OTHER'; 
    startDate: admin.firestore.Timestamp; 
    endDate: admin.firestore.Timestamp; 
    reason: string; 
    status: 'PENDING' | 'APPROVED' | 'REJECTED'; 
    createdAt: admin.firestore.Timestamp;
}

/**
 * Payload recibido del Frontend.
 * 🛑 ES CRÍTICO QUE ESTA INTERFAZ TENGA 'export' PARA QUE EL SERVICIO LA VEA.
 */
export interface IAbsencePayload {
    employeeId: string;
    employeeName: string;
    clientId: string;
    type: 'VACATION' | 'SICK_LEAVE' | 'OTHER';
    // Flexible: Timestamp (si viene de otro servicio) o Date (si viene de JSON serializado)
    startDate: admin.firestore.Timestamp | Date; 
    endDate: admin.firestore.Timestamp | Date;
    reason: string;
}



