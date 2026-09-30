import { useMemo, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { FileCheck2, Printer, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/lib/firebase';
import { MARCO_VERSION } from '@/lib/eventuales/marcoAnexoConst.mjs';
import { marcoDeBolsa } from '@/lib/eventuales/marcoTexto.mjs';
import {
  agruparPaginas, asignarHoja, formatearCuil, MOTIVOS_SIN_ASIGNAR, parsearQrMarco, pendientesDeMarco, resumenLote,
} from '@/lib/eventuales/marcosLote.mjs';

export type PersonaMarco = {
  id: string;
  nombre: string;
  dni: string;
  domicilio: string;
  disponibilidad: string;
  empresasHabilitadas: string[];
  marcos: Record<string, { firmado?: boolean; fechaFirma?: string; vigenciaDias?: number }>;
};

type Pagina = { id: string; archivo: string; pagina: number; qr: string | null; sinImagen: boolean };
type Grupo = { cuil: string; paginas: string[]; fuente: 'QR' | 'ARCHIVO' | 'MANUAL' };
type SinAsignar = { id: string; archivo: string; pagina: number; motivo: keyof typeof MOTIVOS_SIN_ASIGNAR; cuil: string };
type Agrupado = { grupos: Grupo[]; sinAsignar: SinAsignar[]; reconocidos: number; hojasReconocidas: number; hojasSinAsignar: number };
type ResultadoPersona = { cuil: string; ok: boolean; hojas: number; estado?: string; vencimiento?: string | null; link?: string | null; error?: string };

type Props = {
  empresaId: string;
  fichas: PersonaMarco[];
  seleccionados: string[];
  puedeEditar: boolean;
  llamar: (nombre: string, data: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

const MAX_MB = 9;
const hoy = () => new Date().toISOString().slice(0, 10);

function base64De(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`No se pudo leer ${file.name}`));
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.readAsDataURL(file);
  });
}

function descargar(bytes: Uint8Array, nombre: string) {
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export default function MarcosLotePanel({ empresaId, fichas, seleccionados, puedeEditar, llamar }: Props) {
  const [imprimiendo, setImprimiendo] = useState(false);
  const [abierto, setAbierto] = useState(false);
  const [archivos, setArchivos] = useState<File[]>([]);
  const [fechaFirma, setFechaFirma] = useState(hoy());
  const [vigenciaDias, setVigenciaDias] = useState('365');
  const [loteId, setLoteId] = useState('');
  const [progreso, setProgreso] = useState('');
  const [paginas, setPaginas] = useState<Pagina[]>([]);
  const [agrupado, setAgrupado] = useState<Agrupado | null>(null);
  const [eleccion, setEleccion] = useState<Record<string, string>>({});
  const [informe, setInforme] = useState<{ guardados: number; fallidos: number; resultados: ResultadoPersona[] } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const porCuil = useMemo(() => new Map(fichas.map((f) => [f.id, f])), [fichas]);
  const pendientes = useMemo(() => (empresaId ? (pendientesDeMarco({ fichas, empresaId, hoy: hoy() }) as PersonaMarco[]) : []), [fichas, empresaId]);
  const candidatos = useMemo(
    () => fichas.filter((f) => !empresaId || f.empresasHabilitadas.includes(empresaId)).sort((a, b) => a.nombre.localeCompare(b.nombre)),
    [fichas, empresaId],
  );

  const nombreDe = (cuil: string) => porCuil.get(cuil)?.nombre || `CUIL ${formatearCuil(cuil)} (no está en la bolsa)`;

  const imprimir = async () => {
    if (!empresaId) { toast.error('Elegí una empresa para imprimir los marcos.'); return; }
    const elegidas = seleccionados.length ? fichas.filter((f) => seleccionados.includes(f.id)) : pendientes;
    if (!elegidas.length) { toast.info('No hay marcos pendientes en esa empresa.'); return; }
    setImprimiendo(true);
    try {
      const snap = await getDoc(doc(db, 'empresas', empresaId));
      const e = snap.data() || {};
      const { pdfMarcosLote } = await import('@/lib/eventuales/marcosLotePdf.mjs');
      const out = pdfMarcosLote({
        empresa: { id: empresaId, nombre: String(e.razonSocial || e.nombre || empresaId), cuit: String(e.cuit || ''), domicilio: String(e.domicilio || '') },
        personas: elegidas.map((f) => ({ cuil: f.id, nombre: f.nombre, dni: f.dni, domicilio: f.domicilio })),
        fecha: hoy(),
        marcoVersion: MARCO_VERSION,
      }) as { bytes: Uint8Array; paginas: number };
      descargar(out.bytes, `Marcos-${empresaId}-${hoy()}.pdf`);
      toast.success(`${elegidas.length} marco${elegidas.length === 1 ? '' : 's'} × 2 ejemplares · ${out.paginas} hojas.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo armar el PDF.');
    } finally {
      setImprimiendo(false);
    }
  };

  const reiniciar = () => {
    setArchivos([]); setPaginas([]); setAgrupado(null); setEleccion({}); setInforme(null); setProgreso(''); setLoteId('');
  };

  const abrir = () => {
    if (!empresaId) { toast.error('Elegí una empresa antes de subir los escaneos.'); return; }
    reiniciar();
    setFechaFirma(hoy());
    setAbierto(true);
  };

  const analizar = async () => {
    if (!archivos.length) { toast.error('Elegí al menos un archivo.'); return; }
    const grande = archivos.find((a) => a.size > MAX_MB * 1024 * 1024);
    if (grande) { toast.error(`${grande.name} supera ${MAX_MB} MB. Dividí el PDF.`); return; }
    const id = loteId || `lote_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    setLoteId(id);
    setOcupado(true);
    setInforme(null);
    const acumuladas: Pagina[] = [...paginas];
    try {
      for (let i = 0; i < archivos.length; i += 1) {
        const archivo = archivos[i];
        setProgreso(`Leyendo ${archivo.name} (${i + 1}/${archivos.length})…`);
        const base64 = await base64De(archivo);
        const res = await llamar('subirMarcosLote', { accion: 'analizar', loteId: id, empresaId, archivo: { nombre: archivo.name, base64 } }) as { paginas?: Pagina[] };
        acumuladas.push(...(res.paginas || []));
      }
      setPaginas(acumuladas);
      setAgrupado(agruparPaginas({ paginas: acumuladas, empresaId, cuilsEnBolsa: new Set(fichas.map((f) => f.id)) }) as Agrupado);
      setArchivos([]);
      setProgreso('');
    } catch (err) {
      setProgreso('');
      toast.error(err instanceof Error ? err.message : 'No se pudieron leer los escaneos.');
    } finally {
      setOcupado(false);
    }
  };

  const asignar = (hojaId: string) => {
    const cuil = eleccion[hojaId];
    if (!agrupado || !cuil) { toast.error('Elegí a quién corresponde la hoja.'); return; }
    setAgrupado(asignarHoja(agrupado, hojaId, cuil) as Agrupado);
  };

  const confirmar = async () => {
    if (!agrupado?.grupos.length) { toast.error('No hay personas reconocidas.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaFirma)) { toast.error('Fecha de firma inválida.'); return; }
    setOcupado(true);
    setProgreso(`Guardando ${agrupado.grupos.length} marcos en Drive…`);
    try {
      const versionDe = (g: Grupo) => {
        const conQr = paginas.find((p) => g.paginas.includes(p.id) && parsearQrMarco(p.qr));
        return conQr ? (parsearQrMarco(conQr.qr) as { marcoVersion: number }).marcoVersion : MARCO_VERSION;
      };
      const res = await llamar('subirMarcosLote', {
        accion: 'confirmar', loteId, empresaId, fechaFirma, vigenciaDias: Number(vigenciaDias) || 365,
        grupos: agrupado.grupos.map((g) => ({ cuil: g.cuil, paginaIds: g.paginas, marcoVersion: versionDe(g) })),
      }) as { guardados: number; fallidos: number; resultados: ResultadoPersona[] };
      setInforme(res);
      setProgreso('');
      if (res.fallidos) toast.warning(`${res.guardados} marcos guardados, ${res.fallidos} con error.`);
      else toast.success(`${res.guardados} marcos vigentes desde ${fechaFirma.split('-').reverse().join('/')}.`);
    } catch (err) {
      setProgreso('');
      toast.error(err instanceof Error ? err.message : 'No se pudo confirmar el lote.');
    } finally {
      setOcupado(false);
    }
  };

  const descartar = async () => {
    if (loteId && !informe) {
      try { await llamar('subirMarcosLote', { accion: 'descartar', loteId, empresaId }); } catch { /* las hojas temporales se limpian igual al confirmar otro lote */ }
    }
    reiniciar();
    setAbierto(false);
  };

  if (!puedeEditar) return null;

  return (
    <>
      <button type="button" onClick={imprimir} disabled={imprimiendo} title="Un PDF con el marco de cada persona sin marco o vencido en la empresa elegida (o de las seleccionadas), dos ejemplares por persona, con QR en la hoja de firmas"
        className="inline-flex items-center gap-2 rounded-2xl bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50">
        <Printer size={14} /> Imprimir marcos {seleccionados.length ? `(${seleccionados.length} seleccionados)` : `pendientes${empresaId ? ` (${pendientes.length})` : ''}`}
      </button>
      <button type="button" onClick={abrir} className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-700">
        <Upload size={14} /> Subir escaneos en lote
      </button>

      {abierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-3xl bg-white p-6 shadow-lg">
            <div className="mb-4 flex items-start justify-between gap-2">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-black text-slate-800"><FileCheck2 size={18} /> Subir marcos firmados · {empresaId}</h2>
                <p className="text-xs text-slate-500">Un PDF con muchas hojas o varios archivos/fotos. Se lee el QR de cada hoja de firmas; si no se puede, vale el CUIL en el nombre del archivo.</p>
              </div>
              <button type="button" onClick={descartar} className="rounded-xl p-1 text-slate-500 hover:bg-slate-100" aria-label="Cerrar"><X size={18} /></button>
            </div>

            <div className="mb-4 flex flex-wrap items-end gap-3">
              <label className="text-xs font-bold text-slate-600">Fecha de firma
                <input type="date" value={fechaFirma} onChange={(e) => setFechaFirma(e.target.value)} disabled={!!informe} className="mt-1 block rounded-xl border border-slate-200 px-2 py-1 text-sm" />
              </label>
              <label className="text-xs font-bold text-slate-600">Vigencia (días)
                <input value={vigenciaDias} onChange={(e) => setVigenciaDias(e.target.value)} disabled={!!informe} className="mt-1 block w-20 rounded-xl border border-slate-200 px-2 py-1 text-sm" />
              </label>
              {!informe && (
                <label className="cursor-pointer rounded-2xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200">
                  Elegir archivos
                  <input type="file" multiple accept="application/pdf,image/jpeg,image/png" className="hidden" disabled={ocupado}
                    onChange={(e) => setArchivos([...archivos, ...Array.from(e.target.files || [])])} />
                </label>
              )}
              {archivos.length > 0 && !informe && (
                <button type="button" onClick={analizar} disabled={ocupado} className="rounded-2xl bg-indigo-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
                  Leer {archivos.length} archivo{archivos.length === 1 ? '' : 's'}
                </button>
              )}
            </div>

            {archivos.length > 0 && (
              <ul className="mb-4 flex flex-wrap gap-2">
                {archivos.map((a) => (
                  <li key={`${a.name}_${a.size}`} className="flex items-center gap-1 rounded-xl bg-slate-50 px-2 py-1 text-xs text-slate-600">
                    {a.name} · {(a.size / 1024 / 1024).toFixed(1)} MB
                    <button type="button" onClick={() => setArchivos(archivos.filter((x) => x !== a))} className="text-slate-400 hover:text-rose-600" aria-label={`Quitar ${a.name}`}><X size={12} /></button>
                  </li>
                ))}
              </ul>
            )}

            {progreso && <p className="mb-3 animate-pulse text-sm font-bold text-indigo-700">{progreso}</p>}

            {agrupado && !informe && (
              <div className="space-y-4">
                <p className="text-sm font-black text-slate-800">{resumenLote(agrupado)}</p>
                {agrupado.grupos.length > 0 && (
                  <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-100">
                    {agrupado.grupos.map((g) => (
                      <li key={g.cuil} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                        <span>
                          <span className="font-bold text-slate-800">{nombreDe(g.cuil)}</span>
                          <span className="ml-2 text-xs text-slate-500">CUIL {formatearCuil(g.cuil)} · {g.paginas.length} hoja{g.paginas.length === 1 ? '' : 's'}</span>
                          {porCuil.get(g.cuil) && marcoDeBolsa(porCuil.get(g.cuil), empresaId, hoy()).estado === 'MARCO_VIGENTE' && <span className="ml-2 text-xs font-bold text-amber-700">ya tenía marco vigente: se reemplaza</span>}
                        </span>
                        <span className={`rounded-xl px-2 py-0.5 text-[11px] font-bold ${g.fuente === 'QR' ? 'bg-emerald-50 text-emerald-700' : g.fuente === 'ARCHIVO' ? 'bg-sky-50 text-sky-700' : 'bg-slate-100 text-slate-600'}`}>
                          {g.fuente === 'QR' ? 'QR' : g.fuente === 'ARCHIVO' ? 'nombre del archivo' : 'manual'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {agrupado.sinAsignar.length > 0 && (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
                    <h3 className="text-sm font-black text-amber-800">Hojas sin asignar · elegí a quién corresponden</h3>
                    <ul className="mt-2 space-y-2">
                      {agrupado.sinAsignar.map((h) => (
                        <li key={h.id} className="flex flex-wrap items-center gap-2 text-xs text-slate-700">
                          <span className="font-bold">{h.archivo} · hoja {h.pagina}</span>
                          <span className="text-slate-500">{MOTIVOS_SIN_ASIGNAR[h.motivo] || h.motivo}{h.cuil ? ` (${formatearCuil(h.cuil)})` : ''}</span>
                          <select value={eleccion[h.id] || ''} onChange={(e) => setEleccion({ ...eleccion, [h.id]: e.target.value })} className="rounded-xl border border-slate-200 bg-white px-2 py-1">
                            <option value="">Persona…</option>
                            {candidatos.map((f) => <option key={f.id} value={f.id}>{f.nombre} · {formatearCuil(f.id)}</option>)}
                          </select>
                          <button type="button" onClick={() => asignar(h.id)} className="rounded-xl bg-indigo-600 px-2 py-1 font-bold text-white">Asignar</button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="flex flex-wrap justify-end gap-2">
                  <button type="button" onClick={descartar} disabled={ocupado} className="rounded-2xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700">Descartar lote</button>
                  <button type="button" onClick={confirmar} disabled={ocupado || !agrupado.grupos.length} className="rounded-2xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
                    Confirmar {agrupado.grupos.length} marco{agrupado.grupos.length === 1 ? '' : 's'}{agrupado.sinAsignar.length ? ` (${agrupado.sinAsignar.length} hojas quedan afuera)` : ''}
                  </button>
                </div>
              </div>
            )}

            {informe && (
              <div className="space-y-3">
                <p className="text-sm font-black text-slate-800">{informe.guardados} guardado{informe.guardados === 1 ? '' : 's'}{informe.fallidos ? ` · ${informe.fallidos} con error` : ''}</p>
                <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-100">
                  {informe.resultados.map((r) => (
                    <li key={r.cuil} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                      <span><span className="font-bold text-slate-800">{nombreDe(r.cuil)}</span> <span className="text-xs text-slate-500">· {r.hojas} hojas</span></span>
                      {r.ok
                        ? <span className="text-xs font-bold text-emerald-700">{r.estado} hasta {r.vencimiento ? r.vencimiento.split('-').reverse().join('/') : '—'}{r.link ? <> · <a href={r.link} target="_blank" rel="noreferrer" className="underline">Drive</a></> : ' · pendiente de Drive'}</span>
                        : <span className="text-xs font-bold text-rose-700">{r.error}</span>}
                    </li>
                  ))}
                </ul>
                <div className="flex justify-end">
                  <button type="button" onClick={() => { reiniciar(); setAbierto(false); }} className="rounded-2xl bg-indigo-600 px-3 py-2 text-xs font-bold text-white">Listo</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
