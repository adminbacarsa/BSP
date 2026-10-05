import React from 'react';

export type CoberturaDiaFila = {
  date: string;
  label: string;
  coverageLabel: string;
  mode: 'none' | 'substitute' | 'split';
  editing: boolean;
  titular: string | null;
};

/** Paso 2: resumen de lo que tiene cada día marcado. Tocar edita; Quitar saca solo ese día. */
export function VacancyCoberturaLista(props: {
  days: CoberturaDiaFila[];
  emptyCount: number;
  templateLabel: string | null;
  onEdit: (date: string) => void;
  onClear: (date: string) => void;
  onCompleteRemaining: () => void;
}) {
  return (
    <div data-cobertura-paso="2">
      <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">Paso 2 · Cobertura por día</label>
      <p className="text-[10px] font-bold text-slate-500 mb-2">
        Cada día se cubre aparte. Tocá un día para editarlo. Quitar saca solo esa cobertura.
      </p>
      {props.emptyCount > 0 && props.templateLabel && (
        <button
          type="button"
          data-cobertura-completar="1"
          onClick={props.onCompleteRemaining}
          className="mb-2 w-full py-2 rounded-xl border border-violet-200 bg-violet-50 text-[10px] font-black text-violet-800 hover:bg-violet-100"
        >
          Completar {props.emptyCount} día(s) sin cobertura con la de {props.templateLabel}
        </button>
      )}
      <div className="max-h-36 overflow-y-auto custom-scrollbar border rounded-xl divide-y">
        {props.days.map((day) => (
          <div key={day.date} className={`flex items-center gap-1 pr-1 ${day.editing ? 'bg-indigo-50 ring-2 ring-inset ring-indigo-300' : ''}`}>
            <button
              type="button"
              data-cobertura-dia={day.date}
              onClick={() => props.onEdit(day.date)}
              className="flex-1 min-w-0 flex items-center gap-2 px-3 py-2.5 text-xs text-left hover:bg-slate-50"
            >
              <span className="font-mono font-black text-slate-700 w-14 shrink-0">{day.label}</span>
              <span className="flex-1 min-w-0">
                <span className="block truncate font-bold text-slate-700">{day.coverageLabel}</span>
                {day.titular ? (
                  <span className="block truncate text-[9px] font-bold text-amber-700 mt-0.5">Cubrir: {day.titular}</span>
                ) : (
                  <span className="block text-[9px] font-bold text-rose-500 mt-0.5">Sin turno laboral inferido</span>
                )}
              </span>
              {day.mode === 'split' && (
                <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-violet-100 text-violet-800 shrink-0">ext+adel</span>
              )}
              {day.mode === 'substitute' && (
                <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-teal-100 text-teal-800 shrink-0">suplente</span>
              )}
            </button>
            {day.mode !== 'none' && (
              <button
                type="button"
                data-cobertura-quitar={day.date}
                onClick={() => props.onClear(day.date)}
                className="shrink-0 px-2 py-1 text-[10px] font-black text-rose-600 hover:bg-rose-50 rounded-lg"
              >
                Quitar
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Botones del día que se está configurando. El primario guarda solo ese día. */
export function VacancyCoberturaAcciones(props: {
  dayLabel: string;
  markedCount: number;
  canApply: boolean;
  isLast: boolean;
  hasPreviousCoverage: boolean;
  onApplyThisDay: () => void;
  onApplyToMarked: () => void;
  onNext: () => void;
  onCopyPrevious: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 pt-0.5 border-t border-slate-200/80" data-cobertura-acciones={props.dayLabel}>
      <button
        type="button"
        data-cobertura-aplicar="dia"
        disabled={!props.canApply}
        onClick={props.onApplyThisDay}
        className="w-full py-3 rounded-xl bg-indigo-600 text-white text-xs font-black disabled:opacity-40 hover:bg-indigo-700 shadow-sm"
      >
        Aplicar a este día
      </button>
      {props.markedCount > 1 && (
        <button
          type="button"
          data-cobertura-aplicar="marcados"
          disabled={!props.canApply}
          onClick={props.onApplyToMarked}
          className="w-full py-2.5 rounded-xl border border-indigo-200 bg-white text-[11px] font-black text-indigo-800 disabled:opacity-40 hover:bg-indigo-50"
        >
          Aplicar esta misma cobertura a los {props.markedCount} días marcados
        </button>
      )}
      <div className="flex gap-2">
        {props.hasPreviousCoverage && (
          <button
            type="button"
            data-cobertura-copiar="1"
            onClick={props.onCopyPrevious}
            className="flex-1 py-2.5 text-xs font-bold text-violet-700 hover:bg-violet-50 rounded-xl transition-colors"
          >
            Copiar del día anterior
          </button>
        )}
        <button
          type="button"
          data-cobertura-siguiente="1"
          onClick={props.onNext}
          className="flex-1 py-2.5 text-xs font-bold text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-xl transition-colors"
        >
          {props.isLast ? 'Listo' : 'Siguiente día →'}
        </button>
        <button
          type="button"
          onClick={props.onClose}
          className="px-4 py-2.5 text-xs font-bold text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
        >
          Cerrar
        </button>
      </div>
    </div>
  );
}
