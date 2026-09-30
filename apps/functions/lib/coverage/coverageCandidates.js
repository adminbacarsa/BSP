"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COVERAGE_REJECT_LABEL = exports.COVERAGE_LICENSE_CODES = exports.COVERAGE_HARD_CAP_MS = exports.COVERAGE_JOIN_TOLERANCE_MS = exports.COVERAGE_LEGACY_CANDIDATE_TYPES = exports.COVERAGE_CASCADE_ORDER = void 0;
exports.coverageRejectMessage = coverageRejectMessage;
exports.coverageWizardStepKeys = coverageWizardStepKeys;
exports.dualSegmentBounds = dualSegmentBounds;
exports.buildCoverageCandidates = buildCoverageCandidates;
exports.pickBestCandidate = pickBestCandidate;
exports.acceptanceStillValid = acceptanceStillValid;
exports.COVERAGE_CASCADE_ORDER = [
    'RET',
    'REF',
    'ESC',
    'EXTEND',
    'ADVANCE',
    'FT',
];
exports.COVERAGE_LEGACY_CANDIDATE_TYPES = [
    'VOLANTE',
    'SIN_TURNO_CON_EXP',
    'SIN_TURNO',
];
exports.COVERAGE_JOIN_TOLERANCE_MS = 30 * 60 * 1000;
exports.COVERAGE_HARD_CAP_MS = (12 * 60 + 59) * 60 * 1000;
const COVERAGE_MIN_REST_MS = 12 * 60 * 60 * 1000;
const AR_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
exports.COVERAGE_LICENSE_CODES = new Set([
    'V', 'L', 'E', 'A', 'ART', 'AA', 'PG', 'SGS', 'SUS',
]);
const FRANCO_CODES = new Set(['F', 'FF', 'FP']);
const WORK_BANDS = new Set(['M', 'T', 'N', 'D12', 'N12']);
exports.COVERAGE_REJECT_LABEL = {
    ES_EL_AUSENTE: 'Es el ausente de esta vacante',
    LICENCIA_TURNO: 'Tiene licencia en la malla',
    LICENCIA_RRHH: 'Tiene licencia cargada en RRHH',
    ZOMBI: 'Turno vencido (zombi), no se convoca',
    NO_CONTIGUO: 'No es contiguo al hueco (±30 min)',
    TOPE_12_59: 'Superaría el tope de 12:59 h',
    YA_CONVOCADO: 'Ya está convocado en otro hueco',
    SOLAPA_COBERTURA: 'Ya tiene una cobertura en ese horario',
    AUSENTE: 'Figura ausente',
    NO_PRESENTE: 'No está fichado en el puesto',
    COMPLETADO: 'El turno ya está cerrado',
    SIN_SOLAPE: 'El turno no solapa el hueco',
    COBERTURA_USADA: 'Ese turno ya se usó para cubrir',
    HUECO_CUBIERTO: 'El hueco ya está cubierto',
    FALTA_APTITUD: 'Le falta una aptitud del puesto',
    RESTRICCION: 'Tiene restricción de objetivo o cliente',
    EN_OTRA_SESION: 'Ya está propuesto en otra vacante del CC',
    DESCANSO: 'No cumple el descanso entre turnos (12 h)',
};
function coverageRejectMessage(reason) {
    switch (reason) {
        case 'ES_EL_AUSENTE':
            return 'No podés cubrir tu propia ausencia.';
        case 'LICENCIA_TURNO':
        case 'LICENCIA_RRHH':
            return 'No se puede tomar esta cobertura: estás de licencia ese día.';
        case 'SOLAPA_COBERTURA':
            return 'No se puede tomar esta cobertura: ya tenés otra cobertura en ese horario.';
        case 'YA_CONVOCADO':
            return 'No se puede tomar esta cobertura: ya estás convocado en otro hueco.';
        case 'TOPE_12_59':
            return 'No se puede tomar esta cobertura: superarías el tope de 12:59 h.';
        case 'DESCANSO':
            return 'No se puede tomar esta cobertura: no cumplís las 12 h de descanso entre turnos.';
        case 'ZOMBI':
            return 'No se puede tomar esta cobertura: el turno está vencido.';
        case 'HUECO_CUBIERTO':
            return 'El hueco ya fue cubierto.';
        case 'NO_CONTIGUO':
            return 'No se puede tomar esta cobertura: tu turno no es contiguo a este hueco.';
        default:
            return 'No se puede tomar esta cobertura: ya no estás disponible para este hueco.';
    }
}
function coverageWizardStepKeys(order = exports.COVERAGE_CASCADE_ORDER) {
    const steps = [];
    for (const t of order) {
        const key = t === 'FT' ? 'FT' : t === 'EXTEND' || t === 'ADVANCE' ? 'RETENCION' : 'INTERNO';
        if (steps[steps.length - 1] !== key)
            steps.push(key);
    }
    return steps;
}
function norm(value) {
    return String(value ?? '').trim().toUpperCase();
}
function arMidnight(ms) {
    return Math.floor((ms - AR_OFFSET_MS) / DAY_MS) * DAY_MS + AR_OFFSET_MS;
}
function arHmOnDay(dayMs, h, m) {
    return arMidnight(dayMs) + ((h * 60) + m) * 60 * 1000;
}
function rangesOverlap(a0, a1, b0, b1) {
    if (!a0 || !a1 || !b0 || !b1)
        return false;
    return a0 < b1 && b0 < a1;
}
function emptyByType() {
    return { RET: [], REF: [], ESC: [], EXTEND: [], ADVANCE: [], FT: [] };
}
function dualSegmentBounds(gap) {
    if (gap.startMs && gap.endMs && gap.endMs > gap.startMs && gap.endMs - gap.startMs <= exports.COVERAGE_HARD_CAP_MS + 60_000) {
        const mid = gap.startMs + Math.floor((gap.endMs - gap.startMs) / 2);
        return { extEndMs: mid, advStartMs: mid };
    }
    const band = norm(gap.band);
    let hm = 11;
    if (band === 'T')
        hm = 19;
    else if (band === 'N' || band === 'N12')
        hm = 3;
    else if (band === 'M' || band === 'D12')
        hm = 11;
    const dayMs = band === 'N' || band === 'N12' ? gap.startMs + DAY_MS : gap.startMs;
    const ms = gap.startMs ? arHmOnDay(dayMs, hm, 0) : 0;
    return { extEndMs: ms, advStartMs: ms };
}
function samePosition(gap, shift) {
    const a = String(gap.positionId || '').trim();
    const b = String(shift.positionId || '').trim();
    if (a && b)
        return a === b;
    const an = norm(gap.positionName);
    const bn = norm(shift.positionName);
    if (an && bn)
        return an === bn;
    return true;
}
function isLicenseCode(code) {
    return exports.COVERAGE_LICENSE_CODES.has(norm(code));
}
function absenceBlocks(abs, gapStartMs) {
    const st = norm(abs.status);
    if (['ANULADA', 'INACTIVE', 'CANCELLED', 'CANCELED', 'RECHAZADA'].includes(st))
        return false;
    if (!abs.employeeId || !abs.startMs || !abs.endMs)
        return false;
    if (!isLicenseCode(abs.code))
        return false;
    const day = arMidnight(gapStartMs);
    return abs.startMs <= day + DAY_MS - 1 && abs.endMs >= day;
}
function onLeave(employeeId, absences, gapStartMs) {
    return absences.some((a) => a.employeeId === employeeId && absenceBlocks(a, gapStartMs));
}
function isZombie(shift, gap, nowMs, hardCapMs, toleranceMs) {
    if (shift.isPresent !== true || shift.isCompleted === true)
        return false;
    if (!shift.endMs)
        return false;
    if (arMidnight(shift.endMs) < arMidnight(gap.startMs))
        return true;
    const contiguous = Math.abs(shift.endMs - gap.startMs) <= toleranceMs;
    const evalMs = gap.startMs < arMidnight(nowMs) ? gap.startMs : nowMs;
    if (!contiguous && shift.endMs < evalMs && evalMs - shift.endMs > hardCapMs)
        return true;
    return false;
}
function workStart(shift) {
    return shift.realStartMs || shift.checkInMs || shift.startMs || 0;
}
function sourceOverlapsGap(shift, gap) {
    if (shift.coverageUsed === true || shift.isDeleted === true)
        return false;
    if (!shift.startMs || !shift.endMs || shift.endMs <= shift.startMs)
        return false;
    if (!gap.startMs || !gap.endMs || gap.endMs <= gap.startMs)
        return false;
    const code = norm(shift.code);
    if (shift.startMs >= gap.endMs)
        return false;
    if (shift.endMs < gap.startMs)
        return false;
    if (shift.endMs === gap.startMs && code !== 'RET')
        return false;
    if (code === 'RET')
        return shift.startMs <= gap.startMs + 60_000;
    const gapBand = norm(gap.band);
    const deploy = norm(shift.deploymentBand);
    const srcBand = WORK_BANDS.has(deploy) ? deploy : (WORK_BANDS.has(code) ? code : deploy || code);
    const sameBand = WORK_BANDS.has(gapBand) && WORK_BANDS.has(srcBand) && gapBand === srcBand;
    return sameBand || shift.startMs <= gap.startMs + 60_000;
}
function employeeOf(input, id) {
    return (input.employees || []).find((e) => e.id === id);
}
function restrictionOrAptitude(emp, gap, nowYmd) {
    if (!emp)
        return null;
    if ((emp.restriccionesObjetivo || []).some((r) => r.objectiveId === gap.objectiveId))
        return 'RESTRICCION';
    if (gap.clientId && (emp.restriccionesCliente || []).some((r) => r.clientId === gap.clientId)) {
        return 'RESTRICCION';
    }
    const required = gap.aptitudesRequeridas || [];
    if (required.length === 0)
        return null;
    const vigentes = (emp.aptitudes || [])
        .filter((a) => !a.vigencia || a.vigencia >= nowYmd)
        .map((a) => norm(a.codigo));
    if (required.some((r) => !vigentes.includes(norm(r))))
        return 'FALTA_APTITUD';
    return null;
}
function engagedElsewhere(employeeId, input) {
    if ((input.sessionBusyEmployeeIds || []).includes(employeeId))
        return 'EN_OTRA_SESION';
    const busy = (input.engagements || []).some((e) => {
        if (e.employeeId !== employeeId)
            return false;
        if (e.shiftId && e.shiftId === input.gap.titularShiftId)
            return false;
        const st = norm(e.status);
        return st === 'PENDING' || st === 'ESCALATED';
    });
    return busy ? 'YA_CONVOCADO' : null;
}
function overlappingCoverage(employeeId, window, input) {
    return input.shifts.some((sh) => {
        if (sh.employeeId !== employeeId)
            return false;
        if (sh.coverageSuperseded === true || sh.isDeleted === true)
            return false;
        const origin = norm(sh.origin);
        const trace = sh.coverageHoursOnSource === true
            || (origin === 'OPERATIONS_COVERAGE' && (norm(sh.coverageType) === 'EXTEND' || norm(sh.coverageType) === 'ADVANCE'));
        const ops = origin === 'OPERATIONS_COVERAGE';
        if (!ops && !trace)
            return false;
        if (sh.absenceShiftId && sh.absenceShiftId === input.gap.titularShiftId)
            return false;
        return rangesOverlap(sh.startMs, sh.endMs, window.startMs, window.endMs);
    });
}
function rowFrom(type, shift, gap, reason) {
    const other = !samePosition(gap, shift);
    const retained = type === 'EXTEND' && isRetainedForGap(shift, gap);
    return {
        type,
        employeeId: shift.employeeId,
        employeeName: String(shift.employeeName || shift.employeeId),
        sourceShiftId: shift.id,
        positionRank: other ? 1 : 0,
        otherPosition: other,
        eligible: !reason,
        ...(reason ? { rejectReason: reason } : {}),
        ...(retained ? { retainedForGap: true } : {}),
    };
}
function isRetainedForGap(shift, gap) {
    if (shift.isRetention !== true)
        return false;
    const ref = String(shift.retentionAbsenceShiftId || '').trim();
    if (ref)
        return ref === String(gap.titularShiftId || '');
    return samePosition(gap, shift) && String(shift.objectiveId || '') === String(gap.objectiveId || '');
}
function sameGapDay(shift, gap) {
    return !!shift?.startMs && !!gap.startMs && arMidnight(shift.startMs) === arMidnight(gap.startMs);
}
function collapseByEmployee(rows, shifts, gap) {
    const byId = new Map(shifts.map((s) => [s.id, s]));
    const best = new Map();
    const beats = (next, prev) => {
        if (next.eligible !== prev.eligible)
            return next.eligible;
        if (!!next.retainedForGap !== !!prev.retainedForGap)
            return !!next.retainedForGap;
        const nextDay = sameGapDay(byId.get(next.sourceShiftId), gap);
        const prevDay = sameGapDay(byId.get(prev.sourceShiftId), gap);
        if (nextDay !== prevDay)
            return nextDay;
        if (next.positionRank !== prev.positionRank)
            return next.positionRank < prev.positionRank;
        return false;
    };
    for (const row of rows) {
        const prev = best.get(row.employeeId);
        if (!prev || beats(row, prev))
            best.set(row.employeeId, row);
    }
    return [...best.values()];
}
function pushUnique(bucket, seen, row) {
    const key = `${row.type}|${row.employeeId}|${row.sourceShiftId}|${row.eligible ? '1' : row.rejectReason}`;
    if (seen.has(key))
        return;
    seen.add(key);
    bucket.push(row);
}
function baseReject(shift, input, accept) {
    const gap = input.gap;
    const absences = input.absences || [];
    if (gap.absentEmployeeId && shift.employeeId === gap.absentEmployeeId)
        return 'ES_EL_AUSENTE';
    if (isLicenseCode(shift.code))
        return 'LICENCIA_TURNO';
    if (onLeave(shift.employeeId, absences, gap.startMs))
        return 'LICENCIA_RRHH';
    if (gap.alreadyCovered)
        return 'HUECO_CUBIERTO';
    const hardCapMs = input.hardCapMs ?? exports.COVERAGE_HARD_CAP_MS;
    const toleranceMs = input.toleranceMs ?? exports.COVERAGE_JOIN_TOLERANCE_MS;
    if (isZombie(shift, gap, input.nowMs, hardCapMs, toleranceMs))
        return 'ZOMBI';
    if (shift.isAbsent === true)
        return 'AUSENTE';
    if (!accept && shift.isCompleted === true)
        return 'COMPLETADO';
    const empReason = restrictionOrAptitude(employeeOf(input, shift.employeeId), gap, new Date(arMidnight(gap.startMs) - AR_OFFSET_MS).toISOString().slice(0, 10));
    if (empReason)
        return empReason;
    const busy = engagedElsewhere(shift.employeeId, input);
    if (busy)
        return busy;
    return null;
}
function considerExt(shift, input, accept) {
    const common = baseReject(shift, input, accept);
    if (common)
        return common;
    const toleranceMs = input.toleranceMs ?? exports.COVERAGE_JOIN_TOLERANCE_MS;
    const hardCapMs = input.hardCapMs ?? exports.COVERAGE_HARD_CAP_MS;
    if (!accept && shift.isPresent !== true)
        return 'NO_PRESENTE';
    if (Math.abs(shift.endMs - input.gap.startMs) > toleranceMs)
        return 'NO_CONTIGUO';
    const until = dualSegmentBounds(input.gap).extEndMs;
    const start = workStart(shift);
    if (start && until && until - start > hardCapMs)
        return 'TOPE_12_59';
    const winEnd = until || input.gap.endMs;
    if (overlappingCoverage(shift.employeeId, { startMs: input.gap.startMs, endMs: winEnd }, input)) {
        return 'SOLAPA_COBERTURA';
    }
    return null;
}
function considerAdv(shift, input, accept) {
    const common = baseReject(shift, input, accept);
    if (common)
        return common;
    if (shift.isFranco === true || FRANCO_CODES.has(norm(shift.code)))
        return 'NO_CONTIGUO';
    if (norm(shift.code) === 'RET' || norm(shift.code) === 'REF' || norm(shift.code) === 'ESC')
        return 'NO_CONTIGUO';
    const toleranceMs = input.toleranceMs ?? exports.COVERAGE_JOIN_TOLERANCE_MS;
    const hardCapMs = input.hardCapMs ?? exports.COVERAGE_HARD_CAP_MS;
    if (!accept && shift.isPresent === true && shift.startMs <= input.nowMs)
        return 'NO_CONTIGUO';
    if (Math.abs(shift.startMs - input.gap.endMs) > toleranceMs)
        return 'NO_CONTIGUO';
    const from = dualSegmentBounds(input.gap).advStartMs;
    if (from && shift.endMs && shift.endMs - from > hardCapMs)
        return 'TOPE_12_59';
    if (overlappingCoverage(shift.employeeId, { startMs: from || input.gap.startMs, endMs: shift.endMs || input.gap.endMs }, input)) {
        return 'SOLAPA_COBERTURA';
    }
    return null;
}
function considerInternal(shift, input, accept, kind) {
    if (shift.coverageUsed === true)
        return 'COBERTURA_USADA';
    const common = baseReject(shift, input, accept);
    if (common)
        return common;
    if (!sourceOverlapsGap(shift, input.gap))
        return 'SIN_SOLAPE';
    if (overlappingCoverage(shift.employeeId, { startMs: input.gap.startMs, endMs: input.gap.endMs }, input)) {
        return 'SOLAPA_COBERTURA';
    }
    if (!accept && shift.isCompleted === true)
        return 'COMPLETADO';
    return null;
}
function isRealCoverageWork(sh) {
    if (sh.coverageSuperseded === true || sh.isDeleted === true || sh.isAbsent === true)
        return false;
    if (norm(sh.origin) !== 'OPERATIONS_COVERAGE')
        return false;
    if (sh.coverageHoursOnSource === true)
        return false;
    return !!sh.startMs && !!sh.endMs && sh.endMs > sh.startMs;
}
function ftAlreadyWorked(shift, input) {
    const gap = input.gap;
    const hardCapMs = input.hardCapMs ?? exports.COVERAGE_HARD_CAP_MS;
    const gapLen = Math.max(0, (gap.endMs || 0) - (gap.startMs || 0));
    const gapDay = arMidnight(gap.startMs);
    let worked = 0;
    for (const sh of input.shifts) {
        if (sh.employeeId !== shift.employeeId || sh.id === shift.id)
            continue;
        if (!isRealCoverageWork(sh))
            continue;
        if (sh.absenceShiftId && sh.absenceShiftId === gap.titularShiftId)
            return 'SOLAPA_COBERTURA';
        if (rangesOverlap(sh.startMs, sh.endMs, gap.startMs, gap.endMs))
            return 'SOLAPA_COBERTURA';
        if (sh.endMs <= gap.startMs && gap.startMs - sh.endMs < COVERAGE_MIN_REST_MS)
            return 'DESCANSO';
        if (gap.endMs <= sh.startMs && sh.startMs - gap.endMs < COVERAGE_MIN_REST_MS)
            return 'DESCANSO';
        const touchesGapDay = arMidnight(sh.startMs) === gapDay || arMidnight(sh.endMs - 1) === gapDay;
        if (touchesGapDay)
            worked += sh.endMs - sh.startMs;
    }
    if (worked + gapLen > hardCapMs)
        return 'TOPE_12_59';
    return null;
}
function considerFt(shift, input, accept) {
    const common = baseReject(shift, input, accept);
    if (common)
        return common;
    const code = norm(shift.code);
    const franco = shift.isFranco === true || FRANCO_CODES.has(code);
    const alreadyFt = code === 'FT';
    if (!franco && !alreadyFt)
        return 'SIN_SOLAPE';
    if (!shift.startMs || arMidnight(shift.startMs) !== arMidnight(input.gap.startMs))
        return 'SIN_SOLAPE';
    if (overlappingCoverage(shift.employeeId, { startMs: input.gap.startMs, endMs: input.gap.endMs }, input)) {
        return 'SOLAPA_COBERTURA';
    }
    return ftAlreadyWorked(shift, input);
}
function plausible(type, shift, gap) {
    if (!shift.employeeId || shift.employeeId === 'VACANTE')
        return false;
    if (shift.isVirtual === true || shift.draft === true || shift.isDeleted === true)
        return false;
    if (shift.id === gap.titularShiftId)
        return false;
    const sameObj = String(shift.objectiveId || '') === String(gap.objectiveId || '');
    const code = norm(shift.code);
    if (type === 'FT') {
        if (norm(shift.origin) === 'OPERATIONS_COVERAGE')
            return false;
        return FRANCO_CODES.has(code) || code === 'FT';
    }
    if (!sameObj)
        return false;
    if (type === 'RET')
        return code === 'RET';
    if (type === 'REF')
        return code === 'REF';
    if (type === 'ESC')
        return code === 'ESC';
    if (type === 'EXTEND') {
        return shift.isPresent === true
            || shift.employeeId === gap.absentEmployeeId
            || isLicenseCode(code)
            || isZombie(shift, gap, shift.endMs + 1, exports.COVERAGE_HARD_CAP_MS, exports.COVERAGE_JOIN_TOLERANCE_MS);
    }
    if (isLicenseCode(code) || FRANCO_CODES.has(code) || code === 'RET' || code === 'REF' || code === 'ESC' || code === 'FT') {
        return isLicenseCode(code);
    }
    return true;
}
function decide(type, shift, input) {
    const accept = input.purpose === 'accept';
    if (type === 'EXTEND')
        return considerExt(shift, input, accept);
    if (type === 'ADVANCE')
        return considerAdv(shift, input, accept);
    if (type === 'FT')
        return considerFt(shift, input, accept);
    return considerInternal(shift, input, accept, type);
}
function buildCoverageCandidates(input) {
    const byType = emptyByType();
    const seen = new Set();
    const types = exports.COVERAGE_CASCADE_ORDER;
    for (const type of types) {
        for (const shift of input.shifts) {
            if (!plausible(type, shift, input.gap))
                continue;
            if (type === 'EXTEND' && norm(shift.origin) === 'OPERATIONS_COVERAGE')
                continue;
            const reason = decide(type, shift, input);
            pushUnique(byType[type], seen, rowFrom(type, shift, input.gap, reason || undefined));
        }
    }
    const leaveIds = new Set();
    for (const abs of input.absences || []) {
        if (absenceBlocks(abs, input.gap.startMs))
            leaveIds.add(abs.employeeId);
    }
    for (const employeeId of leaveIds) {
        if (input.gap.absentEmployeeId && employeeId === input.gap.absentEmployeeId)
            continue;
        for (const type of types) {
            const already = byType[type].some((r) => r.employeeId === employeeId);
            if (already)
                continue;
            pushUnique(byType[type], seen, {
                type,
                employeeId,
                employeeName: employeeOf(input, employeeId)?.name || employeeId,
                sourceShiftId: '',
                positionRank: 1,
                otherPosition: false,
                eligible: false,
                rejectReason: 'LICENCIA_RRHH',
            });
        }
    }
    for (const type of types) {
        byType[type] = collapseByEmployee(byType[type], input.shifts, input.gap);
        byType[type].sort((a, b) => {
            if (a.eligible !== b.eligible)
                return a.eligible ? -1 : 1;
            if (!!a.retainedForGap !== !!b.retainedForGap)
                return a.retainedForGap ? -1 : 1;
            if (a.positionRank !== b.positionRank)
                return a.positionRank - b.positionRank;
            return a.employeeName.localeCompare(b.employeeName, 'es');
        });
    }
    const eligible = types.flatMap((t) => byType[t].filter((r) => r.eligible));
    const rejected = types.flatMap((t) => byType[t].filter((r) => !r.eligible));
    return { byType, eligible, rejected };
}
function pickBestCandidate(set, type) {
    return set.byType[type].find((r) => r.eligible) || null;
}
function acceptanceStillValid(input, type, employeeId, sourceShiftId) {
    if (!exports.COVERAGE_CASCADE_ORDER.includes(type)) {
        return { ok: true };
    }
    if (input.gap.alreadyCovered) {
        return { ok: false, reason: 'HUECO_CUBIERTO', message: coverageRejectMessage('HUECO_CUBIERTO') };
    }
    const set = buildCoverageCandidates({ ...input, purpose: input.purpose || 'accept' });
    const rows = set.byType[type].filter((r) => r.employeeId === employeeId);
    const match = sourceShiftId
        ? rows.find((r) => r.sourceShiftId === sourceShiftId) || rows[0]
        : rows[0];
    if (match?.eligible)
        return { ok: true };
    const reason = match?.rejectReason || 'NO_CONTIGUO';
    return { ok: false, reason, message: coverageRejectMessage(reason) };
}
//# sourceMappingURL=coverageCandidates.js.map