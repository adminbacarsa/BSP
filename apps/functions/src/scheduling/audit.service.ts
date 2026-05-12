import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { GeofencingService } from './geofencing.service';
import { DataManagementService } from '../data-management/data-management.service'; 
import { IShift } from '../common/interfaces/shift.interface';
import * as functions from 'firebase-functions';
import { IObjective } from '../common/interfaces/client.interface'; 

const SHIFTS_COLLECTION = 'turnos';

@Injectable()
export class AuditService {
  
  constructor(
    private readonly geofencingService: GeofencingService,
    private readonly dmService: DataManagementService,
  ) {}

  private getDb = () => admin.app().firestore();

  /**
   * Procesa el fichaje (Check-in/out) validando reglas de negocio, GPS y permisos.
   * Soporta modo "Manual Override" para operadores.
   */
  async auditShiftAction(
    shiftId: string,
    action: 'CHECK_IN' | 'CHECK_OUT',
    employeeCoords: { latitude: number, longitude: number } | null, // Puede ser null en manual
    actorUid: string,
    actorRole: string,          // 🛑 NUEVO: Rol de quien ejecuta
    isManualOverride: boolean   // 🛑 NUEVO: Bandera de fuerza mayor
  ): Promise<IShift> {
    
    const dbInstance = this.getDb();
    const shiftRef = dbInstance.collection(SHIFTS_COLLECTION).doc(shiftId);

    return dbInstance.runTransaction(async (transaction) => {
      const shiftDoc = await transaction.get(shiftRef);

      if (!shiftDoc.exists) {
        throw new BadRequestException('El turno no existe.');
      }

      const shift = shiftDoc.data() as IShift;
      
      // --- VALIDACIÓN DE PERMISOS ---
      const isOwner = shift.employeeId === actorUid;
      const isAdminOrOperator = ['admin', 'SuperAdmin', 'Manager', 'Operator', 'Scheduler', 'Supervisor'].includes(actorRole);

      // Si no es el dueño y no es admin, fuera.
      if (!isOwner && !isAdminOrOperator) {
        throw new ForbiddenException('No tienes permiso para gestionar este turno.');
      }
      
      // --- REGLAS DE NEGOCIO ---
      const now = admin.firestore.Timestamp.now();

      if (!isManualOverride) {
          // MODO ESTÁNDAR (Empleado con Celular)
          
          // 1. Identidad: Solo el asignado puede fichar normal
          if (!isOwner) throw new ForbiddenException('Solo el empleado asignado puede fichar desde la app.');
          
          // 2. Tiempo (Anti-Anticipación)
          if (action === 'CHECK_IN') {
              const shiftStartMillis = shift.startTime.toMillis();
              const diffMinutes = (shiftStartMillis - now.toMillis()) / (1000 * 60);
              const TOLERANCE = 10; // minutos

              if (diffMinutes > TOLERANCE) {
                  throw new functions.https.HttpsError(
                      'failed-precondition', 
                      `⏳ Muy temprano. Fichaje habilitado ${TOLERANCE} min antes.`
                  );
              }
          }

          // 3. Ubicación (Geofence)
          const objective = await this.dmService.getObjectiveById(shift.objectiveId) as IObjective; 
          
          // Validamos que vengan coordenadas
          if (!employeeCoords || !employeeCoords.latitude) {
               throw new functions.https.HttpsError('invalid-argument', 'Se requiere ubicación GPS.');
          }

          if (!this.geofencingService.isInGeofence(employeeCoords, objective.location)) {
            console.warn(`[GEOFENCE_FAIL] User ${actorUid} far from objective.`);
            throw new functions.https.HttpsError(
                'failed-precondition', 
                '📍 Estás demasiado lejos del objetivo. Acércate a la sede.'
            );
          }

      } else {
          // MODO MANUAL (Operador desde Torre de Control)
          
          // 1. Permisos: Solo admins
          if (!isAdminOrOperator) {
              throw new ForbiddenException('Solo supervisores pueden forzar el fichaje manual.');
          }
          
          console.log(`[MANUAL_OVERRIDE] Turno ${shiftId} forzado por ${actorUid} (${actorRole})`);
      }
      
      // --- TRANSICIÓN DE ESTADO ---
      let newStatus: IShift['status'];

      if (action === 'CHECK_IN') {
        // Permitimos re-fichar si estaba en Assigned, o corregir si hubo error
        if (shift.status !== 'Assigned' && !isManualOverride) {
            throw new BadRequestException(`Estado incorrecto para entrada: ${shift.status}`);
        }
        newStatus = 'InProgress';
        shift.checkInTime = now;

      } else if (action === 'CHECK_OUT') {
        if (shift.status !== 'InProgress' && !isManualOverride) {
            throw new BadRequestException(`El turno no está en curso (Estado: ${shift.status})`);
        }
        newStatus = 'Completed';
        shift.checkOutTime = now;

      } else {
        throw new BadRequestException(`Acción inválida: ${action}`);
      }
      
      // --- ACTUALIZACIÓN ---
      const updateData: any = {
          status: newStatus,
          updatedAt: now,
          checkInTime: shift.checkInTime,
          checkOutTime: shift.checkOutTime
      };

      // Si fue manual, dejamos marca de auditoría
      if (isManualOverride) {
          updateData.isManualRecord = true;
          updateData.processedBy = actorUid; // Guardamos quién lo forzó
          updateData.manualReason = 'Operador Torre de Control';
      }

      transaction.update(shiftRef, updateData);

      return { ...shift, ...updateData };
    });
  }
}



