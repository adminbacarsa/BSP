/**
 * Copiar / pegar / rellenar / tirador en modo rápido: el turno que se escribe
 * es el de la celda origen (código, puesto y horario), no el puesto por defecto del destino.
 */

export type FuenteTurno = {
    code: string;
    name?: string;
    startTime?: string;
    endTime?: string;
    hours?: number;
    positionName?: string;
};

export type FranjaServicio = {
    code: string;
    name?: string;
    startTime?: string;
    endTime?: string;
    hours?: number;
};

export type PuestoServicio = {
    positionName: string;
    shifts: FranjaServicio[];
};

export type TurnoCopiado = {
    code: string;
    name: string;
    startTime: string;
    endTime: string;
    hours: number;
    positionName: string;
    avisos: string[];
};

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export function mesLabelDe(d: Date): string {
    return MESES[d.getMonth()] || '';
}

export function puestoReal(nombre?: string | null): string {
    const s = String(nombre || '').trim();
    if (!s || s === 'General' || s === 'Retén') return '';
    return s;
}

export function apellidoAvisoCopia(nombre: string): string {
    const base = String(nombre || '').split(',')[0].trim();
    const palabra = base.split(/\s+/).filter(Boolean)[0] || '';
    return palabra.toUpperCase();
}

function franjaDe(puestos: PuestoServicio[], positionName: string, code: string): FranjaServicio | null {
    const puesto = puestos.find((p) => p.positionName === positionName);
    if (!puesto) return null;
    const c = code.toUpperCase();
    return puesto.shifts.find((s) => String(s.code || '').trim().toUpperCase() === c && s.startTime && s.endTime) || null;
}

/**
 * Resuelve el turno a escribir cuando la celda origen trae puesto.
 * Sin puesto en la fuente devuelve null: el llamador sigue con el horario del código
 * (teclear, o el pegado de Excel, que usa la tabla de equivalencias).
 */
export function resolverTurnoCopiado(input: {
    fuente: FuenteTurno;
    /** Puesto donde cae el código si el de origen no existe en el servicio del mes. */
    puestoDestino: string;
    /**
     * Puesto por defecto del guardia. Si viene (aunque sea vacío), el aviso
     * «tomó un turno de…» solo sale cuando ese puesto es otro. Si no viene,
     * se compara contra `puestoDestino`.
     */
    puestoDefecto?: string | null;
    nombreDestino: string;
    mesLabel: string;
    puestos: PuestoServicio[];
}): TurnoCopiado | null {
    const code = String(input.fuente.code || '').trim().toUpperCase();
    const origen = puestoReal(input.fuente.positionName);
    if (!code || !origen) return null;
    const destino = puestoReal(input.puestoDestino);
    const comparar = input.puestoDefecto !== undefined ? puestoReal(input.puestoDefecto || '') : destino;
    const avisos: string[] = [];
    const existe = input.puestos.some((p) => p.positionName === origen);
    let positionName = origen;
    let start = input.fuente.startTime || '';
    let end = input.fuente.endTime || '';
    let hours = Number(input.fuente.hours) || 0;
    let name = input.fuente.name || code;
    if (!existe) {
        const usado = destino || input.puestos[0]?.positionName || '';
        if (!usado) return null;
        const banda = franjaDe(input.puestos, usado, code);
        positionName = usado;
        if (banda?.startTime && banda.endTime) {
            start = banda.startTime;
            end = banda.endTime;
            hours = Number(banda.hours) || hours;
            name = banda.name || name;
        }
        avisos.push(`${origen} no está en el servicio de ${input.mesLabel}: se usó ${usado}`);
    } else {
        if (!start || !end) {
            const banda = franjaDe(input.puestos, origen, code);
            if (banda?.startTime && banda.endTime) {
                start = banda.startTime;
                end = banda.endTime;
                hours = Number(banda.hours) || hours;
                name = banda.name || name;
            }
        }
        if (comparar && comparar !== origen) {
            const quien = apellidoAvisoCopia(input.nombreDestino) || 'El guardia';
            avisos.push(`${quien} tomó un turno de ${origen}`);
        }
    }
    if (!start || !end) return null;
    return { code, name, startTime: start, endTime: end, hours, positionName, avisos };
}
