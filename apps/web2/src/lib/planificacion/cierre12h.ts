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
    /** Objetivo del turno. En la vista agrupada puede ser otro del grupo. */
    objectiveId?: string;
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
    /** Puesto de donde sale. */
    positionName: string;
    /** Puesto al que se acredita la cobertura cuando no es el propio. */
    coversPositionName?: string;
    /** Objetivo al que se acredita cuando el turno es de otro objetivo del grupo. */
    coversObjectiveId?: string;
};

export type OpcionPareja12 = {
    empId: string;
    nombre: string;
    positionName: string;
    code: string;
    hours?: number;
    lado: 'D12' | 'N12';
    bloqueado?: boolean;
    motivo?: string;
};

export type Propuesta12h = {
    dateStr: string;
    positionName: string;
    banda: string;
    modo: 'par' | 'uno';
    cambios: Cambio12h[];
    texto: string;
    alternativas?: OpcionPareja12[];
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

function normPos(v: string): string {
    return up(v).replace(/\s+/g, ' ');
}

function clavePuesto(t: { positionName: string; objectiveId?: string }): string {
    return `${t.objectiveId || ''}|${normPos(t.positionName)}`;
}

function bandaQueDeja(code: string): 'M' | 'T' | 'N' | null {
    const c = up(code);
    if (c === 'M' || c === 'T' || c === 'N') return c;
    return null;
}

function cubreBanda(code: string, banda: string): boolean {
    const c = up(code);
    if (banda === 'M') return c === 'M' || c === 'D12';
    if (banda === 'T') return c === 'T' || c === 'D12' || c === 'N12';
    if (banda === 'N') return c === 'N' || c === 'N12';
    return false;
}

function cupoDe(
    cupos: Readonly<Record<string, number>> | undefined,
    t: { positionName: string; objectiveId?: string },
): number {
    if (!cupos) return 1;
    const full = clavePuesto(t);
    if (cupos[full] != null) return cupos[full];
    const n = normPos(t.positionName);
    if (cupos[n] != null) return cupos[n];
    if (cupos[t.positionName] != null) return cupos[t.positionName];
    return 1;
}

function esDelPuestoObjetivo(
    t: { positionName: string; objectiveId?: string },
    positionName: string,
    objectiveId?: string,
): boolean {
    if (!mismoPuesto(t.positionName, positionName)) return false;
    if (t.objectiveId && objectiveId && t.objectiveId !== objectiveId) return false;
    return true;
}

/** Sacar a esta persona de su puesto no puede dejar su banda por debajo del cupo. */
function noAbreHueco(
    turnos: readonly TurnoPuesto12[],
    dateStr: string,
    salientes: readonly TurnoPuesto12[],
    cupos: Readonly<Record<string, number>> | undefined,
): boolean {
    const porPuesto = new Map<string, TurnoPuesto12[]>();
    for (const s of salientes) {
        const k = clavePuesto(s);
        const list = porPuesto.get(k) || [];
        list.push(s);
        porPuesto.set(k, list);
    }
    for (const [, grupo] of porPuesto) {
        const sample = grupo[0];
        const excluir = new Set(grupo.map((g) => g.empId));
        const bandas = new Set(grupo.map((g) => bandaQueDeja(g.code)).filter((b): b is 'M' | 'T' | 'N' => !!b));
        for (const banda of bandas) {
            const quedan = turnos.filter((t) =>
                t.dateStr === dateStr
                && clavePuesto(t) === clavePuesto(sample)
                && !excluir.has(t.empId)
                && !t.bloqueado
                && cubreBanda(t.code, banda));
            if (quedan.length < cupoDe(cupos, sample)) return false;
        }
    }
    return true;
}

function cambio(
    t: TurnoPuesto12,
    h: Horario12 & { code: 'D12' | 'N12' },
    targetPos: string,
    targetObj?: string,
): Cambio12h {
    const otroPuesto = !esDelPuestoObjetivo(t, targetPos, targetObj);
    const otroObj = !!(t.objectiveId && targetObj && t.objectiveId !== targetObj);
    return {
        empId: t.empId,
        nombre: t.nombre,
        dateStr: t.dateStr,
        code: h.code,
        startTime: h.startTime,
        endTime: h.endTime,
        hours: h.hours,
        positionName: t.positionName,
        ...(otroPuesto ? { coversPositionName: targetPos } : {}),
        ...(otroObj ? { coversObjectiveId: targetObj } : {}),
    };
}

function codigosLado(banda: string, lado: 'D12' | 'N12'): string[] {
    if (lado === 'D12') return banda === 'N' ? ['M'] : banda === 'M' ? ['T'] : ['M', 'T'];
    return banda === 'M' ? ['N'] : banda === 'N' ? ['T'] : ['N', 'T'];
}

export function alternativasPareja(turnos: readonly TurnoPuesto12[], dateStr: string, banda: string): OpcionPareja12[] {
    const out: OpcionPareja12[] = [];
    for (const lado of ['D12', 'N12'] as const) {
        const codes = new Set(codigosLado(banda, lado));
        for (const t of turnos) {
            if (t.dateStr !== dateStr || yaEs12h(t) || !codes.has(up(t.code))) continue;
            out.push({
                empId: t.empId,
                nombre: t.nombre,
                positionName: t.positionName,
                code: up(t.code),
                hours: t.hours,
                lado,
                bloqueado: !!t.bloqueado,
                motivo: t.motivo,
            });
        }
    }
    return out;
}

/** Cambia quién pasa a D12 o a N12. La pareja bloqueada no se elige. */
export function cambiarPareja(propuesta: Propuesta12h, empId: string, turnos: readonly TurnoPuesto12[], lado?: 'D12' | 'N12'): Propuesta12h {
    const op = (propuesta.alternativas || []).find((a) => a.empId === empId && !a.bloqueado && (!lado || a.lado === lado));
    if (!op) return propuesta;
    const origen = turnos.find((t) => t.empId === empId && t.dateStr === propuesta.dateStr && up(t.code) === op.code);
    if (!origen) return propuesta;
    const horario = horarioDoce(op.lado, undefined);
    const nuevo = cambio(origen, horario, propuesta.positionName);
    const cambios = propuesta.cambios.filter((c) => c.code !== op.lado);
    if (cambios.length === propuesta.cambios.length) return propuesta;
    const siguiente = [...cambios, nuevo];
    return {
        ...propuesta,
        cambios: siguiente,
        texto: textoDe(propuesta.banda, propuesta.positionName, siguiente, siguiente.some((c) => c.coversPositionName)),
    };
}

function textoDe(banda: string, puesto: string, cambios: Cambio12h[], mixto: boolean): string {
    const partes = cambios.map((c) => {
        const pos = mixto && c.positionName ? ` (${c.positionName})` : '';
        return `${apellidoCorto(c.nombre)} ${c.code}${pos} ${c.startTime}–${c.endTime}`;
    });
    return `Cubre la ${banda} de ${puesto}: ${partes.join(' + ')} · Enter confirma, Esc cancela`;
}

/**
 * Falta una banda de 8 h y en el puesto ya hay las otras dos: el par pasa a D12 + N12.
 * Si en el puesto no hay par, busca la banda vecina ese día en los otros puestos
 * (y, si el turno trae objectiveId, en los otros objetivos). No mueve a quien deje
 * su puesto descubierto. Si solo hay un lado, lo propone solo.
 */
export function proponerCierre12h(input: {
    dateStr: string;
    positionName: string;
    faltantes: readonly string[];
    turnos: readonly TurnoPuesto12[];
    preferidoEmpId?: string;
    sla?: ReadonlyArray<{ code?: string; startTime?: string; endTime?: string; hours?: number }>;
    /** Cupo por puesto (`nombre` o `objectiveId|nombre`). Sin dato, 1. */
    cupos?: Readonly<Record<string, number>>;
    /** Objetivo al que se acredita el hueco. */
    objectiveId?: string;
}): Propuesta12h | null {
    const falta = new Set(input.faltantes.map(up));
    const delPuesto = input.turnos.filter((t) => esDelPuestoObjetivo(t, input.positionName, input.objectiveId));
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
        const cambios = [cambio(a, ha, input.positionName, input.objectiveId), cambio(b, hb, input.positionName, input.objectiveId)];
        const mixto = cambios.some((c) => c.coversPositionName || c.coversObjectiveId);
        return {
            dateStr: input.dateStr,
            positionName: input.positionName,
            banda,
            modo: 'par',
            cambios,
            texto: textoDe(banda, input.positionName, cambios, mixto),
            alternativas: alternativasPareja(input.turnos, input.dateStr, banda),
        };
    };
    const uno = (banda: string, a: TurnoPuesto12, h: Horario12 & { code: 'D12' | 'N12' }): Propuesta12h => {
        const cambios = [cambio(a, h, input.positionName, input.objectiveId)];
        return { dateStr: input.dateStr, positionName: input.positionName, banda, modo: 'uno', cambios, texto: textoDe(banda, input.positionName, cambios, false) };
    };
    const sinPar = (banda: string, lado: string, base: Propuesta12h | null): Propuesta12h => {
        const aviso = `No hay quién cubra la ${banda} de ${input.positionName} con 12 h: falta ${lado}`;
        if (!base) {
            return { dateStr: input.dateStr, positionName: input.positionName, banda, modo: 'uno', cambios: [], texto: aviso };
        }
        return { ...base, texto: `${aviso}. ${base.texto}` };
    };

    const local = (): Propuesta12h | null => {
        if (falta.has('T') && m && n) return par('T', m, d12, n, n12);
        if (falta.has('M') && t && n) return par('M', t, d12, n, n12);
        if (falta.has('N') && m && t) return par('N', m, d12, t, n12);
        return null;
    };
    const propio = local();
    if (propio?.modo === 'par') return propio;

    const cruzado = parEntrePuestos(input, falta, d12, n12);
    if (cruzado) return cruzado;

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

/** D12 sale de un M o T de ese día; N12 de un T o N. Primero el mismo puesto (ya resuelto). */
function parEntrePuestos(
    input: {
        dateStr: string;
        positionName: string;
        turnos: readonly TurnoPuesto12[];
        preferidoEmpId?: string;
        cupos?: Readonly<Record<string, number>>;
        objectiveId?: string;
    },
    falta: Set<string>,
    d12: Horario12 & { code: 'D12' | 'N12' },
    n12: Horario12 & { code: 'D12' | 'N12' },
): Propuesta12h | null {
    const orden: Array<{ banda: string; dCodes: string[]; nCodes: string[] }> = [
        { banda: 'T', dCodes: ['M', 'T'], nCodes: ['T', 'N'] },
        { banda: 'M', dCodes: ['T'], nCodes: ['N'] },
        { banda: 'N', dCodes: ['M'], nCodes: ['T'] },
    ];
    const indice = new Map(input.turnos.map((t, i) => [`${t.empId}|${t.dateStr}|${up(t.code)}`, i]));
    let best: Propuesta12h | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const lado of orden) {
        if (!falta.has(lado.banda)) continue;
        const dCands = input.turnos.filter((t) => t.dateStr === input.dateStr && !t.bloqueado && !yaEs12h(t) && lado.dCodes.includes(up(t.code)));
        const nCands = input.turnos.filter((t) => t.dateStr === input.dateStr && !t.bloqueado && !yaEs12h(t) && lado.nCodes.includes(up(t.code)));
        for (const a of dCands) {
            for (const b of nCands) {
                if (a.empId === b.empId) continue;
                const salientes = [a, b].filter((t) => !esDelPuestoObjetivo(t, input.positionName, input.objectiveId));
                if (!salientes.length) continue;
                if (!noAbreHueco(input.turnos, input.dateStr, salientes, input.cupos)) continue;
                const cambios = [
                    cambio(a, d12, input.positionName, input.objectiveId),
                    cambio(b, n12, input.positionName, input.objectiveId),
                ];
                const afuera = salientes.length;
                const otroObj = salientes.filter((t) => t.objectiveId && input.objectiveId && t.objectiveId !== input.objectiveId).length;
                const prefer = (a.empId === input.preferidoEmpId || b.empId === input.preferidoEmpId) ? 0 : 1;
                const ordenLista = (indice.get(`${a.empId}|${a.dateStr}|${up(a.code)}`) || 0) + (indice.get(`${b.empId}|${b.dateStr}|${up(b.code)}`) || 0);
                const score = afuera * 1000 + otroObj * 100 + prefer * 10 + ordenLista;
                if (score >= bestScore) continue;
                bestScore = score;
                best = {
                    dateStr: input.dateStr,
                    positionName: input.positionName,
                    banda: lado.banda,
                    modo: 'par',
                    cambios,
                    texto: textoDe(lado.banda, input.positionName, cambios, true),
                    alternativas: alternativasPareja(input.turnos, input.dateStr, lado.banda),
                };
            }
        }
        if (best) return best;
    }
    return best;
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
