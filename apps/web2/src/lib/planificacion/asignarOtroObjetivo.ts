/**
 * Asignar, desde un cronograma, un turno que vive en otro objetivo.
 * La celda de origen queda como «Turno en {objetivo}». Solo si ese día
 * el guardia no tiene turno ni licencia en ningún objetivo.
 */

export type TurnoEseDia = {
    objectiveId: string;
    objectiveName: string;
    clientId?: string;
    code: string;
    esLicencia?: boolean;
};

export type DecisionOtroObjetivo =
    | { ok: true }
    | {
        ok: false;
        mensaje: string;
        abrir: {
            objectiveId: string;
            clientId: string;
            year: number;
            month: number;
            dateStr: string;
            empId: string;
        } | null;
    };

const LICENCIA = new Set(['V', 'L', 'E', 'A', 'AA', 'PG', 'ART', 'SGS', 'SUS', 'LT', 'MAVIC']);

function up(v: unknown): string {
    return String(v || '').trim().toUpperCase();
}

export function fechaCorta(dateStr: string): string {
    const [y, m, d] = String(dateStr || '').split('-');
    if (!y || !m || !d) return dateStr;
    return `${d}/${m}`;
}

export function urlCronograma(input: {
    objectiveId: string;
    clientId?: string;
    year: number;
    month: number;
    dateStr?: string;
    empId?: string;
}): string {
    const q = new URLSearchParams({
        objectiveId: input.objectiveId,
        year: String(input.year),
        month: String(input.month),
    });
    if (input.clientId) q.set('clientId', input.clientId);
    if (input.dateStr) q.set('dia', input.dateStr);
    if (input.empId) q.set('empId', input.empId);
    return `/admin/planificacion/?${q.toString()}`;
}

/** Publicado: corrección (permiso correct). Sin publicar: borrador. */
export function modoEscrituraOtroObjetivo(publicado: boolean, puedeCorregir: boolean):
    | { ok: true; draft: boolean }
    | { ok: false; mensaje: string } {
    if (!publicado) return { ok: true, draft: true };
    if (!puedeCorregir) return { ok: false, mensaje: 'Ese mes está publicado: hace falta el permiso de corrección.' };
    return { ok: true, draft: false };
}

export function decidirAsignacionOtroObjetivo(input: {
    nombre: string;
    empId: string;
    dateStr: string;
    turnos: readonly TurnoEseDia[];
}): DecisionOtroObjetivo {
    const anio = Number(input.dateStr.slice(0, 4));
    const mes = Number(input.dateStr.slice(5, 7));
    const ocupado = input.turnos.find((t) => up(t.code) || t.esLicencia);
    if (!ocupado) return { ok: true };
    const codigo = up(ocupado.code) || (ocupado.esLicencia ? 'licencia' : 'turno');
    const mensaje = `${input.nombre} ya tiene ${codigo} en ${ocupado.objectiveName || 'otro objetivo'} el ${fechaCorta(input.dateStr)}`;
    return {
        ok: false,
        mensaje,
        abrir: ocupado.objectiveId
            ? {
                objectiveId: ocupado.objectiveId,
                clientId: ocupado.clientId || '',
                year: anio,
                month: mes,
                dateStr: input.dateStr,
                empId: input.empId,
            }
            : null,
    };
}

export function esLicenciaCodigo(code: string): boolean {
    return LICENCIA.has(up(code));
}

/** «VF/T», «MISE 2/T», «PM / T», «BANCO». La marca va al objetivo; la banda, al turno. */
export function partirCodigoAjeno(raw: string): { marca: string; banda: string | null } | null {
    const visible = String(raw || '').trim().replace(/\s+/g, ' ');
    if (!visible) return null;
    const compact = visible.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    if (/^(M|T|N|D12|N12|F|FF|FP|FT|RET|REF|ESC|V|L|E|A|AA|PG|ART|SGS|SUS|LT|EV)$/.test(compact.replace(/\s/g, ''))) return null;
    const m = compact.match(/^(.*?)(?:\s*\/\s*|\s+)(M|T|N|D12|N12)$/);
    if (m && m[1].trim()) {
        // «FT/N» es franco trabajado en la N, no un objetivo «FT».
        if (/^(FT|F|FF|FP|RET)$/.test(m[1].trim())) return null;
        return { marca: m[1].trim().replace(/\s+/g, ' '), banda: m[2] };
    }
    if (/^[A-Z0-9][A-Z0-9 .'-]{1,}$/.test(compact) && compact.length >= 2) {
        return { marca: compact.replace(/\s+/g, ' '), banda: null };
    }
    return null;
}

export type EquivalenciaOtro = {
    codigo: string;
    objectiveId: string;
    clientId: string;
    objectiveName: string;
    banda: string;
    positionName: string;
    startTime: string;
    endTime: string;
    hours: number;
};

export function resolverEquivalenciaOtro(
    raw: string,
    eqs: readonly EquivalenciaOtro[] | null | undefined,
): EquivalenciaOtro | null {
    const partido = partirCodigoAjeno(raw);
    if (!partido || !eqs?.length) return null;
    const marca = partido.marca.toUpperCase();
    const banda = (partido.banda || '').toUpperCase();
    return eqs.find((e) => up(e.codigo) === marca && (!banda || up(e.banda) === banda))
        || eqs.find((e) => up(e.codigo) === marca)
        || null;
}

export type FranjaServicio = {
    positionName: string;
    code: string;
    startTime: string;
    endTime: string;
    hours: number;
};

/** Descansa menos de 8 h, se solapa, o pasa de 200 h. */
export function validarContraTodos(input: {
    startMin: number;
    endMin: number;
    horasMes: number;
    horasTurno: number;
    otros: ReadonlyArray<{ startMin: number; endMin: number; dateOffset: -1 | 0 | 1 }>;
}): { ok: true } | { ok: false; mensaje: string } {
    const a0 = input.startMin;
    const a1 = input.endMin <= input.startMin ? input.endMin + 24 * 60 : input.endMin;
    for (const o of input.otros) {
        const b0 = o.startMin + o.dateOffset * 24 * 60;
        const b1 = (o.endMin <= o.startMin ? o.endMin + 24 * 60 : o.endMin) + o.dateOffset * 24 * 60;
        const solapa = a0 < b1 && b0 < a1;
        if (o.dateOffset === 0 && solapa) return { ok: false, mensaje: 'Se solapa con un turno que ya tiene ese día.' };
        if (!solapa) {
            const descanso = a0 >= b1 ? a0 - b1 : b0 - a1;
            if (descanso >= 0 && descanso < 8 * 60) return { ok: false, mensaje: 'Quedan menos de 8 h de descanso.' };
        }
    }
    if (input.horasMes + input.horasTurno > 200) return { ok: false, mensaje: 'Pasa las 200 h del mes.' };
    return { ok: true };
}
