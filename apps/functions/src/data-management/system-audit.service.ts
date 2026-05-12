import { Injectable } from '@nestjs/common';
import * as admin from 'firebase-admin';

export type AuditModule = 'CLIENTS' | 'EMPLOYEES' | 'SYSTEM' | 'SCHEDULING' | 'ABSENCE' | 'OVERTIME';
export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'EXPORT' | 'PUBLISH' | 'APPROVE' | 'REJECT';

export interface ISystemLog {
  id: string; actorUid: string; actorName: string; action: AuditAction; module: AuditModule;
  details: string; metadata?: any; timestamp: admin.firestore.Timestamp; ip?: string;
}

@Injectable()
export class SystemAuditService {
  private getDb = () => admin.app().firestore();
  private readonly COLLECTION_NAME = 'system_audit_logs';

  async logAction(actorUid: string, actorName: string, action: AuditAction, module: AuditModule, details: string, metadata?: any): Promise<void> {
    try {
      const db = this.getDb();
      const ref = db.collection(this.COLLECTION_NAME).doc();
      const entry: ISystemLog = {
        id: ref.id, actorUid: actorUid || 'SYSTEM', actorName: actorName || 'Sistema', action, module, details, metadata: metadata || {}, timestamp: admin.firestore.Timestamp.now()
      };
      ref.set(entry).catch(err => console.error("⚠️ Error audit log:", err));
    } catch (e) { console.error("❌ Error SystemAuditService:", e); }
  }

  async getLogs(limit: number = 50, moduleFilter?: string): Promise<ISystemLog[]> {
    const db = this.getDb();
    let query = db.collection(this.COLLECTION_NAME).orderBy('timestamp', 'desc').limit(limit);
    if (moduleFilter && moduleFilter !== 'ALL') query = query.where('module', '==', moduleFilter);
    const snapshot = await query.get();
    return snapshot.docs.map(doc => ({ ...doc.data(), timestamp: doc.data().timestamp } as ISystemLog));
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
}