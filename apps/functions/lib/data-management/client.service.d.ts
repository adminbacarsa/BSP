import { IClient, IObjective, IServiceContract, IShiftType } from '../common/interfaces/client.interface';
export declare class ClientService {
    private getDb;
    createClient(data: Omit<IClient, 'id' | 'createdAt'>): Promise<IClient>;
    getClient(id: string): Promise<IClient>;
    findAllClients(): Promise<IClient[]>;
    updateClient(id: string, data: Partial<IClient>): Promise<void>;
    deleteClient(id: string): Promise<void>;
    createObjective(data: Omit<IObjective, 'id'>): Promise<IObjective>;
    getObjectivesByClient(clientId: string): Promise<IObjective[]>;
    updateObjective(id: string, data: Partial<IObjective>): Promise<void>;
    getClientById(clientId: string): Promise<IClient>;
    getObjectiveById(objectiveId: string): Promise<IObjective>;
    createServiceContract(data: Omit<IServiceContract, 'id'>): Promise<IServiceContract>;
    updateServiceContract(id: string, data: Partial<IServiceContract>): Promise<void>;
    deleteServiceContract(id: string): Promise<void>;
    createShiftType(data: Omit<IShiftType, 'id'>): Promise<IShiftType>;
    getShiftTypesByContract(contractId: string): Promise<IShiftType[]>;
    updateShiftType(id: string, data: Partial<IShiftType>): Promise<void>;
    deleteShiftType(id: string): Promise<void>;
}
