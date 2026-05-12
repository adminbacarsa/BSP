import { IServicePattern, IPatternPayload } from '../common/interfaces/service-pattern.interface';
export declare class PatternService {
    private getDb;
    createPattern(payload: IPatternPayload, userId: string): Promise<IServicePattern>;
    getPatternsByContract(contractId: string): Promise<IServicePattern[]>;
    deletePattern(id: string): Promise<void>;
    generateVacancies(contractId: string, month: number, year: number, objectiveId: string): Promise<{
        created: number;
        message: string;
    }>;
    clearVacancies(objectiveId: string, month: number, year: number): Promise<{
        deleted: number;
    }>;
}
