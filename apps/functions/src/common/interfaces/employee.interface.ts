import * as admin from 'firebase-admin';

/**
 * @description Define los roles de usuario dentro del sistema.
 */
export type EmployeeRole = 'admin' | 'employee';

/**
 * @description Define los tipos de contrato laboral soportados.
 */
export type ContractType = 'FullTime' | 'PartTime' | 'Eventual';

/**
 * 🛑 NUEVO: Convenios Colectivos soportados para reglas de negocio.
 */
export type LaborAgreement = 'SUVICO' | 'COMERCIO' | 'UOCRA' | 'FUERA_CONVENIO';

/**
 * @description Interfaz de Colaborador (Versión Backend).
 */
export interface IEmployee {
  uid: string;
  name: string;
  role: EmployeeRole;
  email: string;
  
  isAvailable: boolean;
  
  // Configuración Laboral
  maxHoursPerMonth: number;
  contractType: ContractType;
  
  // 🛑 NUEVO CAMPO: Convenio Colectivo
  laborAgreement?: LaborAgreement; 
  
  // Campos para el Ciclo de Nómina
  payrollCycleStartDay?: number; 
  payrollCycleEndDay?: number;
  
  clientId?: string;
  businessUnitId?: string;

  dni: string;        
  fileNumber: string;
  address: string;    
  phone?: string;
}

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

export interface IAbsencePayload {
    employeeId: string;
    employeeName: string;
    clientId: string;
    type: 'VACATION' | 'SICK_LEAVE' | 'OTHER';
    startDate: admin.firestore.Timestamp | Date | string; 
    endDate: admin.firestore.Timestamp | Date | string;
    reason: string;
}



