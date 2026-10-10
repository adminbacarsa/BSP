/**
 * Cerrar la banda que falta con dos jornadas de 12 h (D12 + N12),
 * la misma cuenta que «Puestos sin cerrar».
 */

export type TurnoPuesto12 = {
    empId: string;
    nombre: string;
    dateStr: string;
    code: string;
    positionName: string;
};

export type Horario12 = { startTime: string; endTime: string; hours: number };

export type Cambio12h = {
    empId: string;
    nombre: string;
    dateStr: string;
    code: 'D12' | 'N12' | 'M' | 'T' | 'N';
    startTime: string;
    endTime: string;
    hours: number;
};

export type Propuesta12h = {
    dateStr: string;
    positionName: string;
    banda: string;
    modo: 'par' | 'uno';
    cambios: Cambio12h[];
    texto: string;
};

const OCHO: Record<'M' | 'T' | 'N', Horario12> = {
    M: { startTime: '07:00', endTime: '15:00', hours: 8 },
    T: { startTime: '15:00', endTime: '23:00', hours: 8 },
    N: { startTime: '23:00', endTime: '07:00', hours: 8 },
};

const DOCE: Record<'D12' | 'N12', Horario12> = {
    D12: { startTime: '07:00', endTime: '19:00', hours: 12 },
    N12: { startTime: '19:00', endTime: '07:00', hours: 12 },
};

function up(v: unknown): string {
    return String(v || '').trim().toUpperCase();
}

export function apellidoCorto(nombre: string): string {
    const base = String(nombre || '').split(',')[0].trim();
    return (base.split(/\s+/)[0] || nombre || '').toUpperCase();
}

export function horarioDoce(
    code: 'D12' | 'N12',
    sla?: ReadonlyArray<{ code?: string; startTime?: string; endTime?: string; hours?: number }>,
): Horario12 & { code: 'D12' | 'N12' } {
    const hit = (sla || []).find((s) => up(s.code) === code && s.startTime && s.endTime);
    if (hit) {
        return {
            code,
            startTime: String(hit.startTime),
            endTime: String(hit.endTime),
            hours: Number(hit.hours) || DOCE[code].hours,
        };
    }
    return { code, ...DOCE[code] };
}

export function volverA8(code: string): { code: 'M' | 'N'; startTime: string; endTime: string; hours: number } | null {
    const c = up(code);
    if (c === 'D12') return { code: 'M', ...OCHO.M };
    if (c === 'N12') return { code: 'N', ...OCHO.N };
    return null;
}

function mismoPuesto(a: string, b: string): boolean {
    return up(a).replace(/\s+/g, ' ') === up(b).replace(/\s+/g, ' ');
}

function elegir(lista: TurnoPuesto12[], preferido?: string): TurnoPuesto12 | null {
    if (!lista.length) return null;
    return lista.find((t) => t.empId === preferido) || lista[0];
}

function cambio(t: TurnoPuesto12, h: Horario12 & { code: 'D12' | 'N12' }): Cambio12h {
    return {
        empId: t.empId,
        nombre: t.nombre,
        dateStr: t.dateStr,
        code: h.code,
        startTime: h.startTime,
        endTime: h.endTime,
        hours: h.hours,
    };
}

function textoDe(banda: string, puesto: string, cambios: Cambio12h[]): string {
    const partes = cambios.map((c) => `${apellidoCorto(c.nombre)} ${c.code} ${c.startTime}–${c.endTime}`);
    return `Cubre la ${banda} de ${puesto}: ${partes.join(' + ')} · Enter confirma, Esc cancela`;
}

/**
 * Falta una banda de 8 h y en el puesto ya hay las otras dos: el par pasa a D12 + N12.
 * Si solo hay un lado, lo propone solo (la grilla lo escribe con el cierre de un guardia).
 */
export function proponerCierre12h(input: {
    dateStr: string;
    positionName: string;
    faltantes: readonly string[];
    turnos: readonly TurnoPuesto12[];
    preferidoEmpId?: string;
    sla?: ReadonlyArray<{ code?: string; startTime?: string; endTime?: string; hours?: number }>;
}): Propuesta12h | null {
    const falta = new Set(input.faltantes.map(up));
    const delPuesto = input.turnos.filter((t) => mismoPuesto(t.positionName, input.positionName));
    const delDia = (code: string, dateStr = input.dateStr) =>
        delPuesto.filter((t) => up(t.code) === code && t.dateStr === dateStr);
    const m = elegir(delDia('M'), input.preferidoEmpId);
    const t = elegir(delDia('T'), input.preferidoEmpId);
    const nMismo = elegir(delDia('N'), input.preferidoEmpId);
    const nPrev = elegir(delPuesto.filter((x) => up(x.code) === 'N' && x.dateStr < input.dateStr), input.preferidoEmpId);
    const n = nMismo || nPrev;
    const d12 = horarioDoce('D12', input.sla);
    const n12 = horarioDoce('N12', input.sla);

    const par = (banda: string, a: TurnoPuesto12, ha: Horario12 & { code: 'D12' | 'N12' }, b: TurnoPuesto12, hb: Horario12 & { code: 'D12' | 'N12' }): Propuesta12h => {
        const cambios = [cambio(a, ha), cambio(b, hb)];
        return { dateStr: input.dateStr, positionName: input.positionName, banda, modo: 'par', cambios, texto: textoDe(banda, input.positionName, cambios) };
    };
    const uno = (banda: string, a: TurnoPuesto12, h: Horario12 & { code: 'D12' | 'N12' }): Propuesta12h => {
        const cambios = [cambio(a, h)];
        return { dateStr: input.dateStr, positionName: input.positionName, banda, modo: 'uno', cambios, texto: textoDe(banda, input.positionName, cambios) };
    };

    if (falta.has('T') && m && n) return par('T', m, d12, n, n12);
    if (falta.has('M') && t && n) return par('M', t, d12, n, n12);
    if (falta.has('N') && m && t) return par('N', m, d12, t, n12);
    if (falta.has('T') && m) return uno('T', m, d12);
    if (falta.has('T') && n) return uno('T', n, n12);
    if (falta.has('M') && t) return uno('M', t, d12);
    if (falta.has('M') && n) return uno('M', n, n12);
    if (falta.has('N') && t) return uno('N', t, n12);
    if (falta.has('N') && m) return uno('N', m, d12);
    return null;
}

export function textoResumen12h(propuestas: readonly Propuesta12h[]): string {
    return propuestas.map((p) => p.texto.replace(/ · Enter confirma, Esc cancela$/, '')).join('\n');
}
