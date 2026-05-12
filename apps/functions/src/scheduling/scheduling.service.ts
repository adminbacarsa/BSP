import { Injectable, BadRequestException } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { IShift } from '../common/interfaces/shift.interface';
import { ShiftOverlapService } from './shift-overlap.service';
import { WorkloadService } from './workload.service';
import * as functions from 'firebase-functions';

const SHIFTS_COLLECTION = 'turnos';
const ABSENCES_COLLECTION = 'ausencias'; 

@Injectable()
export class SchedulingService {
  private getDb = () => admin.app().firestore();

  constructor(
    private readonly overlapService: ShiftOverlapService,
    private readonly workloadService: WorkloadService
  ) {}

  private convertToDate(input: any): Date {
    if (!input) return new Date();
    if (input instanceof admin.firestore.Timestamp) return input.toDate();
    if (typeof input.toDate === 'function') return input.toDate();
    if (input._seconds !== undefined) return new Date(input._seconds * 1000);
    return new Date(input);
  }

  // 1. VALIDACIÓN DE AUSENCIAS (HARD BLOCK) - FIX: Evitar Bloqueo Persistente
  private async checkAbsenceConflict(employeeId: string, shiftStart: Date, shiftEnd: Date): Promise<void> {
      if (employeeId === 'VACANTE') return;

      const db = this.getDb();
      // Traemos TODAS las ausencias activas para el empleado
      const absencesSnap = await db.collection(ABSENCES_COLLECTION)
          .where('employeeId', '==', employeeId)
          .where('status', 'in', ['APPROVED', 'PENDING']) 
          .get();

      if (absencesSnap.empty) return;

      const conflict = absencesSnap.docs.find(doc => {
          const data = doc.data();
          if (data.status === 'REJECTED' || data.status === 'CANCELLED') return false;

          const absStart = this.convertToDate(data.startDate);
          const absEnd = this.convertToDate(data.endDate);

          // 🛑 FIX: Lógica de Overlap. Solo bloquea si el turno intersecta el rango de la licencia.
          if (shiftStart.getTime() < absEnd.getTime() && shiftEnd.getTime() > absStart.getTime()) {
              const type = data.type === 'SICK_LEAVE' ? 'LICENCIA MÉDICA' : 
                           data.type === 'VACATION' ? 'VACACIONES' : 'AUSENCIA';
              throw new functions.https.HttpsError(
                  'failed-precondition', 
                  `⛔ BLOQUEO: El empleado tiene una ${type} vigente en esa fecha.`
              );
          }
          return false;
      });
  }

  // --- CREAR TURNO INDIVIDUAL ---
  async assignShift(shiftData: Partial<IShift> & { authorizeOvertime?: boolean }, userAuth: admin.auth.DecodedIdToken): Promise<IShift> {
    const dbInstance = this.getDb();
    const newShiftRef = dbInstance.collection(SHIFTS_COLLECTION).doc();

    if (!shiftData.startTime || !shiftData.endTime || !shiftData.employeeId || !shiftData.objectiveId) {
        throw new functions.https.HttpsError('invalid-argument', 'Faltan datos requeridos.');
    }
    
    let newStart: Date;
    let newEnd: Date;
    try {
        newStart = this.convertToDate(shiftData.startTime);
        newEnd = this.convertToDate(shiftData.endTime);
    } catch (e) { throw new functions.https.HttpsError('invalid-argument', 'Fecha inválida.'); }
    
    const employeeId = shiftData.employeeId!;
    if (newStart.getTime() >= newEnd.getTime()) throw new BadRequestException('Horario inválido.');

    // 1. VALIDAR AUSENCIAS (Hard Block)
    await this.checkAbsenceConflict(employeeId, newStart, newEnd);

    // 2. VALIDAR CARGA HORARIA (Soft Block)
    let isOvertime = false;
    if (employeeId !== 'VACANTE') {
        try {
            // Llama a la validación que suma correctamente las horas
            await this.workloadService.validateAssignment(employeeId, newStart, newEnd);
        } catch (error: any) {
            if (error.message && (error.message.includes('LÍMITE EXCEDIDO') || error.status === 409)) { 
                if (!shiftData.authorizeOvertime) {
                    // Rebotamos con error específico para activar el diálogo en el frontend
                    throw new functions.https.HttpsError('resource-exhausted', error.message);
                }
                isOvertime = true;
                console.log(`⚠️ Overtime autorizado para ${employeeId}`);
            } else {
                throw error;
            }
        }
    }

    // 3. TRANSACCIÓN FINAL
    try {
      await dbInstance.runTransaction(async (transaction) => {
        if (employeeId !== 'VACANTE') {
            const overlappingQuery = dbInstance.collection(SHIFTS_COLLECTION)
              .where('employeeId', '==', employeeId)
              .where('endTime', '>', newStart) 
              .limit(5); 

            const snapshot = await transaction.get(overlappingQuery);
            const hasOverlap = snapshot.docs.some(doc => {
                const data = doc.data();
                if (data.status === 'Canceled') return false;
                const existStart = this.convertToDate(data.startTime);
                const existEnd = this.convertToDate(data.endTime);
                return this.overlapService.isOverlap(existStart, existEnd, newStart, newEnd);
            });

            if (hasOverlap) throw new functions.https.HttpsError('already-exists', '⛔ El empleado ya tiene OTRO TURNO asignado en este horario.');
        }
        
        const finalShift: IShift = {
          id: newShiftRef.id,
          employeeId,
          objectiveId: shiftData.objectiveId!,
          employeeName: shiftData.employeeName || 'S/D', 
          objectiveName: shiftData.objectiveName || 'S/D',
          startTime: admin.firestore.Timestamp.fromDate(newStart), 
          endTime: admin.firestore.Timestamp.fromDate(newEnd),
          status: 'Assigned',
          schedulerId: userAuth.uid,
          updatedAt: admin.firestore.Timestamp.now(),
          role: (shiftData as any).role || 'Vigilador',
          isOvertime 
        };

        transaction.set(newShiftRef, finalShift);
      });
      
      return { id: newShiftRef.id, ...shiftData } as IShift;

    } catch (error: any) {
        if (error instanceof functions.https.HttpsError) throw error;
        throw new functions.https.HttpsError('internal', error.message);
    }
  }

  // --- EDITAR TURNO ---
  async updateShift(shiftId: string, updateData: Partial<IShift> & { authorizeOvertime?: boolean }): Promise<void> {
      const db = this.getDb();
      const shiftRef = db.collection(SHIFTS_COLLECTION).doc(shiftId);
      
      const currentDoc = await shiftRef.get();
      if (!currentDoc.exists) throw new functions.https.HttpsError('not-found', 'Turno no encontrado');
      const currentShift = currentDoc.data() as IShift;

      const effectiveEmployeeId = updateData.employeeId || currentShift.employeeId;
      const effectiveStart = updateData.startTime ? this.convertToDate(updateData.startTime) : this.convertToDate(currentShift.startTime);
      const effectiveEnd = updateData.endTime ? this.convertToDate(updateData.endTime) : this.convertToDate(currentShift.endTime);

      const isRealEmployee = effectiveEmployeeId !== 'VACANTE';
      const hasChanged = updateData.employeeId !== undefined || updateData.startTime !== undefined || updateData.endTime !== undefined;

      let isOvertime = currentShift.isOvertime || false;

      if (isRealEmployee && hasChanged) {
           // 1. Validar Ausencias
           await this.checkAbsenceConflict(effectiveEmployeeId, effectiveStart, effectiveEnd);

           // 2. Validar Carga
           try {
               await this.workloadService.validateAssignment(effectiveEmployeeId, effectiveStart, effectiveEnd, shiftId);
               if (!updateData.authorizeOvertime) isOvertime = false; 
           } catch (e: any) {
               if (e.message && (e.message.includes('LÍMITE EXCEDIDO') || e.status === 409)) {
                   if (!updateData.authorizeOvertime) {
                       throw new functions.https.HttpsError('resource-exhausted', e.message);
                   }
                   isOvertime = true;
               } else {
                   throw e;
               }
           }
      }

      const safeUpdate: any = { ...updateData };
      delete safeUpdate.id; 
      delete safeUpdate.authorizeOvertime; 

      if (safeUpdate.startTime) safeUpdate.startTime = admin.firestore.Timestamp.fromDate(effectiveStart);
      if (safeUpdate.endTime) safeUpdate.endTime = admin.firestore.Timestamp.fromDate(effectiveEnd);
      
      safeUpdate.updatedAt = admin.firestore.Timestamp.now();
      safeUpdate.isOvertime = isOvertime;
      
      await shiftRef.update(safeUpdate);
  }

  // --- REPLICAR ESTRUCTURA (Lógica Corregida) ---
  async replicateDailyStructure(
    objectiveId: string, 
    sourceDateStr: string, 
    targetStartDateStr: string, 
    targetEndDateStr: string, 
    schedulerId: string,
    targetDays?: number[]
  ): Promise<{ created: number, skipped: number }> {
    const db = this.getDb();
    
    const TZ_OFFSET_HOURS = 3; 
    const sourceDate = new Date(sourceDateStr + 'T00:00:00');
    const startSource = new Date(sourceDate); startSource.setHours(startSource.getHours() + TZ_OFFSET_HOURS);
    const endSource = new Date(startSource); endSource.setHours(startSource.getHours() + 23, 59, 59, 999);

    const sourceShiftsSnap = await db.collection(SHIFTS_COLLECTION)
        .where('objectiveId', '==', objectiveId)
        .where('startTime', '>=', admin.firestore.Timestamp.fromDate(startSource))
        .where('startTime', '<=', admin.firestore.Timestamp.fromDate(endSource))
        .get();

    if (sourceShiftsSnap.empty) throw new functions.https.HttpsError('not-found', 'El día origen no tiene turnos.');

    const sourceShifts = sourceShiftsSnap.docs.map(doc => doc.data() as IShift).filter(s => s.status !== 'Canceled');
    
    const batch = db.batch();
    let opCount = 0;
    let skipped = 0;
    const MAX_BATCH_SIZE = 450; 
    const allowedDays = targetDays && targetDays.length > 0 ? targetDays : [0,1,2,3,4,5,6];

    const startTarget = new Date(targetStartDateStr + 'T00:00:00');
    const endTarget = new Date(targetEndDateStr + 'T00:00:00');
    const loopStart = new Date(startTarget); 
    const loopEnd = new Date(endTarget);

    for (let d = new Date(loopStart); d <= loopEnd; d.setDate(d.getDate() + 1)) {
        if (!allowedDays.includes(d.getDay())) continue;

        const dayStartUTC = new Date(d);
        dayStartUTC.setHours(dayStartUTC.getHours() + TZ_OFFSET_HOURS);
        const dayEndUTC = new Date(dayStartUTC);
        dayEndUTC.setHours(dayStartUTC.getHours() + 23, 59, 59, 999);
        
        const existingCheck = await db.collection(SHIFTS_COLLECTION)
            .where('objectiveId', '==', objectiveId)
            .where('startTime', '>=', admin.firestore.Timestamp.fromDate(dayStartUTC))
            .where('startTime', '<=', admin.firestore.Timestamp.fromDate(dayEndUTC))
            .get();

        if (existingCheck.empty) { skipped++; continue; }

        const existingShifts = existingCheck.docs.map(doc => ({ ref: doc.ref, data: doc.data() as IShift }));
             
        const hasRealEmployees = existingShifts.some(s => s.data.employeeId !== 'VACANTE' && s.data.status !== 'Canceled');
        if (hasRealEmployees) { skipped++; continue; }

        existingShifts.forEach(doc => { batch.delete(doc.ref); opCount++; });

        for (const template of sourceShifts) {
            const tStart = this.convertToDate(template.startTime);
            const tEnd = this.convertToDate(template.endTime);
            
            const msFromStartOfDay = tStart.getTime() - startSource.getTime();
            const durationMs = tEnd.getTime() - tStart.getTime();
            
            const newStart = new Date(dayStartUTC.getTime() + msFromStartOfDay);
            const newEnd = new Date(newStart.getTime() + durationMs);

            const newShiftRef = db.collection(SHIFTS_COLLECTION).doc();
            const newShift: IShift = {
                id: newShiftRef.id,
                objectiveId: objectiveId,
                objectiveName: template.objectiveName,
                employeeId: template.employeeId, 
                employeeName: template.employeeName,
                role: template.role || 'Vigilador',
                startTime: admin.firestore.Timestamp.fromDate(newStart),
                endTime: admin.firestore.Timestamp.fromDate(newEnd),
                status: 'Assigned',
                schedulerId: schedulerId,
                updatedAt: admin.firestore.Timestamp.now()
            };
            
            batch.set(newShiftRef, newShift);
            opCount++;
            if (opCount >= MAX_BATCH_SIZE) break;
        }
        if (opCount >= MAX_BATCH_SIZE) break;
    }

    if (opCount > 0) await batch.commit();
    return { created: opCount, skipped };
  }
  
  async deleteShift(shiftId: string): Promise<void> {
      const db = this.getDb();
      await db.collection(SHIFTS_COLLECTION).doc(shiftId).delete();
  }
}



