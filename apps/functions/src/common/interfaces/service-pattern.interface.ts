import * as admin from 'firebase-admin';

/**
 * @interface IServicePattern (El "Molde" Inteligente)
 * @description Define una regla de recurrencia para generar turnos automáticamente.
 * Ej: "Necesito 2 Vigiladores (Turno Noche) todos los Lunes, Miércoles y Viernes".
 */
export interface IServicePattern {
  id: string;
  contractId: string;      // Vinculado al contrato "Seguridad Planta 2025"
  shiftTypeId: string;     // Usa la modalidad "Turno Noche 12hs"
  
  // Configuración de Recurrencia
  // 0=Dom, 1=Lun, ..., 6=Sab. Ej: [1,2,3,4,5] para Lun-Vie.
  daysOfWeek: number[];    
  
  // Cantidad de recursos requeridos simultáneamente
  quantityPerDay: number;  
  
  // Vigencia de la regla
  validFrom: admin.firestore.Timestamp;
  validTo?: admin.firestore.Timestamp; // Si es null, es indefinido
  
  // Metadatos
  createdAt: admin.firestore.Timestamp;
  createdBy: string; // UID del planificador
  active: boolean;
}

/**
 * Payload para crear/editar un patrón desde el Frontend.
 * Usamos strings para las fechas para evitar problemas de serialización.
 */
export interface IPatternPayload {
  contractId: string;
  shiftTypeId: string;
  daysOfWeek: number[];
  quantity: number;
  validFrom: string; // ISO String
  validTo?: string;  // ISO String
}



