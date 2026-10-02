import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { MovilBadge } from './ui/MovilBadge';
import { MOVIL_CARD, type MovilTone } from './ui/tones';
import { CCT_422_ID, celdasBajaConfianza, derivadosFila, parametrosDe, rotuloFuente, rotuloVigencia } from '@/lib/eventuales/escalaCct.mjs';

type Campo = { valor: number | null; confianza: string; motivo?: string };
type Fila = { codigo: string; label: string; codigoArca: string | null; basico: Campo; presentismo: Campo; viatico: Campo; noRemunerativo: Campo; total: Campo };
type Tramo = { mes: string; vigenciaDesde: string; vigenciaHasta: string; categorias: Fila[]; aeroportuario: Campo | null; adicionalVacacionesPorDia: Campo | null };
type Escala = Record<string, any> & { id: string; estado: string; tramos: Tramo[]; version?: number | null };

const ESTADO: Record<string, { texto: string; tone: MovilTone }> = {
  PROPUESTA: { texto: 'Propuesta', tone: 'amber' },
  APROBADA: { texto: 'Vigente', tone: 'emerald' },
  REEMPLAZADA: { texto: 'Reemplazada', tone: 'slate' },
  RECHAZADA: { texto: 'Rechazada', tone: 'rose' },
};
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const fmt = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('es-AR', { maximumFractionDigits: 2 }));
const fmtMes = (mes: string) => `${MESES[Number(mes.slice(5, 7)) - 1] || mes} ${mes.slice(0, 4)}`;

/** Escala salarial en el celular: solo lectura. Editar y aprobar es en la computadora. */
export function EscalaMovilPanel({ escalas: externas }: { escalas?: Escala[] }) {
  const [internas, setInternas] = useState<Escala[]>([]);
  const [cargando, setCargando] = useState(!externas);
  const [elegidaId, setElegidaId] = useState('');
  const [categoria, setCategoria] = useState('VIGILADOR');

  useEffect(() => {
    if (externas) return;
    const q = query(collection(db, 'escalas_cct'), where('cct', '==', CCT_422_ID));
    return onSnapshot(q, (snap) => {
      setInternas(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Escala)));
      setCargando(false);
    }, () => setCargando(false));
  }, [externas]);

  const escalas = useMemo(() => (externas || internas).slice().sort((a, b) => String(b.vigenciaDesde || '').localeCompare(String(a.vigenciaDesde || ''))), [externas, internas]);
  const elegida = escalas.find((e) => e.id === elegidaId) || escalas.find((e) => e.estado === 'APROBADA') || escalas.find((e) => e.estado === 'PROPUESTA') || escalas[0] || null;
  const parametros = elegida ? parametrosDe(elegida) : null;
  const bajas = useMemo(() => (elegida ? celdasBajaConfianza(elegida) as { mes: string; codigo: string; campo: string }[] : []), [elegida]);
  const categorias = elegida?.tramos?.[0]?.categorias || [];

  return (
    <div className="flex flex-col gap-3" data-movil-list="escala">
      <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Escala salarial · CCT 422/05 · bruto del anexo</p>
      {cargando && <p className={`${MOVIL_CARD} p-4 text-sm font-semibold text-slate-500`}>Cargando…</p>}
      {!cargando && !escalas.length && <p className={`${MOVIL_CARD} p-4 text-sm font-semibold text-slate-500`}>Sin escala cargada. Se propone sola cuando sale el acuerdo nuevo; también se carga desde la computadora.</p>}
      {escalas.length > 1 && (
        <div className="flex gap-1 overflow-x-auto px-1">
          {escalas.map((e) => (
            <button key={e.id} type="button" onClick={() => setElegidaId(e.id)} data-escala={e.id}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-[12px] font-semibold ${elegida?.id === e.id ? 'border-transparent bg-[var(--movil-primary,#111827)] text-[var(--movil-primary-text,#fff)]' : 'border-slate-200 bg-white text-slate-700'}`}>
              {rotuloVigencia(e)}{e.version != null ? ` · v${e.version}` : ''}
            </button>
          ))}
        </div>
      )}
      {elegida && (
        <>
          <section className={`${MOVIL_CARD} p-3`} data-escala-detalle={elegida.id}>
            <div className="flex items-start justify-between gap-2">
              <span className="text-[15px] font-semibold text-slate-900">Vigencia {rotuloVigencia(elegida)}</span>
              <MovilBadge tone={(ESTADO[elegida.estado] || ESTADO.PROPUESTA).tone}>{(ESTADO[elegida.estado] || ESTADO.PROPUESTA).texto}{elegida.version != null ? ` v${elegida.version}` : ''}</MovilBadge>
            </div>
            <p className="mt-1 text-[12px] font-medium text-slate-600">{rotuloFuente(elegida)}{elegida.fuente?.url ? <> · <a href={elegida.fuente.url} target="_blank" rel="noreferrer" className="text-[var(--movil-primary,#111827)] underline">documento</a></> : null}</p>
            <p className="mt-1 text-[12px] font-medium text-slate-500">
              Confianza {elegida.confianzaGlobal || '—'}{bajas.length ? ` · ${bajas.length} celdas a revisar` : ''}{elegida.historial?.length ? ` · ${elegida.historial.length} correcciones` : ''}
            </p>
            {elegida.estado === 'PROPUESTA' && <p className="mt-2 border-l-[3px] border-amber-500 pl-2 text-[12px] font-semibold text-amber-800">Pendiente de aprobación. Se aprueba desde la computadora (Eventuales → Escala salarial).</p>}
          </section>
          <label className="block px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Categoría
            <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className="mt-1 min-h-12 w-full rounded-lg border border-slate-200 bg-white px-3 text-base font-semibold text-slate-900">
              {categorias.map((c) => <option key={c.codigo} value={c.codigo}>{c.label}{c.codigoArca ? ` · ARCA ${c.codigoArca}` : ''}</option>)}
            </select>
          </label>
          <ul className="space-y-2">
            {elegida.tramos.map((t) => {
              const f = t.categorias.find((c) => c.codigo === categoria) || t.categorias[0];
              if (!f) return null;
              const der = derivadosFila(f, parametros) as { valorHora: number | null; horaExtra50: number | null; horaExtra100: number | null; horaNocturna: number | null };
              const marca = (campo: string) => (bajas.some((b) => b.mes === t.mes && b.codigo === f.codigo && b.campo === campo) ? 'text-amber-700' : 'text-slate-900');
              return (
                <li key={t.mes} className={`${MOVIL_CARD} p-3`} data-tramo={t.mes}>
                  <p className="text-[14px] font-semibold text-slate-900">{fmtMes(t.mes)}</p>
                  <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px] font-medium text-slate-500">
                    <div><dt>Básico</dt><dd className={`text-[14px] font-semibold tabular-nums ${marca('basico')}`}>{fmt(f.basico?.valor)}</dd></div>
                    <div><dt>Presentismo</dt><dd className={`text-[14px] font-semibold tabular-nums ${marca('presentismo')}`}>{fmt(f.presentismo?.valor)}</dd></div>
                    <div><dt>Viático art. 106</dt><dd className={`text-[14px] font-semibold tabular-nums ${marca('viatico')}`}>{fmt(f.viatico?.valor)}</dd></div>
                    <div><dt>No remunerativo</dt><dd className={`text-[14px] font-semibold tabular-nums ${marca('noRemunerativo')}`}>{fmt(f.noRemunerativo?.valor)}</dd></div>
                    <div><dt>Total conformado</dt><dd className={`text-[14px] font-semibold tabular-nums ${marca('total')}`}>{fmt(f.total?.valor)}</dd></div>
                    <div><dt>Valor hora</dt><dd className="text-[14px] font-semibold tabular-nums text-slate-900">{fmt(der.valorHora)}</dd></div>
                    <div><dt>Hora extra 50 %</dt><dd className="text-[13px] font-semibold tabular-nums text-slate-900">{fmt(der.horaExtra50)}</dd></div>
                    <div><dt>Hora extra 100 %</dt><dd className="text-[13px] font-semibold tabular-nums text-slate-900">{fmt(der.horaExtra100)}</dd></div>
                    <div><dt>Hora nocturna</dt><dd className={`text-[13px] font-semibold tabular-nums ${der.horaNocturna == null ? 'text-amber-700' : 'text-slate-900'}`}>{der.horaNocturna == null ? 'recargo a cargar' : fmt(der.horaNocturna)}</dd></div>
                    <div><dt>Aeroportuario / vac. día</dt><dd className="text-[13px] font-semibold tabular-nums text-slate-900">{fmt(t.aeroportuario?.valor)} / {fmt(t.adicionalVacacionesPorDia?.valor)}</dd></div>
                  </dl>
                </li>
              );
            })}
          </ul>
          <p className="px-1 text-[12px] font-semibold text-slate-500">Editar y aprobar: disponible en la computadora.</p>
        </>
      )}
    </div>
  );
}
