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

const NOVEDAD_TYPES = ['Vacaciones', 'Enfermedad', 'ART', 'Injustificada', 'Licencia Esp.', 'PG Permiso Gremial'] as const;

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
}: AusenciasTabProps) {
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
          {NOVEDAD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
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
        <table className="w-full text-left">
          <thead className="bg-slate-50 dark:bg-slate-900 sticky top-0 z-10">
            <tr>
              {canAdjust && (
                <th className="p-2 w-8">
                  <input
                    type="checkbox"
                    style={{ width: 14, height: 14, display: 'block', cursor: 'pointer', accentColor: '#e11d48' }}
                    checked={filteredAbsences.length > 0 && filteredAbsences.every(a => selectedAbsenceIds.has(a.id!))}
                    onChange={e => {
                      const ids = filteredAbsences.map(a => a.id!);
                      setSelectedAbsenceIds(e.target.checked ? new Set(ids) : new Set());
                    }}
                  />
                </th>
              )}
              <th className="px-3 py-2 text-[10px] font-black uppercase text-slate-400">Empleado</th>
              <th className="px-3 py-2 text-[10px] font-black uppercase text-slate-400">Tipo / Motivo</th>
              <th className="px-3 py-2 text-[10px] font-black uppercase text-slate-400">Periodo</th>
              <th className="px-3 py-2 text-[10px] font-black uppercase text-slate-400 text-center">Estado</th>
              <th className="px-3 py-2 text-[10px] font-black uppercase text-slate-400 text-center">Cert.</th>
              <th className="px-3 py-2 text-[10px] font-black uppercase text-slate-400 text-center">Cobertura</th>
              <th className="px-2 py-2 text-right w-20" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {filteredAbsences.length === 0 ? (
              <tr>
                <td colSpan={canAdjust ? 8 : 7} className="px-4 py-8 text-center text-sm text-slate-400 font-bold">
                  No hay novedades con los filtros actuales
                </td>
              </tr>
            ) : filteredAbsences.map(a => {
              const isLT = a.type === 'Llegada Tarde';
              const isAA = (a.type === 'No Presentacion' || a.type === 'No Presentación' || (a as any).absenceType === 'AA') && !isLT;
              const hasCert = !!(a as any).certificateUrl || a.hasCertificate;
              // checkInTime (Timestamp CF), checkInTimeStr (string CF), arrivedAt (Timestamp cliente)
              const checkInStr = fmtCheckIn((a as any).checkInTimeStr, (a as any).checkInTime, (a as any).arrivedAt);
              const rowBg = selectedAbsenceIds.has(a.id!)
                ? 'bg-rose-50 dark:bg-rose-900/10'
                : isLT
                  ? 'bg-orange-50/40 dark:bg-orange-900/10'
                  : isAA && a.status === 'Confirmada'
                    ? 'bg-blue-50/40 dark:bg-blue-900/10'
                    : a.status === 'Injustificada'
                      ? 'bg-rose-50/30 dark:bg-rose-900/10'
                      : a.status === 'Justificada'
                        ? 'bg-emerald-50/30'
                        : '';
              return (
                <AbsenceRow
                  key={a.id}
                  a={a}
                  isLT={isLT}
                  isAA={isAA}
                  hasCert={hasCert}
                  checkInStr={checkInStr}
                  rowBg={rowBg}
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

// ─── Fila individual con hooks propios (countdown) ─────────────────────────
function AbsenceRow({
  a, isLT, isAA, hasCert, checkInStr, rowBg,
  canAdjust, selectedAbsenceIds, setSelectedAbsenceIds,
  getAbsenceEmployeeName, getArgentinaDate, renderAbsenceStatusCell,
  coberturaBadgeClass, handleOpenAbsenceModal, handleDeleteAbsence,
}: {
  a: any; isLT: boolean; isAA: boolean; hasCert: boolean; checkInStr: string | null; rowBg: string;
  canAdjust: boolean; selectedAbsenceIds: Set<string>; setSelectedAbsenceIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  getAbsenceEmployeeName: (a: any) => string; getArgentinaDate: (d: any) => string;
  renderAbsenceStatusCell: (a: any) => React.ReactNode; coberturaBadgeClass: (e?: string) => string;
  handleOpenAbsenceModal: (a: any) => void; handleDeleteAbsence: (id: string) => void;
}) {
  const countdown = useCountdownTo2359(isAA && a.status === 'Confirmada' && !hasCert ? a.startDate : undefined);
  return (
    <tr className={`hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors ${rowBg}`}>
      {canAdjust && (
        <td className="p-2 w-8">
          <input
            type="checkbox"
            style={{ width: 14, height: 14, display: 'block', cursor: 'pointer', accentColor: '#e11d48' }}
            checked={selectedAbsenceIds.has(a.id!)}
            onChange={e => {
              setSelectedAbsenceIds(prev => {
                const next = new Set(prev);
                e.target.checked ? next.add(a.id!) : next.delete(a.id!);
                return next;
              });
            }}
          />
        </td>
      )}
      <td className="px-3 py-2 font-bold text-xs text-slate-900 dark:text-white uppercase">{getAbsenceEmployeeName(a)}</td>
      <td className="px-3 py-2">
        <div className="flex flex-col gap-0.5">
          {isLT ? (
            <div className="flex items-center gap-1">
              <span className="text-[11px] font-black uppercase text-orange-600 leading-tight">Llegada Tarde</span>
              {checkInStr && (
                <span className="flex items-center gap-0.5 text-[10px] font-bold text-orange-500 bg-orange-50 px-1.5 py-0.5 rounded-full border border-orange-200">
                  <Clock size={9}/>{checkInStr}
                </span>
              )}
            </div>
          ) : (
            <span className="text-[11px] font-bold uppercase leading-tight">{a.type}</span>
          )}
          <span className="text-[10px] text-slate-500 line-clamp-1">{a.reason || '-'}</span>
        </div>
      </td>
      <td className="px-3 py-2 text-[11px] font-mono text-slate-500 whitespace-nowrap">
        {getArgentinaDate(a.startDate)} — {getArgentinaDate(a.endDate)}
      </td>
      <td className="px-3 py-2 text-center">
        <div className="flex flex-col items-center gap-1">
          {hasCert && (
            <span className="flex items-center gap-0.5 text-[9px] font-black uppercase text-emerald-600 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full">
              <FileCheck size={9}/> Cert. presentado
            </span>
          )}
          {isAA && a.status === 'Confirmada' && !hasCert && countdown && (
            <span className="flex items-center gap-0.5 text-[9px] font-black text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
              <AlertTriangle size={9}/> Vence en {countdown}
            </span>
          )}
          {renderAbsenceStatusCell(a)}
        </div>
      </td>
      <td className="px-3 py-2 text-center">
        {hasCert
          ? <span className="text-emerald-500 flex justify-center"><FileCheck size={14} /></span>
          : <span className="text-slate-300">-</span>}
      </td>
      <td className="px-3 py-2 text-center">
        <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase ${coberturaBadgeClass(a.coberturaEstado)}`}>
          {a.coberturaEstado || 'PENDIENTE'}
        </span>
        {(!a.coberturaEstado || a.coberturaEstado === 'PENDIENTE') && a.status !== 'Rechazada' && (
          <p className="text-[8px] text-slate-400 mt-0.5 font-bold leading-tight">Planificación</p>
        )}
      </td>
      <td className="px-2 py-2 text-right">
        <div className="flex justify-end gap-1">
          {(a.status === 'Pendiente' || a.status === 'En verificación') && (
            <button
              title="Rechazar"
              onClick={() => handleOpenAbsenceModal({ ...a, status: 'Rechazada' })}
              className="text-slate-400 hover:text-red-600 text-[9px] font-black uppercase px-1.5 py-0.5 rounded hover:bg-red-50"
            >
              ✕
            </button>
          )}
          <button onClick={() => handleOpenAbsenceModal(a)} className="text-slate-400 hover:text-indigo-500 p-0.5">
            <Edit2 size={14} />
          </button>
          <button onClick={() => handleDeleteAbsence(a.id!)} className="text-slate-400 hover:text-rose-500 p-0.5">
            <Trash2 size={14} />
          </button>
        </div>
      </td>
    </tr>
  );
}
