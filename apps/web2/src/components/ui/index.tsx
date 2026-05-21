import React, { useState, useMemo } from 'react';
import { LayoutGrid, List, Search, Loader2 } from 'lucide-react';

// ─── SECTION TITLE ────────────────────────────────────────────────────────────
export const SectionTitle = ({ label }: { label: string }) => (
  <div className="flex items-center gap-3 mb-4">
    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500 whitespace-nowrap">
      {label}
    </span>
    <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
  </div>
);

// ─── METRIC CARD (compact horizontal) ────────────────────────────────────────
interface MetricCardProps {
  title: string;
  value: React.ReactNode;
  icon: React.ElementType;
  color: string;       // hex color for icon bg tint
  subtext?: string;
  alert?: boolean;
  noData?: boolean;
}
export const MetricCard = ({ title, value, icon: Icon, color, subtext, alert, noData }: MetricCardProps) => (
  <div
    role="group"
    aria-label={title}
    className={`bg-white dark:bg-slate-800 px-4 py-3.5 rounded-xl border shadow-sm hover:shadow-md transition-all flex items-center gap-3
      ${alert ? 'border-rose-300 dark:border-rose-800 ring-1 ring-rose-200 dark:ring-rose-900' : 'border-slate-100 dark:border-slate-700'}
      ${noData ? 'opacity-55' : ''}`}>
    <div className="p-2 rounded-lg shrink-0 flex items-center justify-center" style={{ background: color + '18' }}>
      <Icon size={16} color={color} strokeWidth={2.5} aria-hidden="true" />
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider leading-tight truncate">{title}</p>
      <p className={`text-xl font-black leading-tight ${noData ? 'text-slate-300 dark:text-slate-600' : 'text-slate-800 dark:text-white'}`}>
        {noData ? '—' : value}
      </p>
      {subtext && <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium leading-tight truncate">{subtext}</p>}
    </div>
  </div>
);

// ─── PAGE SHELL ───────────────────────────────────────────────────────────────
interface PageShellProps {
  children: React.ReactNode;
  className?: string;
}
export const PageShell = ({ children, className = '' }: PageShellProps) => (
  <div className={`min-h-screen bg-slate-50/50 dark:bg-slate-900 p-6 pb-20 animate-in fade-in ${className}`}>
    {children}
  </div>
);

// ─── PAGE HEADER ─────────────────────────────────────────────────────────────
interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: React.ElementType;
  actions?: React.ReactNode;
  className?: string;
}
export const PageHeader = ({ title, subtitle, icon: Icon, actions, className = '' }: PageHeaderProps) => (
  <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 ${className}`}>
    <div className="flex items-center gap-3">
      {Icon && (
        <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20 shrink-0">
          <Icon size={20} className="text-white" aria-hidden="true" />
        </div>
      )}
      <div>
        <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight uppercase">{title}</h1>
        {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-0.5">{subtitle}</p>}
      </div>
    </div>
    {actions && <div className="flex items-center gap-2">{actions}</div>}
  </div>
);

// ─── CONTENT CARD ─────────────────────────────────────────────────────────────
interface ContentCardProps {
  children: React.ReactNode;
  className?: string;
  padding?: boolean;
}
export const ContentCard = ({ children, className = '', padding = true }: ContentCardProps) => (
  <div className={`bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm ${padding ? 'p-6' : ''} ${className}`}>
    {children}
  </div>
);

// ─── TAB BAR ─────────────────────────────────────────────────────────────────
interface Tab { id: string; label: string; icon?: React.ElementType; count?: number; }
interface TabBarProps {
  tabs: Tab[];
  active: string;
  onChange: (id: string) => void;
  label?: string;
}
export const TabBar = ({ tabs, active, onChange, label }: TabBarProps) => (
  <div
    role="tablist"
    aria-label={label}
    className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800/50 p-1 rounded-xl border border-slate-200 dark:border-slate-700 flex-wrap"
  >
    {tabs.map(tab => (
      <button
        key={tab.id}
        role="tab"
        aria-selected={active === tab.id}
        onClick={() => onChange(tab.id)}
        className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-[11px] font-black uppercase transition-all
          ${active === tab.id
            ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
            : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
      >
        {tab.icon && <tab.icon size={12} aria-hidden="true" />}
        {tab.label}
        {tab.count !== undefined && (
          <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-black
            ${active === tab.id ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400' : 'bg-slate-200 dark:bg-slate-600 text-slate-500 dark:text-slate-400'}`}>
            {tab.count}
          </span>
        )}
      </button>
    ))}
  </div>
);

// ─── MODULE SHELL ─────────────────────────────────────────────────────────────
// Shell reutilizable con toggle card/lista y expand/collapse por ítem.

export interface ModuleShellItem { id: string }

export interface ModuleShellProps<T extends ModuleShellItem> {
  title: string;
  subtitle?: string;
  icon: React.ElementType;
  iconColor?: string;
  action?: React.ReactNode;
  topContent?: React.ReactNode;
  items: T[];
  loading?: boolean;
  emptyText?: string;
  searchPlaceholder?: string;
  searchFn: (item: T, query: string) => boolean;
  // Render functions
  renderCardSummary: (item: T) => React.ReactNode;
  renderRowSummary: (item: T) => React.ReactNode;
  renderExpanded: (item: T, close: () => void) => React.ReactNode;
  accentFn?: (item: T) => string; // Tailwind bg class, e.g. 'bg-emerald-500'
  defaultView?: 'card' | 'list';
}

export function ModuleShell<T extends ModuleShellItem>({
  title, subtitle, icon: Icon, iconColor = 'bg-indigo-600',
  action, topContent, items, loading = false, emptyText = 'Sin resultados.',
  searchPlaceholder = 'Buscar...', searchFn,
  renderCardSummary, renderRowSummary, renderExpanded,
  accentFn, defaultView = 'card',
}: ModuleShellProps<T>) {
  const [view, setView] = useState<'card' | 'list'>(defaultView);
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return items;
    return items.filter(item => searchFn(item, q));
  }, [items, query, searchFn]);

  const toggle = (id: string) => setExpandedId(prev => prev === id ? null : id);
  const close = () => setExpandedId(null);

  return (
    <div className="min-h-screen bg-slate-50/50 dark:bg-slate-900 p-6 pb-20 animate-in fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 ${iconColor} rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20 shrink-0`}>
            <Icon size={20} className="text-white" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight uppercase">{title}</h1>
            {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-0.5">{subtitle}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {action}
        </div>
      </div>

      {/* Optional content between header and toolbar */}
      {topContent && <div className="mb-6">{topContent}</div>}

      {/* Toolbar: search + view toggle */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl flex items-center gap-3 px-4 py-3 shadow-sm">
          <Search size={16} className="text-slate-400 shrink-0" aria-hidden="true" />
          <input
            value={query}
            onChange={e => { setQuery(e.target.value); setExpandedId(null); }}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="flex-1 bg-transparent outline-none text-sm font-bold text-slate-700 dark:text-white placeholder:text-slate-400 placeholder:font-normal uppercase"
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label="Limpiar búsqueda" className="text-slate-400 hover:text-slate-600 text-xs font-bold shrink-0">✕</button>
          )}
        </div>
        <div role="group" aria-label="Tipo de vista" className="flex items-center bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden shadow-sm">
          <button
            onClick={() => { setView('card'); close(); }}
            aria-label="Vista tarjetas"
            aria-pressed={view === 'card'}
            className={`p-2.5 transition-colors ${view === 'card' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
          >
            <LayoutGrid size={16} aria-hidden="true" />
          </button>
          <button
            onClick={() => { setView('list'); close(); }}
            aria-label="Vista lista"
            aria-pressed={view === 'list'}
            className={`p-2.5 transition-colors ${view === 'list' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
          >
            <List size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Count */}
      {!loading && (
        <p className="text-[10px] font-black uppercase text-slate-400 mb-4 tracking-widest">
          {filtered.length} {filtered.length === 1 ? 'resultado' : 'resultados'}
          {query && ` para "${query}"`}
        </p>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-24 gap-3 text-slate-400">
          <Loader2 size={22} className="animate-spin" />
          <span className="text-sm font-bold">Cargando…</span>
        </div>
      )}

      {/* Empty */}
      {!loading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-slate-400 gap-2">
          <Icon size={36} className="opacity-20" aria-hidden="true" />
          <p className="text-sm font-bold">{emptyText}</p>
        </div>
      )}

      {/* CARD VIEW */}
      {!loading && filtered.length > 0 && view === 'card' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(item => {
            const isOpen = expandedId === item.id;
            const accent = accentFn?.(item) ?? 'bg-indigo-400';
            return (
              <div key={item.id} className={`bg-white dark:bg-slate-800 rounded-2xl border shadow-sm transition-all overflow-hidden
                ${isOpen ? 'border-indigo-300 dark:border-indigo-700 shadow-md ring-1 ring-indigo-200 dark:ring-indigo-800 md:col-span-2 lg:col-span-3' : 'border-slate-200 dark:border-slate-700 hover:shadow-md hover:border-indigo-200 dark:hover:border-indigo-700'}`}>
                {/* Summary (siempre visible) */}
                <button
                  onClick={() => toggle(item.id)}
                  aria-expanded={isOpen}
                  className="w-full text-left flex items-stretch gap-0 focus:outline-none"
                >
                  <div className={`w-1.5 shrink-0 rounded-l-2xl ${accent}`} />
                  <div className="flex-1 p-5 pr-4">
                    {renderCardSummary(item)}
                  </div>
                  <div className="flex items-start pt-5 pr-4">
                    <span aria-hidden="true" className={`text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </span>
                  </div>
                </button>
                {/* Expanded */}
                {isOpen && (
                  <div className="border-t border-slate-100 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40 px-6 py-5 animate-in fade-in slide-in-from-top-1 duration-150">
                    {renderExpanded(item, close)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* LIST VIEW */}
      {!loading && filtered.length > 0 && view === 'list' && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
          {filtered.map((item, idx) => {
            const isOpen = expandedId === item.id;
            const accent = accentFn?.(item) ?? 'bg-indigo-400';
            return (
              <div key={item.id} className={`${idx > 0 ? 'border-t border-slate-100 dark:border-slate-700' : ''}`}>
                <button
                  onClick={() => toggle(item.id)}
                  aria-expanded={isOpen}
                  className={`w-full text-left flex items-center gap-0 transition-colors focus:outline-none
                    ${isOpen ? 'bg-indigo-50/60 dark:bg-indigo-900/20' : 'hover:bg-slate-50 dark:hover:bg-slate-700/40'}`}
                >
                  <div className={`w-1 self-stretch shrink-0 ${accent}`} />
                  <div className="flex-1 px-5 py-3.5">
                    {renderRowSummary(item)}
                  </div>
                  <div className="px-4 shrink-0">
                    <span aria-hidden="true" className={`text-slate-400 transition-transform duration-200 block ${isOpen ? 'rotate-180' : ''}`}>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </span>
                  </div>
                </button>
                {isOpen && (
                  <div className="border-t border-slate-100 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40 px-6 py-5 animate-in fade-in slide-in-from-top-1 duration-150">
                    {renderExpanded(item, close)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
