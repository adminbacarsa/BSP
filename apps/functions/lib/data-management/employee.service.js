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
exports.EmployeeService = void 0;
const common_1 = require("@nestjs/common");
const admin = require("firebase-admin");
const workload_service_1 = require("../scheduling/workload.service");
const COLL_EMPLOYEES = 'empleados';
let EmployeeService = class EmployeeService {
    constructor(workloadService) {
        this.workloadService = workloadService;
        this.getDb = () => admin.app().firestore();
        this.getAuth = () => admin.app().auth();
    }
    async findAllEmployees(clientId) {
        try {
            let query = this.getDb().collection(COLL_EMPLOYEES);
            if (clientId) {
                query = query.where('clientId', '==', clientId);
            }
            const snapshot = await query.get();
            return snapshot.docs.map(doc => doc.data());
        }
        catch (error) {
            console.error('[GET_EMPLOYEES_ERROR]', error);
            throw new common_1.InternalServerErrorException('Error al obtener la lista de empleados.');
        }
    }
    async getEmployeeWorkload(uid, month, year) {
        const report = await this.workloadService.getWorkloadReport(uid, month, year);
        return report;
    }
    async updateEmployee(uid, data) {
        const db = this.getDb();
        const auth = this.getAuth();
        const ref = db.collection(COLL_EMPLOYEES).doc(uid);
        const doc = await ref.get();
        if (!doc.exists) {
            throw new common_1.NotFoundException('Empleado no encontrado.');
        }
        const updateData = { ...data };
        if (updateData.payrollCycleStartDay !== undefined)
            updateData.payrollCycleStartDay = Number(updateData.payrollCycleStartDay);
        if (updateData.payrollCycleEndDay !== undefined)
            updateData.payrollCycleEndDay = Number(updateData.payrollCycleEndDay);
        delete updateData.uid;
        delete updateData.email;
        await ref.update(updateData);
        if (data.role) {
            try {
                await auth.setCustomUserClaims(uid, { role: data.role });
            }
            catch (e) {
                console.error(`Error actualizando claims para ${uid}`, e);
            }
        }
    }
    async deleteEmployee(uid) {
        try {
            try {
                await this.getAuth().deleteUser(uid);
            }
            catch (e) {
                if (e.code !== 'auth/user-not-found')
                    throw e;
            }
            const snap = await this.getDb().collection(COLL_EMPLOYEES).where('uid', '==', uid).get();
            const batch = this.getDb().batch();
            snap.docs.forEach(d => batch.delete(d.ref));
            batch.delete(this.getDb().collection(COLL_EMPLOYEES).doc(uid));
            await batch.commit();
        }
        catch (error) {
            console.error('[DELETE_EMPLOYEE_ERROR]', error);
            throw new common_1.InternalServerErrorException('Error al eliminar el empleado.');
        }
    }
    async importEmployees(rows, adminUid) {
        const db = this.getDb();
        const auth = this.getAuth();
        const errors = [];
        let successCount = 0;
        for (const row of rows) {
            try {
                if (!row.email || !row.dni || !row.name) {
                    throw new Error(`Faltan datos (email, dni, nombre) para: ${row.name || 'Fila desconocida'}`);
                }
                const email = row.email.trim().toLowerCase();
                const password = row.dni.trim();
                let uid = '';
                try {
                    const userRecord = await auth.createUser({
                        email,
                        password,
                        displayName: row.name,
                        emailVerified: true
                    });
                    uid = userRecord.uid;
                }
                catch (e) {
                    if (e.code === 'auth/email-already-exists') {
                        const existingUser = await auth.getUserByEmail(email);
                        uid = existingUser.uid;
                    }
                    else {
                        throw e;
                    }
                }
                await auth.setCustomUserClaims(uid, { role: 'employee' });
                const employeeData = {
                    uid,
                    name: row.name,
                    email: email,
                    dni: row.dni,
                    fileNumber: row.legajo || '',
                    address: row.direccion || '',
                    role: 'employee',
                    isAvailable: true,
                    laborAgreement: row.convenio || 'SUVICO',
                    contractType: row.modalidad || 'FullTime',
                    maxHoursPerMonth: Number(row.horas_mensuales) || 176,
                    payrollCycleStartDay: Number(row.inicio_ciclo) || 1,
                    payrollCycleEndDay: 0,
                    createdAt: admin.firestore.Timestamp.now(),
                    importedBy: adminUid
                };
                await db.collection(COLL_EMPLOYEES).doc(uid).set(employeeData, { merge: true });
                successCount++;
            }
            catch (error) {
                console.error(`Error importando ${row.email}:`, error.message);
                errors.push({ email: row.email, error: error.message });
            }
        }
        return { success: successCount, errors };
    }
};
exports.EmployeeService = EmployeeService;
exports.EmployeeService = EmployeeService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [workload_service_1.WorkloadService])
], EmployeeService);
//# sourceMappingURL=employee.service.js.map