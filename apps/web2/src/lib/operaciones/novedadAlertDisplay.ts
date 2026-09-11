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
export function novedadSubline(n: any): string {
    const body = novedadBodyText(n);
    const pos = String(n?.positionName || '').trim();
    const actor = novedadActorName(n);
    const type = String(n?.type || '');

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
]);

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
