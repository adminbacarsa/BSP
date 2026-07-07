import type { VplanDemandModel } from '../vplan.types';
import type { VplanPositionDef } from '../vplan.positions';
export declare function buildVplanDemandModel(opts: {
    positions: VplanPositionDef[];
    days: Array<{
        dateStr: string;
        dayLetter: string;
    }>;
    slaVendidas: number;
    cycle?: string;
}): VplanDemandModel;
