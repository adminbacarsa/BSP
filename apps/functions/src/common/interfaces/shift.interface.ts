import * as admin from 'firebase-admin';

export interface IShift {
  id: string;
  
  // Relación con Empleado
  employeeId: string;
  employeeName: string;
  
  // Relación con Objetivo
  objectiveId: string;
  objectiveName: string;
  
  // Tiempos (Firestore Admin SDK)
  startTime: admin.firestore.Timestamp; 
  endTime: admin.firestore.Timestamp;
  
  // Estado
  status: 'Assigned' | 'Confirmed' | 'InProgress' | 'Completed' | 'Canceled';
  
  // Auditoría de Fichaje
  checkInTime?: admin.firestore.Timestamp;
  checkOutTime?: admin.firestore.Timestamp;
  
  // Metadatos
  schedulerId: string;
  updatedAt: admin.firestore.Timestamp;
  
  // Roles y Flags
  role?: string;           // Ej: 'Vigilador'
  isOvertime?: boolean;    // 🛑 NUEVO: Indica si el turno fue autorizado con exceso de horas
}



