"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SystemAuditService = void 0;
const common_1 = require("@nestjs/common");
const admin = require("firebase-admin");
let SystemAuditService = class SystemAuditService {
    constructor() {
        this.getDb = () => admin.app().firestore();
        this.COLLECTION_NAME = 'system_audit_logs';
    }
    async logAction(actorUid, actorName, action, module, details, metadata) {
        try {
            const db = this.getDb();
            const ref = db.collection(this.COLLECTION_NAME).doc();
            const entry = {
                id: ref.id, actorUid: actorUid || 'SYSTEM', actorName: actorName || 'Sistema', action, module, details, metadata: metadata || {}, timestamp: admin.firestore.Timestamp.now()
            };
            ref.set(entry).catch(err => console.error("⚠️ Error audit log:", err));
        }
        catch (e) {
            console.error("❌ Error SystemAuditService:", e);
        }
    }
    async getLogs(limit = 50, moduleFilter) {
        const db = this.getDb();
        let query = db.collection(this.COLLECTION_NAME).orderBy('timestamp', 'desc').limit(limit);
        if (moduleFilter && moduleFilter !== 'ALL')
            query = query.where('module', '==', moduleFilter);
        const snapshot = await query.get();
        return snapshot.docs.map(doc => ({ ...doc.data(), timestamp: doc.data().timestamp }));
    }
    async getSystemStats() {
        const db = this.getDb();
        const [clientsSnap, activeEmpsSnap, logsSnap] = await Promise.all([
            db.collection('clientes').count().get(),
            db.collection('empleados').where('isAvailable', '==', true).count().get(),
            db.collection(this.COLLECTION_NAME).count().get()
        ]);
        return {
            totalClients: clientsSnap.data().count,
            activeEmployees: activeEmpsSnap.data().count,
            totalAuditLogs: logsSnap.data().count
        };
    }
};
exports.SystemAuditService = SystemAuditService;
exports.SystemAuditService = SystemAuditService = __decorate([
    (0, common_1.Injectable)()
], SystemAuditService);
//# sourceMappingURL=system-audit.service.js.map