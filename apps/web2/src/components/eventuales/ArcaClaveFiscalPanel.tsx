import { useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { functions } from '@/lib/firebase';

type Meta = {
  configurada?: boolean;
  cuitLogin?: string;
  cuitRepresentado?: string;
  configuradoAt?: string;
  configuradoPor?: string;
};

function soloDigitos(valor: string): string {
  return valor.replace(/\D/g, '').slice(0, 11);
}

function cuando(iso?: string): string {
  if (!iso) return '';
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return '';
  const partes = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(fecha);
  const tomar = (tipo: string) => partes.find((p) => p.type === tipo)?.value || '';
  return `${tomar('day')}/${tomar('month')} ${tomar('hour')}:${tomar('minute')}`;
}

function mensaje(err: unknown): string {
  return err instanceof Error ? err.message : 'No se pudo guardar la clave fiscal.';
}

export default function ArcaClaveFiscalPanel({ empresaId, cuitEmpresa }: { empresaId: string; cuitEmpresa: string }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [editando, setEditando] = useState(false);
  const [confirmarQuitar, setConfirmarQuitar] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [cuitLogin, setCuitLogin] = useState('');
  const [cuitRepresentado, setCuitRepresentado] = useState('');
  const [clave, setClave] = useState('');

  const cargar = async () => {
    if (!empresaId) return;
    setCargando(true);
    try {
      const res = await httpsCallable(functions, 'gestionarClaveFiscalArca')({ accion: 'leer', empresaId });
      const data = (res.data || {}) as Meta;
      setMeta(data);
      setEditando(!data.configurada);
      setCuitLogin(data.cuitLogin || '');
      setCuitRepresentado(data.cuitRepresentado || soloDigitos(cuitEmpresa));
    } catch (err) {
      setMeta({ configurada: false });
      setEditando(true);
      toast.error(mensaje(err));
    } finally {
      setCargando(false);
      setClave('');
    }
  };

  useEffect(() => {
    setCuitRepresentado(soloDigitos(cuitEmpresa));
    void cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId, cuitEmpresa]);

  const guardar = async () => {
    setGuardando(true);
    try {
      const res = await httpsCallable(functions, 'gestionarClaveFiscalArca')({
        accion: 'guardar',
        empresaId,
        cuitLogin,
        cuitRepresentado,
        clave,
      });
      setMeta((res.data || {}) as Meta);
      setEditando(false);
      setClave('');
      setConfirmarQuitar(false);
      toast.success('Clave fiscal guardada.');
    } catch (err) {
      toast.error(mensaje(err));
    } finally {
      setGuardando(false);
    }
  };

  const quitar = async () => {
    setGuardando(true);
    try {
      await httpsCallable(functions, 'gestionarClaveFiscalArca')({ accion: 'quitar', empresaId, confirmar: true });
      setMeta({ configurada: false });
      setEditando(true);
      setCuitLogin('');
      setCuitRepresentado(soloDigitos(cuitEmpresa));
      setClave('');
      setConfirmarQuitar(false);
      toast.success('Se quitó la clave fiscal.');
    } catch (err) {
      toast.error(mensaje(err));
    } finally {
      setGuardando(false);
    }
  };

  const configurada = !!meta?.configurada && !editando;

  return (
    <section className="mt-5 border-t border-slate-100 pt-4" data-arca-clave-fiscal>
      <h3 className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wider text-slate-400">
        <KeyRound size={14} /> Acceso a ARCA del robot
      </h3>
      <p className="mt-1 text-xs text-slate-500">
        Solo SuperAdmin. La clave fiscal queda en Secret Manager. Esta pantalla no la vuelve a mostrar.
      </p>
      {cargando && <p className="mt-3 text-xs text-slate-400">Cargando acceso…</p>}
      {!cargando && configurada && (
        <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 shadow-sm">
          <p className="text-sm font-semibold text-slate-800" data-arca-clave-estado>
            Configurada el {cuando(meta?.configuradoAt)} por {meta?.configuradoPor || '—'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Entra con {meta?.cuitLogin} y representa a {meta?.cuitRepresentado}.
          </p>
          {confirmarQuitar ? (
            <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3">
              <p className="text-sm font-semibold text-rose-800">¿Quitar la clave fiscal? El robot no va a poder entrar a ARCA.</p>
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={() => setConfirmarQuitar(false)} className="rounded-xl px-3 py-2 text-sm text-slate-600">Volver</button>
                <button type="button" disabled={guardando} onClick={() => void quitar()} className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Quitar</button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => { setEditando(true); setClave(''); }} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50">Reemplazar</button>
              <button type="button" onClick={() => setConfirmarQuitar(true)} className="rounded-xl px-3 py-2 text-sm font-bold text-rose-700">Quitar</button>
            </div>
          )}
        </div>
      )}
      {!cargando && !configurada && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500">
            CUIT con el que se entra
            <input
              data-arca-cuit-login
              value={cuitLogin}
              onChange={(e) => setCuitLogin(soloDigitos(e.target.value))}
              inputMode="numeric"
              autoComplete="off"
              maxLength={11}
              placeholder="11 dígitos, persona"
              className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold normal-case tracking-normal text-slate-800"
            />
          </label>
          <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500">
            CUIT representado
            <input
              data-arca-cuit-representado
              value={cuitRepresentado}
              onChange={(e) => setCuitRepresentado(soloDigitos(e.target.value))}
              inputMode="numeric"
              autoComplete="off"
              maxLength={11}
              placeholder="30…"
              className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold normal-case tracking-normal text-slate-800"
            />
          </label>
          <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 sm:col-span-2">
            Clave fiscal
            <input
              data-arca-clave
              type="password"
              value={clave}
              onChange={(e) => setClave(e.target.value)}
              autoComplete="new-password"
              className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold normal-case tracking-normal text-slate-800"
            />
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <button type="button" disabled={guardando} onClick={() => void guardar()} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50">
              {guardando ? 'Guardando…' : 'Guardar clave'}
            </button>
            {meta?.configurada && (
              <button type="button" onClick={() => { setEditando(false); setClave(''); }} className="rounded-xl px-3 py-2 text-sm text-slate-500">Cancelar</button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}