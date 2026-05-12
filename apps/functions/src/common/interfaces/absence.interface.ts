import * as admin from 'firebase-admin';

export type AbsenceType = 'VACATION' | 'SICK_LEAVE' | 'OTHER';

export interface IAbsence {
  id: string;
  employeeId: string;
  employeeName: string; // 🛑 Campo necesario para la UI
  clientId: string;
  type: AbsenceType;
  startDate: admin.firestore.Timestamp;
  endDate: admin.firestore.Timestamp;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: admin.firestore.Timestamp;
}

// 🛑 ESTA EXPORTACIÓN ES CRÍTICA PARA EL SERVICIO
export interface IAbsencePayload {
  employeeId: string;
  employeeName: string;
  clientId: string;
  type: AbsenceType;
  // Flexible para aceptar Dates del frontend o Timestamps internos
  startDate: admin.firestore.Timestamp | Date;
  endDate: admin.firestore.Timestamp | Date;
  reason: string;
}



