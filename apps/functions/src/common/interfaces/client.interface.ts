import * as admin from 'firebase-admin';

/**
 * @interface IClient
 * @description La empresa o entidad que contrata nuestros servicios de seguridad/personal.
 * Es la entidad raíz de la jerarquía comercial.
 */
export interface IClient {
  id: string;
  /** Razón Social o Nombre Comercial */
  businessName: string; 
  /** Identificación Fiscal (CUIT/RUT/NIT) */
  cuit: string;         
  /** Nombre del contacto principal */
  contactName: string;
  /** Email del contacto para notificaciones automáticas */
  contactEmail: string;
  /** Estado administrativo del cliente */
  status: 'Active' | 'Inactive' | 'Suspended';
  /** Fecha de alta en el sistema */
  createdAt: admin.firestore.Timestamp;
}

/**
 * @interface IObjective
 * @description El lugar físico, sucursal o puesto donde se presta el servicio.
 * Pertenece a un Cliente.
 */
export interface IObjective {
  id: string;
  /** ID del Cliente al que pertenece (Foreign Key) */
  clientId: string; 
  /** Nombre del objetivo (Ej: "Planta Industrial Pilar") */
  name: string;     
  /** Dirección física real */
  address: string;
  /** Coordenadas para el Geofencing (Check-in/out) */
  location: {
    latitude: number;
    longitude: number;
  };
  /** Zonas internas (opcional). Ej: ["Garita 1", "Recepción", "Ronda"] */
  zones?: string[]; 
}

/**
 * @interface IServiceContract
 * @description Define el acuerdo de nivel de servicio (SLA) para un Objetivo.
 * Establece cuántas horas se vendieron y en qué período.
 */
export interface IServiceContract {
  id: string;
  /** ID del Objetivo asociado (Foreign Key) */
  objectiveId: string; 
  /** Nombre del servicio (Ej: "Seguridad 24x7 - 2025") */
  name: string;        
  startDate: admin.firestore.Timestamp;
  endDate?: admin.firestore.Timestamp; // Opcional si es indeterminado
  /** Objetivo de venta mensual en horas (para reportes de rentabilidad) */
  totalHoursPerMonth: number; 
  isActive: boolean;
}

/**
 * @interface IShiftType (Modalidad)
 * @description Plantilla de turno para agilizar la planificación.
 * Define los "moldes" que se arrastrarán al calendario.
 */
export interface IShiftType {
  id: string;
  /** ID del Contrato al que pertenece esta modalidad (Foreign Key) */
  contractId: string; 
  /** Nombre descriptivo (Ej: "Turno Tarde 8hs") */
  name: string;       
  /** Código corto para visualización en calendario (Ej: "T8") */
  code: string;       
  /** Color hexadecimal para diferenciar en el calendario (Ej: "#FF5733") */
  color: string;      
  
  // Configuración del Horario Base
  /** Hora de inicio sugerida en formato "HH:mm" (Ej: "14:00") */
  startTime: string;     
  /** Duración en horas para cálculo de costos (Ej: 8) */
  durationHours: number; 
  
  /** Requisitos específicos (Opcional). Ej: "Vigilador Armado", "Chofer" */
  requiredRole?: string; 
}



