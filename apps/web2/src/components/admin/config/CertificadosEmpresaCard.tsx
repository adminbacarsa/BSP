import { useEffect, useState } from 'react';
import { FileCheck, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useEmpresa } from '@/context/EmpresaContext';
import { guardarEmpresa } from '@/lib/multiempresa';

type Metricas = { aprobadas?: number; rechazadas?: number };

/** Carpeta de legajos y modo de la lectura del certificado. Una por empresa. */
export default function CertificadosEmpresaCard() {
  const { empresa } = useEmpresa();
  const [carpeta, setCarpeta] = useState('');
  const [guardando, setGuardando] = useState(false);
  const modo = String((empresa as { certificadoIaModo?: string } | null)?.certificadoIaModo || 'PROPUESTA');
  const metricas = ((empresa as { certificadoIaMetricas?: Metricas } | null)?.certificadoIaMetricas) || {};
  const aprobadas = Number(metricas.aprobadas || 0);
  const rechazadas = Number(metricas.rechazadas || 0);

  useEffect(() => {
    setCarpeta(String((empresa as { legajosDriveFolderId?: string } | null)?.legajosDriveFolderId || ''));
  }, [empresa?.id, (empresa as { legajosDriveFolderId?: string } | null)?.legajosDriveFolderId]);

  if (!empresa) return null;

  const guardar = async (patch: Record<string, unknown>) => {
    setGuardando(true);
    try {
      await guardarEmpresa(empresa.id, patch as never);
      toast.success('Certificados guardados');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo guardar');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-indigo-500/15 flex items-center justify-center shrink-0">
          <FileCheck size={18} className="text-indigo-600" />
        </div>
        <div>
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-wide">Certificados</h3>
          <p className="text-xs text-slate-500 font-medium mt-1 leading-relaxed">
            Cada certificado va a la carpeta de la persona (la misma si es eventual y legajo), en Certificados / año.
            Sin carpeta queda en Storage hasta configurarla.
          </p>
        </div>
      </div>
      <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Carpeta raíz de legajos</label>
      <div className="flex gap-2">
        <input
          value={carpeta}
          onChange={(e) => setCarpeta(e.target.value)}
          placeholder="Id de la carpeta de Drive"
          className="flex-1 px-3 py-2 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
        <button
          type="button"
          disabled={guardando}
          onClick={() => { void guardar({ legajosDriveFolderId: carpeta.trim() }); }}
          className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-black disabled:opacity-60"
        >
          {guardando ? <Loader2 size={14} className="animate-spin" /> : 'Guardar'}
        </button>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black text-slate-700">Lectura con IA</p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {modo === 'AUTOMATICO' ? 'Justifica sola si todo coincide. Con dudas no toca nada.' : 'Deja la propuesta y RRHH aprueba o rechaza.'}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">{aprobadas} aprobadas · {rechazadas} rechazadas</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={modo === 'AUTOMATICO'}
          aria-label="Modo automático de certificados"
          disabled={guardando}
          onClick={() => { void guardar({ certificadoIaModo: modo === 'AUTOMATICO' ? 'PROPUESTA' : 'AUTOMATICO' }); }}
          className={`relative h-8 w-14 rounded-full shrink-0 transition-colors disabled:opacity-60 ${modo === 'AUTOMATICO' ? 'bg-emerald-600' : 'bg-slate-300'}`}
        >
          <span className={`absolute top-1 left-1 h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${modo === 'AUTOMATICO' ? 'translate-x-6' : ''}`} />
        </button>
      </div>
    </div>
  );
}
