/**
 * Excedente vs plantilla → sin Modo 12 automático; RET cubre ausentes en Modo 8.
 */
import { filterModo12DaysWhenSurplusRetAvailable } from '../src/lib/planificacion/planningCoveragePolicy';
import type { V2AbsenceMap } from '../src/lib/planificacion/autoScheduleEngineV2';

const absences: V2AbsenceMap = {};
const farias = '7M4nUy7XDhsfxHB3g7Hz';
const lopez = 'MdAhlJ6ACqnBa25dEoRh';
absences[farias] = new Map();
absences[lopez] = new Map();
for (let d = 8; d <= 21; d++) {
    absences[farias].set(`2026-07-${String(d).padStart(2, '0')}`, 'V');
}
for (let d = 12; d <= 18; d++) {
    absences[lopez].set(`2026-07-${String(d).padStart(2, '0')}`, 'V');
}

const employeeIds = [farias, lopez, 'a', 'b', 'c'];
const modo12DaysAuto = [
    ...new Set([
        ...[...absences[farias].keys()],
        ...[...absences[lopez].keys()],
    ]),
].sort();

const result = filterModo12DaysWhenSurplusRetAvailable({
    modo12DaysAuto,
    absences,
    employeeIds,
    plantillaTotal: 16,
    peopleAvailable: 19,
});

let failed = false;
const assert = (cond: boolean, msg: string) => {
    if (!cond) {
        console.error(`FAIL: ${msg}`);
        failed = true;
    } else {
        console.log(`OK: ${msg}`);
    }
};

assert(result.modo12Days.length === 0, 'sin Modo 12 con 3 de excedente y máx 2 ausentes/día');
assert(result.messages.length > 0, 'mensaje de política RET stand-by');

if (failed) {
    console.error('\n=== eval:surplus-absence-modo8 FAILED ===');
    process.exit(1);
}
console.log('\n=== eval:surplus-absence-modo8 PASS ===');
