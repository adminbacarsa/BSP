import * as admin from 'firebase-admin';
export type EmployeeRole = 'admin' | 'employee';
export type ContractType = 'FullTime' | 'PartTime' | 'Eventual';
export type LaborAgreement = 'SUVICO' | 'COMERCIO' | 'UOCRA' | 'FUERA_CONVENIO';
export interface IEmployee {
    uid: string;
    name: string;
    role: EmployeeRole;
    email: string;
    isAvailable: boolean;
    maxHoursPerMonth: number;
    contractType: ContractType;
    laborAgreement?: LaborAgreement;
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
