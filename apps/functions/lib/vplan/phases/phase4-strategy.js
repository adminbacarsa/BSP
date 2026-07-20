"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildVplanStrategy = buildVplanStrategy;
const vplan_rotation_1 = require("../vplan.rotation");
const vplan_planning_method_1 = require("../vplan.planning-method");
const vplan_cycle_semantics_1 = require("../vplan.cycle-semantics");
function buildVplanStrategy(opts) {
    const cycle = opts.preferredCycle ?? '6+2';
    const rot = (0, vplan_rotation_1.getRotationProfile)(cycle);
    const rotNote = `Rotación ${rot.shiftHours}h: subgrupo ${rot.subgroupSize} (${rot.workersPerDay} trab + ${rot.francosPerDay}F/día), bloque ${rot.workBlockDays}+${rot.restBlockDays}`;
    const base = {
        cycle,
        absenceTiming: 'pre_block',
        continuity: 'reset',
        engine: cycle === '4+2' ? 'Cycle4x2D12N12' : 'FixedBandFloater',
        modes: {
            useTrailing: false,
            preserveExisting: false,
            patchAbsencesPostGenerate: true,
        },
        notes: [rotNote],
    };
    const withNotes = (extra) => ({
        ...base,
        notes: [rotNote, ...extra],
    });
    switch (opts.mode) {
        case 'CONTINUE':
            return attachPlanningMethod({
                ...withNotes(['Continuar rachas del mes anterior (turnos junio + planificacion_estados)']),
                continuity: 'continue_streaks',
                absenceTiming: 'pre_block',
                modes: {
                    useTrailing: opts.hasTrailing || Boolean(opts.hasPrevMonthShifts),
                    preserveExisting: false,
                    patchAbsencesPostGenerate: true,
                },
            }, opts);
        case 'COMPLETE':
            return attachPlanningMethod({
                ...withNotes(['Preservar celdas ya planificadas; generación base para huecos']),
                continuity: 'continue_streaks',
                absenceTiming: 'hybrid',
                modes: {
                    useTrailing: opts.hasTrailing,
                    preserveExisting: true,
                    patchAbsencesPostGenerate: true,
                },
            }, opts);
        case 'RESTORE':
        case 'REPLAN_ABSENCES':
            return attachPlanningMethod({
                ...withNotes(['Re-armar días afectados por licencias o novedades']),
                absenceTiming: 'post_replan',
                continuity: 'continue_streaks',
                modes: {
                    useTrailing: opts.hasTrailing,
                    preserveExisting: opts.hasExistingAssignments,
                    patchAbsencesPostGenerate: true,
                },
            }, opts);
        case 'REBALANCE_HOURS':
            return attachPlanningMethod({
                ...withNotes(['Prioridad cierre horario vs SLA sin cambiar esquema']),
                absenceTiming: 'hybrid',
                modes: {
                    useTrailing: opts.hasTrailing,
                    preserveExisting: true,
                    patchAbsencesPostGenerate: false,
                },
            }, opts);
        case 'MIGRATE_CYCLE':
            return attachPlanningMethod({
                ...withNotes([`Migración de ciclo hacia ${cycle}`]),
                engine: 'CycleMigrator',
                absenceTiming: 'pre_block',
                modes: {
                    useTrailing: false,
                    preserveExisting: false,
                    patchAbsencesPostGenerate: true,
                },
            }, opts);
        case 'GREENFIELD':
        default:
            return attachPlanningMethod({
                ...withNotes(['Cronograma desde cero (sin trailing del mes anterior)']),
                continuity: 'reset',
                modes: {
                    useTrailing: false,
                    preserveExisting: false,
                    patchAbsencesPostGenerate: true,
                },
            }, opts);
    }
}
function attachPlanningMethod(strategy, opts) {
    const cycleSemantics = (0, vplan_cycle_semantics_1.buildVplanCycleSemantics)(strategy.cycle, opts.planningRules ?? null);
    if (!opts.positions?.length) {
        return { ...strategy, cycleSemantics };
    }
    return {
        ...strategy,
        cycleSemantics,
        planningMethod: (0, vplan_planning_method_1.buildVplanPlanningMethod)({
            strategy,
            mode: opts.mode,
            demand: opts.demand,
            supply: opts.supply,
            feasibility: opts.feasibility,
            positions: opts.positions,
            trailingEmployeeCount: opts.trailingEmployeeCount,
            cycleSemantics,
        }),
    };
}
//# sourceMappingURL=phase4-strategy.js.map