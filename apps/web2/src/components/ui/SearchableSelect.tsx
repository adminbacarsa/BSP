import { useState, useRef, useEffect } from 'react';

export interface SearchableSelectOption { value: string; label: string; }

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  className?: string;
}

export function SearchableSelect({ value, onChange, options, placeholder = 'Seleccionar...', className = '' }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedLabel = options.find(o => o.value === value)?.label ?? '';
  const filtered = query.trim()
    ? options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  function openDropdown() {
    setQuery('');
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function selectOpt(opt: SearchableSelectOption) {
    onChange(opt.value);
    setOpen(false);
    setQuery('');
  }

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          className={`${className} pr-8`}
          value={open ? query : selectedLabel}
          placeholder={open ? 'Buscar...' : (selectedLabel || placeholder)}
          readOnly={!open}
          style={{ cursor: open ? 'text' : 'pointer' }}
          onClick={() => { if (!open) openDropdown(); }}
          onChange={e => { if (open) setQuery(e.target.value); }}
          onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}
        />
        <span
          className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400"
          aria-hidden="true"
        >
          <svg
            className={`w-4 h-4 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
          </svg>
        </span>
      </div>

      {open && (
        <div className="absolute z-50 w-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl overflow-hidden">
          <ul className="max-h-56 overflow-y-auto">
            {filtered.length === 0 && (
              <li className="px-3 py-2.5 text-sm text-slate-400 italic">Sin resultados</li>
            )}
            {filtered.map(opt => (
              <li
                key={opt.value}
                className={`px-3 py-2.5 text-sm cursor-pointer ${
                  opt.value === value
                    ? 'bg-indigo-50 dark:bg-indigo-900/30 font-bold text-indigo-600 dark:text-indigo-400'
                    : 'text-slate-900 dark:text-white hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}
                onMouseDown={e => { e.preventDefault(); selectOpt(opt); }}
              >
                {opt.label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
