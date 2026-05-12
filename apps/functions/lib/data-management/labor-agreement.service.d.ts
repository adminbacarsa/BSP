import { ILaborAgreement } from '../common/interfaces/labor-agreement.interface';
export declare class LaborAgreementService {
    private getDb;
    create(data: Partial<ILaborAgreement>): Promise<ILaborAgreement>;
    findAll(): Promise<ILaborAgreement[]>;
    update(id: string, data: Partial<ILaborAgreement>): Promise<void>;
    delete(id: string): Promise<void>;
    initializeDefaults(): Promise<string>;
    getAgreementByCode(code: string): Promise<ILaborAgreement | null>;
}
