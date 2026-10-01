import { useEffect, useState } from 'react';
import { coveragePct, guardStatusLabel, guardTone } from '@/lib/movil/guardTone';
import { guardDetalle, proximoRelevo, type GuardDetalleShift } from '@/lib/movil/guardDetalle';
import { MOVIL_CONTADORES, buscarClientes, etiquetaEstado, type OpsClienteMovil, type OpsEstadoFiltro, type OpsFiltroMovil } from '@/lib/movil/operacionFiltros';

/** Hoja «Cliente → objetivos» con buscador. */
export function AmbitoSheetBody({ clientes, filtro, onElegir }: {
  clientes: readonly OpsClienteMovil[];
  filtro: OpsFiltroMovil;
  onElegir: (clientId: string | null, objectiveId: string | null) => void;
}) {
  const [texto, setTexto] = useState('');
  const [clienteAbierto, setClienteAbierto] = useState<string | null>(filtro.clientId);
  const lista = buscarClientes(clientes, texto);
  const abierto = lista.find((c) => c.id === clienteAbierto) || (lista.length === 1 ? lista[0] : null);
  return (
    <div data-movil-sheet="ambito">
      <input
        type="search"
        value={texto}
        onChange={(event) => setTexto(event.target.value)}
        placeholder="Buscar cliente u objetivo"
        aria-label="Buscar cliente u objetivo"
        className="mb-3 min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold"
      />
      <button
        type="button"
        onClick={() => onElegir(null, null)}
        className={`mb-2 min-h-12 w-full rounded-2xl text-sm font-black ${!filtro.clientId && !filtro.objectiveId ? 'bg-indigo-600 text-white' : 'border border-slate-200 bg-white text-slate-700'}`}
      >
        Todos los clientes
      </button>
      {!abierto && lista.map((c) => (
        <button
          key={c.id}
          type="button"
          data-movil-cliente={c.id}
          onClick={() => setClienteAbierto(c.id)}
          className="mb-1.5 flex min-h-12 w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-3 text-left"
        >
          <span className="truncate text-sm font-black text-slate-800">{c.name}</span>
          <span className="shrink-0 text-[11px] font-bold text-slate-500">{c.objetivos.length} obj · {c.turnos}</span>
        </button>
      ))}
      {abierto && (
        <>
          <div className="mb-1.5 flex items-center gap-2">
            {lista.length > 1 && (
              <button type="button" onClick={() => setClienteAbierto(null)} className="min-h-11 rounded-xl border border-slate-200 px-3 text-sm font-black">←</button>
            )}
            <p className="truncate text-sm font-black text-slate-800">{abierto.name}</p>
          </div>
          <button
            type="button"
            data-movil-cliente-todo={abierto.id}
            onClick={() => onElegir(abierto.id, null)}
            className={`mb-1.5 min-h-12 w-full rounded-2xl text-sm font-black ${filtro.clientId === abierto.id && !filtro.objectiveId ? 'bg-indigo-600 text-white' : 'border border-indigo-200 bg-indigo-50 text-indigo-800'}`}
          >
            Todo {abierto.name} · {abierto.turnos}
          </button>
          {abierto.objetivos.map((o) => (
            <button
              key={o.id}
              type="button"
              data-movil-objetivo={o.id}
              onClick={() => onElegir(abierto.id, o.id)}
              className={`mb-1.5 flex min-h-12 w-full items-center justify-between rounded-2xl px-3 text-left ${filtro.objectiveId === o.id ? 'bg-indigo-600 text-white' : 'border border-slate-200 bg-white text-slate-800'}`}
            >
              <span className="truncate text-sm font-bold">{o.name}</span>
              <span className="shrink-0 text-[11px] font-bold opacity-70">{o.turnos}</span>
            </button>
          ))}
        </>
      )}
      {lista.length === 0 && <p className="rounded-2xl bg-white p-4 text-sm font-semibold text-slate-500">Nada coincide con «{texto}».</p>}
    </div>
  );
}

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
  filtro = { estado: 'TODOS', clientId: null, objectiveId: null },
  contadores,
  ambitoLabel = null,
  grupos = [],
  vacioLabel = 'Sin guardias',
  onAmbito,
  onQuitarAmbito,
}: {
  empresa: string;
  modeLabel: string;
  online: boolean;
  pendingLabel: string | null;
  /** Compatibilidad: si no vienen `contadores`, se muestran estos números. */
  stats?: MovilStats;
  notices?: string[];
  /** Supervisión: mismas pantallas sin botones de acción ni sala. */
  readOnly?: boolean;
  /** Instante de referencia (tests). Default `Date.now()`. */
  now?: number;
  /** Resumen por objetivo dentro del ámbito (estado Todos). */
  objectives: MovilObjective[];
  objective: MovilObjective | null;
  alerts: GuardShift[];
  panel: 'home' | 'objetivo' | 'alertas';
  /** Filtro activo: estado (contador) + cliente/objetivo. */
  filtro?: OpsFiltroMovil;
  /** Número de cada contador dentro del ámbito = tarjetas que aparecen al filtrar. */
  contadores?: Partial<Record<OpsEstadoFiltro, number>>;
  /** Chip del cliente/objetivo elegido. */
  ambitoLabel?: string | null;
  /** Tarjetas agrupadas por objetivo cuando hay un estado activo. */
  grupos?: MovilObjective[];
  vacioLabel?: string;
  onAmbito?: () => void;
  onQuitarAmbito?: () => void;
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
    objective?.shifts
    ?? grupos.find((item) => item.shifts.some((s) => s.id === shift.id))?.shifts
    ?? objectives.find((item) => item.objectiveId === shift.objectiveId)?.shifts
    ?? [];
  const legacy: Partial<Record<OpsEstadoFiltro, number>> = stats
    ? { ACTIVOS: stats.activos, RETENIDOS: stats.retenidos, AUSENTES: stats.ausentes, VACANTES: stats.vacantes, PLAN: stats.plan }
    : {};
  const counters = MOVIL_CONTADORES
    .map((item) => ({ ...item, value: contadores?.[item.id] ?? legacy[item.id] }))
    .filter((item) => item.value !== undefined);
  const filtrando = filtro.estado !== 'TODOS';
  const cardProps = { now: nowMs, readOnly, onLlego, onRevertir, onSalida, onProtocolo, onRetencion };
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
            {onAmbito && (
              <div className="mb-2 flex items-center gap-1.5" data-movil-ambito={filtro.objectiveId ? 'objetivo' : filtro.clientId ? 'cliente' : 'todos'}>
                <button
                  type="button"
                  onClick={onAmbito}
                  aria-label="Filtrar por cliente u objetivo"
                  className="flex min-h-11 flex-1 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 text-left text-[12px] font-bold text-slate-600 shadow-sm"
                >
                  <span aria-hidden="true">⌕</span>
                  <span className="truncate">{ambitoLabel ? 'Cambiar cliente u objetivo' : 'Todos los clientes y objetivos'}</span>
                </button>
                {ambitoLabel && (
                  <span className="flex min-h-11 max-w-[55%] items-center gap-1 rounded-2xl bg-indigo-600 pl-3 pr-1 text-[11px] font-black text-white shadow-sm" data-movil-chip="ambito">
                    <span className="truncate">{ambitoLabel}</span>
                    <button type="button" onClick={onQuitarAmbito} aria-label={`Quitar filtro ${ambitoLabel}`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-base font-black active:bg-indigo-500">×</button>
                  </span>
                )}
              </div>
            )}
            <div className={`mb-3 grid gap-1.5 ${counters.length > 5 ? 'grid-cols-6' : 'grid-cols-5'}`} role="group" aria-label="Filtrar por estado">
              {counters.map((item) => {
                const activo = filtro.estado === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onCounter(item.id)}
                    aria-pressed={activo}
                    data-movil-contador={item.id}
                    data-movil-filtro-activo={activo ? '1' : undefined}
                    className={`rounded-2xl border py-2 text-center shadow-sm ${activo ? `border-transparent ring-2 ${item.activo}` : 'border-slate-200 bg-white'}`}
                  >
                    <b className={`block text-lg leading-none ${item.cls}`}>{item.value}</b>
                    <small className="text-[9px] font-black uppercase text-slate-500">{item.label}</small>
                  </button>
                );
              })}
            </div>
            {filtrando && (
              <p className="mb-2 flex items-center justify-between text-[11px] font-bold text-slate-500">
                <span>Mostrando <b className="text-slate-800">{etiquetaEstado(filtro.estado)}</b>{ambitoLabel ? ` · ${ambitoLabel}` : ''} · {grupos.reduce((acc, g) => acc + g.shifts.length, 0)}</span>
                <button type="button" onClick={() => onCounter(filtro.estado)} className="min-h-9 rounded-xl px-2 font-black text-indigo-700">Ver todos</button>
              </p>
            )}
            {filtrando && grupos.map((grupo) => (
              <section key={grupo.objectiveId} className="mb-3" data-movil-grupo={grupo.objectiveId}>
                <button type="button" onClick={() => onOpen(grupo.objectiveId)} className="mb-1.5 flex w-full items-baseline justify-between px-1 text-left">
                  <span className="truncate text-[13px] font-black text-slate-800">{grupo.name}</span>
                  <span className="shrink-0 text-[10px] font-bold text-slate-500">{grupo.client ? `${grupo.client} · ` : ''}{grupo.shifts.length}</span>
                </button>
                {grupo.shifts.map((shift) => (
                  <GuardCard key={shift.id} shift={shift} siblings={siblingsOf(shift)} {...cardProps} />
                ))}
              </section>
            ))}
            {filtrando && grupos.length === 0 && (
              <p className="rounded-2xl bg-white p-4 text-sm font-semibold text-slate-500" data-movil-vacio="1">{vacioLabel}</p>
            )}
            {!filtrando && objectives.map((item) => {
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
            {!filtrando && objectives.length === 0 && (
              <p className="rounded-2xl bg-white p-4 text-sm font-semibold text-slate-500" data-movil-vacio="1">{ambitoLabel ? vacioLabel : 'Sincronizando objetivos…'}</p>
            )}
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
