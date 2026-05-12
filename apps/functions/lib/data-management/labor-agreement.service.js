"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LaborAgreementService = void 0;
const common_1 = require("@nestjs/common");
const admin = require("firebase-admin");
const labor_rules_1 = require("../common/constants/labor-rules");
const COLL_AGREEMENTS = 'convenios_colectivos';
let LaborAgreementService = class LaborAgreementService {
    constructor() {
        this.getDb = () => admin.app().firestore();
    }
    async create(data) {
        const ref = this.getDb().collection(COLL_AGREEMENTS).doc();
        const newItem = {
            ...data,
            id: ref.id,
            createdAt: admin.firestore.Timestamp.now(),
            isActive: true
        };
        await ref.set(newItem);
        return newItem;
    }
    async findAll() {
        const snap = await this.getDb().collection(COLL_AGREEMENTS).where('isActive', '==', true).get();
        return snap.docs.map(doc => doc.data());
    }
    async update(id, data) {
        await this.getDb().collection(COLL_AGREEMENTS).doc(id).update(data);
    }
    async delete(id) {
        await this.getDb().collection(COLL_AGREEMENTS).doc(id).delete();
    }
    async initializeDefaults() {
        const db = this.getDb();
        const batch = db.batch();
        const collectionRef = db.collection(COLL_AGREEMENTS);
        let count = 0;
        for (const [code, rule] of Object.entries(labor_rules_1.LABOR_RULES)) {
            const snapshot = await collectionRef.where('code', '==', code).get();
            if (snapshot.empty) {
                const newDoc = collectionRef.doc();
                batch.set(newDoc, {
                    id: newDoc.id,
                    code: code,
                    name: rule.name,
                    maxHoursWeekly: rule.maxHoursWeekly || 48,
                    maxHoursMonthly: rule.maxHoursMonthly,
                    overtimeThresholdDaily: rule.overtimeThresholdDaily || 0,
                    saturdayCutoffHour: rule.saturdayCutoffHour,
                    nightShiftStart: rule.nightShiftStart,
                    nightShiftEnd: rule.nightShiftEnd,
                    isActive: true,
                    createdAt: admin.firestore.Timestamp.now()
                });
                count++;
            }
        }
        if (count > 0) {
            await batch.commit();
            return `Se importaron ${count} convenios correctamente.`;
        }
        else {
            return 'Los convenios ya estaban cargados.';
        }
    }
    async getAgreementByCode(code) {
        const snap = await this.getDb().collection(COLL_AGREEMENTS).where('code', '==', code).limit(1).get();
        if (snap.empty)
            return null;
        return snap.docs[0].data();
    }
};
exports.LaborAgreementService = LaborAgreementService;
exports.LaborAgreementService = LaborAgreementService = __decorate([
    (0, common_1.Injectable)()
], LaborAgreementService);
//# sourceMappingURL=labor-agreement.service.js.map