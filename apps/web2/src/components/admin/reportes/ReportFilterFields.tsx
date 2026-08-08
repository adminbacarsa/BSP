import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';

export const RPT_FIELD_LABEL = 'text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wide';
export const RPT_INPUT =
  'w-full h-10 px-3 rounded-2xl border-2 border-slate-100 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm font-bold text-slate-700 dark:text-slate-200 outline-none shadow-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 transition-colors';
export const RPT_SEARCH_INPUT =
  'w-full h-9 pl-9 pr-3 rounded-2xl border-2 border-slate-100 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm font-medium text-slate-700 dark:text-slate-200 outline-none shadow-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15';
export const RPT_SELECT =
  'w-full h-10 px-3 rounded-2xl border-2 border-slate-100 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm font-bold text-slate-700 dark:text-slate-200 outline-none shadow-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15';
export const RPT_SELECT_ACCENT =
  'w-full h-10 px-3 rounded-2xl border-2 border-indigo-100 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/30 text-sm font-bold text-slate-800 dark:text-slate-100 outline-none shadow-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15';

type ReportFilterSectionProps = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
};

export function ReportFilterSection({ title, subtitle, children, className = '' }: ReportFilterSectionProps) {
  return (
    <div className={`w-full border-t border-slate-100 dark:border-slate-700 pt-4 mt-1 ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h3 className="text-xs font-black text-slate-800 dark:text-white uppercase tracking-wide">{title}</h3>
        {subtitle ? <p className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400">{subtitle}</p> : null}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">{children}</div>
    </div>
  );
}

type ReportSearchSelectProps = {
  step?: string;
  label: string;
  hint?: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  selectValue: string;
  onSelectChange: (value: string) => void;
  emptyLabel: string;
  disabled?: boolean;
  searchDisabled?: boolean;
  accentSelect?: boolean;
  children: React.ReactNode;
};

export function ReportSearchSelect({
  step,
  label,
  hint,
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Buscar…',
  selectValue,
  onSelectChange,
  emptyLabel,
  disabled,
  searchDisabled,
  accentSelect,
  children,
}: ReportSearchSelectProps) {
  const off = disabled || searchDisabled;
  return (
    <div className={`flex flex-col gap-1.5 min-w-0 ${disabled ? 'opacity-60' : ''}`}>
      <label className="flex items-center gap-2 min-h-[14px]">
        {step ? <span className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 tabular-nums">{step}</span> : null}
        <span className={RPT_FIELD_LABEL}>{label}</span>
      </label>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" aria-hidden />
        <input
          type="search"
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          disabled={off}
          className={`${RPT_SEARCH_INPUT} disabled:cursor-not-allowed`}
        />
      </div>
      <select
        value={selectValue}
        onChange={(e) => onSelectChange(e.target.value)}
        disabled={disabled}
        className={`${accentSelect ? RPT_SELECT_ACCENT : RPT_SELECT} disabled:cursor-not-allowed`}
      >
        <option value="">{emptyLabel}</option>
        {children}
      </select>
      {hint ? <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-snug">{hint}</p> : null}
    </div>
  );
}

type ReportSelectFieldProps = {
  step?: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  emptyLabel: string;
  disabled?: boolean;
  accent?: boolean;
  children: React.ReactNode;
};

export function ReportSelectField({
  step,
  label,
  hint,
  value,
  onChange,
  emptyLabel,
  disabled,
  accent,
  children,
}: ReportSelectFieldProps) {
  return (
    <div className={`flex flex-col gap-1.5 min-w-0 ${disabled ? 'opacity-60' : ''}`}>
      <label className="flex items-center gap-2">
        {step ? <span className="text-[10px] font-black text-indigo-600 dark:text-indigo-400">{step}</span> : null}
        <span className={RPT_FIELD_LABEL}>{label}</span>
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={`${accent ? RPT_SELECT_ACCENT : RPT_SELECT} disabled:cursor-not-allowed`}
      >
        <option value="">{emptyLabel}</option>
        {children}
      </select>
      {hint ? <p className="text-[10px] text-slate-500 leading-snug">{hint}</p> : null}
    </div>
  );
}

export function ReportClearButton({ onClick, label = 'Limpiar filtros' }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-10 px-4 text-[10px] font-black uppercase text-rose-600 hover:text-rose-700 border-2 border-rose-100 dark:border-rose-900/50 rounded-2xl bg-rose-50/80 dark:bg-rose-950/20 hover:bg-rose-100 dark:hover:bg-rose-950/40 transition-colors shadow-sm"
    >
      {label}
    </button>
  );
}

export type ReportEmployeeOption = {
  id: string;
  name: string;
  legajo: string;
};

type ReportEmployeeLookupProps = {
  label?: string;
  hint?: string;
  employees: ReportEmployeeOption[];
  selectedId: string;
  onSelectedIdChange: (id: string) => void;
  searchText: string;
  onSearchTextChange: (value: string) => void;
  placeholder?: string;
  listCap?: number;
};

/** Búsqueda con lupa + lista desplegable (liquidación por legajo). */
export function ReportEmployeeLookup({
  label = 'Buscar empleado',
  hint,
  employees,
  selectedId,
  onSelectedIdChange,
  searchText,
  onSearchTextChange,
  placeholder = 'Nombre o legajo…',
  listCap = 12,
}: ReportEmployeeLookupProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const selected = useMemo(
    () => employees.find((e) => e.id === selectedId) ?? null,
    [employees, selectedId],
  );

  const matches = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    const base = q
      ? employees.filter((e) => {
          const hay = `${e.name} ${e.legajo}`.toLowerCase();
          return hay.includes(q);
        })
      : employees;
    return base.slice(0, listCap);
  }, [employees, searchText, listCap]);

  useEffect(() => {
    const onDoc = (ev: MouseEvent) => {
      if (!rootRef.current?.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const pick = (emp: ReportEmployeeOption) => {
    onSelectedIdChange(emp.id);
    onSearchTextChange(emp.name);
    setOpen(false);
  };

  const clear = () => {
    onSelectedIdChange('');
    onSearchTextChange('');
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="flex flex-col gap-1.5 min-w-0 md:col-span-2 xl:col-span-3">
      <label className="flex items-center gap-2" htmlFor={`${listId}-input`}>
        <Search className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" aria-hidden />
        <span className={RPT_FIELD_LABEL}>{label}</span>
      </label>

      {selected ? (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border-2 border-indigo-100 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-950/30 px-3 py-2 shadow-sm">
          <span className="text-sm font-black text-slate-800 dark:text-white truncate">
            {selected.legajo ? (
              <>
                <span className="font-mono text-indigo-700 dark:text-indigo-300">{selected.legajo}</span>
                <span className="text-slate-400 font-normal mx-1.5">·</span>
              </>
            ) : null}
            {selected.name}
          </span>
          <button
            type="button"
            onClick={clear}
            className="ml-auto text-[10px] font-black uppercase text-rose-600 hover:text-rose-700 px-2 py-1 rounded-lg border border-rose-200 bg-white/80 dark:bg-slate-900/50"
          >
            Quitar
          </button>
        </div>
      ) : null}

      <div className="relative">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-indigo-500 pointer-events-none"
          aria-hidden
        />
        <input
          id={`${listId}-input`}
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${listId}-listbox`}
          aria-autocomplete="list"
          value={searchText}
          onChange={(e) => {
            onSearchTextChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className={`${RPT_SEARCH_INPUT} pl-10 h-11 text-sm`}
        />
        {open && matches.length > 0 ? (
          <ul
            id={`${listId}-listbox`}
            role="listbox"
            className="absolute z-30 left-0 right-0 mt-1 max-h-56 overflow-auto rounded-2xl border-2 border-slate-100 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-lg py-1"
          >
            {matches.map((emp) => (
              <li key={emp.id} role="option" aria-selected={emp.id === selectedId}>
                <button
                  type="button"
                  className="w-full text-left px-3 py-2.5 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 flex items-baseline gap-2"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(emp)}
                >
                  {emp.legajo ? (
                    <span className="font-mono text-[11px] font-black text-indigo-600 dark:text-indigo-400 shrink-0">
                      {emp.legajo}
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-400 shrink-0">—</span>
                  )}
                  <span className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate">{emp.name}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {open && searchText.trim() && matches.length === 0 ? (
          <p className="absolute z-30 left-0 right-0 mt-1 px-3 py-2 text-xs text-slate-500 rounded-2xl border border-slate-100 bg-white shadow-lg">
            Sin coincidencias en la plantilla.
          </p>
        ) : null}
      </div>
      {hint ? <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-snug">{hint}</p> : null}
    </div>
  );
}
