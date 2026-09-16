/**
 * Normaliza campos de novedades para el panel Alertas / popup de detalle.
 * El backend a veces usa `message` (p. ej. COBERTURA_RESUELTA) y a veces `description`.
 */

const TRAILING_DASHES = /\s*[—\-–·.]{1,4}\s*$/g;

/** Evita mostrar IDs Firestore como si fueran nombres de objetivo/guardia. */
export function etiquetaPareceIdFirestore(text: string, docId = ''): boolean {
    const e = String(text || '').trim();
    if (!e) return true;
    const id = String(docId || '').trim();
    if (id && (e === id || e === id.slice(0, 12))) return true;
    return e.length >= 10 && !/\s/.test(e) && /^[a-zA-Z0-9_-]+$/.test(e);
}

type IaAlertParsed = {
    employeeName?: string;
    objectiveName?: string;
    code?: string;
    detail?: string;
};

function parseIaAlertDescription(body: string): IaAlertParsed | null {
    const raw = String(body || '').trim();
    if (!raw) return null;
    const sep = raw.indexOf(' — ');
    if (sep < 0) return null;
    const head = raw.slice(0, sep);
    const detail = raw.slice(sep + 3).trim();
    const headParts = head.split(' · ').map((p) => p.trim()).filter(Boolean);
    if (headParts.length < 3) return null;
    const [employeeName, objectiveName, code] = headParts;
    return {
        employeeName,
        objectiveName: etiquetaPareceIdFirestore(objectiveName) ? undefined : objectiveName,
        code,
        detail: detail.replace(/\bpara empleado [a-zA-Z0-9_-]{10,}\b/gi, '').replace(/\s+/g, ' ').trim(),
    };
}

function sanitizeDisplayLabel(text: string, docId = ''): string {
    const t = String(text || '').trim();
    if (!t) return '';
    if (etiquetaPareceIdFirestore(t, docId)) return '';
    return t;
}

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
    const type = String(n?.type || '');
    const actor = sanitizeDisplayLabel(novedadActorName(n), String(n?.employeeId || ''));
    let obj = sanitizeDisplayLabel(String(n?.objectiveName || '').trim(), String(n?.objectiveId || ''));

    if (type.startsWith('IA_ALERTA_')) {
        const parsed = parseIaAlertDescription(novedadBodyText(n));
        const name = sanitizeDisplayLabel(parsed?.employeeName || actor, String(n?.employeeId || '')) || actor;
        const place = parsed?.objectiveName || obj;
        if (name && place) return `${name} · ${place}`;
        if (name) return name;
        const title = String(n?.title || '').trim();
        if (title) return title;
    }

    if (actor && obj) return `${actor} · ${obj}`;
    if (actor) return actor;
    if (obj) return obj;
    const title = String(n?.title || '').trim();
    if (title) return title;
    return type.replace(/_/g, ' ') || 'Novedad';
}

/** Segunda línea: puesto / mensaje, sin repetir el nombre del headline. */
export function novedadSubline(n: any): string {
    const body = novedadBodyText(n);
    const pos = String(n?.positionName || '').trim();
    const actor = novedadActorName(n);
    const type = String(n?.type || '');

    if (type.startsWith('IA_ALERTA_')) {
        const parsed = parseIaAlertDescription(body);
        if (parsed?.detail) {
            const codePart = parsed.code ? `${parsed.code} — ` : '';
            return `${codePart}${parsed.detail}`;
        }
        if (body && !etiquetaPareceIdFirestore(body.split(' · ')[1] || '')) return body;
        const title = String(n?.title || '').trim();
        if (title) return title;
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
/** Alertas IA ligadas a turnos que Ops no trata como guardia real (vacante de malla, fuera de monitor, etc.). */
export function isStaleIaAutomationNovedad(n: any, processedData: any[]): boolean {
    const type = String(n?.type || '');
    if (!type.startsWith('IA_ALERTA_')) return false;
    const shiftId = String(n?.shiftId || '').trim();
    if (!shiftId) return true;
    const shift = (processedData || []).find((s: any) => s.id === shiftId);
    if (!shift) return true;
    const empId = String(shift.employeeId || '').trim();
    if (!empId || empId.toUpperCase() === 'VACANTE') return true;
    if (shift.isFranco === true) return true;
    if (shift.isCompleted === true) return true;
    if (shift.status === 'COVERED' && shift.isAbsent !== true) return true;
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
