import type { VplanPositionDef } from './vplan.positions';
import type { VplanDayDemand, VplanPlanningTarget, VplanPositionPlanningRule, VplanDayTypeExample, VplanMonthBandRollup } from './vplan.types';
export type { VplanPlanningTarget, VplanPositionPlanningRule, VplanDayTypeExample, VplanMonthBandRollup, };
export declare function formatBandSlotsLabel(bandSlots: Record<string, number>): string;
declare const DAY_NAMES: Record<string, string>;
declare const ALL_DAYS: string[];
export declare function formatActiveDaysLabel(activeDays?: string[]): string;
export declare function formatDayDemandSummary(day: VplanDayDemand): string;
export declare function sortPositionPlanningRules(rules: VplanPositionPlanningRule[]): VplanPositionPlanningRule[];
export declare function buildVplanPlanningTarget(opts: {
    positions: VplanPositionDef[];
    dayDemands: VplanDayDemand[];
    monthBandDemand: Record<string, number>;
    monthDemandHours: number;
    cycle?: string;
}): VplanPlanningTarget;
export declare function dailyTripletLabel(qty: number): string;
export { ALL_DAYS, DAY_NAMES };
