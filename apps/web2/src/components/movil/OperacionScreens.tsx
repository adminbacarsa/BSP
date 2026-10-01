import { useEffect, useState } from 'react';
import { coveragePct, guardStatusLabel, guardTone } from '@/lib/movil/guardTone';
import { guardDetalle, proximoRelevo, type GuardDetalleShift } from '@/lib/movil/guardDetalle';

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

export type GuardShift = GuardDetalleShift;

export interface MovilStats {
  activos: number;
  retenidos: number;
  ausentes: number;
  vacantes: number;
  plan: number;
}

const TONE_TEXT: Record<string, string> = {
  ok: 'text-emerald-700',
  ret: 'text-orange-700',
  aus: 'text-slate-800',
  late: 'text-amber-800',
  vac: 'text-rose-700',
  plan: 'text-indigo-700',
};

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

/** Botón LLAMAR con el teléfono del legajo. Sin teléfono queda deshabilitado. */
export function LlamarButton({ telefono, compact = false }: { telefono: string | null; compact?: boolean }) {
  const cls = telefono
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : 'border-slate-200 bg-slate-50 text-slate-400';
  return (
    <a
      href={telefono ? `tel:${telefono.replace(/[^\d+]/g, '')}` : undefined}
      aria-disabled={telefono ? undefined : 'true'}
      aria-label={telefono ? `Llamar a ${telefono}` : 'Sin teléfono en el legajo'}
      data-movil-llamar={telefono ? '1' : '0'}
      className={`flex min-h-12 items-center justify-center rounded-2xl border text-[11px] font-black ${compact ? 'w-12' : 'px-3'} ${cls}`}
      onClick={telefono ? undefined : (event) => event.preventDefault()}
    >
      {compact ? '☎' : telefono ? 'Llamar' : 'Sin tel.'}
    </a>
  );
}

/**
 * Detalle compacto del guardia: horario planificado + código, puesto y objetivo,
 * ingreso real o estado con minutos, relevo, convocatoria/cobertura.
 */
export function GuardDetalleLines({ shift, siblings = [], now, showObjective = true }: { shift: GuardShift; siblings?: readonly GuardShift[]; now?: number; showObjective?: boolean }) {
  const tone = guardTone(shift);
  const d = guardDetalle(shift, siblings, now ?? Date.now());
  return (
    <div data-movil-detalle={shift.id} className="min-w-0">
      <p className="truncate text-[11px] font-semibold text-slate-500">
        <span className="font-black uppercase text-indigo-700">{d.puesto}</span>
        {showObjective && d.objetivo ? ` · ${d.objetivo}` : ''}
      </p>
      <p className="text-[12px] font-black tabular-nums text-slate-800">
        {d.horario}
        <span className="ml-1 text-[10px] font-bold text-slate-500">· {d.code}</span>
      </p>
      {d.ingreso && <p className="truncate text-[11px] font-bold text-emerald-700">{d.ingreso}</p>}
      {d.estado && <p className={`truncate text-[11px] font-bold ${TONE_TEXT[tone]}`}>{d.estado}</p>}
      {d.relevaA && <p className="truncate text-[11px] font-semibold text-slate-600">{d.relevaA}</p>}
      {d.loReleva && <p className="truncate text-[11px] font-semibold text-slate-600">{d.loReleva}</p>}
      {d.convocatoria && <p className="truncate text-[11px] font-bold text-indigo-700">{d.convocatoria}</p>}
      {d.cobertura && <p className="truncate text-[11px] font-bold text-violet-700">{d.cobertura}</p>}
    </div>
  );
}

export function GuardCard({
  shift,
  siblings = [],
  now,
  readOnly = false,
  onLlego,
  onRevertir,
  onSalida,
  onProtocolo,
  onRetencion,
}: {
  shift: GuardShift;
  /** Turnos del mismo objetivo: de acá sale a quién releva / quién lo releva. */
  siblings?: readonly GuardShift[];
  now?: number;
  readOnly?: boolean;
  onLlego: (shift: GuardShift) => void;
  onRevertir: (shift: GuardShift) => void;
  onSalida: (shift: GuardShift) => void;
  onProtocolo: (shift: GuardShift) => void;
  onRetencion: (shift: GuardShift) => void;
}) {
  const tone = guardTone(shift);
  const telefono = String(shift.phone || '').trim() || null;
  const nombre = shift.isUnassigned ? `VACANTE${shift.vacancyBand ? ` · ${shift.vacancyBand}` : ''}` : shift.employeeName || 'Sin nombre';
  return (
    <article className="mb-2 flex overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" data-movil-tone={tone}>
      <div className={`w-1.5 ${TONE_BAR[tone]}`} />
      <div className="min-w-0 flex-1 p-2.5">
        <div className="flex items-center gap-2">
          <strong className={`truncate text-sm ${shift.isUnassigned ? 'text-rose-700' : ''}`}>{nombre}</strong>
          <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${TONE_PILL[tone]}`}>{guardStatusLabel(shift)}</span>
          <span className="shrink-0 rounded-lg bg-slate-900 px-1.5 py-0.5 text-[11px] font-black text-white">{shift.code || '—'}</span>
        </div>
        <GuardDetalleLines shift={shift} siblings={siblings} now={now} showObjective={false} />
        <div className="mt-2 flex gap-1.5">
          {!shift.isUnassigned && <LlamarButton telefono={telefono} compact={!readOnly} />}
          {!readOnly && (
            <>
              {tone === 'aus' && <BigButton label="Llegó?" tone="go" onClick={() => onLlego(shift)} />}
              {tone === 'aus' && <BigButton label="Revertir" onClick={() => onRevertir(shift)} />}
              {(tone === 'ok' || tone === 'ret' || tone === 'late') && <BigButton label="Salida" tone="warn" onClick={() => onSalida(shift)} />}
              {tone === 'ret' && <BigButton label="Retención" onClick={() => onRetencion(shift)} />}
              {(tone === 'aus' || tone === 'vac') && <BigButton label="Protocolo" tone="pri" onClick={() => onProtocolo(shift)} />}
              <button type="button" className="min-h-12 w-12 rounded-2xl border border-slate-200 text-lg font-black" aria-label="Más acciones" onClick={() => onProtocolo(shift)}>⋯</button>
            </>
          )}
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
  readOnly = false,
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
  now,
}: {
  empresa: string;
  modeLabel: string;
  online: boolean;
  pendingLabel: string | null;
  stats: MovilStats;
  notices?: string[];
  /** Supervisión: mismas pantallas sin botones de acción ni sala. */
  readOnly?: boolean;
  /** Instante de referencia (tests). Default `Date.now()`. */
  now?: number;
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
  const nowMs = now ?? Date.now();
  const siblingsOf = (shift: GuardShift): readonly GuardShift[] =>
    objective?.shifts ?? objectives.find((item) => item.objectiveId === shift.objectiveId)?.shifts ?? [];
  const counters = [
    { id: 'ACTIVOS', label: 'Activos', value: stats.activos, cls: 'text-emerald-600' },
    { id: 'RETENIDOS', label: 'Ret', value: stats.retenidos, cls: 'text-orange-600' },
    { id: 'AUSENTES', label: 'Aus', value: stats.ausentes, cls: 'text-slate-800' },
    { id: 'VACANTES', label: 'Vac', value: stats.vacantes, cls: 'text-rose-600' },
    { id: 'PLAN', label: 'Plan', value: stats.plan, cls: 'text-indigo-600' },
  ];
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[480px] flex-col bg-slate-100 pb-24" data-movil-screen={panel} data-movil-readonly={readOnly ? '1' : undefined}>
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white px-3 py-2">
        <div className="flex items-center gap-2">
          {panel === 'objetivo' && (
            <button type="button" onClick={onBack} className="min-h-11 rounded-xl border border-slate-200 px-3 text-sm font-black">←</button>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-black">{panel === 'objetivo' ? objective?.name : empresa}</p>
            <p className="text-[11px] font-semibold text-slate-500">
              {online ? (readOnly ? `Supervisión · ${modeLabel}` : modeLabel) : 'Sin señal · se muestra lo último'}
            </p>
          </div>
          {readOnly ? (
            <span className="min-h-11 rounded-xl bg-slate-200 px-2 py-3 text-[10px] font-black uppercase text-slate-700">Solo lectura</span>
          ) : (
            <button type="button" onClick={onSala} aria-label={`Sala · ${modeLabel}`} className="min-h-11 rounded-xl bg-emerald-600 px-2 text-[10px] font-black uppercase text-white">
              {modeLabel}
            </button>
          )}
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
              const relevo = proximoRelevo(item.shifts, nowMs);
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
                  {relevo && <p className="mt-1.5 text-[11px] font-bold text-indigo-700">{relevo}</p>}
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
              siblings={objective.shifts}
              now={nowMs}
              readOnly={readOnly}
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
            <p className="mb-2 text-[11px] font-bold text-slate-500">
              {readOnly ? 'Prioridad primero. Las acciones las toma el Centro de Control.' : 'Prioridad primero. La acción grande queda bajo el pulgar.'}
            </p>
            {alerts.map((shift, index) => (
              <article key={shift.id} className="mb-2 flex overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                {index === 0 && !readOnly && (
                  <button type="button" onClick={() => (guardTone(shift) === 'vac' ? onProtocolo(shift) : onLlego(shift))} className="flex w-[92px] flex-col items-center justify-center bg-emerald-600 text-[11px] font-black text-white">
                    {guardTone(shift) === 'vac' ? 'Cubrir' : 'Llegó'}
                  </button>
                )}
                <div className="min-w-0 flex-1 p-3">
                  <p className="text-[10px] font-black uppercase text-rose-600">{guardStatusLabel(shift)}</p>
                  <h3 className="text-sm font-black">{shift.isUnassigned ? `VACANTE${shift.vacancyBand ? ` · ${shift.vacancyBand}` : ''}` : shift.employeeName || 'Vacante'}</h3>
                  <GuardDetalleLines shift={shift} siblings={siblingsOf(shift)} now={nowMs} />
                  <div className="mt-2 flex gap-1.5">
                    {!shift.isUnassigned && <LlamarButton telefono={String(shift.phone || '').trim() || null} compact={!readOnly} />}
                    {!readOnly && (
                      <>
                        {!shift.isUnassigned && <BigButton label="Llegó?" tone="go" onClick={() => onLlego(shift)} />}
                        <BigButton label="Protocolo" tone="pri" onClick={() => onProtocolo(shift)} />
                      </>
                    )}
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
