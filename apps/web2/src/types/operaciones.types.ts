import { Timestamp } from 'firebase/firestore';

// --- ENUMS (Estados permitidos) ---
export type ShiftStatus = 
  | 'PENDING' 
  | 'PRESENT'   // En servicio
  | 'COMPLETED' // Finalizado OK
  | 'ABSENT'    // Ausente
  | 'CANCELED'; // Cancelado administrativo

export type ShiftCondition = 
  | 'LATE' 
  | 'IMMINENT' 
  | 'ENDING' 
  | 'EARLY_ENTRY' 
  | 'NORMAL';

// --- INTERFACES PRINCIPALES ---

export interface IEmployee {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  phone?: string;
  // Agrega aquí otros campos necesarios del maestro de empleados
}

export interface IShift {
  id: string;
  // Relaciones
  employeeId: string;
  employeeName: string;
  clientId: string;
  clientName: string;
  objectiveId: string;
  objectiveName: string;
  
  // Tiempo
  startTime: Timestamp;
  endTime: Timestamp;
  realStartTime?: Timestamp;
  realEndTime?: Timestamp;
  
  // Estado y Lógica
  status: ShiftStatus;
  code?: string; // Ej: 'M', 'T', 'N', 'F'
  isFranco?: boolean;
  
  // Banderas de Novedad
  hasNovedad?: boolean;
  novedadReason?: string;
  
  // Banderas de Cobertura
  isCoverage?: boolean;
  coverageNote?: string;
  relatedAbsentShiftId?: string; // Si cubre a otro turno
  
  // Banderas de Ingreso/Egreso
  isEarlyEntry?: boolean;
  entryNote?: string;
  checkInMethod?: 'MANUAL_RADIO' | 'APP_QR' | 'APP_GEO';
  checkoutMethod?: 'MANUAL_RADIO' | 'APP_QR';
  checkoutNote?: string;
  hasCheckoutNovedad?: boolean;

  // Campos calculados en frontend (no guardar en BD necesariamente, pero útiles en UI)
  shiftDateObj?: Date;
  endDateObj?: Date;
}

export interface IObjective {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
  address?: string;
  lat: string | number;
  lng: string | number;
  // Campos auxiliares para el mapa
  shifts?: IShiftUI[]; 
}

// --- INTERFAZ EXTENDIDA PARA UI (Lo que usa tu componente GuardCard) ---
export interface IShiftUI extends IShift {
  // Banderas calculadas en tiempo real (reloj)
  isLate: boolean;
  isImminent: boolean;
  isEnding: boolean;
  isPresent: boolean;
  isAbsent: boolean;
  isCompleted: boolean;
  phone?: string; // Traído del maestro de empleados
}

export interface IAuditLog {
  action: string;      // Ej: 'INGRESO', 'EGRESO', 'NOVEDAD'
  module: 'OPERACIONES';
  details: string;
  timestamp: any;      // ServerTimestamp
  actorName: string;   // Quién hizo la acción
  actorUid: string;
}