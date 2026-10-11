/**
 * Franco trabajado en la grilla.
 * Modo rápido: sobre un F/FF/FP, la banda se asigna directo (ya se habló por teléfono).
 * Clic derecho «Asignar a…»: el franco no se escribe; se consulta por la app.
 */
import { horasEntre, horarioDeCodigo, normalizarCodigo, type TurnoSla } from './modoRapido';

export type CeldaFt = {
    code?: string;
    isFranco?: boolean;
    isFrancoTrabajado?: boolean;
    isDeleted?: boolean;
} | null | undefined;

const FRANCO_BASE = new Set(['F', 'FF', 'FP']);
const BANDA_ESTANDAR = new Set(['M', 'T', 'N', 'D12', 'N12']);

export function esCeldaFranco(celda: CeldaFt): boolean {
    if (!celda || celda.isDeleted || celda.isFrancoTrabajado === true) return false;
    const code = normalizarCodigo(celda.code || '');
    return celda.isFranco === true || FRANCO_BASE.has(code);
}

/** «FT·M». Si el código guardado ya es FT, queda «FT». */
export function etiquetaFt(code: string | null | undefined): string {
    const c = normalizarCodigo(code || '');
    if (!c || c === 'FT') return 'FT';
    return `FT·${c}`;
}

/** «FT» solo, sin banda elegida: el autocompletar tiene que pedir M/T/N… */
export function confirmarFtPideBanda(texto: string, elegida: number): boolean {
    const raw = String(texto || '').trim().toUpperCase().replace(/\s+/g, '');
    return raw === 'FT' && elegida < 0;
}

function bandaEscrita(texto: string): string | null {
    const raw = String(texto || '').trim().toUpperCase().replace(/\s+/g, '');
    const m = raw.match(/^FT[·•.]([A-Z0-9]+)$/);
    return m ? m[1] : null;
}

export type OpcionFt = { code: string; horario?: string; detalle: string };

/** Opciones del autocompletar: «FT·M» con el horario de esa banda. */
export function opcionesBandaFt(bandas: readonly TurnoSla[]): OpcionFt[] {
    const vistos = new Set<string>();
    const out: OpcionFt[] = [];
    const lista = bandas.length
        ? bandas
        : (['M', 'T', 'N', 'D12', 'N12'] as const).map((code) => ({ code }));
    for (const b of lista) {
        const code = normalizarCodigo(b.code);
        if (!code || vistos.has(code) || FRANCO_BASE.has(code) || code === 'FT' || code === 'RET') continue;
        vistos.add(code);
        const h = horarioDeCodigo(code, { slaPuesto: bandas as TurnoSla[], slaTodos: bandas as TurnoSla[] });
        if (!h) continue;
        out.push({
            code: `FT·${code}`,
            horario: `${h.startTime}–${h.endTime}`,
            detalle: 'Franco trabajado',
        });
    }
    return out;
}

export type ResolucionFt =
    | { accion: 'no' }
    | { accion: 'pedir_banda' }
    | { accion: 'sin_permiso' }
    | { accion: 'no_franco' }
    | { accion: 'ft'; code: string; name: string; startTime: string; endTime: string; hours: number };

/**
 * Qué hace una tecla en modo rápido.
 * «FT» pide la banda. «FT·M» o una banda sobre un franco escribe el FT con las horas de esa banda.
 */
export function resolverEscrituraFt(input: {
    texto: string;
    celda: CeldaFt;
    bandas: readonly TurnoSla[];
    puede: boolean;
}): ResolucionFt {
    const escrito = normalizarCodigo(input.texto);
    const deFt = bandaEscrita(input.texto);
    const sobreFranco = esCeldaFranco(input.celda);
    if (!deFt && escrito === 'FT') {
        if (!sobreFranco) return { accion: 'no_franco' };
        if (!input.puede) return { accion: 'sin_permiso' };
        return { accion: 'pedir_banda' };
    }
    const codeBanda = deFt || (sobreFranco ? escrito : '');
    if (!codeBanda || FRANCO_BASE.has(codeBanda) || codeBanda === 'FT' || codeBanda === 'RET') return { accion: 'no' };
    if (!sobreFranco) return deFt ? { accion: 'no_franco' } : { accion: 'no' };
    const h = horarioDeCodigo(codeBanda, { slaPuesto: input.bandas as TurnoSla[], slaTodos: input.bandas as TurnoSla[] });
    if (!h) return { accion: 'no' };
    const enServicio = input.bandas.some((b) => normalizarCodigo(b.code) === h.code);
    if (!enServicio && !BANDA_ESTANDAR.has(h.code)) return { accion: 'no' };
    if (!input.puede) return { accion: 'sin_permiso' };
    const hours = Number(h.hours) || horasEntre(h.startTime, h.endTime);
    if (!(hours > 0)) return { accion: 'no' };
    return { accion: 'ft', code: h.code, name: h.name || h.code, startTime: h.startTime, endTime: h.endTime, hours };
}

/** Lo que manda el clic derecho cuando el elegido está de franco. No incluye un turno. */
export function payloadConsultaFt(input: {
    empresaId: string;
    objectiveId: string | null;
    clientId: string | null;
    objectiveName: string | null;
    positionName: string;
    jornada: { fecha: string; horaInicio: string; horaFin: string; horas: number; code: string; name?: string };
    franco: { employeeId: string; nombre: string };
    cubreEmployeeId: string | null;
    cubreNombre: string | null;
    autorizaciones?: { employeeId: string; kind: 'DESCANSO' | 'TOPE'; motivo: string; autorizadoPor?: string }[];
    venceMinutos?: number;
}): Record<string, unknown> {
    return {
        empresaId: input.empresaId,
        objectiveId: input.objectiveId,
        clientId: input.clientId,
        objectiveName: input.objectiveName,
        positionName: input.positionName,
        jornadas: [input.jornada],
        guardias: [{ employeeId: input.franco.employeeId, tipo: 'FT', nombre: input.franco.nombre }],
        lugares: 1,
        venceMinutos: input.venceMinutos ?? 120,
        autorizaciones: input.autorizaciones || [],
        cubreEmployeeId: input.cubreEmployeeId,
        cubreNombre: input.cubreNombre,
        ...(input.cubreEmployeeId ? { titularEmployeeId: input.cubreEmployeeId } : {}),
    };
}
