/**
 * Smoke tests — reglas de capacidad del guardia (racha 48h, RET, semana).
 * Ejecutar: npm run eval:guard-capacity
 */
import {
    buildGuardCapacityConfig,
    buildSyntheticSequenceAssignments,
    evaluateGuardCanTakeShift,
    evaluateRetAvailableForCoverage,
    guardCapacityRulesSummary,
} from '../src/lib/planificacion/guardCapacityEvaluator';

const EMP = 'g1';
const START = '2026-07-01';
const CFG = buildGuardCapacityConfig(['6+2']);
const EMPTY_ABS = {};

function assert(cond: boolean, msg: string) {
    if (!cond) {
        console.error('FAIL:', msg);
        process.exit(1);
    }
    console.log('OK:', msg);
}

console.log('Reglas:', guardCapacityRulesSummary(CFG));
console.log('---');

// Ejemplo A: M×6 = 48h → 7º M debe fallar (descanso 35h)
{
    const seq = buildSyntheticSequenceAssignments(EMP, START, ['M', 'M', 'M', 'M', 'M', 'M']);
    const day7 = '2026-07-07';
    const v = evaluateGuardCanTakeShift({
        empId: EMP,
        targetDateStr: day7,
        proposedCode: 'M',
        assignments: seq,
        absences: EMPTY_ABS,
        cfg: CFG,
    });
    assert(!v.ok, 'M×6 + 7º M bloqueado (racha 48h / descanso 35h)');
    assert(v.tier === 'blocked_rest' || v.tier === 'blocked_streak', `tier=${v.tier}`);
}

// Ejemplo B: M×4 RET RET — activar RET→M viable (24h acumuladas)
{
    const seq = buildSyntheticSequenceAssignments(EMP, START, ['M', 'M', 'M', 'M', 'RET', 'RET']);
    const day5 = '2026-07-05';
    const v = evaluateRetAvailableForCoverage({
        empId: EMP,
        targetDateStr: day5,
        proposedCode: 'M',
        assignments: seq,
        absences: EMPTY_ABS,
        cfg: CFG,
    });
    assert(v.ok, 'M×4 + RET activable a M (24h < 48h)');
    assert(v.tier === 'ret_available' || v.tier === 'free' || v.tier === 'ret_risky', `tier=${v.tier}`);
}

// Ejemplo C: RET RET T T T T F F — RET día 1 activable
{
    const seq = buildSyntheticSequenceAssignments(
        EMP,
        START,
        ['RET', 'RET', 'T', 'T', 'T', 'T', 'F', 'F'],
    );
    const v = evaluateRetAvailableForCoverage({
        empId: EMP,
        targetDateStr: '2026-07-01',
        proposedCode: 'T',
        assignments: seq,
        absences: EMPTY_ABS,
        cfg: CFG,
    });
    assert(v.ok, 'RET inicial activable a T');
}

// Ejemplo D: M×6 + RET — no debe permitir 7º día facturable (ni activar RET ni M nuevo)
{
    const seq = buildSyntheticSequenceAssignments(
        EMP,
        START,
        ['M', 'M', 'M', 'M', 'M', 'M', 'RET'],
    );
    const vRet = evaluateRetAvailableForCoverage({
        empId: EMP,
        targetDateStr: '2026-07-07',
        proposedCode: 'M',
        assignments: seq,
        absences: EMPTY_ABS,
        cfg: CFG,
    });
    assert(!vRet.ok, 'M×6 + RET: activar RET→M bloqueado (7 días facturables)');
    const seqAfter = buildSyntheticSequenceAssignments(
        EMP,
        START,
        ['M', 'M', 'M', 'M', 'M', 'M', 'RET', 'M'],
    );
    const vAfter = evaluateGuardCanTakeShift({
        empId: EMP,
        targetDateStr: '2026-07-08',
        proposedCode: 'M',
        assignments: seqAfter.slice(0, -1),
        absences: EMPTY_ABS,
        cfg: CFG,
    });
    assert(!vAfter.ok, 'M×6 + RET + 7º M bloqueado');
}

// Ejemplo E: D12 D12 M M M RET — tras 48h, activar RET→M debe fallar o ser riesgoso
{
    const seq = buildSyntheticSequenceAssignments(
        EMP,
        START,
        ['D12', 'D12', 'M', 'M', 'M', 'RET'],
    );
    const v = evaluateRetAvailableForCoverage({
        empId: EMP,
        targetDateStr: '2026-07-06',
        proposedCode: 'M',
        assignments: seq,
        absences: EMPTY_ABS,
        cfg: CFG,
    });
    assert(!v.ok || v.tier === 'ret_risky', 'RET post-48h no libre sin descanso largo');
}

// Tope semanal 48h: 6×M en misma semana → 7º en semana bloqueado
{
    const seq = buildSyntheticSequenceAssignments(
        EMP,
        '2026-07-06',
        ['M', 'M', 'M', 'M', 'M', 'M'],
    );
    const v = evaluateGuardCanTakeShift({
        empId: EMP,
        targetDateStr: '2026-07-12',
        proposedCode: 'M',
        assignments: seq,
        absences: EMPTY_ABS,
        cfg: CFG,
    });
    assert(!v.ok && v.tier === 'blocked_weekly', '7º M en semana > 48h bloqueado');
}

// Extensión 56h con modo12
{
    const cfgExt = buildGuardCapacityConfig(['6+2'], { modo12: true });
    const seq = buildSyntheticSequenceAssignments(
        EMP,
        '2026-07-06',
        ['D12', 'D12', 'M', 'M'],
    );
    const v = evaluateGuardCanTakeShift({
        empId: EMP,
        targetDateStr: '2026-07-10',
        proposedCode: 'D12',
        assignments: seq,
        absences: EMPTY_ABS,
        cfg: cfgExt,
    });
    assert(v.ok, 'Modo12 permite 52h/semana (2×D12 + 2×M + D12)');
    const v2 = evaluateGuardCanTakeShift({
        empId: EMP,
        targetDateStr: '2026-07-11',
        proposedCode: 'D12',
        assignments: [...seq, {
            empId: EMP,
            dateStr: '2026-07-10',
            positionName: 'Puesto 1',
            code: 'D12',
            name: 'D12',
            hours: 12,
            startTime: '07:00',
        }],
        absences: EMPTY_ABS,
        cfg: cfgExt,
    });
    assert(!v2.ok && v2.tier === 'blocked_weekly', 'Modo12 bloquea >56h/semana');
}

console.log('---');
console.log('Todos los casos de capacidad pasaron.');
