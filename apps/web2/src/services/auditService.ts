
import { db } from '@/lib/firebase';
import { collection, addDoc, Timestamp } from 'firebase/firestore';

export const auditService = {
    /**
     * Registra un evento en la auditoría del sistema.
     * @param action Qué pasó (Ej: 'ALTA_EMPLEADO', 'BAJA_CLIENTE')
     * @param module En qué módulo (Ej: 'RRHH', 'CRM', 'PLANIFICACION')
     * @param details Objeto con los datos relevantes ("foto" del cambio)
     * @param actor Quién lo hizo (email o nombre del usuario)
     */
    async log(action: string, module: string, details: any, actor: string = 'admin@bacarsa.com.ar') {
        try {
            const safeDetails = JSON.parse(JSON.stringify(details || {}));
            await addDoc(collection(db, 'historial_operaciones'), {
                action: action.toUpperCase(),
                module: module.toUpperCase(),
                details: JSON.stringify(safeDetails), 
                actorName: actor,
                timestamp: Timestamp.now(),
                createdAt: new Date().toISOString()
            });
            console.log(`📝 Auditoría: [${module}] ${action}`);
        } catch (error) {
            console.error("❌ Error escribiendo auditoría:", error);
        }
    }
};
