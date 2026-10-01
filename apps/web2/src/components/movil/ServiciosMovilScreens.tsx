import { ArrowLeft, CalendarPlus, Lock } from 'lucide-react';
import { ESTADO_LABEL, type ServicioMovilDetalle, type ServicioMovilEstado, type ServicioMovilRow } from '@/lib/servicios/serviciosMovil';
import { MovilBadge } from './ui/MovilBadge';
import { MovilCard } from './ui/MovilCard';
import { MovilTopBar } from './ui/MovilTopBar';
import { MOVIL_BTN_PRIMARY, MOVIL_BTN_SECONDARY, MOVIL_CARD, MOVIL_FONT, MOVIL_PRIMARY_BG, MOVIL_TEXT, type MovilTone } from './ui/tones';

/** Tono semántico del estado del mes: verde en operación, ámbar sin operación, gris cerrado / sin servicio. */
export const ESTADO_TONE: Record<ServicioMovilEstado, MovilTone> = {
  active: 'emerald',
  withoutPlan: 'amber',
  closed: 'slate',
  none: 'slate',
};

const CHIP = 'flex min-h-8 flex-1 items-center justify-center gap-1 rounded-md border px-2 text-[12px] font-medium tabular-nums';
const CHIP_OFF = `${CHIP} border-slate-300 bg-white text-slate-700`;
const CHIP_ON = `${CHIP} border-transparent ${MOVIL_PRIMARY_BG}`;
const BTN = 'flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm font-semibold active:bg-slate-50';

export type ServiciosFiltroEstado = '' | ServicioMovilEstado;

export function ServiciosMovilScreens({
  empresa,
  onEmpresa,
  online,
  pendingLabel,
  loading,
  rows,
  row,
  detalle,
  acciones,
  filter,
  onFilter,
  estadoFiltro = '',
  onEstadoFiltro,
  onOpen,
  onBack,
  onCerrar,
  onReabrir,
  onAgregarMeses,
}: {
  empresa: string;
  onEmpresa?: () => void;
  online: boolean;
  pendingLabel: string | null;
  loading: boolean;
  rows: ServicioMovilRow[];
  row: ServicioMovilRow | null;
  detalle: ServicioMovilDetalle | null;
  acciones: { cerrar: boolean; reabrir: boolean; agregarMeses?: boolean };
  filter: string;
  onFilter: (value: string) => void;
  /** Contador seleccionado = filtro por estado (tocar de nuevo vuelve a todos). */
  estadoFiltro?: ServiciosFiltroEstado;
  onEstadoFiltro?: (value: ServiciosFiltroEstado) => void;
  onOpen: (objectiveId: string) => void;
  onBack: () => void;
  onCerrar: () => void;
  onReabrir: () => void;
  onAgregarMeses?: () => void;
}) {
  const panel = row ? 'detalle' : 'lista';
  const counts = rows.reduce<Record<ServicioMovilEstado, number>>((acc, item) => {
    acc[item.estado] += 1;
    return acc;
  }, { active: 0, withoutPlan: 0, closed: 0, none: 0 });
  const needle = filter.trim().toLowerCase();
  const visibles = rows
    .filter((item) => !estadoFiltro || item.estado === estadoFiltro)
    .filter((item) => !needle || `${item.objectiveName} ${item.clientName}`.toLowerCase().includes(needle));
  const sinCronograma = rows.filter((item) => item.cronogramaAviso).length;

  return (
    <div className={`mx-auto flex min-h-[844px] w-full max-w-[390px] flex-col touch-manipulation overflow-x-hidden bg-[#f7f8fa] pb-24 ${MOVIL_FONT}`} data-movil-screen={`servicios-${panel}`} data-viewport="390x844">
      <MovilTopBar modulo="Servicios" empresa={empresa} onEmpresa={onEmpresa} online={online} pendingLabel={pendingLabel} />
      {row && (
        <div className="flex h-11 items-center gap-2 px-3 pt-1" data-movil-objetivo-header="fino">
          <button type="button" onClick={onBack} aria-label="Volver" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 active:bg-slate-50">
            <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-slate-900">{row.objectiveName}</p>
            <p className="truncate text-[11px] text-slate-500">{row.clientName || empresa}</p>
          </div>
          <MovilBadge tone={ESTADO_TONE[row.estado]} attrs={{ 'data-servicio-estado': row.estado }}>{ESTADO_LABEL[row.estado]}</MovilBadge>
        </div>
      )}
      <div className="flex flex-col gap-2 px-3 pt-2">
        {panel === 'lista' && (
          <>
            <div className="flex gap-1.5" data-servicios-contadores="3">
              {(['active', 'withoutPlan', 'closed'] as ServicioMovilEstado[]).map((estado) => {
                const activo = estadoFiltro === estado;
                return (
                  <button
                    key={estado}
                    type="button"
                    aria-pressed={activo}
                    onClick={() => onEstadoFiltro?.(activo ? '' : estado)}
                    className={activo ? CHIP_ON : CHIP_OFF}
                    data-servicios-filtro={estado}
                  >
                    <b className={`font-semibold ${activo ? '' : MOVIL_TEXT[ESTADO_TONE[estado]]}`}>{counts[estado]}</b>
                    <span className="truncate">{estado === 'active' ? 'en operación' : estado === 'withoutPlan' ? 'sin operación' : 'cerrados'}</span>
                  </button>
                );
              })}
            </div>
            {sinCronograma > 0 && (
              <p className="px-1 text-[12px] font-medium text-amber-600" data-servicios-sin-cronograma={String(sinCronograma)}>
                {sinCronograma === 1 ? '1 objetivo' : `${sinCronograma} objetivos`} con servicio y sin cronograma publicado
              </p>
            )}
            <input
              type="search"
              value={filter}
              onChange={(event) => onFilter(event.target.value)}
              placeholder="Buscar objetivo o cliente"
              className={`h-9 w-full ${MOVIL_CARD} px-3 text-base outline-none focus:border-[var(--movil-primary,#111827)]`}
            />
            {visibles.map((item) => (
              <MovilCard
                key={item.objectiveId}
                ring={ESTADO_TONE[item.estado]}
                title={item.objectiveName}
                subtitle={item.clientName || 'Cliente'}
                badge={<MovilBadge tone={ESTADO_TONE[item.estado]}>{ESTADO_LABEL[item.estado]}</MovilBadge>}
                onClick={() => onOpen(item.objectiveId)}
                attrs={{ 'data-servicio-objetivo': item.objectiveId, 'data-servicio-estado': item.estado }}
              >
                {item.sla && (
                  <p className="mt-1 text-[11px] text-slate-500">
                    {(item.sla.positions || []).length} puesto{(item.sla.positions || []).length === 1 ? '' : 's'} · hasta {String(item.sla.endDate || '').slice(0, 10) || 'sin fin'}
                    {item.contratos > 1 ? ` · ${item.contratos} contratos` : ''}
                  </p>
                )}
                {item.cronogramaAviso && (
                  <p className="mt-1 text-[11px] font-medium text-amber-600" data-servicio-cronograma="1">{item.cronogramaAviso}</p>
                )}
              </MovilCard>
            ))}
            {!loading && visibles.length === 0 && (
              <p className="py-6 text-center text-[13px] text-slate-500">
                {estadoFiltro ? `Sin objetivos en ${ESTADO_LABEL[estadoFiltro].toLowerCase()}.` : 'Sin objetivos para mostrar.'}
              </p>
            )}
            {loading && rows.length === 0 && <p className="py-6 text-center text-[13px] text-slate-500">Cargando servicios…</p>}
          </>
        )}
        {panel === 'detalle' && row && (
          <>
            {!row.sla && (
              <p className={`${MOVIL_CARD} p-4 text-[13px] text-slate-500`}>Este objetivo no tiene contrato cargado. El alta se hace en la computadora.</p>
            )}
            {row.sla && detalle && (
              <>
                <section className={`${MOVIL_CARD} p-3`}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Vigencia</p>
                  <p className="text-sm font-semibold text-slate-900">{detalle.vigencia}</p>
                  <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Facturación</p>
                  <p className="text-sm font-semibold text-slate-900">{detalle.facturacion}</p>
                  {row.cronogramaAviso && (
                    <p className="mt-2 text-[12px] font-medium text-amber-600" data-servicio-cronograma="1">
                      {row.cronogramaAviso} · el mes no entra en operación hasta publicarlo (Planificación).
                    </p>
                  )}
                  {detalle.cerrado && (
                    <p className="mt-2 flex items-center gap-1.5 text-[12px] font-medium text-slate-600" data-servicio-cerrado="1">
                      <Lock size={13} strokeWidth={1.75} aria-hidden="true" />
                      Contrato cerrado{detalle.cerradoMotivo ? ` (${detalle.cerradoMotivo})` : ''} · solo lectura
                    </p>
                  )}
                  {!detalle.cerrado && detalle.reabiertoManual && (
                    <p className="mt-2 text-[12px] font-medium text-slate-600">Reabierto a mano</p>
                  )}
                </section>
                {detalle.puestos.map((puesto) => (
                  <section key={puesto.name} className={`${MOVIL_CARD} p-3`}>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-slate-900">{puesto.name}</h3>
                      <MovilBadge outline size="md" tone="slate" className="ml-auto normal-case">×{puesto.quantity}</MovilBadge>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {puesto.franjas.map((franja) => (
                        <span key={`${franja.code}-${franja.horario}`} className="rounded border border-slate-300 px-1.5 py-0.5 text-[11px] text-slate-700 tabular-nums">
                          <b className="font-semibold">{franja.code}</b>{franja.horario ? ` ${franja.horario}` : ''} · ×{franja.quantity}
                        </span>
                      ))}
                      {puesto.franjas.length === 0 && <span className="text-[11px] text-slate-500">Sin franjas cargadas</span>}
                    </div>
                  </section>
                ))}
                {(acciones.agregarMeses || acciones.cerrar || acciones.reabrir) && (
                  <div className="mt-1 flex flex-col gap-2">
                    {acciones.agregarMeses && onAgregarMeses && (
                      <button type="button" onClick={onAgregarMeses} className={`${BTN} ${MOVIL_BTN_PRIMARY}`} data-servicio-agregar-meses="1">
                        <CalendarPlus size={15} strokeWidth={1.75} aria-hidden="true" /> Agregar meses
                      </button>
                    )}
                    <div className="flex gap-2">
                      {acciones.reabrir && (
                        <button type="button" onClick={onReabrir} className={`${BTN} ${acciones.agregarMeses ? MOVIL_BTN_SECONDARY : MOVIL_BTN_PRIMARY}`}>Reabrir contrato</button>
                      )}
                      {acciones.cerrar && (
                        <button type="button" onClick={onCerrar} className={`${BTN} ${MOVIL_BTN_SECONDARY}`}>Cerrar contrato</button>
                      )}
                    </div>
                  </div>
                )}
                <p className="px-1 text-[11px] text-slate-500">La edición completa del contrato se hace en la computadora.</p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
