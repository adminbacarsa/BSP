import React, { useEffect, useRef, useState } from 'react';
import {
  Search, Edit2, Trash2, FileCheck, ChevronLeft, ChevronRight, Calendar, Clock, AlertTriangle,
} from 'lucide-react';

/** Formatea un Firestore Timestamp, Date o string "HH:MM" a HH:MM ARG.
 *  Acepta fallbacks: primer valor no-nulo gana. */
function fmtCheckIn(...vals: any[]): string | null {
  for (const val of vals) {
    if (!val) continue;
    // String ya formateado "HH:MM" o "HH:MM:SS"
    if (typeof val === 'string' && /^\d{2}:\d{2}/.test(val)) return val.slice(0, 5);
    // Timestamp Firestore / { seconds } plain
    const d: Date | null = val.toDate ? val.toDate() : (val.seconds ? new Date(val.seconds * 1000) : null);
    if (d) return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Cordoba' });
  }
  return null;
}

/** Countdown hasta las 23:59 de hoy en ARG */
function useCountdownTo2359(startDate: string | undefined) {
  const [remaining, setRemaining] = useState('');
  useEffect(() => {
    if (!startDate) return;
    const tick = () => {
      const now = new Date();
      const argNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Argentina/Cordoba' }));
      const todayArg = argNow.toISOString().slice(0, 10);
      if (startDate !== todayArg) { setRemaining(''); return; }
      const deadline = new Date(argNow);
      deadline.setHours(23, 59, 0, 0);
      const diff = deadline.getTime() - argNow.getTime();
      if (diff <= 0) { setRemaining('Vencido'); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      setRemaining(h > 0 ? `${h}h ${m}m` : `${m}m`);
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [startDate]);
  return remaining;
}
import type { Absence } from '@/services/absenceService';
import { NOVEDAD_TYPE_LABELS_FALLBACK } from '@/lib/rrhh/novedadTypes';

function SelectionBox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 shadow-sm transition-all ${
        checked
          ? 'border-slate-950 bg-slate-950 text-white dark:border-white dark:bg-white dark:text-slate-950'
          : 'border-slate-950 bg-white text-transparent hover:bg-slate-100 dark:border-white dark:bg-slate-900'
      }`}
    >
      <span className="text-[11px] font-black leading-none">✓</span>
    </button>
  );
}

export interface AusenciasTabProps {
  canAdjust: boolean;
  filteredAbsences: Absence[];
  absenceSearchTerm: string;
  setAbsenceSearchTerm: (v: string) => void;
  absenceTypeFilter: string;
  setAbsenceTypeFilter: (v: string) => void;
  absenceStatusFilter: string;
  setAbsenceStatusFilter: (v: string) => void;
  absenceDateFilterMode: 'month' | 'days';
  setAbsenceDateFilterMode: (v: 'month' | 'days') => void;
  absencePeriodFilter: string;
  setAbsencePeriodFilter: (v: string) => void;
  absenceCalendarMonth: string;
  setAbsenceCalendarMonth: (v: string) => void;
  absenceSelectedDays: Set<string>;
  setAbsenceSelectedDays: React.Dispatch<React.SetStateAction<Set<string>>>;
  absencePeriods: { value: string; label: string }[];
  absenceCalendarCells: (string | null)[];
  toggleAbsenceCalendarDay: (day: string) => void;
  selectedAbsenceIds: Set<string>;
  setSelectedAbsenceIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  getAbsenceEmployeeName: (a: Absence) => string;
  getArgentinaDate: (d: unknown) => string;
  renderAbsenceStatusCell: (a: Absence) => React.ReactNode;
  coberturaBadgeClass: (estado?: string) => string;
  handleOpenAbsenceModal: (a?: Absence) => void;
  handleDeleteAbsence: (id: string) => void;
  novedadTypeLabels?: string[];
}

export default function AusenciasTab({
  canAdjust,
  filteredAbsences,
  absenceSearchTerm,
  setAbsenceSearchTerm,
  absenceTypeFilter,
  setAbsenceTypeFilter,
  absenceStatusFilter,
  setAbsenceStatusFilter,
  absenceDateFilterMode,
  setAbsenceDateFilterMode,
  absencePeriodFilter,
  setAbsencePeriodFilter,
  absenceCalendarMonth,
  setAbsenceCalendarMonth,
  absenceSelectedDays,
  setAbsenceSelectedDays,
  absencePeriods,
  absenceCalendarCells,
  toggleAbsenceCalendarDay,
  selectedAbsenceIds,
  setSelectedAbsenceIds,
  getAbsenceEmployeeName,
  getArgentinaDate,
  renderAbsenceStatusCell,
  coberturaBadgeClass,
  handleOpenAbsenceModal,
  handleDeleteAbsence,
  novedadTypeLabels,
}: AusenciasTabProps) {
  const typeOptions = (novedadTypeLabels && novedadTypeLabels.length > 0)
    ? novedadTypeLabels
    : [...NOVEDAD_TYPE_LABELS_FALLBACK];
  const [showDayPicker, setShowDayPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  const monthLabel = absencePeriods.find(p => p.value === absenceCalendarMonth)?.label || absenceCalendarMonth;
  const selectedDayList = [...absenceSelectedDays].sort();
  const hasActiveFilters = !!(absenceTypeFilter || absenceStatusFilter || absencePeriodFilter
    || absenceDateFilterMode === 'days' || absenceSelectedDays.size > 0);

  useEffect(() => {
    if (absenceDateFilterMode === 'month') setShowDayPicker(false);
  }, [absenceDateFilterMode]);

  useEffect(() => {
    if (!showDayPicker) return;
    const onDocClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowDayPicker(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [showDayPicker]);

  const shiftCalendarMonth = (delta: number) => {
    const [y, m] = absenceCalendarMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setAbsenceCalendarMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const clearFilters = () => {
    setAbsenceTypeFilter('');
    setAbsenceStatusFilter('');
    const n = new Date();
    setAbsencePeriodFilter(`${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`);
    setAbsenceDateFilterMode('month');
    setAbsenceSelectedDays(new Set());
    setShowDayPicker(false);
  };

  const formatDayChip = (day: string) => {
    const [, , dd] = day.split('-');
    return `${parseInt(dd, 10)}`;
  };

  return (
    <div className="flex-1 bg-white dark:bg-slate-800 rounded-xl border dark:border-slate-700 p-4 overflow-hidden flex flex-col min-h-0">
      <div className="flex flex-wrap items-center gap-2 mb-2 shrink-0">
        <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-900 px-3 py-1.5 rounded-xl border dark:border-slate-700 flex-1 min-w-[160px] max-w-xs">
          <Search size={15} className="text-slate-400 shrink-0" />
          <input
            placeholder="Buscar empleado..."
            className="bg-transparent outline-none w-full text-sm font-bold text-slate-900 dark:text-white"
            value={absenceSearchTerm}
            onChange={e => setAbsenceSearchTerm(e.target.value)}
          />
        </div>

        <select
          className="bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-1.5 text-xs font-black uppercase text-slate-700 dark:text-white outline-none"
          value={absenceTypeFilter}
          onChange={e => setAbsenceTypeFilter(e.target.value)}
        >
          <option value="">Todos los tipos</option>
          {typeOptions.map(t => <option key={t} value={t}>{t}</option>)}
        </select>

        <select
          className="bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-1.5 text-xs font-black uppercase text-slate-700 dark:text-white outline-none"
          value={absenceStatusFilter}
          onChange={e => setAbsenceStatusFilter(e.target.value)}
        >
          <option value="">Todos los estados</option>
          <option value="Confirmada">Confirmada</option>
          <option value="Pendiente">Pendiente</option>
          <option value="En verificación">En verificación</option>
          <option value="Autorizada">Autorizada</option>
          <option value="Justificada">Justificada</option>
          <option value="Injustificada">Injustificada</option>
          <option value="Rechazada">Rechazada</option>
        </select>

        <div className="flex rounded-xl border border-slate-200 dark:border-slate-600 overflow-hidden shrink-0">
          <button
            type="button"
            onClick={() => setAbsenceDateFilterMode('month')}
            className={`px-3 py-1.5 text-[10px] font-black uppercase transition-colors ${absenceDateFilterMode === 'month' ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-white'}`}
          >
            Mes
          </button>
          <button
            type="button"
            onClick={() => setAbsenceDateFilterMode('days')}
            className={`px-3 py-1.5 text-[10px] font-black uppercase transition-colors ${absenceDateFilterMode === 'days' ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-white'}`}
          >
            Días
          </button>
        </div>

        {absenceDateFilterMode === 'month' ? (
          <select
            className="bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-1.5 text-xs font-black uppercase text-slate-700 dark:text-white outline-none"
            value={absencePeriodFilter}
            onChange={e => setAbsencePeriodFilter(e.target.value)}
          >
            <option value="">Todos los períodos</option>
            {absencePeriods.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        ) : (
          <div ref={pickerRef} className="relative flex items-center gap-1 shrink-0">
            <button type="button" onClick={() => shiftCalendarMonth(-1)} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500">
              <ChevronLeft size={14} />
            </button>
            <span className="text-[10px] font-black uppercase text-slate-600 dark:text-slate-300 min-w-[72px] text-center">{monthLabel}</span>
            <button type="button" onClick={() => shiftCalendarMonth(1)} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500">
              <ChevronRight size={14} />
            </button>
            <button
              type="button"
              onClick={() => setShowDayPicker(v => !v)}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase border transition-colors ${showDayPicker ? 'bg-rose-600 text-white border-rose-600' : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-white border-slate-200 dark:border-slate-600 hover:border-rose-300'}`}
            >
              <Calendar size={12} />
              Días
            </button>
            {showDayPicker && (
              <div className="absolute top-full left-0 mt-1 z-30 w-[220px] p-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-xl">
                <div className="flex justify-end gap-2 mb-1.5">
                  <button
                    type="button"
                    onClick={() => setAbsenceSelectedDays(new Set(absenceCalendarCells.filter(Boolean) as string[]))}
                    className="text-[9px] font-bold text-indigo-600 hover:underline"
                  >
                    Todo el mes
                  </button>
                  <button
                    type="button"
                    onClick={() => setAbsenceSelectedDays(new Set())}
                    className="text-[9px] font-bold text-slate-400 hover:underline"
                  >
                    Limpiar
                  </button>
                </div>
                <div className="grid grid-cols-7 gap-0.5 text-center">
                  {['D', 'L', 'M', 'M', 'J', 'V', 'S'].map((d, i) => (
                    <div key={`${d}-${i}`} className="text-[8px] font-black text-slate-400 py-0.5">{d}</div>
                  ))}
                  {absenceCalendarCells.map((day, i) => day ? (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleAbsenceCalendarDay(day)}
                      className={`h-6 rounded text-[10px] font-bold font-mono transition-colors ${absenceSelectedDays.has(day) ? 'bg-rose-600 text-white' : 'bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-rose-50 dark:hover:bg-rose-900/20'}`}
                    >
                      {parseInt(day.split('-')[2], 10)}
                    </button>
                  ) : (
                    <div key={`pad-${i}`} className="h-6" />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="px-2.5 py-1.5 rounded-xl text-[10px] font-black uppercase text-slate-400 hover:text-rose-500 border border-slate-200 dark:border-slate-600 hover:border-rose-300 transition-colors"
          >
            Limpiar
          </button>
        )}

        <span className="text-[10px] font-bold text-slate-400 ml-auto">
          {filteredAbsences.length} novedad{filteredAbsences.length === 1 ? '' : 'es'}
        </span>
      </div>

      {absenceDateFilterMode === 'days' && (
        <div className="flex flex-wrap items-center gap-1 mb-2 shrink-0 min-h-[24px]">
          {selectedDayList.length === 0 ? (
            <span className="text-[10px] text-slate-400 font-bold">Mostrando todo {monthLabel} — abrí «Días» para filtrar fechas puntuales</span>
          ) : (
            <>
              <span className="text-[10px] text-slate-400 font-bold mr-1">{selectedDayList.length} día(s):</span>
              {selectedDayList.slice(0, 12).map(day => (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleAbsenceCalendarDay(day)}
                  className="px-1.5 py-0.5 rounded-md bg-rose-100 text-rose-700 text-[10px] font-black font-mono hover:bg-rose-200"
                  title={day}
                >
                  {formatDayChip(day)}
                </button>
              ))}
              {selectedDayList.length > 12 && (
                <span className="text-[10px] font-bold text-slate-400">+{selectedDayList.length - 12}</span>
              )}
            </>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto custom-scrollbar border border-slate-100 dark:border-slate-700 rounded-xl">
        <table className="w-full text-left border-collapse">
          <thead className="bg-slate-50 dark:bg-slate-900/80 sticky top-0 z-10">
            <tr className="border-b-2 border-slate-200 dark:border-slate-700">
              <th className="px-4 py-3 text-[10px] font-black uppercase tracking-wider text-slate-400">
                <div className="flex items-center gap-2">
                  {canAdjust && (
                    <SelectionBox
                      checked={filteredAbsences.length > 0 && filteredAbsences.every(a => selectedAbsenceIds.has(a.id!))}
                      label="Seleccionar todas las novedades visibles"
                      onChange={checked => {
                        const ids = filteredAbsences.map(a => a.id!);
                        setSelectedAbsenceIds(checked ? new Set(ids) : new Set());
                      }}
                    />
                  )}
                  <span>Empleado</span>
                </div>
              </th>
              <th className="px-4 py-3 text-[10px] font-black uppercase tracking-wider text-slate-400">Tipo / Motivo</th>
              <th className="px-4 py-3 text-[10px] font-black uppercase tracking-wider text-slate-400 whitespace-nowrap">Periodo</th>
              <th className="px-4 py-3 text-[10px] font-black uppercase tracking-wider text-slate-400">Estado</th>
              <th className="px-4 py-3 text-[10px] font-black uppercase tracking-wider text-slate-400 text-center whitespace-nowrap">Cobertura</th>
              <th className="px-3 py-3 w-20" />
            </tr>
          </thead>
          <tbody>
            {filteredAbsences.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-400 font-bold">
                  No hay novedades con los filtros actuales
                </td>
              </tr>
            ) : filteredAbsences.map((a, idx) => {
              const isLT = a.type === 'Llegada Tarde';
              const isAA = (a.type === 'No Presentacion' || a.type === 'No Presentación' || (a as any).absenceType === 'AA') && !isLT;
              const hasCert = !!(a as any).certificateDriveLink || !!(a as any).certificateUrl || a.hasCertificate;
              const checkInStr = fmtCheckIn((a as any).checkInTimeStr, (a as any).checkInTime, (a as any).arrivedAt);
              const isSelected = selectedAbsenceIds.has(a.id!);
              return (
                <AbsenceRow
                  key={a.id}
                  a={a}
                  idx={idx}
                  isLT={isLT}
                  isAA={isAA}
                  hasCert={hasCert}
                  checkInStr={checkInStr}
                  isSelected={isSelected}
                  canAdjust={canAdjust}
                  selectedAbsenceIds={selectedAbsenceIds}
                  setSelectedAbsenceIds={setSelectedAbsenceIds}
                  getAbsenceEmployeeName={getAbsenceEmployeeName}
                  getArgentinaDate={getArgentinaDate}
                  renderAbsenceStatusCell={renderAbsenceStatusCell}
                  coberturaBadgeClass={coberturaBadgeClass}
                  handleOpenAbsenceModal={handleOpenAbsenceModal}
                  handleDeleteAbsence={handleDeleteAbsence}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── helpers de formato de fecha ───────────────────────────────────────────
function fmtDate(raw: string | undefined | null): string {
  if (!raw) return '—';
  // raw puede ser "YYYY-MM-DD"
  const [y, m, d] = (raw as string).split('-');
  if (!y || !m || !d) return raw ?? '—';
  const months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1] ?? m}`;
}

function fmtPeriodo(startDate: string | undefined | null, endDate: string | undefined | null): string {
  const s = fmtDate(startDate);
  const e = fmtDate(endDate);
  if (!endDate || startDate === endDate) return s;
  return `${s} — ${e}`;
}

// ─── chip de tipo ──────────────────────────────────────────────────────────
function TypeChip({ isLT, isAA, type, checkInStr }: { isLT: boolean; isAA: boolean; type: string; checkInStr: string | null }) {
  if (isLT) {
    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-orange-100 text-orange-700 border border-orange-200">
          <Clock size={9} /> Llegada tarde
        </span>
        {checkInStr && (
          <span className="text-[10px] font-bold text-orange-500 font-mono">{checkInStr}</span>
        )}
      </div>
    );
  }
  if (isAA) {
    return (
      <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-blue-100 text-blue-700 border border-blue-200">
        No presentación
      </span>
    );
  }
  return (
    <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-slate-100 text-slate-600 border border-slate-200">
      {type || '—'}
    </span>
  );
}

// ─── Fila individual con hooks propios (countdown) ─────────────────────────
function AbsenceRow({
  a, idx, isLT, isAA, hasCert, checkInStr, isSelected,
  canAdjust, selectedAbsenceIds, setSelectedAbsenceIds,
  getAbsenceEmployeeName, getArgentinaDate, renderAbsenceStatusCell,
  coberturaBadgeClass, handleOpenAbsenceModal, handleDeleteAbsence,
}: {
  a: any; idx: number; isLT: boolean; isAA: boolean; hasCert: boolean; checkInStr: string | null; isSelected: boolean;
  canAdjust: boolean; selectedAbsenceIds: Set<string>; setSelectedAbsenceIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  getAbsenceEmployeeName: (a: any) => string; getArgentinaDate: (d: any) => string;
  renderAbsenceStatusCell: (a: any) => React.ReactNode; coberturaBadgeClass: (e?: string) => string;
  handleOpenAbsenceModal: (a: any) => void; handleDeleteAbsence: (id: string) => void;
}) {
  const countdown = useCountdownTo2359(isAA && a.status === 'Confirmada' && !hasCert ? a.startDate : undefined);
  const hasCountdown = !!countdown;

  const rowClass = [
    'border-b border-slate-100 dark:border-slate-700/60 transition-colors',
    isSelected
      ? 'bg-indigo-50 dark:bg-indigo-900/15'
      : idx % 2 === 0
        ? 'bg-white dark:bg-slate-800'
        : 'bg-slate-50/60 dark:bg-slate-800/50',
    'hover:bg-indigo-50/50 dark:hover:bg-slate-700/40',
  ].join(' ');

  // Borde izquierdo de urgencia
  const urgencyBorder = hasCountdown
    ? 'border-l-[3px] border-l-amber-400'
    : a.status === 'Injustificada'
      ? 'border-l-[3px] border-l-rose-400'
      : a.status === 'Justificada'
        ? 'border-l-[3px] border-l-emerald-400'
        : 'border-l-[3px] border-l-transparent';

  return (
    <tr className={`${rowClass} ${urgencyBorder}`}>
      {/* ── Empleado ── */}
      <td className="px-4 py-3">
        <div className="flex items-start gap-2">
          {canAdjust && (
            <div className="pt-0.5 shrink-0">
              <SelectionBox
                checked={isSelected}
                label={`Seleccionar novedad de ${getAbsenceEmployeeName(a)}`}
                onChange={checked => {
                  setSelectedAbsenceIds(prev => {
                    const next = new Set(prev);
                    checked ? next.add(a.id!) : next.delete(a.id!);
                    return next;
                  });
                }}
              />
            </div>
          )}
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[12px] font-black uppercase text-slate-900 dark:text-white leading-tight truncate">
              {getAbsenceEmployeeName(a)}
            </span>
            {hasCountdown && (
              <span className="inline-flex items-center gap-1 text-[9px] font-black text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full w-fit">
                <AlertTriangle size={8} /> Vence en {countdown}
              </span>
            )}
          </div>
        </div>
      </td>

      {/* ── Tipo / Motivo ── */}
      <td className="px-4 py-3">
        <div className="flex flex-col gap-1">
          <TypeChip isLT={isLT} isAA={isAA} type={a.type} checkInStr={checkInStr} />
          {a.reason && (
            <span className="text-[10px] text-slate-400 dark:text-slate-500 leading-snug line-clamp-2 max-w-[180px]">
              {a.reason}
            </span>
          )}
          {hasCert && (
            <span className="inline-flex items-center gap-1 text-[9px] font-black text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full w-fit">
              <FileCheck size={8} /> Certificado
            </span>
          )}
        </div>
      </td>

      {/* ── Periodo ── */}
      <td className="px-4 py-3 whitespace-nowrap">
        <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 font-mono tabular-nums">
          {fmtPeriodo(a.startDate, a.endDate)}
        </span>
      </td>

      {/* ── Estado ── */}
      <td className="px-4 py-3">
        {renderAbsenceStatusCell(a)}
      </td>

      {/* ── Cobertura ── */}
      <td className="px-4 py-3 text-center">
        <span className={`inline-block px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${coberturaBadgeClass(a.coberturaEstado)}`}>
          {a.coberturaEstado || 'Pendiente'}
        </span>
      </td>

      {/* ── Acciones ── */}
      <td className="px-3 py-3">
        <div className="flex items-center justify-end gap-0.5">
          {(a.status === 'Pendiente' || a.status === 'En verificación') && (
            <button
              title="Rechazar"
              onClick={() => handleOpenAbsenceModal({ ...a, status: 'Rechazada' })}
              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
            >
              <Trash2 size={13} />
            </button>
          )}
          <button
            title="Editar"
            onClick={() => handleOpenAbsenceModal(a)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
          >
            <Edit2 size={13} />
          </button>
          {a.status !== 'Pendiente' && a.status !== 'En verificación' && (
            <button
              title="Eliminar"
              onClick={() => handleDeleteAbsence(a.id!)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
