/**
 * Motor V4 — fusión determinística:
 * - Base V2: loop día×puesto×banda, segundo pase, RET solo con excedente, PASO 3b (200h).
 * - V3 recuperado: D12/N12 solo si ausencia real en banda T; EN/RO titular + respaldo Puesto 24hs.
 */
export {
    generateScheduleV2 as generateScheduleV4,
    runAutoScheduleV2 as runAutoScheduleV4,
    pickOptimalAutoCycles,
    effectiveShiftsForPositionDay,
    positionIsActiveOn,
    checkFeasibility,
    pickRepresentativeCycle,
    TARGET_AVG_HOURS,
    HARD_MAX_HOURS,
} from './autoScheduleEngineV2';

export type {
    V2ShiftDef,
    V2PositionDef,
    V2EmployeeDef,
    V2AbsenceMap,
    V2BudgetMode,
    V2EngineContext,
    V2PositionDemand,
    V2EmployeeOffer,
    V2FeasibilityReport,
    V2EngineResult,
    V2Assignment,
    V2GenerateStats,
    CapOverflowSlot,
    V2GenerateResult,
} from './autoScheduleEngineV2';
