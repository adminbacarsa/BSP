"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DataManagementService = void 0;
const common_1 = require("@nestjs/common");
const admin = require("firebase-admin");
const CLIENTS_COLLECTION = 'clientes';
const OBJECTIVES_COLLECTION = 'objetivos';
let DataManagementService = class DataManagementService {
    constructor() {
        this.getDb = () => admin.app().firestore();
    }
    async createObjective(objectiveData) {
        const dbInstance = this.getDb();
        const newRef = dbInstance.collection(OBJECTIVES_COLLECTION).doc();
        const objective = {
            ...objectiveData,
            id: newRef.id,
        };
        await newRef.set(objective);
        return objective;
    }
    async findAllObjectives(clientId) {
        const dbInstance = this.getDb();
        let query = dbInstance.collection(OBJECTIVES_COLLECTION);
        if (clientId) {
            query = query.where('clientId', '==', clientId);
        }
        const snapshot = await query.get();
        if (snapshot.empty) {
            return [];
        }
        return snapshot.docs.map(doc => doc.data());
    }
    async getClientById(clientId) {
        const dbInstance = this.getDb();
        const doc = await dbInstance.collection(CLIENTS_COLLECTION).doc(clientId).get();
        if (!doc.exists) {
            throw new common_1.NotFoundException(`Client with ID ${clientId} not found.`);
        }
        return doc.data();
    }
    async getObjectiveById(objectiveId) {
        const dbInstance = this.getDb();
        const doc = await dbInstance.collection(OBJECTIVES_COLLECTION).doc(objectiveId).get();
        if (!doc.exists) {
            throw new common_1.NotFoundException(`Objective with ID ${objectiveId} not found.`);
        }
        return doc.data();
    }
};
exports.DataManagementService = DataManagementService;
exports.DataManagementService = DataManagementService = __decorate([
    (0, common_1.Injectable)()
], DataManagementService);
//# sourceMappingURL=data-management.service.js.map