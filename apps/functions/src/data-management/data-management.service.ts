import { Injectable, NotFoundException } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { IClient, IObjective } from '../common/interfaces/client.interface'; // RUTA RELATIVA FINAL
import { IShift } from '../common/interfaces/shift.interface'; // RUTA RELATIVA FINAL (Aunque IShift no se usa directamente aquí, la mantenemos si es necesario)

const CLIENTS_COLLECTION = 'clientes';
const OBJECTIVES_COLLECTION = 'objetivos';
// 🛑 ELIMINADO: const db = admin.firestore(); // Eliminado para resolver el error 'app/no-app'

/**
 * @class DataManagementService
 * @description Servicio CRUD para las entidades Cliente y Objetivo (P1). 
 */
@Injectable()
export class DataManagementService {
  
  // 🔑 FIX: Getter para asegurar que Firestore solo se accede después de initializeApp()
  private getDb = () => admin.app().firestore();

  // --- CRUD para Objetivos (Sucursales/Puestos) ---

  async createObjective(objectiveData: Omit<IObjective, 'id'>): Promise<IObjective> {
    const dbInstance = this.getDb();
    const newRef = dbInstance.collection(OBJECTIVES_COLLECTION).doc();
    const objective: IObjective = {
      ...objectiveData,
      id: newRef.id,
    };
    await newRef.set(objective);
    return objective;
  }

  async findAllObjectives(clientId?: string): Promise<IObjective[]> {
    const dbInstance = this.getDb();
    let query: admin.firestore.Query = dbInstance.collection(OBJECTIVES_COLLECTION);
    
    if (clientId) {
      query = query.where('clientId', '==', clientId);
    }

    const snapshot = await query.get();
    if (snapshot.empty) {
        return [];
    }

    return snapshot.docs.map(doc => doc.data() as IObjective);
  }
  
  // --- Métodos de Lectura (Críticos para el Check-In) ---
  
  public async getClientById(clientId: string): Promise<IClient> {
      const dbInstance = this.getDb();
      const doc = await dbInstance.collection(CLIENTS_COLLECTION).doc(clientId).get();
      if (!doc.exists) {
          throw new NotFoundException(`Client with ID ${clientId} not found.`);
      }
      return doc.data() as IClient;
  }
  
  public async getObjectiveById(objectiveId: string): Promise<IObjective> {
      const dbInstance = this.getDb();
      const doc = await dbInstance.collection(OBJECTIVES_COLLECTION).doc(objectiveId).get();
      if (!doc.exists) {
          throw new NotFoundException(`Objective with ID ${objectiveId} not found.`);
      }
      return doc.data() as IObjective;
  }
}



