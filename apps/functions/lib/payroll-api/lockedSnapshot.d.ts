import type { LiquidacionSnapshot } from './calc';
export type LockedSnapshotLookup = {
    locked: false;
} | {
    locked: true;
    snapshot: LiquidacionSnapshot;
};
export declare function readLockedLiquidacionSnapshot(params: {
    cycleId: string;
    empresaId: string;
    page?: number;
    pageSize?: number;
    clientIdFilter?: string;
}): Promise<LockedSnapshotLookup>;
