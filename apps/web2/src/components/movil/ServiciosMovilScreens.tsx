import { ESTADO_LABEL, type ServicioMovilDetalle, type ServicioMovilEstado, type ServicioMovilRow } from '@/lib/servicios/serviciosMovil';

const ESTADO_PILL: Record<ServicioMovilEstado, string> = {
  active: 'bg-white text-emerald-700',
  withoutPlan: 'bg-white text-amber-800',
  closed: 'bg-slate-200 text-slate-700',
  none: 'bg-slate-100 text-slate-500',
};

const ESTADO_BAR: Record<ServicioMovilEstado, string> = {
  active: 'bg-emerald-500',
  withoutPlan: 'bg-amber-500',
  closed: 'bg-slate-500',
  none: 'bg-slate-300',
};

export function ServiciosMovilScreens({
  empresa,
  online,
  pendingLabel,
  loading,
  rows,
  row,
  detalle,
  acciones,
  filter,
  onFilter,
  onOpen,
  onBack,
  onCerrar,
  onReabrir,
}: {
  empresa: string;
  online: boolean;
  pendingLabel: string | null;
  loading: boolean;
  rows: ServicioMovilRow[];
  row: ServicioMovilRow | null;
  detalle: ServicioMovilDetalle | null;
  acciones: { cerrar: boolean; reabrir: boolean };
  filter: string;
  onFilter: (value: string) => void;
  onOpen: (objectiveId: string) => void;
  onBack: () => void;
  onCerrar: () => void;
  onReabrir: () => void;
}) {
  const panel = row ? 'detalle' : 'lista';
  const counts = rows.reduce<Record<ServicioMovilEstado, number>>((acc, item) => {
    acc[item.estado] += 1;
    return acc;
  }, { active: 0, withoutPlan: 0, closed: 0, none: 0 });
  const needle = filter.trim().toLowerCase();
  const visibles = needle
    ? rows.filter((item) => `${item.objectiveName} ${item.clientName}`.toLowerCase().includes(needle))
    : rows;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[480px] flex-col bg-[#f7f8fa] pb-24" data-movil-screen={`servicios-${panel}`}>
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white px-3 py-2">
        <div className="flex items-center gap-2">
          {panel === 'detalle' && (
            <button type="button" onClick={onBack} className="min-h-11 rounded-lg border border-slate-200 px-3 text-sm font-semibold">←</button>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{row ? row.objectiveName : 'Servicios'}</p>
            <p className="truncate text-[11px] font-semibold text-slate-500">
              {online ? (row ? row.clientName || empresa : empresa) : 'Sin señal · se muestra lo último'}
            </p>
          </div>
          {row && (
            <span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase ${ESTADO_PILL[row.estado]}`}>{ESTADO_LABEL[row.estado]}</span>
          )}
        </div>
        {pendingLabel && (
          <p className="mt-1 rounded-lg bg-white px-2 py-1 text-[11px] font-bold text-amber-800">Pendiente de enviar: {pendingLabel}</p>
        )}
      </header>
      <div className="px-3 pt-3">
        {panel === 'lista' && (
          <>
            <div className="mb-3 grid grid-cols-3 gap-1.5">
              {(['active', 'withoutPlan', 'closed'] as ServicioMovilEstado[]).map((estado) => (
                <div key={estado} className="rounded-lg border border-slate-200 bg-white py-2 text-center">
                  <b className={`block text-lg leading-none ${estado === 'active' ? 'text-emerald-600' : estado === 'withoutPlan' ? 'text-amber-600' : 'text-slate-600'}`}>{counts[estado]}</b>
                  <small className="block px-1 text-[9px] font-semibold uppercase leading-tight text-slate-500">{ESTADO_LABEL[estado]}</small>
                </div>
              ))}
            </div>
            <input
              type="search"
              value={filter}
              onChange={(event) => onFilter(event.target.value)}
              placeholder="Buscar objetivo o cliente"
              className="mb-3 min-h-12 w-full rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold outline-none focus:border-[var(--movil-primary,#111827)]"
            />
            {visibles.map((item) => (
              <button key={item.objectiveId} type="button" onClick={() => onOpen(item.objectiveId)} className="mb-2 flex w-full overflow-hidden rounded-lg border border-slate-200 bg-white text-left active:scale-[0.99]">
                <div className={`w-1.5 ${ESTADO_BAR[item.estado]}`} />
                <div className="min-w-0 flex-1 p-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate text-[15px] font-semibold">{item.objectiveName}</h3>
                      <p className="truncate text-[11px] font-semibold text-slate-500">{item.clientName || 'Cliente'}</p>
                    </div>
                    <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${ESTADO_PILL[item.estado]}`}>{ESTADO_LABEL[item.estado]}</span>
                  </div>
                  {item.sla && (
                    <p className="mt-1 text-[11px] font-semibold text-slate-500">
                      {(item.sla.positions || []).length} puesto{(item.sla.positions || []).length === 1 ? '' : 's'} · hasta {String(item.sla.endDate || '').slice(0, 10) || 'sin fin'}
                      {item.contratos > 1 ? ` · ${item.contratos} contratos` : ''}
                    </p>
                  )}
                </div>
              </button>
            ))}
            {!loading && visibles.length === 0 && (
              <p className="rounded-lg bg-white p-4 text-sm font-semibold text-slate-500">Sin objetivos para mostrar.</p>
            )}
            {loading && rows.length === 0 && (
              <p className="rounded-lg bg-white p-4 text-sm font-semibold text-slate-500">Cargando servicios…</p>
            )}
          </>
        )}
        {panel === 'detalle' && row && (
          <>
            {!row.sla && (
              <p className="rounded-lg bg-white p-4 text-sm font-semibold text-slate-500">Este objetivo no tiene contrato cargado. El alta se hace en la computadora.</p>
            )}
            {row.sla && detalle && (
              <>
                <section className="mb-2 rounded-lg border border-slate-200 bg-white p-3">
                  <p className="text-[10px] font-semibold uppercase text-slate-500">Vigencia</p>
                  <p className="text-sm font-semibold">{detalle.vigencia}</p>
                  <p className="mt-2 text-[10px] font-semibold uppercase text-slate-500">Facturación</p>
                  <p className="text-sm font-semibold">{detalle.facturacion}</p>
                  {detalle.cerrado && (
                    <p className="mt-2 rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-700">
                      🔒 Contrato cerrado{detalle.cerradoMotivo ? ` (${detalle.cerradoMotivo})` : ''} — solo lectura
                    </p>
                  )}
                  {!detalle.cerrado && detalle.reabiertoManual && (
                    <p className="mt-2 rounded-lg bg-white px-2 py-1 text-[11px] font-bold text-[var(--movil-primary,#111827)]">Reabierto a mano</p>
                  )}
                </section>
                {detalle.puestos.map((puesto) => (
                  <section key={puesto.name} className="mb-2 rounded-lg border border-slate-200 bg-white p-3">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold">{puesto.name}</h3>
                      <span className="ml-auto rounded-lg border border-slate-300 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700">×{puesto.quantity}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {puesto.franjas.map((franja) => (
                        <span key={`${franja.code}-${franja.horario}`} className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-bold text-slate-700">
                          <b className="font-semibold">{franja.code}</b>{franja.horario ? ` ${franja.horario}` : ''} · ×{franja.quantity}
                        </span>
                      ))}
                      {puesto.franjas.length === 0 && <span className="text-[11px] font-semibold text-slate-500">Sin franjas cargadas</span>}
                    </div>
                  </section>
                ))}
                {(acciones.cerrar || acciones.reabrir) && (
                  <div className="mt-3 flex gap-2">
                    {acciones.reabrir && (
                      <button type="button" onClick={onReabrir} className="min-h-12 flex-1 rounded-lg bg-[var(--movil-primary,#111827)] text-sm font-semibold text-white active:bg-slate-50">Reabrir contrato</button>
                    )}
                    {acciones.cerrar && (
                      <button type="button" onClick={onCerrar} className="min-h-12 flex-1 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 active:bg-slate-50">Cerrar contrato</button>
                    )}
                  </div>
                )}
                <p className="mt-3 text-[11px] font-semibold text-slate-500">La edición completa del contrato se hace en la computadora.</p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
