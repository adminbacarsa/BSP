import { useEffect, useState } from 'react';
import { coveragePct, guardStatusLabel, guardTone, type GuardFlags } from '@/lib/movil/guardTone';

export interface MovilObjective {
  objectiveId: string;
  name: string;
  client?: string;
  active: number;
  retention: number;
  absent: number;
  vacant: number;
  plan: number;
  shifts: GuardShift[];
}

export interface GuardShift extends GuardFlags {
  id: string;
  employeeName?: string;
  code?: string;
  positionName?: string;
  objectiveName?: string;
  shiftDateObj?: Date | string | null;
  endDateObj?: Date | string | null;
}

export interface MovilStats {
  activos: number;
  retenidos: number;
  ausentes: number;
  vacantes: number;
  plan: number;
}

function hhmm(value: Date | string | null | undefined): string {
  const date = value instanceof Date ? value : value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Argentina/Cordoba',
  });
}

function horario(shift: GuardShift): string {
  const start = hhmm(shift.shiftDateObj);
  const end = hhmm(shift.endDateObj);
  if (start && end) return `${start}–${end}`;
  return start || '—';
}

const TONE_BAR: Record<string, string> = {
  ok: 'bg-emerald-500',
  ret: 'bg-orange-500',
  aus: 'bg-slate-700',
  late: 'bg-amber-500',
  vac: 'bg-rose-600',
  plan: 'bg-indigo-500',
};

const TONE_PILL: Record<string, string> = {
  ok: 'bg-emerald-50 text-emerald-700',
  ret: 'bg-orange-50 text-orange-700',
  aus: 'bg-slate-100 text-slate-800',
  late: 'bg-amber-50 text-amber-800',
  vac: 'bg-rose-50 text-rose-700',
  plan: 'bg-indigo-50 text-indigo-700',
};

function BigButton({
  label,
  tone,
  onClick,
}: {
  label: string;
  tone?: 'go' | 'pri' | 'warn';
  onClick: () => void;
}) {
  const cls = tone === 'go'
    ? 'bg-emerald-600 text-white'
    : tone === 'pri'
      ? 'bg-indigo-600 text-white'
      : tone === 'warn'
        ? 'bg-orange-50 text-orange-800 border border-orange-200'
        : 'bg-white text-slate-700 border border-slate-200';
  return (
    <button type="button" onClick={onClick} className={`min-h-12 flex-1 rounded-2xl text-[11px] font-black ${cls}`}>
      {label}
    </button>
  );
}

export function GuardCard({
  shift,
  onLlego,
  onRevertir,
  onSalida,
  onProtocolo,
  onRetencion,
}: {
  shift: GuardShift;
  onLlego: (shift: GuardShift) => void;
  onRevertir: (shift: GuardShift) => void;
  onSalida: (shift: GuardShift) => void;
  onProtocolo: (shift: GuardShift) => void;
  onRetencion: (shift: GuardShift) => void;
}) {
  const tone = guardTone(shift);
  return (
    <article className="mb-2 flex overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className={`w-1.5 ${TONE_BAR[tone]}`} />
      <div className="min-w-0 flex-1 p-2.5">
        <div className="flex items-center gap-2">
          <strong className="truncate text-sm">{shift.employeeName || 'Sin nombre'}</strong>
          <span className="ml-auto rounded-lg bg-slate-900 px-1.5 py-0.5 text-[11px] font-black text-white">{shift.code || '—'}</span>
        </div>
        <p className="text-[11px] font-semibold text-slate-500">{horario(shift)} · {shift.positionName || 'Puesto'}</p>
        <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${TONE_PILL[tone]}`}>
          {guardStatusLabel(shift)}
        </span>
        <div className="mt-2 flex gap-1.5">
          {tone === 'aus' && <BigButton label="Llegó?" tone="go" onClick={() => onLlego(shift)} />}
          {tone === 'aus' && <BigButton label="Revertir" onClick={() => onRevertir(shift)} />}
          {(tone === 'ok' || tone === 'ret' || tone === 'late') && <BigButton label="Salida" tone="warn" onClick={() => onSalida(shift)} />}
          {tone === 'ret' && <BigButton label="Retención" onClick={() => onRetencion(shift)} />}
          {(tone === 'aus' || tone === 'vac') && <BigButton label="Protocolo" tone="pri" onClick={() => onProtocolo(shift)} />}
          <button type="button" className="min-h-12 w-12 rounded-2xl border border-slate-200 text-lg font-black" aria-label="Más acciones" onClick={() => onProtocolo(shift)}>⋯</button>
        </div>
      </div>
    </article>
  );
}

export function OperacionScreens({
  empresa,
  modeLabel,
  online,
  pendingLabel,
  stats,
  notices = [],
  objectives,
  objective,
  alerts,
  panel,
  onBack,
  onOpen,
  onCounter,
  onLlego,
  onRevertir,
  onSalida,
  onProtocolo,
  onRetencion,
  onSala,
}: {
  empresa: string;
  modeLabel: string;
  online: boolean;
  pendingLabel: string | null;
  stats: MovilStats;
  notices?: string[];
  objectives: MovilObjective[];
  objective: MovilObjective | null;
  alerts: GuardShift[];
  panel: 'home' | 'objetivo' | 'alertas';
  onBack: () => void;
  onOpen: (id: string) => void;
  onCounter: (id: string) => void;
  onLlego: (shift: GuardShift) => void;
  onRevertir: (shift: GuardShift) => void;
  onSalida: (shift: GuardShift) => void;
  onProtocolo: (shift: GuardShift) => void;
  onRetencion: (shift: GuardShift) => void;
  onSala: () => void;
}) {
  const counters = [
    { id: 'ACTIVOS', label: 'Activos', value: stats.activos, cls: 'text-emerald-600' },
    { id: 'RETENIDOS', label: 'Ret', value: stats.retenidos, cls: 'text-orange-600' },
    { id: 'AUSENTES', label: 'Aus', value: stats.ausentes, cls: 'text-slate-800' },
    { id: 'VACANTES', label: 'Vac', value: stats.vacantes, cls: 'text-rose-600' },
    { id: 'PLAN', label: 'Plan', value: stats.plan, cls: 'text-indigo-600' },
  ];
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[480px] flex-col bg-slate-100 pb-24" data-movil-screen={panel}>
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white px-3 py-2">
        <div className="flex items-center gap-2">
          {panel === 'objetivo' && (
            <button type="button" onClick={onBack} className="min-h-11 rounded-xl border border-slate-200 px-3 text-sm font-black">←</button>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-black">{panel === 'objetivo' ? objective?.name : empresa}</p>
            <p className="text-[11px] font-semibold text-slate-500">
              {online ? modeLabel : 'Sin señal · se muestra lo último'}
            </p>
          </div>
          <button type="button" onClick={onSala} className="min-h-11 rounded-xl bg-emerald-600 px-2 text-[10px] font-black uppercase text-white">
            {modeLabel}
          </button>
        </div>
        {pendingLabel && (
          <p className="mt-1 rounded-xl bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-800">Pendiente de enviar: {pendingLabel}</p>
        )}
      </header>
      <div className="px-3 pt-3">
        {panel === 'home' && (
          <>
            {notices.map((text) => (
              <p key={text} className="mb-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">{text}</p>
            ))}
            <div className="mb-3 grid grid-cols-5 gap-1.5">
              {counters.map((item) => (
                <button key={item.id} type="button" onClick={() => onCounter(item.id)} className="rounded-2xl border border-slate-200 bg-white py-2 text-center shadow-sm">
                  <b className={`block text-lg leading-none ${item.cls}`}>{item.value}</b>
                  <small className="text-[9px] font-black uppercase text-slate-500">{item.label}</small>
                </button>
              ))}
            </div>
            {objectives.map((item) => {
              const pct = coveragePct(item);
              return (
                <button key={item.objectiveId} type="button" onClick={() => onOpen(item.objectiveId)} className="mb-2 w-full rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-sm">
                  <div className="flex items-start gap-2">
                    <div>
                      <h3 className="text-[15px] font-black">{item.name}</h3>
                      <p className="text-[11px] font-semibold text-slate-500">{item.client || 'Objetivo'}</p>
                    </div>
                    <span className={`ml-auto rounded-xl px-2 py-1 text-sm font-black ${pct >= 100 ? 'bg-emerald-50 text-emerald-700' : pct >= 75 ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'}`}>{pct}%</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1 text-[10px] font-black">
                    {item.active > 0 && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">ACT {item.active}</span>}
                    {item.retention > 0 && <span className="rounded-full bg-orange-50 px-2 py-0.5 text-orange-700">RET {item.retention}</span>}
                    {item.absent > 0 && <span className="rounded-full bg-slate-100 px-2 py-0.5">AUS {item.absent}</span>}
                    {item.vacant > 0 && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-rose-700">VAC {item.vacant}</span>}
                  </div>
                </button>
              );
            })}
            {objectives.length === 0 && <p className="rounded-2xl bg-white p-4 text-sm font-semibold text-slate-500">Sincronizando objetivos…</p>}
          </>
        )}
        {panel === 'objetivo' && objective && (
          objective.shifts.map((shift) => (
            <GuardCard
              key={shift.id}
              shift={shift}
              onLlego={onLlego}
              onRevertir={onRevertir}
              onSalida={onSalida}
              onProtocolo={onProtocolo}
              onRetencion={onRetencion}
            />
          ))
        )}
        {panel === 'alertas' && (
          <>
            <p className="mb-2 text-[11px] font-bold text-slate-500">Prioridad primero. La acción grande queda bajo el pulgar.</p>
            {alerts.map((shift, index) => (
              <article key={shift.id} className="mb-2 flex overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                {index === 0 && (
                  <button type="button" onClick={() => (guardTone(shift) === 'vac' ? onProtocolo(shift) : onLlego(shift))} className="flex w-[92px] flex-col items-center justify-center bg-emerald-600 text-[11px] font-black text-white">
                    {guardTone(shift) === 'vac' ? 'Cubrir' : 'Llegó'}
                  </button>
                )}
                <div className="min-w-0 flex-1 p-3">
                  <p className="text-[10px] font-black uppercase text-rose-600">{guardStatusLabel(shift)}</p>
                  <h3 className="text-sm font-black">{shift.employeeName || 'Vacante'}</h3>
                  <p className="text-[11px] font-semibold text-slate-500">{shift.objectiveName} · {shift.code} · {horario(shift)}</p>
                  <div className="mt-2 flex gap-1.5">
                    <BigButton label="Llegó?" tone="go" onClick={() => onLlego(shift)} />
                    <BigButton label="Protocolo" tone="pri" onClick={() => onProtocolo(shift)} />
                  </div>
                </div>
              </article>
            ))}
            {alerts.length === 0 && <p className="rounded-2xl bg-white p-4 text-sm font-semibold text-slate-500">Sin alertas en este momento.</p>}
          </>
        )}
      </div>
    </div>
  );
}

export function useOnlineFlag(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const apply = () => setOnline(typeof navigator === 'undefined' || navigator.onLine !== false);
    apply();
    window.addEventListener('online', apply);
    window.addEventListener('offline', apply);
    return () => {
      window.removeEventListener('online', apply);
      window.removeEventListener('offline', apply);
    };
  }, []);
  return online;
}
