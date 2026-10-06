import { useState } from 'react';
import { Download, ExternalLink, Eye, FileSignature, Landmark, Send } from 'lucide-react';
import { toast } from 'sonner';
import {
  enviosDelContrato, estadoAnexoVista, textoEscalaYBruto, textoEstadoContrato, textoJornada, textoPeriodoContrato,
} from '@/lib/eventuales/contratoVista.mjs';

export type ContratoVista = {
  id: string;
  empresaId?: string;
  estado?: string;
  fechaAlta?: string;
  fechaBaja?: string;
  jornadas?: { fecha: string; horaInicio: string; horaFin: string; horas: number }[];
  anexoEstado?: string;
  anexoMensaje?: string | null;
  anexoExigido?: boolean;
  codigoVenceMs?: number | null;
  anexoEscalaTexto?: string;
  anexoBrutoTexto?: string | null;
  anexoEscalaRespaldo?: boolean;
  anexo?: {
    fechaHora?: string | null; dispositivo?: string | null; link?: string | null; drivePendiente?: boolean;
    escalaTexto?: string | null; brutoTexto?: string | null; escalaRespaldo?: boolean; hashAnexo?: string | null;
  } | null;
};

export type ArcaVista = {
  id: string; tipo?: string; estado?: string; fechaAlta?: string; fechaBaja?: string; nroTransaccion?: string | null; constanciaUrl?: string | null;
  contratoIds?: string[]; quitadoDelLote?: boolean; acuseAnulacion?: string | null;
};

type EstadoAnexo = { id: string; tono: string; texto: string; reenviar: boolean; firmado: boolean };
type EnvioVista = { id: string; tipo: string; estado: string; tono: string; fecha: string; constanciaUrl: string | null; nroTransaccion: string | null };

const TONO: Record<string, string> = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  pendiente: 'border-amber-200 bg-amber-50 text-amber-800',
  malo: 'border-rose-200 bg-rose-50 text-rose-800',
  neutro: 'border-slate-200 bg-slate-50 text-slate-600',
};

function bytesDeBase64(base64: string) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Abre o descarga un PDF que llegó por callable (base64) o, si el servidor solo tiene el link, ese link.
 * Para «ver» la pestaña se abre antes de esperar la callable, así el navegador no la bloquea.
 */
export async function abrirPdfCallable<T extends { pdfBase64?: string | null; link?: string | null; nombre?: string }>(
  modo: 'ver' | 'descargar',
  pedir: () => Promise<T>,
): Promise<T> {
  const ventana = modo === 'ver' ? window.open('', '_blank') : null;
  try {
    const res = await pedir();
    const nombre = String(res.nombre || 'documento.pdf');
    if (res.pdfBase64) {
      const url = URL.createObjectURL(new Blob([bytesDeBase64(res.pdfBase64)], { type: 'application/pdf' }));
      if (modo === 'ver') {
        if (ventana) ventana.location.href = url; else window.open(url, '_blank');
      } else {
        const a = document.createElement('a');
        a.href = url; a.download = nombre; a.click();
      }
      return res;
    }
    if (res.link) {
      if (ventana) ventana.location.href = res.link; else window.open(res.link, '_blank');
      return res;
    }
    ventana?.close();
    throw new Error('El PDF no está disponible.');
  } catch (e) {
    ventana?.close();
    throw e;
  }
}

function BotonChico({ label, title, onClick, disabled, icon: Icon, tono = 'neutro' }: { label: string; title?: string; onClick: () => void; disabled?: boolean; icon: React.ElementType; tono?: 'neutro' | 'primario' }) {
  const clases = tono === 'primario' ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50';
  return (
    <button type="button" title={title || label} disabled={disabled} onClick={onClick} className={`inline-flex h-8 items-center gap-1 rounded-xl px-2.5 text-[11px] font-bold shadow-sm transition active:scale-95 disabled:opacity-50 ${clases}`}>
      <Icon size={12} /> {label}
    </button>
  );
}

type Props = {
  cuil: string;
  exigirMarco: boolean;
  contratos: ContratoVista[];
  arca: ArcaVista[];
  nombreEmpresa: (id: string) => string;
  puedeLeer: boolean;
  puedeEditar: boolean;
  llamar: (nombre: string, data: Record<string, unknown>) => Promise<Record<string, unknown>>;
  recargar: () => void;
};

/** Solapa Contratos de la ficha: un bloque por contrato con anexo (PDF), escala/bruto, jornadas y ARCA. */
export default function ContratosEventual({ cuil, exigirMarco, contratos, arca, nombreEmpresa, puedeLeer, puedeEditar, llamar, recargar }: Props) {
  const [ocupado, setOcupado] = useState('');

  const pdfAnexo = async (c: ContratoVista, modo: 'ver' | 'descargar') => {
    const clave = `${modo}:${c.id}`;
    setOcupado(clave);
    try {
      const res = await abrirPdfCallable(modo, () => llamar('gestionarMarcoEventual', { accion: 'anexoPdf', cuil, contratoId: c.id }) as Promise<{ pdfBase64?: string | null; link?: string | null; nombre?: string; firmado?: boolean }>);
      if (res.firmado === false) toast.message('Anexo sin firmar', { description: 'Es el borrador: el eventual todavía no aceptó el anexo.' });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo abrir el anexo.');
    } finally {
      setOcupado('');
    }
  };

  const reenviar = async (c: ContratoVista) => {
    setOcupado(`reenviar:${c.id}`);
    try {
      const res = await llamar('gestionarMarcoEventual', { accion: 'reenviarCodigoAnexo', cuil, contratoId: c.id });
      toast.success(String(res.mensaje || 'Código reenviado.'));
      recargar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo reenviar el código.');
    } finally {
      setOcupado('');
    }
  };

  if (!contratos.length) return <p className="text-xs text-slate-400">Sin contratos.</p>;

  return (
    <div className="space-y-2" data-contratos-eventual>
      {contratos.map((c) => {
        const anexo = estadoAnexoVista({ contrato: c, anexo: c.anexo || null, exigirMarco: c.anexoExigido ?? exigirMarco }) as EstadoAnexo;
        const escala = textoEscalaYBruto({ contrato: c, anexo: c.anexo || null }) as { escala: string; bruto: string; aviso: string };
        const envios = enviosDelContrato(arca, c.id) as EnvioVista[];
        return (
          <div key={c.id} data-contrato={c.id} data-anexo-estado={anexo.id} className="rounded-xl border border-slate-100 p-3 text-xs text-slate-600">
            <div className="flex flex-wrap items-center gap-2">
              <p className="flex-1 font-bold text-slate-800">
                {c.empresaId ? nombreEmpresa(c.empresaId) : 'Sin empresa'} · {textoEstadoContrato(c.estado)} · {textoPeriodoContrato(c)}
              </p>
              {puedeLeer && (
                <>
                  <BotonChico label="Ver anexo" title={anexo.firmado ? 'Abre el anexo firmado' : 'Abre el anexo marcado SIN FIRMAR'} icon={Eye} onClick={() => void pdfAnexo(c, 'ver')} disabled={ocupado === `ver:${c.id}`} />
                  <BotonChico label="Descargar" title="Descarga el PDF del anexo" icon={Download} onClick={() => void pdfAnexo(c, 'descargar')} disabled={ocupado === `descargar:${c.id}`} />
                </>
              )}
            </div>
            <ul className="mt-1 space-y-0.5" data-jornadas>
              {(c.jornadas || []).map((j, i) => <li key={i}>{textoJornada(j)}</li>)}
              {(c.jornadas || []).length === 0 && <li className="text-slate-400">Sin jornadas cargadas.</li>}
            </ul>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <FileSignature size={12} className="text-slate-400" />
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Anexo</span>
              <span data-anexo-texto className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${TONO[anexo.tono] || TONO.neutro}`}>{anexo.texto}</span>
              {anexo.reenviar && puedeEditar && (
                <BotonChico label="Reenviar código" title="Genera un código nuevo y lo manda por la app y el mail" icon={Send} tono="primario" onClick={() => void reenviar(c)} disabled={ocupado === `reenviar:${c.id}`} />
              )}
              {c.anexo?.link && <a href={c.anexo.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-700 underline"><ExternalLink size={11} /> Drive</a>}
            </div>
            <p className="mt-1" data-escala>
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Escala aplicada</span> {escala.escala}{escala.bruto ? ` · ${escala.bruto}` : ''}
              {escala.aviso && <span className="ml-1 font-bold text-amber-700">{escala.aviso}</span>}
            </p>
            <div className="mt-1 flex flex-wrap items-start gap-2" data-arca-contrato>
              <Landmark size={12} className="mt-0.5 text-slate-400" />
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">ARCA</span>
              {envios.length === 0 && <span className="text-slate-400">Sin envíos ARCA para este contrato.</span>}
              <ul className="flex flex-wrap gap-1.5">
                {envios.map((e) => (
                  <li key={e.id} data-envio={e.id} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-black ${TONO[e.tono] || TONO.neutro}`}>
                    {e.tipo} · {e.estado}{e.fecha ? ` · ${e.fecha}` : ''}
                    {e.constanciaUrl && <a href={e.constanciaUrl} target="_blank" rel="noreferrer" className="ml-1 underline" title="Constancia de ARCA">constancia</a>}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        );
      })}
    </div>
  );
}
