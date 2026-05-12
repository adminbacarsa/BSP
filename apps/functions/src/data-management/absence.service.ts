import { Injectable } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { WorkloadService } from '../scheduling/workload.service';
import { IAbsence, IAbsencePayload } from '../common/interfaces/absence.interface';
import { IShift } from '../common/interfaces/shift.interface';

@Injectable()
export class AbsenceService {
    private getDb = () => admin.app().firestore();
    private readonly absencesCollection = 'ausencias';
    private readonly shiftsCollection = 'turnos';
    
    constructor(private readonly workloadService: WorkloadService) {}

    private toDate(val: any): Date {
        if (!val) return new Date();
        if (val instanceof admin.firestore.Timestamp) return val.toDate();
        if (val._seconds) return new Date(val._seconds * 1000);
        if (typeof val === 'string') return new Date(val);
        return new Date(val);
    }

    async createAbsence(payload: IAbsencePayload): Promise<IAbsence & { impactedShiftsCount: number }> {
        
        // 1. Parsing y FIX de Fechas (Día Completo)
        const startDateObj = this.toDate(payload.startDate);
        const endDateObj = this.toDate(payload.endDate);

        if (isNaN(startDateObj.getTime()) || isNaN(endDateObj.getTime())) {
            throw new Error('Fechas inválidas.');
        }

        // FIX CRÍTICO: Forzar cobertura de Día Completo (00:00 a 23:59:59.999)
        startDateObj.setHours(0, 0, 0, 0);
        endDateObj.setHours(23, 59, 59, 999);

        // 2. DETECCIÓN DE CONFLICTOS
        const conflictingShifts = await this.workloadService.checkShiftOverlap(
            payload.employeeId,
            startDateObj, 
            endDateObj    
        );

        const db = this.getDb();
        const batch = db.batch(); 
        
        const typeReason = payload.type === 'SICK_LEAVE' ? 'Licencia Médica' : 
                           payload.type === 'VACATION' ? 'Vacaciones' : 'Ausencia';
        let shiftsConvertedToVacancy = 0;

        // 🛑 LÓGICA DE CONVERSIÓN A VACANTE (FIX de Mauro)
        if (conflictingShifts.length > 0) {
            console.log(`[AbsenceService] Liberando ${conflictingShifts.length} turnos de ${payload.employeeName}...`);
            
            conflictingShifts.forEach((shift: IShift) => {
                // Solo liberamos turnos que están asignados, y no completados o cancelados
                if (shift.employeeId !== 'VACANTE' && shift.status !== 'Canceled' && shift.status !== 'Completed') {
                    const shiftRef = db.collection(this.shiftsCollection).doc(shift.id);
                    
                    batch.update(shiftRef, {
                        employeeId: 'VACANTE',
                        employeeName: 'VACANTE', 
                        status: 'Assigned', 
                        description: `Turno liberado por: ${typeReason} de ${payload.employeeName}.`, 
                        isOvertime: false, 
                        updatedAt: admin.firestore.Timestamp.now()
                    });
                    shiftsConvertedToVacancy++;
                }
            });
        }

        // 3. Crear la Ausencia
        const startTimestamp = admin.firestore.Timestamp.fromDate(startDateObj);
        const endTimestamp = admin.firestore.Timestamp.fromDate(endDateObj);

        const newAbsence: any = { 
            employeeId: payload.employeeId,
            employeeName: payload.employeeName,
            clientId: payload.clientId,
            type: payload.type,
            startDate: startTimestamp,
            endDate: endTimestamp,     
            reason: payload.reason,
            status: 'APPROVED', 
            createdAt: admin.firestore.Timestamp.now(), 
            impactedShiftsCount: shiftsConvertedToVacancy 
        };

        const newAbsenceRef = db.collection(this.absencesCollection).doc();
        batch.set(newAbsenceRef, newAbsence);

        await batch.commit();

        return { id: newAbsenceRef.id, ...newAbsence, impactedShiftsCount: shiftsConvertedToVacancy };
    }
}



