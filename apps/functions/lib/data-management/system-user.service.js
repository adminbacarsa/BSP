"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SystemUserService = void 0;
const common_1 = require("@nestjs/common");
const admin = require("firebase-admin");
const COLL_SYSTEM_USERS = 'system_users';
let SystemUserService = class SystemUserService {
    constructor() {
        this.getAuth = () => admin.app().auth();
        this.getDb = () => admin.app().firestore();
    }
    async createSystemUser(data) {
        const auth = this.getAuth();
        const db = this.getDb();
        const userRecord = await auth.createUser({
            email: data.email,
            password: data.password,
            displayName: data.displayName,
            emailVerified: true,
        }).catch(error => {
            if (error.code === 'auth/email-already-exists')
                throw new common_1.ConflictException('El email ya está registrado.');
            throw new common_1.InternalServerErrorException('Error al crear usuario en Auth.');
        });
        await auth.setCustomUserClaims(userRecord.uid, { role: data.role, type: 'system_user' });
        const newUser = {
            uid: userRecord.uid,
            email: data.email,
            displayName: data.displayName,
            role: data.role,
            status: 'Active',
            createdAt: admin.firestore.Timestamp.now()
        };
        await db.collection(COLL_SYSTEM_USERS).doc(userRecord.uid).set(newUser);
        return newUser;
    }
    async findAll() {
        const snapshot = await this.getDb().collection(COLL_SYSTEM_USERS).get();
        return snapshot.docs.map(doc => doc.data());
    }
    async updateSystemUser(uid, data) {
        const auth = this.getAuth();
        const db = this.getDb();
        if (data.role) {
            await auth.setCustomUserClaims(uid, { role: data.role, type: 'system_user' });
        }
        if (data.status) {
            await auth.updateUser(uid, { disabled: data.status === 'Inactive' });
        }
        const safeData = { ...data };
        delete safeData.uid;
        delete safeData.email;
        await db.collection(COLL_SYSTEM_USERS).doc(uid).update(safeData);
    }
    async deleteSystemUser(uid) {
        await this.getAuth().deleteUser(uid);
        await this.getDb().collection(COLL_SYSTEM_USERS).doc(uid).delete();
    }
};
exports.SystemUserService = SystemUserService;
exports.SystemUserService = SystemUserService = __decorate([
    (0, common_1.Injectable)()
], SystemUserService);
//# sourceMappingURL=system-user.service.js.map