"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AbsenceService = void 0;
const common_1 = require("@nestjs/common");
const admin = require("firebase-admin");
const workload_service_1 = require("../scheduling/workload.service");
let AbsenceService = class AbsenceService {
    constructor(workloadService) {
        this.workloadService = workloadService;
        this.getDb = () => admin.app().firestore();
        this.absencesCollection = 'ausencias';
        this.shiftsCollection = 'turnos';
    }
    toDate(val) {
        if (!val)
            return new Date();
        if (val instanceof admin.firestore.Timestamp)
            return val.toDate();
        if (val._seconds)
            return new Date(val._seconds * 1000);
        if (typeof val === 'string')
            return new Date(val);
        return new Date(val);
    }
    async createAbsence(payload) {
        const startDateObj = this.toDate(payload.startDate);
        const endDateObj = this.toDate(payload.endDate);
        if (isNaN(startDateObj.getTime()) || isNaN(endDateObj.getTime())) {
            throw new Error('Fechas inválidas.');
        }
        startDateObj.setHours(0, 0, 0, 0);
        endDateObj.setHours(23, 59, 59, 999);
        const conflictingShifts = await this.workloadService.checkShiftOverlap(payload.employeeId, startDateObj, endDateObj);
        const db = this.getDb();
        const batch = db.batch();
        const typeReason = payload.type === 'SICK_LEAVE' ? 'Licencia Médica' :
            payload.type === 'VACATION' ? 'Vacaciones' : 'Ausencia';
        let shiftsConvertedToVacancy = 0;
        if (conflictingShifts.length > 0) {
            console.log(`[AbsenceService] Liberando ${conflictingShifts.length} turnos de ${payload.employeeName}...`);
            conflictingShifts.forEach((shift) => {
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
        const startTimestamp = admin.firestore.Timestamp.fromDate(startDateObj);
        const endTimestamp = admin.firestore.Timestamp.fromDate(endDateObj);
        const newAbsence = {
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
};
exports.AbsenceService = AbsenceService;
exports.AbsenceService = AbsenceService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [workload_service_1.WorkloadService])
], AbsenceService);
//# sourceMappingURL=absence.service.js.map