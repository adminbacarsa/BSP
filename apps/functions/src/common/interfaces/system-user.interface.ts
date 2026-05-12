import * as admin from 'firebase-admin'; // 🛑 SDK SERVIDOR

/**
 * Roles Jerárquicos del Sistema (RBAC):
 * - SuperAdmin: IT / Dueño del SaaS. Ve todas las unidades.
 * - Manager: Gerente de Unidad. Ve todo dentro de su unidad.
 * - Scheduler: Planificador. Gestiona turnos y asignaciones.
 * - Supervisor: Campo. Gestiona incidencias y personal.
 * - Operator: Monitoreo. Solo lectura o vista de tablero en vivo.
 */
export type SystemRole = 
  | 'SuperAdmin' 
  | 'Manager' 
  | 'Scheduler' 
  | 'Supervisor' 
  | 'Operator';

/**
 * @interface ISystemUser
 * @description Usuario administrativo con acceso al Panel de Control (Back-Office).
 * Se almacena en la colección 'system_users'.
 */
export interface ISystemUser {
  uid: string;
  email: string;
  displayName: string;
  role: SystemRole;
  
  // ID de la Unidad de Negocio a la que pertenece
  // Si es undefined y el rol es SuperAdmin, tiene acceso global.
  businessUnitId?: string; 
  
  status: 'Active' | 'Inactive';
  
  // 🛑 IMPORTANTE: En el backend usamos el namespace de admin para Timestamps
  createdAt: admin.firestore.Timestamp;
  lastLogin?: admin.firestore.Timestamp;
}



