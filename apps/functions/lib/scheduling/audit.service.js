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
exports.AuditService = void 0;
const common_1 = require("@nestjs/common");
const admin = require("firebase-admin");
const geofencing_service_1 = require("./geofencing.service");
const data_management_service_1 = require("../data-management/data-management.service");
const functions = require("firebase-functions");
const SHIFTS_COLLECTION = 'turnos';
let AuditService = class AuditService {
    constructor(geofencingService, dmService) {
        this.geofencingService = geofencingService;
        this.dmService = dmService;
        this.getDb = () => admin.app().firestore();
    }
    async auditShiftAction(shiftId, action, employeeCoords, actorUid, actorRole, isManualOverride) {
        const dbInstance = this.getDb();
        const shiftRef = dbInstance.collection(SHIFTS_COLLECTION).doc(shiftId);
        return dbInstance.runTransaction(async (transaction) => {
            const shiftDoc = await transaction.get(shiftRef);
            if (!shiftDoc.exists) {
                throw new common_1.BadRequestException('El turno no existe.');
            }
            const shift = shiftDoc.data();
            const isOwner = shift.employeeId === actorUid;
            const isAdminOrOperator = ['admin', 'SuperAdmin', 'Manager', 'Operator', 'Scheduler', 'Supervisor'].includes(actorRole);
            if (!isOwner && !isAdminOrOperator) {
                throw new common_1.ForbiddenException('No tienes permiso para gestionar este turno.');
            }
            const now = admin.firestore.Timestamp.now();
            if (!isManualOverride) {
                if (!isOwner)
                    throw new common_1.ForbiddenException('Solo el empleado asignado puede fichar desde la app.');
                if (action === 'CHECK_IN') {
                    const shiftStartMillis = shift.startTime.toMillis();
                    const diffMinutes = (shiftStartMillis - now.toMillis()) / (1000 * 60);
                    const TOLERANCE = 10;
                    if (diffMinutes > TOLERANCE) {
                        throw new functions.https.HttpsError('failed-precondition', `⏳ Muy temprano. Fichaje habilitado ${TOLERANCE} min antes.`);
                    }
                }
                const objective = await this.dmService.getObjectiveById(shift.objectiveId);
                if (!employeeCoords || !employeeCoords.latitude) {
                    throw new functions.https.HttpsError('invalid-argument', 'Se requiere ubicación GPS.');
                }
                if (!this.geofencingService.isInGeofence(employeeCoords, objective.location)) {
                    console.warn(`[GEOFENCE_FAIL] User ${actorUid} far from objective.`);
                    throw new functions.https.HttpsError('failed-precondition', '📍 Estás demasiado lejos del objetivo. Acércate a la sede.');
                }
            }
            else {
                if (!isAdminOrOperator) {
                    throw new common_1.ForbiddenException('Solo supervisores pueden forzar el fichaje manual.');
                }
                console.log(`[MANUAL_OVERRIDE] Turno ${shiftId} forzado por ${actorUid} (${actorRole})`);
            }
            let newStatus;
            if (action === 'CHECK_IN') {
                if (shift.status !== 'Assigned' && !isManualOverride) {
                    throw new common_1.BadRequestException(`Estado incorrecto para entrada: ${shift.status}`);
                }
                newStatus = 'InProgress';
                shift.checkInTime = now;
            }
            else if (action === 'CHECK_OUT') {
                if (shift.status !== 'InProgress' && !isManualOverride) {
                    throw new common_1.BadRequestException(`El turno no está en curso (Estado: ${shift.status})`);
                }
                newStatus = 'Completed';
                shift.checkOutTime = now;
            }
            else {
                throw new common_1.BadRequestException(`Acción inválida: ${action}`);
            }
            const updateData = {
                status: newStatus,
                updatedAt: now,
                checkInTime: shift.checkInTime,
                checkOutTime: shift.checkOutTime
            };
            if (isManualOverride) {
                updateData.isManualRecord = true;
                updateData.processedBy = actorUid;
                updateData.manualReason = 'Operador Torre de Control';
            }
            transaction.update(shiftRef, updateData);
            return { ...shift, ...updateData };
        });
    }
};
exports.AuditService = AuditService;
exports.AuditService = AuditService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [geofencing_service_1.GeofencingService,
        data_management_service_1.DataManagementService])
], AuditService);
//# sourceMappingURL=audit.service.js.map