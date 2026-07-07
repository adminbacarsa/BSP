import { type VplanCycleKey } from './vplan.cycle-templates';
export interface VplanRotationProfile {
    cycleKey: VplanCycleKey;
    subgroupSize: number;
    workersPerDay: number;
    francosPerDay: number;
    shiftHours: 8 | 12;
    bandsPerDay: number;
    workBlockDays: number;
    restBlockDays: number;
}
export declare function getRotationProfile(cycle?: string): VplanRotationProfile;
export declare function headcountPerQtyUnit(cycle?: string): number;
export declare function maxRestStreak(cycle?: string): number;
