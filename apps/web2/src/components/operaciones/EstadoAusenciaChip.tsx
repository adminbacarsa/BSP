import type { EstadoAusenciaCc, EstadoAusenciaTone } from '@cosp/ops-core';

/** Chip del único estado de la ausencia (lista CC, OBJ y paneles del mapa). */
const CHIP_TONE: Record<EstadoAusenciaTone, string> = {
    rojo: 'bg-rose-600 text-white',
    ambar: 'bg-amber-500 text-white',
    verde: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
};

const DETALLE_TONE: Record<EstadoAusenciaTone, string> = {
    rojo: 'text-rose-700',
    ambar: 'text-amber-700',
    verde: 'text-emerald-700',
};

/** Color del chip en el popup del mapa (estilos inline). */
export const ESTADO_AUSENCIA_HEX: Record<EstadoAusenciaTone, string> = {
    rojo: '#e11d48',
    ambar: '#f59e0b',
    verde: '#059669',
};

export function estadoAusenciaAccent(tone: EstadoAusenciaTone): { accentColor: string; rowBg: string } {
    if (tone === 'rojo') return { accentColor: 'bg-rose-600', rowBg: 'bg-rose-50/40' };
    if (tone === 'ambar') return { accentColor: 'bg-amber-500', rowBg: 'bg-amber-50/40' };
    return { accentColor: 'bg-slate-500', rowBg: 'bg-slate-50' };
}

export function EstadoAusenciaChip({ estado, size = 'sm' }: { estado: EstadoAusenciaCc; size?: 'sm' | 'md' }) {
    const pad = size === 'md' ? 'text-[10px] px-2 py-0.5' : 'text-[9px] px-1.5 py-0.5';
    return (
        <span
            className={`${pad} font-black rounded shrink-0 ${CHIP_TONE[estado.tone]}`}
            data-ops-estado-ausencia={estado.kind}
            title={estado.detalle || estado.label}
        >
            {estado.label}
        </span>
    );
}

/** Chip «N aus» de la tarjeta de objetivo: rojo solo si alguna sigue sin cubrir. */
export function AusChipObj({ absent, sinCubrir }: { absent: number; sinCubrir?: number }) {
    const pendientes = sinCubrir ?? absent;
    const cls = pendientes > 0 ? 'text-rose-700 bg-rose-100' : 'text-slate-600 bg-slate-100';
    const texto = pendientes > 0
        ? (pendientes < absent ? `${absent} aus · ${pendientes} sin cubrir` : `${absent} aus`)
        : `${absent} aus · cubiertas`;
    return <span className={`text-[9px] font-bold px-1.5 rounded ${cls}`} data-ops-obj-aus={pendientes}>{texto}</span>;
}

export function EstadoAusenciaDetalle({ estado, className = '' }: { estado: EstadoAusenciaCc; className?: string }) {
    if (!estado.detalle) return null;
    return (
        <p
            className={`text-[10px] font-bold leading-snug break-words ${DETALLE_TONE[estado.tone]} ${className}`}
            data-ops-guard-cubierto={estado.kind === 'CUBIERTO' ? '1' : undefined}
            data-ops-ausencia-detalle={estado.kind}
            title={estado.detalle}
        >
            {estado.detalle}
        </p>
    );
}
