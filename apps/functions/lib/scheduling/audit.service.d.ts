import { GeofencingService } from './geofencing.service';
import { DataManagementService } from '../data-management/data-management.service';
import { IShift } from '../common/interfaces/shift.interface';
export declare class AuditService {
    private readonly geofencingService;
    private readonly dmService;
    constructor(geofencingService: GeofencingService, dmService: DataManagementService);
    private getDb;
    auditShiftAction(shiftId: string, action: 'CHECK_IN' | 'CHECK_OUT', employeeCoords: {
        latitude: number;
        longitude: number;
    } | null, actorUid: string, actorRole: string, isManualOverride: boolean): Promise<IShift>;
}
