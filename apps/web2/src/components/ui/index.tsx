import React, { useState, useMemo } from 'react';
import { LayoutGrid, List, Search, Loader2 } from 'lucide-react';

// ─── SECTION TITLE ────────────────────────────────────────────────────────────
export const SectionTitle = ({ label }: { label: string }) => (
  <div className="flex items-center gap-3 mb-4">
    <span className="text-[10px] font-black uppercase tracking-[0.2em] whitespace-nowrap" style={{ color: 'var(--txt3)' }}>
      {label}
    </span>
    <div className="flex-1 h-px" style={{ backgroundColor: 'var(--border)' }} />
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
    className={`px-4 py-3.5 rounded-xl border transition-all flex items-center gap-3 ${noData ? 'opacity-55' : ''}`}
    style={{
      backgroundColor: 'var(--surf)',
      borderColor: alert ? 'rgba(239,68,68,0.5)' : 'var(--border)',
      borderTop: `2px solid var(--company-primary, #6366f1)`,
    }}
  >
    <div className="p-2 rounded-lg shrink-0 flex items-center justify-center" style={{ background: color + '22' }}>
      <Icon size={16} color={color} strokeWidth={2.5} aria-hidden="true" />
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-[9px] font-black uppercase tracking-wider leading-tight truncate" style={{ color: 'var(--txt3)' }}>{title}</p>
      <p className="text-xl font-black leading-tight" style={{ color: noData ? 'var(--txt3)' : 'var(--txt)' }}>
        {noData ? '—' : value}
      </p>
      {subtext && <p className="text-[10px] font-medium leading-tight truncate" style={{ color: 'var(--txt3)' }}>{subtext}</p>}
    </div>
  </div>
);

// ─── PAGE SHELL ───────────────────────────────────────────────────────────────
interface PageShellProps {
  children: React.ReactNode;
  className?: string;
}
export const PageShell = ({ children, className = '' }: PageShellProps) => (
  <div
    className={`min-h-screen p-6 pb-20 animate-in fade-in ${className}`}
    style={{ backgroundColor: 'var(--app-bg)' }}
  >
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
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: 'var(--company-primary, #6366f1)' }}
        >
          <Icon size={20} className="text-white" aria-hidden="true" />
        </div>
      )}
      <div>
        <h1 className="text-2xl font-black tracking-tight uppercase" style={{ color: 'var(--txt)' }}>{title}</h1>
        {subtitle && <p className="text-xs font-medium mt-0.5" style={{ color: 'var(--txt3)' }}>{subtitle}</p>}
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
  <div
    className={`rounded-xl border ${padding ? 'p-6' : ''} ${className}`}
    style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}
  >
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
    className="flex items-center gap-1 p-1 rounded-xl border flex-wrap"
    style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)' }}
  >
    {tabs.map(tab => (
      <button
        key={tab.id}
        role="tab"
        aria-selected={active === tab.id}
        onClick={() => onChange(tab.id)}
        className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[11px] font-black uppercase transition-all"
        style={active === tab.id ? {
          backgroundColor: 'var(--surf)',
          color: 'var(--company-primary, #6366f1)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
        } : {
          color: 'var(--txt3)',
        }}
      >
        {tab.icon && <tab.icon size={12} aria-hidden="true" />}
        {tab.label}
        {tab.count !== undefined && (
          <span
            className="px-1.5 py-0.5 rounded-full text-[9px] font-black"
            style={active === tab.id ? {
              background: 'var(--company-primary, #6366f1)',
              color: '#fff',
            } : {
              background: 'var(--surf3)',
              color: 'var(--txt3)',
            }}
          >
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
    <div className="min-h-screen p-6 pb-20 animate-in fade-in" style={{ backgroundColor: 'var(--app-bg)' }}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'var(--company-primary, #6366f1)' }}
          >
            <Icon size={20} className="text-white" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight uppercase" style={{ color: 'var(--txt)' }}>{title}</h1>
            {subtitle && <p className="text-xs font-medium mt-0.5" style={{ color: 'var(--txt3)' }}>{subtitle}</p>}
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
        <div
          className="flex-1 rounded-xl border flex items-center gap-3 px-4 py-3"
          style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}
        >
          <Search size={16} style={{ color: 'var(--txt3)' }} className="shrink-0" aria-hidden="true" />
          <input
            value={query}
            onChange={e => { setQuery(e.target.value); setExpandedId(null); }}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="flex-1 bg-transparent outline-none text-sm font-bold uppercase placeholder:font-normal"
            style={{ color: 'var(--txt)' }}
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label="Limpiar búsqueda" className="text-xs font-bold shrink-0" style={{ color: 'var(--txt3)' }}>✕</button>
          )}
        </div>
        <div
          role="group"
          aria-label="Tipo de vista"
          className="flex items-center rounded-xl overflow-hidden border"
          style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}
        >
          <button
            onClick={() => { setView('card'); close(); }}
            aria-label="Vista tarjetas"
            aria-pressed={view === 'card'}
            className="p-2.5 transition-colors"
            style={view === 'card'
              ? { background: 'var(--company-primary, #6366f1)', color: '#fff' }
              : { color: 'var(--txt3)' }}
          >
            <LayoutGrid size={16} aria-hidden="true" />
          </button>
          <button
            onClick={() => { setView('list'); close(); }}
            aria-label="Vista lista"
            aria-pressed={view === 'list'}
            className="p-2.5 transition-colors"
            style={view === 'list'
              ? { background: 'var(--company-primary, #6366f1)', color: '#fff' }
              : { color: 'var(--txt3)' }}
          >
            <List size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Count */}
      {!loading && (
        <p className="text-[10px] font-black uppercase mb-4 tracking-widest" style={{ color: 'var(--txt3)' }}>
          {filtered.length} {filtered.length === 1 ? 'resultado' : 'resultados'}
          {query && ` para "${query}"`}
        </p>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-24 gap-3" style={{ color: 'var(--txt3)' }}>
          <Loader2 size={22} className="animate-spin" />
          <span className="text-sm font-bold">Cargando…</span>
        </div>
      )}

      {/* Empty */}
      {!loading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 gap-2" style={{ color: 'var(--txt3)' }}>
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
              <div
                key={item.id}
                className={`rounded-xl border transition-all overflow-hidden ${isOpen ? 'md:col-span-2 lg:col-span-3' : ''}`}
                style={{
                  backgroundColor: 'var(--surf)',
                  borderColor: isOpen ? 'var(--company-primary, #6366f1)' : 'var(--border)',
                }}
              >
                {/* Summary (siempre visible) */}
                <button
                  onClick={() => toggle(item.id)}
                  aria-expanded={isOpen}
                  className="w-full text-left flex items-stretch gap-0 focus:outline-none"
                >
                  <div className={`w-1.5 shrink-0 rounded-l-xl ${accent}`} />
                  <div className="flex-1 p-5 pr-4">
                    {renderCardSummary(item)}
                  </div>
                  <div className="flex items-start pt-5 pr-4">
                    <span aria-hidden="true" className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} style={{ color: 'var(--txt3)' }}>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </span>
                  </div>
                </button>
                {/* Expanded */}
                {isOpen && (
                  <div
                    className="border-t px-6 py-5 animate-in fade-in slide-in-from-top-1 duration-150"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surf2)' }}
                  >
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
        <div
          className="rounded-xl border overflow-hidden"
          style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}
        >
          {filtered.map((item, idx) => {
            const isOpen = expandedId === item.id;
            const accent = accentFn?.(item) ?? 'bg-indigo-400';
            return (
              <div
                key={item.id}
                className={idx > 0 ? 'border-t' : ''}
                style={idx > 0 ? { borderColor: 'var(--border)' } : undefined}
              >
                <button
                  onClick={() => toggle(item.id)}
                  aria-expanded={isOpen}
                  className="w-full text-left flex items-center gap-0 transition-colors focus:outline-none"
                  style={isOpen
                    ? { backgroundColor: 'var(--surf2)' }
                    : undefined}
                >
                  <div className={`w-1 self-stretch shrink-0 ${accent}`} />
                  <div className="flex-1 px-5 py-3.5">
                    {renderRowSummary(item)}
                  </div>
                  <div className="px-4 shrink-0">
                    <span aria-hidden="true" className={`transition-transform duration-200 block ${isOpen ? 'rotate-180' : ''}`} style={{ color: 'var(--txt3)' }}>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </span>
                  </div>
                </button>
                {isOpen && (
                  <div
                    className="border-t px-6 py-5 animate-in fade-in slide-in-from-top-1 duration-150"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surf2)' }}
                  >
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
