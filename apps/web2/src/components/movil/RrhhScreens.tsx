export type RrhhPanel = 'dia' | 'ausencia' | 'novedad' | 'ficha';

export type GuardiaMovil = { id: string; nombre: string; telefono: string };
export type TipoMovil = { id: string; label: string; code: string };
export type TurnoSemana = { id: string; dia: string; codigo: string };

const NOVEDAD_TIPOS = ['Observación', 'Incidente', 'Uniforme', 'Otro'] as const;

export function RrhhScreens(props: {
  empresa: string;
  online: boolean;
  pendingLabel: string | null;
  panel: RrhhPanel;
  hoyLabel: string;
  ausenciasHoy: { id: string; employeeId: string; nombre: string; tipo: string }[];
  licencias: { id: string; employeeId: string; nombre: string; detalle: string }[];
  certificados: { id: string; employeeId: string; nombre: string }[];
  busqueda: string;
  onBusqueda: (value: string) => void;
  guardias: GuardiaMovil[];
  tipos: TipoMovil[];
  tipoId: string;
  onTipo: (id: string) => void;
  dias: string;
  onDias: (value: string) => void;
  fotoNombre: string | null;
  onFoto: (file: File | null) => void;
  onGuardarAusencia: () => void;
  novedadTipo: string;
  onNovedadTipo: (value: string) => void;
  novedadTexto: string;
  onNovedadTexto: (value: string) => void;
  onGuardarNovedad: () => void;
  ficha: { nombre: string; telefono: string; turnos: TurnoSemana[] } | null;
  onElegir: (id: string) => void;
  onFicha: (id: string) => void;
  onPanel: (panel: RrhhPanel) => void;
}) {
  const guardar = props.online ? 'Guardar' : 'Guardar · pendiente de enviar';
  return (
    <div data-movil-screen data-viewport="390x844" className="mx-auto flex min-h-[844px] w-full max-w-[390px] flex-col bg-slate-100 pb-24">
      <header className="bg-indigo-700 px-4 pb-4 pt-5 text-white shadow-lg">
        <p className="text-[10px] font-black uppercase tracking-widest text-indigo-200">{props.empresa}</p>
        <div className="mt-1 flex items-center justify-between gap-2">
          <h1 className="text-xl font-black">RRHH</h1>
          <span className={`rounded-full px-2 py-1 text-[10px] font-black ${props.online ? 'bg-emerald-400 text-emerald-950' : 'bg-amber-300 text-amber-950'}`}>
            {props.online ? 'En línea' : 'Sin señal'}
          </span>
        </div>
        <p className="mt-1 text-xs font-semibold text-indigo-100">{props.hoyLabel}</p>
        {props.pendingLabel && (
          <p className="mt-2 rounded-xl bg-amber-100 px-2 py-1 text-[11px] font-bold text-amber-900">Pendiente de enviar: {props.pendingLabel}</p>
        )}
      </header>
      <div className="flex gap-2 overflow-x-auto px-3 py-3">
        {([
          ['dia', 'Hoy'],
          ['ausencia', 'Ausencia'],
          ['novedad', 'Novedad'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => props.onPanel(id)}
            className={`min-h-12 shrink-0 rounded-2xl px-4 text-sm font-black shadow-sm ${props.panel === id ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex flex-1 flex-col gap-3 px-3">
        {props.panel === 'dia' && (
          <>
            <Tarjeta titulo="Ausencias de hoy" vacio="Nadie ausente hoy." items={props.ausenciasHoy.map((row) => ({ key: row.id, id: row.employeeId, titulo: row.nombre, detalle: row.tipo }))} onOpen={props.onFicha} />
            <Tarjeta titulo="Licencias que empiezan o terminan" vacio="Ninguna licencia cambia hoy." items={props.licencias.map((row) => ({ key: row.id, id: row.employeeId, titulo: row.nombre, detalle: row.detalle }))} onOpen={props.onFicha} />
            <Tarjeta titulo="Certificados pendientes" vacio="Sin certificados pendientes." items={props.certificados.map((row) => ({ key: row.id, id: row.employeeId, titulo: row.nombre, detalle: 'Falta la foto' }))} onOpen={props.onFicha} />
          </>
        )}
        {props.panel === 'ausencia' && (
          <section className="rounded-3xl bg-white p-4 shadow-sm">
            <h2 className="text-base font-black text-slate-900">Cargar ausencia</h2>
            <input
              value={props.busqueda}
              onChange={(event) => props.onBusqueda(event.target.value)}
              placeholder="Buscar guardia"
              className="mt-3 min-h-12 w-full rounded-2xl border border-slate-200 px-3 text-sm font-semibold"
            />
            <ul className="mt-2 max-h-40 space-y-1 overflow-auto">
              {props.guardias.map((guardia) => (
                <li key={guardia.id}>
                  <button type="button" onClick={() => props.onElegir(guardia.id)} className="min-h-12 w-full rounded-2xl bg-slate-50 px-3 text-left text-sm font-bold text-slate-800">
                    {guardia.nombre}
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              {props.tipos.map((tipo) => (
                <button
                  key={tipo.id}
                  type="button"
                  onClick={() => props.onTipo(tipo.id)}
                  className={`min-h-12 rounded-2xl px-3 text-sm font-black ${props.tipoId === tipo.id ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700'}`}
                >
                  {tipo.code} {tipo.label}
                </button>
              ))}
            </div>
            <label className="mt-3 block text-xs font-black uppercase text-slate-500">
              Días
              <input value={props.dias} onChange={(event) => props.onDias(event.target.value)} inputMode="numeric" className="mt-1 min-h-12 w-full rounded-2xl border border-slate-200 px-3 text-sm font-bold" />
            </label>
            <label className="mt-3 flex min-h-12 cursor-pointer items-center justify-center rounded-2xl bg-slate-100 text-sm font-black text-slate-700">
              {props.fotoNombre || 'Foto del certificado'}
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(event) => props.onFoto(event.target.files?.[0] || null)} />
            </label>
            <button type="button" onClick={props.onGuardarAusencia} className="mt-3 min-h-12 w-full rounded-2xl bg-emerald-600 text-sm font-black text-white shadow-sm active:scale-95">
              {guardar}
            </button>
          </section>
        )}
        {props.panel === 'novedad' && (
          <section className="rounded-3xl bg-white p-4 shadow-sm">
            <h2 className="text-base font-black text-slate-900">Novedad rápida</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {NOVEDAD_TIPOS.map((tipo) => (
                <button key={tipo} type="button" onClick={() => props.onNovedadTipo(tipo)} className={`min-h-12 rounded-2xl px-3 text-sm font-black ${props.novedadTipo === tipo ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700'}`}>
                  {tipo}
                </button>
              ))}
            </div>
            <textarea value={props.novedadTexto} onChange={(event) => props.onNovedadTexto(event.target.value)} placeholder="Qué pasó" className="mt-3 min-h-28 w-full rounded-2xl border border-slate-200 p-3 text-sm font-semibold" />
            <button type="button" onClick={props.onGuardarNovedad} className="mt-3 min-h-12 w-full rounded-2xl bg-indigo-600 text-sm font-black text-white shadow-sm active:scale-95">
              {guardar}
            </button>
          </section>
        )}
        {props.panel === 'ficha' && props.ficha && (
          <section className="rounded-3xl bg-white p-4 shadow-sm">
            <button type="button" onClick={() => props.onPanel('dia')} className="text-xs font-black text-indigo-600">Volver</button>
            <h2 className="mt-2 text-lg font-black text-slate-900">{props.ficha.nombre}</h2>
            {props.ficha.telefono ? (
              <a href={`tel:${props.ficha.telefono}`} className="mt-3 flex min-h-12 items-center justify-center rounded-2xl bg-emerald-600 text-sm font-black text-white shadow-sm">Llamar</a>
            ) : (
              <p className="mt-3 text-sm font-semibold text-slate-500">Sin teléfono</p>
            )}
            <h3 className="mt-4 text-xs font-black uppercase text-slate-500">Turnos de la semana</h3>
            <ul className="mt-2 space-y-2">
              {props.ficha.turnos.map((turno) => (
                <li key={turno.id} className="flex min-h-12 items-center justify-between rounded-2xl bg-slate-50 px-3 text-sm font-bold">
                  <span>{turno.dia}</span>
                  <span className="rounded-xl bg-indigo-100 px-2 py-1 text-indigo-800">{turno.codigo}</span>
                </li>
              ))}
              {props.ficha.turnos.length === 0 && <li className="text-sm font-semibold text-slate-500">Sin turnos esta semana.</li>}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function Tarjeta(props: {
  titulo: string;
  vacio: string;
  items: { key: string; id: string; titulo: string; detalle: string }[];
  onOpen: (id: string) => void;
}) {
  return (
    <section className="rounded-3xl bg-white p-4 shadow-sm">
      <h2 className="text-sm font-black text-slate-900">{props.titulo}</h2>
      <ul className="mt-2 space-y-2">
        {props.items.map((item) => (
          <li key={item.key}>
            <button type="button" onClick={() => props.onOpen(item.id)} className="flex min-h-12 w-full items-center justify-between rounded-2xl bg-slate-50 px-3 text-left">
              <span className="text-sm font-bold text-slate-800">{item.titulo}</span>
              <span className="text-[11px] font-black text-slate-500">{item.detalle}</span>
            </button>
          </li>
        ))}
        {props.items.length === 0 && <li className="text-sm font-semibold text-slate-500">{props.vacio}</li>}
      </ul>
    </section>
  );
}
