import { BottomSheet } from './BottomSheet';

export type EventualesPanel = 'bolsa' | 'arca' | 'alta';

export type EventualMovil = {
  id: string;
  nombre: string;
  cuil: string;
  marco: string;
  telefono: string;
};

export type ArcaMovil = {
  id: string;
  nombre: string;
  tipo: string;
  estado: string;
};

export function EventualesScreens(props: {
  empresa: string;
  online: boolean;
  pendingLabel: string | null;
  panel: EventualesPanel;
  buscar: string;
  onBuscar: (value: string) => void;
  personas: EventualMovil[];
  onElegir: (id: string) => void;
  onCerrarAlta: () => void;
  cuil: string;
  onCuil: (value: string) => void;
  cuilEstado: string;
  nombre: string;
  onNombre: (value: string) => void;
  mail: string;
  onMail: (value: string) => void;
  telefono: string;
  onTelefono: (value: string) => void;
  onGuardarAlta: () => void;
  onCrearAcceso: () => void;
  arca: ArcaMovil[];
  nro: string;
  onNro: (value: string) => void;
  arcaId: string;
  onArca: (id: string) => void;
  onConfirmarArca: () => void;
  elegido: EventualMovil | null;
}) {
  return (
    <div data-movil-screen={props.panel} data-viewport="390x844" className="mx-auto flex min-h-[844px] w-full max-w-[390px] flex-col bg-[#f7f8fa] pb-24">
      <header className="bg-[var(--movil-topbar,#111827)] px-4 pb-4 pt-5 text-white">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-white/75">{props.empresa}</p>
        <div className="mt-1 flex items-center justify-between">
          <h1 className="text-xl font-semibold">Eventuales</h1>
          <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${props.online ? 'bg-emerald-400 text-emerald-950' : 'bg-amber-300 text-amber-950'}`}>
            {props.online ? 'En línea' : 'Sin señal'}
          </span>
        </div>
        {props.pendingLabel && (
          <p className="mt-2 rounded-lg bg-amber-100 px-2 py-1 text-[11px] font-bold text-amber-900">Pendiente de enviar: {props.pendingLabel}</p>
        )}
      </header>
      <div className="flex flex-1 flex-col gap-3 px-3 py-3">
        {props.panel !== 'arca' && (
          <>
            <input value={props.buscar} onChange={(event) => props.onBuscar(event.target.value)} placeholder="Buscar en la bolsa" className="min-h-12 rounded-lg border border-slate-200 px-3 text-sm font-semibold" />
            <ul className="space-y-2">
              {props.personas.map((persona) => (
                <li key={persona.id}>
                  <button type="button" onClick={() => props.onElegir(persona.id)} className="flex min-h-12 w-full items-center justify-between rounded-lg bg-white px-3 text-left">
                    <span className="text-sm font-bold text-slate-800">{persona.nombre}</span>
                    <span className="text-[11px] font-semibold text-[var(--movil-primary,#111827)]">{persona.marco}</span>
                  </button>
                </li>
              ))}
              {props.personas.length === 0 && <li className="rounded-lg bg-white p-4 text-sm font-semibold text-slate-500">Nadie en la bolsa con ese nombre.</li>}
            </ul>
            {props.elegido && (
              <section className="rounded-lg bg-white p-4">
                <h2 className="text-base font-semibold text-slate-900">{props.elegido.nombre}</h2>
                <p className="mt-1 text-sm font-bold text-slate-600">{props.elegido.cuil} · {props.elegido.marco}</p>
                {props.elegido.telefono && (
                  <a href={`tel:${props.elegido.telefono}`} className="mt-3 flex min-h-12 items-center justify-center rounded-lg border border-emerald-600 bg-white text-sm font-semibold text-emerald-700">Llamar</a>
                )}
                <button type="button" onClick={props.onCrearAcceso} className="mt-2 min-h-12 w-full rounded-lg bg-[var(--movil-primary,#111827)] text-sm font-semibold text-white">
                  {props.online ? 'Crear acceso a la app' : 'Crear acceso requiere conexión'}
                </button>
              </section>
            )}
          </>
        )}
        {props.panel === 'arca' && (
          <section className="rounded-lg bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-900">ARCA pendiente</h2>
            <ul className="mt-2 space-y-2">
              {props.arca.map((envio) => (
                <li key={envio.id}>
                  <button type="button" onClick={() => props.onArca(envio.id)} className={`flex min-h-12 w-full items-center justify-between rounded-lg px-3 text-left ${props.arcaId === envio.id ? 'bg-white' : 'bg-slate-50'}`}>
                    <span className="text-sm font-bold">{envio.nombre}</span>
                    <span className="text-[11px] font-semibold text-slate-500">{envio.tipo} {envio.estado}</span>
                  </button>
                </li>
              ))}
              {props.arca.length === 0 && <li className="text-sm font-semibold text-slate-500">Sin altas ni bajas pendientes.</li>}
            </ul>
            <input value={props.nro} onChange={(event) => props.onNro(event.target.value)} placeholder="Número de transacción" className="mt-3 min-h-12 w-full rounded-lg border border-slate-200 px-3 text-sm font-semibold" />
            <button type="button" onClick={props.onConfirmarArca} className="mt-2 min-h-12 w-full rounded-lg border border-emerald-600 bg-white text-sm font-semibold text-emerald-700">
              {props.online ? 'Cargar transacción' : 'ARCA requiere conexión'}
            </button>
          </section>
        )}
      </div>
      <BottomSheet open={props.panel === 'alta'} title="Alta rápida" onClose={props.onCerrarAlta}>
        <label className="block text-xs font-semibold uppercase text-slate-500">CUIL
          <input value={props.cuil} onChange={(event) => props.onCuil(event.target.value)} className="mt-1 min-h-12 w-full rounded-lg border border-slate-200 px-3 text-sm font-bold" />
        </label>
        <p className="mt-1 text-xs font-semibold text-[var(--movil-primary,#111827)]">{props.cuilEstado}</p>
        <input value={props.nombre} onChange={(event) => props.onNombre(event.target.value)} placeholder="Nombre" className="mt-2 min-h-12 w-full rounded-lg border border-slate-200 px-3 text-sm font-semibold" />
        <input value={props.mail} onChange={(event) => props.onMail(event.target.value)} placeholder="Mail" className="mt-2 min-h-12 w-full rounded-lg border border-slate-200 px-3 text-sm font-semibold" />
        <input value={props.telefono} onChange={(event) => props.onTelefono(event.target.value)} placeholder="Teléfono" className="mt-2 min-h-12 w-full rounded-lg border border-slate-200 px-3 text-sm font-semibold" />
        <p className="mt-2 text-xs font-semibold text-slate-500">Empresa habilitada: {props.empresa}</p>
        <button type="button" onClick={props.onGuardarAlta} className="mt-3 min-h-12 w-full rounded-lg bg-[var(--movil-primary,#111827)] text-sm font-semibold text-white">
          {props.online ? 'Guardar en la bolsa' : 'El alta requiere conexión'}
        </button>
      </BottomSheet>
    </div>
  );
}
