/**
 * «P1 M», «P2M», «PL M» y el código propio de un puesto (C, CS)
 * contra el servicio del mes, antes de preguntar otro objetivo.
 */

export type TurnoPuestoMes = {
    code: string;
    name?: string;
    startTime?: string;
    endTime?: string;
    hours?: number;
};

export type PuestoMesPegado = {
    positionName: string;
    shifts: readonly TurnoPuestoMes[];
};

export type CodigoPuestoResuelto = {
    code: string;
    positionName: string;
    startTime?: string;
    endTime?: string;
    hours?: number;
};

export type ResultadoCodigoPuesto =
    | { tipo: 'turno'; celda: CodigoPuestoResuelto }
    | { tipo: 'de_este' };

const BANDAS = ['D12', 'N12', 'M', 'T', 'N'] as const;
const CODIGO_GENERICO = new Set(['M', 'T', 'N', 'D12', 'N12', 'F', 'FF', 'FP', 'FT', 'RET', 'REF', 'ESC', 'V', 'L', 'E', 'A', 'AA', 'PG', 'ART', 'SGS', 'SUS', 'LT', 'EV']);

function sinAcento(s: string): string {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
}

function normNombre(s: string): string {
    return sinAcento(s).replace(/\s+/g, ' ').trim();
}

function compacto(s: string): string {
    return sinAcento(s).replace(/[\s.\-]/g, '');
}

export function horasDeFranja(start?: string, end?: string, hours?: number): number | undefined {
    if (hours && hours > 0) return hours;
    if (!start || !end || !start.includes(':') || !end.includes(':')) return undefined;
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    if (!Number.isFinite(sh) || !Number.isFinite(eh)) return undefined;
    let mins = (eh * 60 + (em || 0)) - (sh * 60 + (sm || 0));
    if (mins <= 0) mins += 24 * 60;
    return Math.round((mins / 60) * 100) / 100;
}

/** Puesto 1 → P1. Playa → PL y PLAYA. Igual criterio que el emparejamiento de la planilla. */
/** «M» en el bloque PUESTO 1 se lee como «P1 M». Una función (Relevante) no prefija. */
export function codigoEnBloque(puestoFila: string, raw: string): string | null {
  const n = normNombre(puestoFila);
  if (!n || /^(RELEVANTE|VOLANTE|RETEN|RETENCION|REFUERZO)$/.test(n)) return null;
  const compact = compacto(raw);
  if (!['M', 'T', 'N', 'D12', 'N12'].includes(compact)) return null;
  const sigla = siglasDePuesto(puestoFila).find((s) => /^P\d+$/.test(s)) || siglasDePuesto(puestoFila).find((s) => s.length === 2);
  return sigla ? `${sigla} ${compact}` : null;
}

export function siglasDePuesto(nombre: string): string[] {
    const n = normNombre(nombre);
    if (!n) return [];
    const out = new Set<string>();
    const num = n.match(/^(?:P|PTO|PUESTO|PSTO)\.?\s*(\d+)$/);
    if (num) out.add(`P${String(Number(num[1]))}`);
    const palabras = n.split(' ').filter((p) => p.length >= 3 && !/^(PUESTO|PTO|PSTO|DEL|LAS|LOS)$/.test(p) && !/^\d+$/.test(p));
    if (!num && palabras.length === 1) out.add(palabras[0].slice(0, 2));
    if (!num) out.add(n.replace(/\s+/g, ''));
    if (palabras.length >= 2) {
        const ini = palabras.map((p) => p[0]).join('');
        if (ini.length >= 2) out.add(ini);
    }
    return [...out];
}

function franjaDe(puesto: PuestoMesPegado, code: string): TurnoPuestoMes | null {
    const c = compacto(code);
    return puesto.shifts.find((s) => compacto(s.code) === c) || null;
}

/** M del puesto: el turno M, si no el propio (P1M, M1, MPL). No elige D12/N12. */
function turnoDeBanda(puesto: PuestoMesPegado, sigla: string, banda: string): TurnoPuestoMes | null {
    const conHora = puesto.shifts.filter((s) => s.startTime && s.endTime && compacto(s.code));
    const exacto = conHora.find((s) => compacto(s.code) === banda);
    if (exacto) return exacto;
    const propio = compacto(`${sigla}${banda}`);
    const porSigla = conHora.find((s) => compacto(s.code) === propio);
    if (porSigla) return porSigla;
    const parecidos = conHora.filter((s) => {
        const c = compacto(s.code);
        if ((BANDAS as readonly string[]).includes(c)) return false;
        return c.startsWith(banda) || c.endsWith(banda);
    });
    return parecidos.length === 1 ? parecidos[0] : null;
}

function armar(puesto: PuestoMesPegado, shift: TurnoPuestoMes): CodigoPuestoResuelto {
    const startTime = shift.startTime || undefined;
    const endTime = shift.endTime || undefined;
    const hours = horasDeFranja(startTime, endTime, shift.hours);
    return {
        code: compacto(shift.code),
        positionName: puesto.positionName,
        ...(startTime ? { startTime } : {}),
        ...(endTime ? { endTime } : {}),
        ...(hours != null ? { hours } : {}),
    };
}

/**
 * null = no es un puesto de este objetivo (sigue el camino de otro objetivo).
 * `de_este` = la sigla es de acá pero esa banda no está: se lista, no se pregunta objetivo.
 */
export function resolverCodigoPuesto(
    raw: string,
    puestos: readonly PuestoMesPegado[] | null | undefined,
): ResultadoCodigoPuesto | null {
    if (!puestos?.length) return null;
    const visible = sinAcento(raw).replace(/\s+/g, ' ').trim();
    if (!visible) return null;
    const compact = compacto(visible);
    const siglaDe = new Map<string, PuestoMesPegado[]>();
    for (const p of puestos) {
        if (!p.positionName) continue;
        for (const s of siglasDePuesto(p.positionName)) {
            const list = siglaDe.get(s) || [];
            list.push(p);
            siglaDe.set(s, list);
        }
    }
    const unicos = (lista: PuestoMesPegado[]) => [...new Map(lista.map((p) => [p.positionName, p])).values()];
    const spaced = visible.match(/^(P\d+|[A-Z]{2,})\s+(D12|N12|M|T|N)$/);
    let partido: { sigla: string; banda: string } | null = spaced ? { sigla: spaced[1], banda: spaced[2] } : null;
    if (!partido) {
        for (const banda of BANDAS) {
            if (!compact.endsWith(banda) || compact.length <= banda.length) continue;
            const sigla = compact.slice(0, compact.length - banda.length);
            if (!siglaDe.has(sigla)) continue;
            partido = { sigla, banda };
            break;
        }
    }
    if (partido && siglaDe.has(partido.sigla)) {
        const hits = unicos(siglaDe.get(partido.sigla) || []);
        if (hits.length !== 1) return null;
        const sh = turnoDeBanda(hits[0], partido.sigla, partido.banda);
        if (!sh) return { tipo: 'de_este' };
        return { tipo: 'turno', celda: armar(hits[0], sh) };
    }
    const conCodigo = CODIGO_GENERICO.has(compact)
        ? []
        : unicos(puestos.filter((p) => p.shifts.some((s) => compacto(s.code) === compact && s.startTime)));
    if (conCodigo.length === 1) {
        const sh = franjaDe(conCodigo[0], compact);
        if (sh?.startTime) return { tipo: 'turno', celda: armar(conCodigo[0], sh) };
    }
    if (siglaDe.has(compact)) {
        const hits = unicos(siglaDe.get(compact) || []);
        if (hits.length === 1) return { tipo: 'de_este' };
    }
    if (compact.length === 1) {
        const porLetra = unicos(puestos.filter((p) => normNombre(p.positionName).startsWith(compact)));
        if (porLetra.length === 1) {
            const sigla = siglasDePuesto(porLetra[0].positionName).find((s) => s.length === 2) || '';
            const sh = franjaDe(porLetra[0], compact) || (sigla ? franjaDe(porLetra[0], sigla) : null);
            if (sh?.startTime) return { tipo: 'turno', celda: armar(porLetra[0], sh) };
        }
    }
    return null;
}

/**
 * Vista agrupada: la columna de la fila nombra el objetivo («CENTRO 08:00 a 15:00hs», «CERRO DE LAS ROSAS»).
 * Si un solo objetivo del grupo tiene todas esas palabras en su nombre («Sucursal Centro · Puesto»), la M/T/N de la
 * fila es el turno de esa banda en ese objetivo.
 */
export function turnoDeFilaGrupo(
    puestoFila: string,
    raw: string,
    puestos: readonly PuestoMesPegado[] | null | undefined,
): CodigoPuestoResuelto | null {
    if (!puestos?.length || !puestoFila) return null;
    const banda = compacto(raw);
    if (!(BANDAS as readonly string[]).includes(banda)) return null;
    const palabras = normNombre(puestoFila.replace(/\d{1,2}[:.]\d{2}.*$/, ''))
        .split(' ')
        .filter((p) => p.length >= 3 && !/^(HS|HORARIO|SUCURSAL|DEL|LAS|LOS)$/.test(p));
    if (!palabras.length) return null;
    const delGrupo = puestos.filter((p) => p.positionName.includes(' · '));
    const objetivoDe = (p: PuestoMesPegado) => normNombre(p.positionName.split(' · ')[0]);
    // «CBA» = «CORDOBA»: mismo comienzo o las letras en orden dentro de la palabra.
    const parecida = (w: string, o: string) => o === w || o.startsWith(w) || (w.length >= 3 && o[0] === w[0] && [...w].every((ch, i, arr) => { const k = o.indexOf(ch, i === 0 ? 0 : o.indexOf(arr[i - 1]) + 1); return k >= 0; }));
    const hits = delGrupo.filter((p) => { const ws = objetivoDe(p).split(' '); return palabras.every((w) => ws.some((o) => parecida(w, o))); });
    const objetivos = [...new Set(hits.map(objetivoDe))];
    if (objetivos.length !== 1) return null;
    for (const p of hits) {
        const sh = turnoDeBanda(p, '', banda);
        if (sh) return armar(p, sh);
    }
    return null;
}

/** Clave del lugar de una fila («NUEVA CBA 08:00 a 14:00hs» → «NUEVA CBA»), para guardar su objetivo. */
export function normLugar(puestoFila: string): string {
    return normNombre(String(puestoFila || '').replace(/\d{1,2}[:.]\d{2}.*$/, '')).replace(/\s+/g, ' ').trim();
}
