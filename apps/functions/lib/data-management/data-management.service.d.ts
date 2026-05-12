import { IClient, IObjective } from '../common/interfaces/client.interface';
export declare class DataManagementService {
    private getDb;
    createObjective(objectiveData: Omit<IObjective, 'id'>): Promise<IObjective>;
    findAllObjectives(clientId?: string): Promise<IObjective[]>;
    getClientById(clientId: string): Promise<IClient>;
    getObjectiveById(objectiveId: string): Promise<IObjective>;
}
