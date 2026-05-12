"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const admin = require("firebase-admin");
const EMPLOYEES_COLLECTION = 'empleados';
let AuthService = class AuthService {
    constructor() {
        this.getAuth = () => admin.app().auth();
        this.getDb = () => admin.app().firestore();
    }
    async createEmployeeProfile(email, password, role, name, profileData) {
        const authInstance = this.getAuth();
        const user = await authInstance.createUser({
            email,
            password,
            displayName: name,
            emailVerified: true,
        }).catch(error => {
            if (error.code === 'auth/email-already-exists') {
                throw new common_1.ConflictException('La dirección de correo ya está en uso.');
            }
            console.error('[AUTH_CREATE_ERROR]', error.message);
            throw new common_1.InternalServerErrorException('Error al crear usuario en Firebase Auth.');
        });
        const employeeUid = user.uid;
        try {
            await authInstance.setCustomUserClaims(employeeUid, { role });
        }
        catch (error) {
            console.error(`[CLAIMS_ERROR] Failed to set claims.`, error);
            await authInstance.deleteUser(employeeUid);
            throw new common_1.InternalServerErrorException('Error al asignar rol. Creación abortada.');
        }
        const employeeProfile = {
            uid: employeeUid,
            email: email,
            name: name,
            role: role,
            isAvailable: true,
            maxHoursPerMonth: 176,
            contractType: 'FullTime',
            clientId: profileData.clientId,
            dni: profileData.dni,
            fileNumber: profileData.fileNumber,
            address: profileData.address
        };
        const dbInstance = this.getDb();
        try {
            await dbInstance.collection(EMPLOYEES_COLLECTION).doc(employeeUid).set(employeeProfile);
        }
        catch (error) {
            console.error(`[FIRESTORE_ERROR] Failed to create profile.`, error);
            await authInstance.deleteUser(employeeUid);
            throw new common_1.InternalServerErrorException('Error al guardar perfil. Creación abortada.');
        }
        return employeeProfile;
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, common_1.Injectable)()
], AuthService);
//# sourceMappingURL=auth.service.js.map