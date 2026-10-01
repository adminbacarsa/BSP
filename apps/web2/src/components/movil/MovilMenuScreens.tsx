import type { MovilModulo } from '@/lib/movil/modulos';

export interface MovilMenuEmpresa {
  id: string;
  name: string;
}

/** Selector de módulos. Con un solo módulo permitido no hay grilla: empresa, asistente y salir. */
export function MovilMenuScreens(props: {
  empresaId: string;
  empresaName: string;
  empresas: MovilMenuEmpresa[];
  canSwitchEmpresa: boolean;
  modulos: MovilModulo[];
  unico: MovilModulo | null;
  onModulo: (modulo: MovilModulo) => void;
  onSwitchEmpresa: (id: string) => void;
  onAsistente: () => void;
  onEscritorio: () => void;
  onLogout: () => void;
}) {
  const otras = props.canSwitchEmpresa ? props.empresas.filter((e) => e.id !== props.empresaId) : [];
  return (
    <div data-movil-screen="menu" data-viewport="390x844" className="mx-auto flex min-h-[844px] w-full max-w-[390px] flex-col gap-3 bg-slate-100 px-3 pb-8 pt-5">
      <section className="rounded-3xl bg-indigo-700 p-4 text-white shadow-lg">
        <p className="text-[10px] font-black uppercase tracking-widest text-indigo-200">Empresa activa</p>
        <h1 className="mt-1 text-xl font-black">{props.empresaName}</h1>
        {otras.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {otras.map((e) => (
              <button key={e.id} type="button" onClick={() => props.onSwitchEmpresa(e.id)} className="min-h-10 rounded-xl bg-white/15 px-3 text-[11px] font-black text-white active:scale-95">
                Cambiar a {e.name}
              </button>
            ))}
          </div>
        )}
      </section>
      {props.unico ? (
        <button type="button" data-movil-module={props.unico.id} onClick={() => props.onModulo(props.unico as MovilModulo)} className="min-h-14 rounded-3xl bg-white text-base font-black text-indigo-700 shadow-sm active:scale-95">
          Volver a {props.unico.label}
        </button>
      ) : (
        <section className="grid grid-cols-2 gap-2">
          {props.modulos.map((modulo) => (
            <button
              key={modulo.id}
              type="button"
              data-movil-module={modulo.id}
              onClick={() => props.onModulo(modulo)}
              className="flex min-h-[92px] flex-col justify-between rounded-3xl border border-slate-200 bg-white p-3 text-left shadow-sm active:scale-95"
            >
              <b className="text-base font-black text-slate-900">{modulo.label}</b>
              <small className="text-[11px] font-semibold text-slate-500">{modulo.desc}</small>
            </button>
          ))}
          {props.modulos.length === 0 && (
            <p className="col-span-2 rounded-3xl bg-white p-4 text-sm font-semibold text-slate-500">Tu rol no tiene módulos para el celular.</p>
          )}
        </section>
      )}
      <button type="button" onClick={props.onAsistente} className="min-h-12 rounded-2xl bg-indigo-50 text-sm font-black text-indigo-800 active:scale-95">Asistente</button>
      <button type="button" onClick={props.onEscritorio} className="min-h-12 rounded-2xl border border-slate-200 bg-white text-sm font-bold text-slate-700 active:scale-95">Ver como escritorio</button>
      <button type="button" onClick={props.onLogout} className="min-h-12 rounded-2xl bg-rose-50 text-sm font-black text-rose-700 active:scale-95">Cerrar sesión</button>
    </div>
  );
}
