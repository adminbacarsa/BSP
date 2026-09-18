import { isOpsShiftHoy } from '@/hooks/useOperacionesMonitor';
import { isObjectiveEligibleForCcMonth } from '@/lib/operaciones/ccObjectiveEligibility';

const TZ_AR = 'America/Argentina/Cordoba';

function formatTimeRangeForAlert(start: Date | null | undefined, end: Date | null | undefined): string {
    if (!(start instanceof Date) || Number.isNaN(start.getTime())) return '';
    const fmt = (d: Date) =>
        d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: TZ_AR });
    if (end instanceof Date && !Number.isNaN(end.getTime()) && end.getTime() > start.getTime()) {
        return `${fmt(start)} – ${fmt(end)}`;
    }
    return fmt(start);
}

function shiftSlotBrief(shift: any): string {
    if (!shift) return '';
    const code = String(shift.code || shift.shiftCode || '').trim().toUpperCase();
    const pos = String(shift.positionName || '').trim();
    const horario = formatTimeRangeForAlert(shift.shiftDateObj, shift.endDateObj);
    return [code, pos, horario].filter(Boolean).join(' · ');
}

const ABSENCE_ALERT_TYPES = new Set([
    'AUSENCIA_AUTO',
    'AUSENCIA_OPERATIVA',
    'RELEVO_NO_PRESENTADO',
    'AUSENCIA_CORTO_PLAZO',
]);

const CC_SCOPE_NOISE_TYPES = new Set([
    'CONVOCATORIA_ENVIADA',
    'CONVOCATORIA_ESCALADA',
]);

/**
 * Normaliza campos de novedades para el panel Alertas / popup de detalle.
 * El backend a veces usa `message` (p. ej. COBERTURA_RESUELTA) y a veces `description`.
 */

const TRAILING_DASHES = /\s*[—\-–·.]{1,4}\s*$/g;

export function novedadBodyText(n: any): string {
    const raw = String(n?.description || n?.message || n?.body || n?.motivo || '').trim();
    return raw.replace(TRAILING_DASHES, '').trim();
}

/** Quién figura en la alerta (titular, candidato de cobertura, etc.). */
export function novedadActorName(n: any): string {
    return String(
        n?.candidateEmployeeName ||
        n?.employeeName ||
        n?.coveredByName ||
        n?.guardiaName ||
        '',
    ).trim();
}

export function novedadHeadline(n: any): string {
    const actor = novedadActorName(n);
    const obj = String(n?.objectiveName || '').trim();
    if (actor && obj) return `${actor} · ${obj}`;
    if (actor) return actor;
    if (obj) return obj;
    const title = String(n?.title || '').trim();
    if (title) return title;
    return String(n?.type || 'Novedad').replace(/_/g, ' ');
}

/** Segunda línea: puesto / mensaje, sin repetir el nombre del headline. */
export function novedadSubline(n: any, processedData?: any[]): string {
    const body = novedadBodyText(n);
    const pos = String(n?.positionName || '').trim();
    const actor = novedadActorName(n);
    const type = String(n?.type || '');

    if (ABSENCE_ALERT_TYPES.has(type)) {
        const shiftId = String(n?.shiftId || '').trim();
        const shift = shiftId ? (processedData || []).find((s: any) => s.id === shiftId) : null;
        const slot = shift ? shiftSlotBrief(shift) : shiftSlotBrief({
            code: n.shiftCode,
            positionName: n.positionName,
        });
        let tail = body;
        if (actor && tail.toLowerCase().startsWith(actor.toLowerCase())) {
            tail = tail.slice(actor.length).replace(/^[\s·,:—\-–]+/, '').trim();
        }
        tail = tail.replace(/\s*\(MODO DEMO\)\s*$/i, '').replace(/\s*\(detectado[^)]*\)\s*$/i, '').trim();
        if (!tail || /^no se presentó/i.test(tail) || tail === '—') {
            tail = n.source === 'MODO_DEMO' || n.reportedBy === 'MODO_DEMO' ? 'No se presentó (demo)' : 'No se presentó';
        }
        if (slot) return `${slot} — ${tail}`;
        if (pos && !tail.toLowerCase().includes(pos.toLowerCase())) return `${pos} · ${tail}`;
        return tail || pos;
    }

    if (type === 'COBERTURA_RESUELTA') {
        if (body) return body;
        const cov = String(n?.coverageType || '').trim();
        const who = actor || 'Guardia';
        const where = String(n?.objectiveName || 'objetivo').trim();
        return cov
            ? `${who} cubrió el puesto (${cov}) en ${where}`
            : `${who} cubrió el puesto en ${where}`;
    }

    if (body) {
        if (actor) {
            const actorLow = actor.toLowerCase();
            const bodyLow = body.toLowerCase();
            // "NOMBRE no se presentó —" → recortar prefijo redundante
            if (bodyLow.startsWith(actorLow)) {
                const rest = body.slice(actor.length).replace(/^[\s·,:—\-–]+/, '').trim();
                if (rest) return pos && !rest.toLowerCase().includes(pos.toLowerCase()) ? `${pos} · ${rest}` : rest;
            }
        }
        if (pos && !body.toLowerCase().includes(pos.toLowerCase())) return `${pos} · ${body}`;
        return body;
    }

    if (pos) return pos;
    return '';
}

/** Tipos informativos: ya están resueltos; el operador solo confirma lectura. */
export const INFO_NOVEDAD_TYPES = new Set([
    'COBERTURA_RESUELTA',
    'TURNO_COMPLETADO_AUTO',
    'INGRESO_AUTOREGISTRO',
]);

/**
 * Fin de turno rutinario: el toast basta.
 * Al completar, el objetivo sale de ACT → en Alertas parece “objetivo sin personal”.
 * No deben ocupar el inbox de CC / mapa.
 */
export const HIDDEN_FROM_OPS_ALERTS_TYPES = new Set([
    'TURNO_COMPLETADO_AUTO',
    'CONVOCATORIA_ENVIADA',
]);

/**
 * Novedad fuera del CC: falta SLA vigente en el mes o cronograma publicado.
 */
export function isNovedadOutsideCcMonitorScope(
    n: any,
    processedData: any[],
    publishStatusMap: Record<string, boolean>,
    servicesSLA: any[] = [],
    now: Date = new Date(),
): boolean {
    const objId = String(n?.objectiveId || '').trim();
    if (!objId) return false;

    const shiftId = String(n?.shiftId || '').trim();
    if (shiftId && (processedData || []).some((s) => s.id === shiftId)) return false;

    const visibleToday = (processedData || []).some(
        (s) => String(s.objectiveId || '') === objId && isOpsShiftHoy(s, now),
    );
    if (visibleToday) return false;

    if (isObjectiveEligibleForCcMonth(objId, now.getFullYear(), now.getMonth(), publishStatusMap, servicesSLA)) {
        return false;
    }

    const type = String(n?.type || '');
    if (CC_SCOPE_NOISE_TYPES.has(type)) return true;
    if (type.startsWith('IA_ALERTA_')) return true;
    if (ABSENCE_ALERT_TYPES.has(type)) return true;
    if (
        type === 'VACANTE_PROTOCOLO_COBERTURA' ||
        type === 'VACANTE_OPERATIVA' ||
        type === 'CONVOCATORIA_COBERTURA' ||
        type === 'CONVOCATORIA_RETEN'
    ) {
        return true;
    }
    return false;
}

/** Ruido ligado a un turno: si el guardia ya no está presente, no alertar. */
export const SHIFT_TIED_NOISE_TYPES = new Set([
    'RECARGO_12H',
    'RETENCION_DETECTADA',
    'RETENCION_LARGA',
]);

export function isInformationalNovedad(n: any): boolean {
    return INFO_NOVEDAD_TYPES.has(String(n?.type || ''));
}

export function isHiddenFromOpsAlerts(n: any): boolean {
    return HIDDEN_FROM_OPS_ALERTS_TYPES.has(String(n?.type || ''));
}

/**
 * REC+12 / retención: ocultar si el turno ya no está presente en el monitor
 * (cerrado, fuera de ventana, u objetivo sin ACT) o si el horario ya venció hace rato (zombie).
 */
const IA_AUTOMATION_TYPE_PREFIX = 'IA_ALERTA_';

function shiftIsOverlapExemptOps(s: any): boolean {
    if (!s) return false;
    const origin = String(s.origin || '');
    if (origin === 'OPERATIONS_COVERAGE') return true;
    if (s.resolvedBy === 'OPERACIONES' || s.resolvedBy === 'MODO_DEMO') {
        if (origin === 'OPERATIONS_COVERAGE' || s.absenceShiftId || s.coveredShiftId || s.modoDemoAt) {
            return true;
        }
        if (String(s.code || '').toUpperCase() === 'FT') return true;
    }
    if (s.absenceShiftId || s.coveredShiftId) return true;
    return false;
}

function parseOverlapFingerprint(fp: string): [string, string] | null {
    const raw = String(fp || '').trim();
    if (!raw.startsWith('overlap__')) return null;
    const rest = raw.slice('overlap__'.length);
    const sep = rest.lastIndexOf('__');
    if (sep <= 0) return null;
    const a = rest.slice(0, sep);
    const b = rest.slice(sep + 2);
    return a && b ? [a, b] : null;
}

function processedDataHasAbsenceCoverage(processedData: any[], absentShiftId: string): boolean {
    return (processedData || []).some((s: any) => {
        if (!s || s.isAbsent || s.isUnassigned) return false;
        const emp = String(s.employeeId || '').trim().toUpperCase();
        if (!emp || emp === 'VACANTE') return false;
        const link = String(s.absenceShiftId || s.coveredShiftId || s.causedByShiftId || '').trim();
        if (link !== absentShiftId) return false;
        return (
            s.origin === 'OPERATIONS_COVERAGE' ||
            s.resolvedBy === 'OPERACIONES' ||
            s.isPresent === true ||
            s.isAwaitingCoverageCheckIn === true
        );
    });
}

/** IA P0: ocultar si el turno ya no está en la ventana operativa del monitor. */
export function isStaleIaAutomationNovedad(n: any, processedData: any[]): boolean {
    const type = String(n?.type || '');
    if (!type.startsWith(IA_AUTOMATION_TYPE_PREFIX)) return false;
    if (String(n?.origin || '') !== 'AUTOMATION_P0') return false;
    const shiftId = String(n?.shiftId || '').trim();
    if (!shiftId) return true;

    if (type === 'IA_ALERTA_AUSENCIA_SIN_COBERTURA') {
        if (processedDataHasAbsenceCoverage(processedData, shiftId)) return true;
    }

    if (type === 'IA_ALERTA_SOLAPAMIENTO_TURNOS') {
        const fp = String(n?.automationFingerprint || '').trim();
        const pair = parseOverlapFingerprint(fp);
        if (pair) {
            const [a, b] = pair;
            const sa = (processedData || []).find((s: any) => s.id === a);
            const sb = (processedData || []).find((s: any) => s.id === b);
            if (shiftIsOverlapExemptOps(sa) || shiftIsOverlapExemptOps(sb)) return true;
            if (sa?.isCompleted && sb?.isCompleted) return true;
        }
    }

    const shift = (processedData || []).find((s: any) => s.id === shiftId);
    if (!shift) return true;
    const now = new Date();
    if (!isOpsShiftHoy(shift, now)) return true;
    if (shift.isCompleted && !shift.isRetention) return true;

    if (type === 'IA_ALERTA_AUSENCIA_SIN_COBERTURA') {
        const endMs = shift.endDateObj?.getTime?.() ?? 0;
        if (endMs > 0 && now.getTime() > endMs + 30 * 60 * 1000) return true;
    }

    return false;
}

export function isOrphanShiftNoiseNovedad(n: any, processedData: any[]): boolean {
    const type = String(n?.type || '');
    if (!SHIFT_TIED_NOISE_TYPES.has(type)) return false;
    const shiftId = n?.shiftId;
    if (!shiftId) return true;
    const shift = (processedData || []).find((s: any) => s.id === shiftId);
    if (!shift) return true;
    if (shift.isCompleted || shift.status === 'COMPLETED') return true;
    if (!(shift.isPresent || shift.status === 'PRESENT')) return true;
    const endMs = shift.endDateObj?.getTime?.() ?? 0;
    // Horario vencido >2h: no es retención operativa, es zombie (p.ej. Demo sin cierre)
    if (endMs > 0 && Date.now() - endMs > 2 * 60 * 60 * 1000) return true;
    return false;
}

export const COBERTURA_RESUELTA_META = {
    label: 'CUBIERTO',
    bg: 'bg-emerald-600',
    text: 'text-white',
    border: 'border-emerald-500',
    listBg: 'bg-emerald-100 text-emerald-800',
    listBorder: 'border-l-emerald-500',
    actionBg: 'bg-emerald-600 hover:bg-emerald-700',
};
