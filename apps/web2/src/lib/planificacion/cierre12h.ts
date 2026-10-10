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
    hours?: number;
    /** Licencia, ausencia (AA, aviso del portal) o no es turno de trabajo de ese puesto. */
    bloqueado?: boolean;
    /** Por qué no entra al par (licencia, franco, descanso menor a 8 h). */
    motivo?: string;
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

const TRABAJO = new Set(['M', 'T', 'N']);

function yaEs12h(t: TurnoPuesto12): boolean {
    return up(t.code) === 'D12' || up(t.code) === 'N12' || Number(t.hours) >= 12;
}

function elegir(lista: TurnoPuesto12[], preferido?: string): TurnoPuesto12 | null {
    const aptos = lista.filter((t) => !t.bloqueado && !yaEs12h(t) && TRABAJO.has(up(t.code)));
    if (!aptos.length) return null;
    return aptos.find((t) => t.empId === preferido) || aptos[0];
}

function ladoDe(code: string): string {
    if (code === 'M') return 'el turno de la mañana';
    if (code === 'T') return 'el turno de la tarde';
    return 'el turno de la noche';
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
    const n = elegir(delDia('N'), input.preferidoEmpId);
    const d12 = horarioDoce('D12', input.sla);
    const n12 = horarioDoce('N12', input.sla);
    const extra = (code: string) => {
        const b = delDia(code).find((x) => x.bloqueado && x.motivo);
        return b?.motivo ? ` (${b.motivo})` : '';
    };

    const par = (banda: string, a: TurnoPuesto12, ha: Horario12 & { code: 'D12' | 'N12' }, b: TurnoPuesto12, hb: Horario12 & { code: 'D12' | 'N12' }): Propuesta12h => {
        const cambios = [cambio(a, ha), cambio(b, hb)];
        return { dateStr: input.dateStr, positionName: input.positionName, banda, modo: 'par', cambios, texto: textoDe(banda, input.positionName, cambios) };
    };
    const uno = (banda: string, a: TurnoPuesto12, h: Horario12 & { code: 'D12' | 'N12' }): Propuesta12h => {
        const cambios = [cambio(a, h)];
        return { dateStr: input.dateStr, positionName: input.positionName, banda, modo: 'uno', cambios, texto: textoDe(banda, input.positionName, cambios) };
    };
    const sinPar = (banda: string, lado: string, base: Propuesta12h | null): Propuesta12h => {
        const aviso = `No hay quién cubra la ${banda} de ${input.positionName} con 12 h: falta ${lado}`;
        if (!base) {
            return { dateStr: input.dateStr, positionName: input.positionName, banda, modo: 'uno', cambios: [], texto: aviso };
        }
        return { ...base, texto: `${aviso}. ${base.texto}` };
    };

    if (falta.has('T') && m && n) return par('T', m, d12, n, n12);
    if (falta.has('M') && t && n) return par('M', t, d12, n, n12);
    if (falta.has('N') && m && t) return par('N', m, d12, t, n12);
    if (falta.has('T') && m) return sinPar('T', ladoDe('N') + extra('N'), uno('T', m, d12));
    if (falta.has('T') && n) return sinPar('T', ladoDe('M') + extra('M'), uno('T', n, n12));
    if (falta.has('M') && t) return sinPar('M', ladoDe('N') + extra('N'), uno('M', t, d12));
    if (falta.has('M') && n) return sinPar('M', ladoDe('T') + extra('T'), uno('M', n, n12));
    if (falta.has('N') && t) return sinPar('N', ladoDe('M') + extra('M'), uno('N', t, n12));
    if (falta.has('N') && m) return sinPar('N', ladoDe('T') + extra('T'), uno('N', m, d12));
    if (falta.has('T')) return sinPar('T', ladoDe(m ? 'N' : 'M') + extra(m ? 'N' : 'M'), null);
    if (falta.has('M')) return sinPar('M', ladoDe(t ? 'N' : 'T') + extra(t ? 'N' : 'T'), null);
    if (falta.has('N')) return sinPar('N', ladoDe(m ? 'T' : 'M') + extra(m ? 'T' : 'M'), null);
    return null;
}

export type DiaRango12 = {
    dateStr: string;
    aplicable: boolean;
    motivo: string;
    linea: string;
    propuesta: Propuesta12h | null;
};

/** Un día del rango de la licencia: el par D12+N12, o «sin cubrir» con el motivo. */
export function resumirDias12(dias: ReadonlyArray<Parameters<typeof proponerCierre12h>[0]>): DiaRango12[] {
    return dias.map((d) => {
        const p = proponerCierre12h(d);
        if (p?.modo === 'par' && p.cambios.length >= 2) {
            return { dateStr: d.dateStr, aplicable: true, motivo: '', linea: p.texto, propuesta: p };
        }
        const motivo = (p?.texto || 'sin par').replace(/ · Enter confirma, Esc cancela$/, '');
        return { dateStr: d.dateStr, aplicable: false, motivo, linea: motivo, propuesta: null };
    });
}

function fechaCorta(ds: string): string {
    return `${ds.slice(8, 10)}/${ds.slice(5, 7)}`;
}

export function textoRango12h(input: {
    nombre: string;
    code: string;
    desde: string;
    hasta: string;
    dias: readonly DiaRango12[];
}): string {
    const ok = input.dias.filter((d) => d.aplicable);
    const no = input.dias.filter((d) => !d.aplicable);
    const pares = ok.map((d) => {
        const cuerpo = d.linea.replace(/ · Enter confirma, Esc cancela$/, '').replace(/^Cubre la .*?: /, '');
        return `${cuerpo} el ${fechaCorta(d.dateStr)}`;
    });
    const cabeza = `${input.code} de ${apellidoCorto(input.nombre)} ${fechaCorta(input.desde)}→${fechaCorta(input.hasta)}: cubrir con 12 h en los ${ok.length} días`;
    const sin = no.map((d) => `${fechaCorta(d.dateStr)} sin cubrir: ${d.motivo}`);
    return [cabeza, pares.join('; '), sin.join('; ')].filter(Boolean).join('\n');
}

/** Si el campo no está en el SLA, se exige cobertura (igual que antes del 10/10). */
export function slaExigeCobertura(sla: { exigeCobertura?: boolean } | null | undefined): boolean {
    return sla?.exigeCobertura !== false;
}

const NO_PINTAR_12 = new Set(['F', 'FF', 'FP', 'FT', 'V', 'L', 'E', 'A', 'AA', 'PG', 'ART', 'RET', 'REF', 'ESC', 'EV', 'RFZ', 'TURA', 'EXTENDED', 'SGS', 'SUS', 'LT']);

/** D12, N12 o un turno de trabajo del puesto de 12 h o más. */
export function esJornada12h(code: string, hours?: number): boolean {
    const c = up(code);
    if (c === 'D12' || c === 'N12') return true;
    if (!c || NO_PINTAR_12.has(c)) return false;
    return Number(hours) >= 12;
}

/** Fondo rojo y letra blanca. Conserva el anillo de pendiente o de comparación. */
export function estiloJornada12(style: string, code: string, hours?: number): string {
    if (!esJornada12h(code, hours)) return style;
    const extra = String(style || '').split(/\s+/).filter((c) => c.startsWith('ring') || c.startsWith('border-l'));
    return ['bg-red-600', 'text-white', 'border-red-800', 'font-black', ...extra].join(' ');
}

export function textoResumen12h(propuestas: readonly Propuesta12h[]): string {
    return propuestas.map((p) => p.texto.replace(/ · Enter confirma, Esc cancela$/, '')).join('\n');
}
