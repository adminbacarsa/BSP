import { CheckCircle2, ChevronRight, CircleDashed, ClipboardList, FlaskConical } from 'lucide-react';
import { chipPruebas, textoListos } from '@/lib/eventuales/listoUx.mjs';

export type TarjetaResumen = { id: string; titulo: string; ayuda: string; tono: string; n: number | null };
export type EstadoFilaVista = { tono: 'ok' | 'falta' | 'baja' | string; texto: string };
export type PasoChecklist = {
  id: string; n: number; titulo: string; ayuda: string; filtro: string; accion: string; boton: string;
  hecho: boolean; detalle: string; aviso?: boolean; deshabilitado?: boolean;
};
export type PasoGuia = { id: string; n: number; titulo: string; ayuda: string; filtro: string; pendientes: number };
export type GuiaVista = { disponibles: number; listos: number; pasos: PasoGuia[] };

const TONO_TARJETA: Record<string, { activo: string; numero: string }> = {
  ok: { activo: 'border-emerald-500 ring-2 ring-emerald-100', numero: 'text-emerald-700' },
  falta: { activo: 'border-amber-500 ring-2 ring-amber-100', numero: 'text-amber-700' },
  aviso: { activo: 'border-orange-500 ring-2 ring-orange-100', numero: 'text-orange-700' },
  arca: { activo: 'border-indigo-500 ring-2 ring-indigo-100', numero: 'text-indigo-700' },
};

/** Las 4 tarjetas de arriba: funcionan como filtro de la lista (ARCA abre el panel de envíos). */
export function TarjetasResumen({ tarjetas, activo, onElegir }: { tarjetas: TarjetaResumen[]; activo: string; onElegir: (id: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 xl:grid-cols-4" data-resumen-eventuales>
      {tarjetas.map((t) => {
        const tono = TONO_TARJETA[t.tono] || TONO_TARJETA.arca;
        const esActiva = activo === t.id;
        return (
          <button
            key={t.id}
            type="button"
            data-resumen={t.id}
            data-activa={esActiva ? '1' : '0'}
            aria-pressed={esActiva}
            title={t.ayuda}
            onClick={() => onElegir(t.id)}
            className={`rounded-2xl border bg-white p-3 text-left shadow-sm transition hover:bg-slate-50 active:scale-[0.99] ${esActiva ? tono.activo : 'border-slate-200'}`}
          >
            <p className={`text-2xl font-black tabular-nums ${tono.numero}`}>{t.n == null ? '—' : t.n}</p>
            <p className="text-xs font-bold text-slate-800">{t.titulo}</p>
            <p className="mt-0.5 line-clamp-2 text-[10px] text-slate-500">{t.ayuda}</p>
          </button>
        );
      })}
    </div>
  );
}

const TONO_ESTADO: Record<string, string> = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  falta: 'border-amber-200 bg-amber-50 text-amber-800',
  baja: 'border-slate-200 bg-slate-100 text-slate-600',
};

/** Un solo estado por fila, en palabras. */
export function EstadoFilaChip({ estado }: { estado: EstadoFilaVista }) {
  return (
    <span data-estado-fila={estado.tono} className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${TONO_ESTADO[estado.tono] || TONO_ESTADO.baja}`} title={estado.texto}>
      {estado.tono === 'ok' ? <CheckCircle2 size={11} className="shrink-0" /> : <CircleDashed size={11} className="shrink-0" />}
      <span className="truncate">{estado.texto}</span>
    </span>
  );
}

/** Chip gris «Pruebas: sin exigir marco» con tooltip. Null si la ficha exige marco. */
export function ChipPruebas({ ficha }: { ficha: { exigirMarco?: boolean } }) {
  const chip = chipPruebas(ficha) as { texto: string; tooltip: string } | null;
  if (!chip) return null;
  return (
    <span data-pruebas="sin-marco" title={chip.tooltip} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-600">
      <FlaskConical size={10} /> {chip.texto}
    </span>
  );
}

/** Panel derecho sin selección: la guía con los pasos y cuántos están en cada uno. El alta vive solo en la barra. */
export function GuiaEventuales({ guia, nombreEmpresa, onFiltrar }: { guia: GuiaVista; nombreEmpresa: string; onFiltrar: (filtro: string) => void }) {
  return (
    <section data-guia-eventuales className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h2 className="flex items-center gap-2 text-base font-black text-slate-800"><ClipboardList size={18} className="text-indigo-600" /> Cómo dejar listo a un eventual</h2>
        <p className="mt-1 text-xs text-slate-500">{nombreEmpresa ? `${nombreEmpresa} · ` : ''}{textoListos(guia)}</p>
        {guia.disponibles === 0 && <p data-guia-alta className="mt-2 text-xs font-bold text-slate-700">Usá Alta de eventual arriba</p>}
      </div>
      <ol className="mt-4 space-y-2">
        {guia.pasos.map((p) => (
          <li key={p.id} data-guia-paso={p.id} data-pendientes={p.pendientes} className="flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-black text-white">{p.n}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-slate-800">{p.titulo}</p>
              <p className="text-[11px] text-slate-500">{p.ayuda}</p>
              <p className={`mt-1 text-[11px] font-bold ${p.pendientes ? 'text-amber-700' : 'text-emerald-700'}`}>
                {p.pendientes === 0 ? 'Nadie tiene este paso pendiente.' : p.pendientes === 1 ? '1 persona con este paso pendiente.' : `${p.pendientes} personas con este paso pendiente.`}
              </p>
            </div>
            {p.pendientes > 0 && (
              <button type="button" data-guia-filtrar={p.filtro} onClick={() => onFiltrar(p.filtro)} className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50 active:scale-95">
                Ver ({p.pendientes}) <ChevronRight size={12} />
              </button>
            )}
          </li>
        ))}
      </ol>
      <p className="mt-4 text-[11px] text-slate-500">Elegí una persona de la lista para ver su ficha y resolver cada paso desde ahí.</p>
    </section>
  );
}

/** Lista de verificación arriba de la ficha: hecho / falta y el botón que lo resuelve ahí mismo. */
export function ChecklistEventual({ pasos, puedeEditar, ocupado, onAccion }: { pasos: PasoChecklist[]; puedeEditar: boolean; ocupado?: string; onAccion: (accion: string) => void }) {
  const hechos = pasos.filter((p) => p.hecho).length;
  return (
    <div data-checklist-eventual data-hechos={hechos} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
      <p className="mb-2 flex items-center justify-between text-[10px] font-black uppercase tracking-wider text-slate-400">
        <span>Para convocarlo</span>
        <span className={hechos === pasos.length ? 'text-emerald-700' : 'text-slate-500'}>{hechos}/{pasos.length} pasos</span>
      </p>
      <ol className="grid gap-1.5 sm:grid-cols-2">
        {pasos.map((p) => (
          <li key={p.id} data-check={p.id} data-hecho={p.hecho ? '1' : '0'} className={`flex items-start gap-2 rounded-xl border bg-white px-2.5 py-2 ${p.hecho ? 'border-emerald-100' : 'border-amber-200'}`}>
            {p.hecho ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" /> : <CircleDashed size={16} className="mt-0.5 shrink-0 text-amber-600" />}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-slate-800">{p.n}. {p.titulo} <span className={`ml-1 text-[10px] font-black uppercase ${p.hecho ? 'text-emerald-700' : 'text-amber-700'}`}>{p.hecho ? 'Hecho' : 'Falta'}</span></p>
              <p className={`text-[11px] ${p.aviso ? 'font-bold text-amber-700' : 'text-slate-500'}`}>{p.detalle}</p>
            </div>
            {!p.hecho && puedeEditar && (
              <button
                type="button"
                data-check-accion={p.accion}
                disabled={!!p.deshabilitado || ocupado === p.accion}
                title={p.deshabilitado ? p.detalle : p.boton}
                onClick={() => onAccion(p.accion)}
                className="shrink-0 rounded-xl bg-indigo-600 px-2.5 py-1.5 text-[11px] font-bold text-white shadow-sm hover:bg-indigo-700 active:scale-95 disabled:opacity-50"
              >
                {ocupado === p.accion ? 'Guardando…' : p.boton}
              </button>
            )}
            {p.hecho && p.aviso && puedeEditar && (p.id === 'MARCO' || p.id === 'VIGENCIAS') && (
              <button type="button" data-check-accion={p.accion} onClick={() => onAccion(p.accion)} className="shrink-0 rounded-xl border border-amber-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-amber-800 hover:bg-amber-50 active:scale-95">
                {p.id === 'MARCO' ? 'Renovar marco' : 'Renovar'}
              </button>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
