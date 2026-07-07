"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRotationProfile = getRotationProfile;
exports.headcountPerQtyUnit = headcountPerQtyUnit;
exports.maxRestStreak = maxRestStreak;
const vplan_cycle_templates_1 = require("./vplan.cycle-templates");
const REST_BLOCK = {
    '6+2': 2,
    '4+2': 2,
    '5+1': 1,
    '6+1': 1,
};
function getRotationProfile(cycle) {
    const cycleKey = (0, vplan_cycle_templates_1.normalizeCycleKey)(cycle);
    const is12h = (0, vplan_cycle_templates_1.is4x2Cycle)(cycleKey);
    const size = (0, vplan_cycle_templates_1.subgroupSize)(cycleKey);
    const francos = 1;
    return {
        cycleKey,
        subgroupSize: size,
        workersPerDay: size - francos,
        francosPerDay: francos,
        shiftHours: is12h ? 12 : 8,
        bandsPerDay: is12h ? 2 : 3,
        workBlockDays: (0, vplan_cycle_templates_1.maxWorkStreak)(cycleKey),
        restBlockDays: REST_BLOCK[cycleKey],
    };
}
function headcountPerQtyUnit(cycle) {
    return getRotationProfile(cycle).subgroupSize;
}
function maxRestStreak(cycle) {
    return getRotationProfile(cycle).restBlockDays;
}
//# sourceMappingURL=vplan.rotation.js.map