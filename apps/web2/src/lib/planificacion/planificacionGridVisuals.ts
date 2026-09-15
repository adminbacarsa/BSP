export const SHIFT_STYLES: Record<string, string> = {
    'M':   'bg-white text-blue-700 border-blue-400 font-bold',
    'T':   'bg-white text-orange-600 border-orange-400 font-bold',
    'N':   'bg-white text-indigo-700 border-indigo-500 font-bold',
    'D12': 'bg-white text-cyan-700 border-cyan-400 font-bold',
    'N12': 'bg-white text-purple-700 border-purple-400 font-bold',
    'F':   'bg-green-500 text-white border-green-600 font-black shadow-sm',
    'PU':  'bg-white text-pink-700 border-pink-400 font-bold',
    'A':   'bg-white text-red-700 border-red-400 font-black pattern-diagonal',
    'ART': 'bg-white text-red-700 border-red-400 font-black pattern-diagonal',
    'V':   'bg-emerald-700 text-white border-emerald-800 font-black shadow-sm',
    'L':   'bg-white text-purple-700 border-purple-400 font-black',
    'E':   'bg-white text-rose-700 border-rose-400 font-black',
    'AA':  'bg-white text-amber-700 border-amber-400',
    'LT':  'bg-orange-50 text-orange-700 border-orange-400 font-black',
    'RET': 'bg-slate-100 text-slate-700 border border-slate-400 font-bold',
    'SGS': 'bg-orange-50 text-orange-700 border border-orange-300 font-bold',
    'SUS': 'bg-red-100 text-red-700 border border-red-400 font-bold',
    'REF': 'bg-violet-100 text-violet-800 border-violet-500 font-black',
    'RFZ': 'bg-red-500 text-white border-red-600 font-black',
    'TURA': 'bg-red-600 text-white border-red-700 font-black',
    'EXTENDED': 'bg-red-600 text-white border-red-700 font-black shadow-sm',
    'OPS_COV': 'bg-orange-500 text-white border-orange-600 font-black shadow-sm',
    'ESC': 'bg-sky-100 text-sky-800 border-sky-500 font-black',
    'EV':  'bg-yellow-400 text-yellow-900 border-yellow-500 font-black',
    'PG':  'bg-white text-blue-700 border-blue-400 font-black',
    'LOCKED': 'bg-slate-200 text-slate-500 border-slate-300 pattern-grid',
    'PAST':   'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed',
    'C':   'bg-white text-slate-600 border-slate-400 font-bold opacity-90',
    'FT':  'bg-violet-600 text-white border-violet-700 font-black shadow-sm',
    'FF':  'bg-green-600 text-white border-green-700 font-black shadow-sm',
    'SWAP':         'bg-cyan-50 text-cyan-700 border-cyan-300 border-dashed font-bold',
    'SWAP_PENDING': 'bg-amber-100 text-amber-700 border-amber-300 border-dashed font-bold',
};

export const GRUPO_COLOR_HEX = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

export function getDefaultStyle(code: string): string {
    return SHIFT_STYLES[code] || 'bg-slate-100 text-slate-700 border-slate-300';
}

/** Mantiene tooltips/modales del pie de cobertura dentro del viewport. */
export function clampPlanifFloatingPos(clientX: number, clientY: number, panelW = 320, panelH = 220): { left: number; top: number } {
    if (typeof window === 'undefined') return { left: clientX, top: clientY };
    const pad = 24;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = clientX + 12;
    let top = clientY + 12;
    if (left + panelW > vw - pad) left = Math.max(pad, vw - panelW - pad);
    if (left < pad) left = pad;
    if (top + panelH > vh - pad) top = Math.max(pad, clientY - panelH - 16);
    if (top < pad) top = pad;
    return { left, top };
}

export const LEGEND_DESCRIPTIONS: Record<string, string> = {
    'M': 'Turno Mañana (Estándar)',
    'T': 'Turno Tarde (Estándar)',
    'N': 'Turno Noche (Estándar)',
    'D12': 'Jornada Diurna 12hs',
    'N12': 'Jornada Nocturna 12hs',
    'F': 'Franco Compensatorio',
    'RET': 'Guardia Retén',
    'REF': 'Refuerzo interno (no cuenta cobertura SLA)',
    'RFZ': 'Refuerzo solicitado por cliente (facturable)',
    'TURA': 'Turno Agregado por cliente (facturable)',
    'ESC': 'Escuela / formación (no cuenta cobertura SLA ni horas planificadas)',
    'PU': 'Puesto Único / Especial',
    'A': 'ART / Autorizada',
    'ART': 'ART (carpeta)',
    'V': 'Vacaciones',
    'L': 'Licencia Esp.',
    'E': 'Enfermedad',
    'AA': 'No Presentó',
    'RA': 'Retiro anticipado',
    'LT': 'Llegada Tarde',
    'LOCKED': 'Bloqueado (Cerrado/Pasado)',
    'PAST': 'Fecha Pasada',
    'C': 'Turno Consolidado (Fichado)',
    'FT': 'Franco Trabajado (Pago Doble)',
    'FF': 'Franco x Franco (Devolución)',
    'SWAP': 'Intercambio de Turno',
    'SWAP_PENDING': 'Intercambio pendiente de autorización',
    'EXTENDED': 'Turno extendido o adelantado (cobertura / horas extra)',
    'OPS_COV': 'Cobertura operativa (SIN_TURNO / OPERATIONS_COVERAGE)',
    'EV': 'Evento especial (recital, partido, operativo)',
};

export const SHIFT_RANGES: Record<string, string> = {
    'M': '07:00 - 15:00',
    'T': '15:00 - 23:00',
    'N': '23:00 - 07:00',
    'D12': '07:00 - 19:00',
    'N12': '19:00 - 07:00',
    'PU': 'Horario Personalizado',
    'FT': 'Cobertura Extra (100%)',
};

export const ABSENCE_STATUS_STYLES: Record<string, string> = {
    'Justificada': 'bg-emerald-100 text-emerald-700 border-emerald-200',
    'Autorizada': 'bg-emerald-100 text-emerald-700 border-emerald-200',
    'En verificación': 'bg-violet-100 text-violet-700 border-violet-200',
    'Pendiente': 'bg-amber-100 text-amber-800 border-amber-200',
    'Injustificada': 'bg-rose-100 text-rose-700 border-rose-200',
    'Rechazada': 'bg-rose-100 text-rose-700 border-rose-200',
};

export const absenceStatusBadgeClass = (status: string) =>
    ABSENCE_STATUS_STYLES[status] || 'bg-slate-100 text-slate-600 border-slate-200';

export const DEFAULT_LIMITS = { weekly: 48, monthly: 200 };

/** Versión del motor de planificación — visible en UI durante generación para verificar deploy. */
export const PLANNING_ENGINE_VERSION = '2.8';

export const SHIFT_HOURS_LOOKUP: Record<string, number> = {
    'M': 8, 'T': 8, 'N': 8, 'D12': 12, 'N12': 12, 'PU': 12, 'EN': 9, 'ENC': 8, 'F': 0, 'FF': 0, 'FP': 0, 'FT': 0, 'V': 0, 'L': 0, 'A': 0, 'E': 0, 'AA': 0, 'LT': 0, 'PG': 0, 'RET': 0, 'REF': 8, 'RFZ': 8, 'TURA': 8, 'ESC': 8, 'C': 8, 'EV': 8,
};
