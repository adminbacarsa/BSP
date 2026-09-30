import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { AlertTriangle, BadgeCheck, Download, Loader2, Upload } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_ARCA_ENVIOS_API || '';

interface EnvioPublico {
  empresaNombre: string;
  tipo: 'AT' | 'BT';
  cantidadRegistros: number;
  fechaAlta: string | null;
  fechaBaja: string | null;
  estado: string;
  advertencias: string[];
}

const TIPO_LABEL: Record<string, string> = { AT: 'Alta', BT: 'Baja' };

const fmt = (iso: string | null) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

const ERRORES: Record<string, string> = {
  TOKEN_INVALIDO: 'Este link no es válido.',
  TOKEN_VENCIDO: 'El link venció. Pedí uno nuevo a Sistemas.',
  TOKEN_USADO: 'Este link ya se usó.',
  YA_CONFIRMADO: 'Este envío ya está confirmado.',
  NO_EXISTE: 'No encontramos el envío.',
  RATE_LIMIT: 'Demasiados intentos. Esperá un minuto.',
};

export default function ArcaEnvioPublico() {
  const router = useRouter();
  const token = typeof router.query.token === 'string' ? router.query.token : '';

  const [envio, setEnvio] = useState<EnvioPublico | null>(null);
  const [txt, setTxt] = useState('');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [nro, setNro] = useState('');
  const [constanciaUrl, setConstanciaUrl] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState(false);

  useEffect(() => {
    if (!router.isReady) return;
    if (!token) {
      setError('TOKEN_INVALIDO');
      setCargando(false);
      return;
    }
    fetch(`${API}?action=link&token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data?.error || 'NO_EXISTE');
        setEnvio(data.envio);
        setTxt(data.txt || '');
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setCargando(false));
  }, [router.isReady, token]);

  const descargar = useCallback(() => {
    const blob = new Blob([txt.endsWith('\n') ? txt : `${txt}\n`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `arca_${envio?.tipo || 'AT'}_${token.slice(0, 8)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [txt, envio?.tipo, token]);

  const confirmar = useCallback(async () => {
    if (!nro.trim()) return;
    setEnviando(true);
    setError('');
    try {
      const r = await fetch(`${API}?action=link-resultado&token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nroTransaccion: nro.trim(), constanciaUrl: constanciaUrl.trim() || undefined }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || 'ERROR_INTERNO');
      setListo(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }, [nro, constanciaUrl, token]);

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-10 flex justify-center">
      <div className="w-full max-w-md">
        {cargando && (
          <div className="rounded-3xl bg-white shadow-lg p-8 flex flex-col items-center gap-3">
            <Loader2 className="animate-spin text-indigo-500" size={28} />
            <p className="text-sm font-semibold text-slate-500">Abriendo el envío…</p>
          </div>
        )}

        {!cargando && (error || !envio) && !listo && (
          <div className="rounded-3xl bg-white shadow-lg p-8 flex flex-col items-center gap-3 text-center">
            <div className="w-14 h-14 rounded-2xl bg-amber-50 flex items-center justify-center">
              <AlertTriangle className="text-amber-500" size={26} />
            </div>
            <p className="font-bold text-slate-800">{ERRORES[error] || 'No pudimos abrir el envío.'}</p>
          </div>
        )}

        {!cargando && envio && listo && (
          <div className="rounded-3xl bg-white shadow-lg p-8 flex flex-col items-center gap-3 text-center">
            <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center">
              <BadgeCheck className="text-emerald-500" size={26} />
            </div>
            <p className="font-bold text-slate-800">Cargado, gracias.</p>
            <p className="text-sm text-slate-500">Sistemas ya ve la confirmación. Podés cerrar la página.</p>
          </div>
        )}

        {!cargando && envio && !listo && (
          <div className="rounded-3xl bg-white shadow-lg overflow-hidden">
            <div className="px-6 py-5 bg-slate-900">
              <p className="text-[11px] uppercase tracking-widest text-slate-400 font-bold">Carga masiva ARCA</p>
              <p className="text-white font-black text-lg mt-1">{envio.empresaNombre}</p>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-[11px] uppercase tracking-wide text-slate-400 font-bold">Movimiento</p>
                  <p className="font-bold text-slate-800">{TIPO_LABEL[envio.tipo] || envio.tipo}</p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-[11px] uppercase tracking-wide text-slate-400 font-bold">Registros</p>
                  <p className="font-bold text-slate-800">{envio.cantidadRegistros}</p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-[11px] uppercase tracking-wide text-slate-400 font-bold">Desde</p>
                  <p className="font-bold text-slate-800">{fmt(envio.fechaAlta)}</p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-[11px] uppercase tracking-wide text-slate-400 font-bold">Hasta</p>
                  <p className="font-bold text-slate-800">{fmt(envio.fechaBaja)}</p>
                </div>
              </div>

              <button
                type="button"
                onClick={descargar}
                className="w-full rounded-2xl bg-indigo-600 text-white font-bold py-3 flex items-center justify-center gap-2 hover:bg-indigo-700 active:scale-95 transition"
              >
                <Download size={18} /> Descargar el TXT
              </button>

              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wide text-slate-500" htmlFor="nro">
                  Nro. de transacción
                </label>
                <input
                  id="nro"
                  value={nro}
                  onChange={(e) => setNro(e.target.value)}
                  placeholder="El que devuelve ARCA al enviar"
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm focus:border-indigo-400 focus:outline-none"
                />
                <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 pt-2" htmlFor="constancia">
                  Constancia (opcional)
                </label>
                <input
                  id="constancia"
                  value={constanciaUrl}
                  onChange={(e) => setConstanciaUrl(e.target.value)}
                  placeholder="Link de la foto o el PDF"
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm focus:border-indigo-400 focus:outline-none"
                />
              </div>

              {error && <p className="text-sm font-semibold text-rose-600">{ERRORES[error] || 'No se pudo guardar.'}</p>}

              <button
                type="button"
                onClick={confirmar}
                disabled={!nro.trim() || enviando}
                className="w-full rounded-2xl bg-emerald-600 text-white font-bold py-3 flex items-center justify-center gap-2 hover:bg-emerald-700 active:scale-95 transition disabled:opacity-40"
              >
                {enviando ? <Loader2 className="animate-spin" size={18} /> : <Upload size={18} />} Confirmar el envío
              </button>
              <p className="text-[11px] text-slate-400 text-center">
                Este link es de un solo uso y vence a las 48 h.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
