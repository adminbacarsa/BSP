import { Injectable } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { ILaborAgreement } from '../common/interfaces/labor-agreement.interface';
import { LABOR_RULES } from '../common/constants/labor-rules'; // 🛑 Importamos las reglas base

const COLL_AGREEMENTS = 'convenios_colectivos';

@Injectable()
export class LaborAgreementService {
    private getDb = () => admin.app().firestore();

    async create(data: Partial<ILaborAgreement>): Promise<ILaborAgreement> {
        const ref = this.getDb().collection(COLL_AGREEMENTS).doc();
        const newItem: any = {
            ...data,
            id: ref.id,
            createdAt: admin.firestore.Timestamp.now(),
            isActive: true
        };
        await ref.set(newItem);
        return newItem;
    }

    async findAll(): Promise<ILaborAgreement[]> {
        const snap = await this.getDb().collection(COLL_AGREEMENTS).where('isActive', '==', true).get();
        return snap.docs.map(doc => doc.data() as ILaborAgreement);
    }

    async update(id: string, data: Partial<ILaborAgreement>): Promise<void> {
        await this.getDb().collection(COLL_AGREEMENTS).doc(id).update(data);
    }
    
    async delete(id: string): Promise<void> {
        await this.getDb().collection(COLL_AGREEMENTS).doc(id).delete();
    }

    // 🛑 NUEVO: Migrar reglas de código a base de datos
    async initializeDefaults(): Promise<string> {
        const db = this.getDb();
        const batch = db.batch();
        const collectionRef = db.collection(COLL_AGREEMENTS);
        let count = 0;

        // Recorremos las reglas estáticas
        for (const [code, rule] of Object.entries(LABOR_RULES)) {
            // Verificamos si ya existe para no duplicar
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
        } else {
            return 'Los convenios ya estaban cargados.';
        }
    }

    async getAgreementByCode(code: string): Promise<ILaborAgreement | null> {
        const snap = await this.getDb().collection(COLL_AGREEMENTS).where('code', '==', code).limit(1).get();
        if (snap.empty) return null;
        return snap.docs[0].data() as ILaborAgreement;
    }
}



