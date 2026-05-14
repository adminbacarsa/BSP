export const SHIFT_STYLES: any = {
    'M': 'bg-blue-100 text-blue-700 border-blue-200', 'T': 'bg-orange-100 text-orange-700 border-orange-200',
    'N': 'bg-indigo-100 text-indigo-700 border-indigo-200', 'D12': 'bg-cyan-100 text-cyan-700 border-cyan-200',
    'N12': 'bg-purple-100 text-purple-700 border-purple-200', 'F': 'bg-emerald-100 text-emerald-700 border-emerald-200',
    'PU': 'bg-pink-100 text-pink-700 border-pink-200', 'A': 'bg-red-100 text-red-700 border-red-300 font-black',
    'V': 'bg-teal-600 text-white border-teal-700 font-black shadow-sm', 'L': 'bg-purple-100 text-purple-700 border-purple-300 font-black',
    'E': 'bg-rose-100 text-rose-700 border-rose-300 font-black', 'AA': 'bg-amber-100 text-amber-700 border-amber-300',
    'RET': 'bg-amber-200 text-amber-900 border-amber-500 font-black',
    'PG': 'bg-blue-100 text-blue-700 border-blue-300 font-black',
    'PAST': 'bg-gray-100 text-gray-300 border-gray-200 cursor-not-allowed', 'C': 'bg-slate-100 text-slate-600 border-slate-300 font-bold opacity-90',
    'FT': 'bg-violet-600 text-white border-violet-700 font-black shadow-sm', 'FF': 'bg-cyan-600 text-white border-cyan-700 font-black shadow-sm',
    'SWAP': 'bg-cyan-50 text-cyan-700 border-cyan-300 border-dashed font-bold'
};
/**
 * Horas por código para SLAs / UI cuando la celda no trae `hours` explícitos.
 * RET = 0: no suma a liquidación ni a racha CCT; el "×8h" de stand-by es solo estimación (`RET_STANDBY_REFERENCE_HOURS`).
 */
export const SHIFT_HOURS_LOOKUP: any = {
    M: 8,
    T: 8,
    N: 8,
    D12: 12,
    N12: 12,
    PU: 12,
    EN: 9,
    RET: 0,
    F: 0,
    FF: 0,
    V: 0,
    L: 0,
    PG: 0,
    A: 0,
    E: 0,
    AA: 0,
    C: 8,
};

/** Si operaciones promueve un RET a cobertura activa, suele modelarse como ~8h (solo estimación). */
export const RET_STANDBY_REFERENCE_HOURS = 8;
