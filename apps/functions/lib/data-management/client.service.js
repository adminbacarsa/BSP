"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClientService = void 0;
const common_1 = require("@nestjs/common");
const admin = require("firebase-admin");
const COLL_CLIENTS = 'clientes';
const COLL_OBJECTIVES = 'objetivos';
const COLL_CONTRACTS = 'contratos_servicio';
const COLL_SHIFT_TYPES = 'tipos_turno';
let ClientService = class ClientService {
    constructor() {
        this.getDb = () => admin.app().firestore();
    }
    async createClient(data) {
        const db = this.getDb();
        const ref = db.collection(COLL_CLIENTS).doc();
        const newClient = {
            ...data,
            id: ref.id,
            createdAt: admin.firestore.Timestamp.now(),
        };
        await ref.set(newClient);
        return newClient;
    }
    async getClient(id) {
        const doc = await this.getDb().collection(COLL_CLIENTS).doc(id).get();
        if (!doc.exists)
            throw new common_1.NotFoundException('Cliente no encontrado');
        return { id: doc.id, ...doc.data() };
    }
    async findAllClients() {
        try {
            const snapshot = await this.getDb().collection(COLL_CLIENTS).get();
            if (snapshot.empty)
                return [];
            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
        }
        catch (error) {
            console.error('[ERROR_FIND_CLIENTS]', error);
            throw new common_1.InternalServerErrorException('Error al consultar clientes.');
        }
    }
    async updateClient(id, data) {
        const ref = this.getDb().collection(COLL_CLIENTS).doc(id);
        const updateData = { ...data };
        delete updateData.id;
        delete updateData.createdAt;
        await ref.update(updateData);
    }
    async deleteClient(id) {
        await this.getDb().collection(COLL_CLIENTS).doc(id).delete();
    }
    async createObjective(data) {
        await this.getClient(data.clientId);
        const db = this.getDb();
        const ref = db.collection(COLL_OBJECTIVES).doc();
        const newObjective = {
            ...data,
            id: ref.id,
        };
        await ref.set(newObjective);
        return newObjective;
    }
    async getObjectivesByClient(clientId) {
        const snapshot = await this.getDb().collection(COLL_OBJECTIVES)
            .where('clientId', '==', clientId)
            .get();
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    }
    async updateObjective(id, data) {
        const db = this.getDb();
        const updateData = { ...data };
        delete updateData.id;
        if (updateData.location) {
            updateData.location.latitude = Number(updateData.location.latitude);
            updateData.location.longitude = Number(updateData.location.longitude);
        }
        await db.collection(COLL_OBJECTIVES).doc(id).update(updateData);
    }
    async getClientById(clientId) {
        return this.getClient(clientId);
    }
    async getObjectiveById(objectiveId) {
        const doc = await this.getDb().collection(COLL_OBJECTIVES).doc(objectiveId).get();
        if (!doc.exists) {
            throw new common_1.NotFoundException(`Objective with ID ${objectiveId} not found.`);
        }
        return { id: doc.id, ...doc.data() };
    }
    async createServiceContract(data) {
        const db = this.getDb();
        const ref = db.collection(COLL_CONTRACTS).doc();
        let startDate;
        if (data.startDate instanceof admin.firestore.Timestamp) {
            startDate = data.startDate;
        }
        else if (data.startDate._seconds) {
            startDate = new admin.firestore.Timestamp(data.startDate._seconds, data.startDate._nanoseconds);
        }
        else {
            startDate = admin.firestore.Timestamp.fromDate(new Date(data.startDate));
        }
        const newContract = {
            ...data,
            id: ref.id,
            startDate: startDate,
        };
        await ref.set(newContract);
        return newContract;
    }
    async updateServiceContract(id, data) {
        const db = this.getDb();
        const updateData = { ...data };
        delete updateData.id;
        await db.collection(COLL_CONTRACTS).doc(id).update(updateData);
    }
    async deleteServiceContract(id) {
        const db = this.getDb();
        await db.collection(COLL_CONTRACTS).doc(id).delete();
    }
    async createShiftType(data) {
        const db = this.getDb();
        const ref = db.collection(COLL_SHIFT_TYPES).doc();
        const newType = {
            ...data,
            id: ref.id,
        };
        await ref.set(newType);
        return newType;
    }
    async getShiftTypesByContract(contractId) {
        const snapshot = await this.getDb().collection(COLL_SHIFT_TYPES)
            .where('contractId', '==', contractId)
            .get();
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    }
    async updateShiftType(id, data) {
        const db = this.getDb();
        const updateData = { ...data };
        delete updateData.id;
        await db.collection(COLL_SHIFT_TYPES).doc(id).update(updateData);
    }
    async deleteShiftType(id) {
        const db = this.getDb();
        await db.collection(COLL_SHIFT_TYPES).doc(id).delete();
    }
};
exports.ClientService = ClientService;
exports.ClientService = ClientService = __decorate([
    (0, common_1.Injectable)()
], ClientService);
//# sourceMappingURL=client.service.js.map