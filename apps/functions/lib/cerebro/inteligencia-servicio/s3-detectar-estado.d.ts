import * as admin from 'firebase-admin';
import { EstadoServicio } from '../types';
export declare function detectarEstadoServicio(db: admin.firestore.Firestore, objetivoId: string, yearMonth: string): Promise<EstadoServicio>;
export declare function detectarEstadoDesdeMemoria(turnos: Array<{
    objectiveId: string;
    startTime: string;
    draft?: boolean;
    employeeId?: string;
    positionName?: string;
}>, objetivoId: string, yearMonth: string): EstadoServicio;
