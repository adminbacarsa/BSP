import { useEffect, useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { functions } from '@/lib/firebase';

type Meta = {
  configurada?: boolean;
  cuitLogin?: string;
  cuitRepresentado?: string;
  cuitLoginEnmascarado?: string;
  cuitRepresentadoEnmascarado?: string;
  configuradoAt?: string;
  configuradoPor?: string;
  secretVersion?: string;
};

type OtraEmpresa = {
  empresaId: string;
  nombre: string;
  cuit: string;
  configurada: boolean;
  cuitLogin: string;
  cuitRepresentado: string;
};

type Respuesta = Meta & {
  empresa?: { empresaId: string; nombre: string; cuit: string };
  empresas?: OtraEmpresa[];
  extendidas?: string[];
};

type Modo = 'ver' | 'nueva' | 'cuits' | 'clave';

type Props = {
  empresaId: string;
  nombreEmpresa: string;
  cuitEmpresa: string;
  /** true mientras hay una clave escrita que todavía no se guardó. */
  onClavePendiente?: (pendiente: boolean) => void;
};

function soloDigitos(valor: string): string {
  return valor.replace(/\D/g, '').slice(0, 11);
}

function cuitValido(valor: string): boolean {
  return /^\d{11}$/.test(valor);
}

export function enmascarar(cuit?: string): string {
  const d = soloDigitos(cuit || '');
  return d ? `***${d.slice(-3)}` : '—';
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

function mensaje(err: unknown, porDefecto: string): string {
  return err instanceof Error && err.message ? err.message : porDefecto;
}

const INPUT = 'mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold normal-case tracking-normal text-slate-800';
const LABEL = 'block text-[10px] font-black uppercase tracking-wider text-slate-500';
const BTN_PRIMARIO = 'rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50';
const BTN_SECUNDARIO = 'rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50';

export default function ArcaClaveFiscalPanel({ empresaId, nombreEmpresa, cuitEmpresa, onClavePendiente }: Props) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [otras, setOtras] = useState<OtraEmpresa[]>([]);
  const [cargando, setCargando] = useState(true);
  const [modo, setModo] = useState<Modo>('ver');
  const [confirmarQuitar, setConfirmarQuitar] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [cuitLogin, setCuitLogin] = useState('');
  const [cuitRepresentado, setCuitRepresentado] = useState('');
  const [clave, setClave] = useState('');
  const [extender, setExtender] = useState<Record<string, { on: boolean; cuitRepresentado: string }>>({});

  const llamar = (data: Record<string, unknown>) =>
    httpsCallable<Record<string, unknown>, Respuesta>(functions, 'gestionarClaveFiscalArca')(data).then((r) => r.data || {});

  const aplicar = (data: Respuesta) => {
    setMeta(data);
    if (Array.isArray(data.empresas)) {
      setOtras(data.empresas);
      setExtender((prev) => {
        const next: Record<string, { on: boolean; cuitRepresentado: string }> = {};
        for (const e of data.empresas || []) {
          next[e.empresaId] = prev[e.empresaId] || { on: false, cuitRepresentado: soloDigitos(e.cuitRepresentado || e.cuit || '') };
        }
        return next;
      });
    }
    setCuitLogin(data.cuitLogin || '');
    setCuitRepresentado(data.cuitRepresentado || soloDigitos(cuitEmpresa));
    setModo(data.configurada ? 'ver' : 'nueva');
  };

  const cargar = async () => {
    if (!empresaId) return;
    setCargando(true);
    try {
      aplicar(await llamar({ accion: 'leer', empresaId }));
    } catch (err) {
      setMeta({ configurada: false });
      setModo('nueva');
      setCuitRepresentado(soloDigitos(cuitEmpresa));
      toast.error(mensaje(err, 'No se pudo leer el acceso a ARCA.'));
    } finally {
      setCargando(false);
      setClave('');
      setConfirmarQuitar(false);
    }
  };

  useEffect(() => {
    setExtender({});
    void cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId]);

  const clavePendiente = (modo === 'nueva' || modo === 'clave') && clave.length > 0;
  useEffect(() => {
    onClavePendiente?.(clavePendiente);
    return () => onClavePendiente?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clavePendiente]);

  const extendidasElegidas = useMemo(
    () => Object.entries(extender).filter(([, v]) => v.on).map(([id, v]) => ({ empresaId: id, cuitRepresentado: v.cuitRepresentado })),
    [extender],
  );
  const extenderValido = extendidasElegidas.every((x) => cuitValido(x.cuitRepresentado));
  const puedeGuardarNueva = cuitValido(cuitLogin) && cuitValido(cuitRepresentado) && clave.length >= 4 && extenderValido;
  const cuitsCambiaron = cuitLogin !== (meta?.cuitLogin || '') || cuitRepresentado !== (meta?.cuitRepresentado || '');
  const puedeGuardarCuits = cuitValido(cuitLogin) && cuitValido(cuitRepresentado) && cuitsCambiaron;
  const puedeGuardarClave = clave.length >= 4;
  const comparten = otras.filter((e) => e.configurada && meta?.cuitLogin && e.cuitLogin === meta.cuitLogin);

  const guardarNueva = async () => {
    if (!puedeGuardarNueva) return;
    setGuardando(true);
    try {
      const data = await llamar({ accion: 'guardar', empresaId, cuitLogin, cuitRepresentado, clave, extender: extendidasElegidas });
      aplicar(data);
      setClave('');
      setExtender((prev) => Object.fromEntries(Object.entries(prev).map(([id, v]) => [id, { ...v, on: false }])));
      const extra = data.extendidas?.length ? ` y ${data.extendidas.length} empresa${data.extendidas.length === 1 ? '' : 's'} más` : '';
      toast.success(`Credenciales guardadas para ${nombreEmpresa}${extra}.`);
    } catch (err) {
      toast.error(mensaje(err, 'No se pudieron guardar las credenciales.'));
    } finally {
      setGuardando(false);
    }
  };

  const guardarCuits = async () => {
    if (!puedeGuardarCuits) return;
    setGuardando(true);
    try {
      aplicar({ ...(await llamar({ accion: 'editarCuits', empresaId, cuitLogin, cuitRepresentado })), empresas: undefined });
      toast.success(`CUIT actualizados para ${nombreEmpresa}.`);
      void cargar();
    } catch (err) {
      toast.error(mensaje(err, 'No se pudieron actualizar los CUIT.'));
    } finally {
      setGuardando(false);
    }
  };

  const guardarClave = async () => {
    if (!puedeGuardarClave) return;
    setGuardando(true);
    try {
      const data = await llamar({ accion: 'reemplazarClave', empresaId, clave });
      aplicar({ ...data, empresas: undefined });
      setClave('');
      toast.success(`Clave reemplazada para ${nombreEmpresa}${comparten.length ? ` y ${comparten.map((e) => e.nombre).join(', ')}` : ''}.`);
    } catch (err) {
      toast.error(mensaje(err, 'No se pudo reemplazar la clave.'));
    } finally {
      setGuardando(false);
    }
  };

  const quitar = async () => {
    setGuardando(true);
    try {
      aplicar(await llamar({ accion: 'quitar', empresaId, confirmar: true }));
      setCuitLogin('');
      setCuitRepresentado(soloDigitos(cuitEmpresa));
      setClave('');
      setConfirmarQuitar(false);
      toast.success(`Se quitó la clave fiscal de ${nombreEmpresa}.`);
    } catch (err) {
      toast.error(mensaje(err, 'No se pudo quitar la clave.'));
    } finally {
      setGuardando(false);
    }
  };

  const cancelarEdicion = () => {
    setClave('');
    setCuitLogin(meta?.cuitLogin || '');
    setCuitRepresentado(meta?.cuitRepresentado || soloDigitos(cuitEmpresa));
    setModo(meta?.configurada ? 'ver' : 'nueva');
  };

  const campoCuitLogin = (
    <label className={LABEL}>
      CUIT con el que se entra a ARCA
      <input
        data-arca-cuit-login
        value={cuitLogin}
        onChange={(e) => setCuitLogin(soloDigitos(e.target.value))}
        inputMode="numeric"
        autoComplete="off"
        maxLength={11}
        placeholder="11 dígitos, la persona"
        className={INPUT}
      />
    </label>
  );
  const campoCuitRepresentado = (
    <label className={LABEL}>
      CUIT representado ({nombreEmpresa})
      <input
        data-arca-cuit-representado
        value={cuitRepresentado}
        onChange={(e) => setCuitRepresentado(soloDigitos(e.target.value))}
        inputMode="numeric"
        autoComplete="off"
        maxLength={11}
        placeholder="30…"
        className={INPUT}
      />
    </label>
  );
  const campoClave = (
    <label className={`${LABEL} sm:col-span-2`}>
      Clave fiscal
      <input
        data-arca-clave
        type="password"
        value={clave}
        onChange={(e) => setClave(e.target.value)}
        autoComplete="new-password"
        placeholder="No se vuelve a mostrar"
        className={INPUT}
      />
    </label>
  );

  return (
    <section className="mt-5 rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4 shadow-sm" data-arca-clave-fiscal data-arca-clave-modo={modo}>
      <h3 className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wider text-indigo-700">
        <KeyRound size={14} /> Acceso a ARCA del robot — {nombreEmpresa}
      </h3>
      <p className="mt-1 text-xs text-slate-500">
        Solo SuperAdmin. La clave queda en Secret Manager y se guarda con su propio botón; el botón «Guardar» de abajo no la toca.
      </p>

      {cargando && <p className="mt-3 text-xs text-slate-400">Cargando acceso…</p>}

      {!cargando && modo === 'ver' && meta?.configurada && (
        <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <p className="text-sm font-semibold text-slate-800" data-arca-clave-estado>
            Configurada el {cuando(meta.configuradoAt)} por {meta.configuradoPor || '—'} · CUIT login {meta.cuitLoginEnmascarado || enmascarar(meta.cuitLogin)} · representa {meta.cuitRepresentadoEnmascarado || enmascarar(meta.cuitRepresentado)}
          </p>
          {comparten.length > 0 && (
            <p className="mt-1 text-xs text-slate-500">Misma clave en: {comparten.map((e) => e.nombre).join(', ')}.</p>
          )}
          {confirmarQuitar ? (
            <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3">
              <p className="text-sm font-semibold text-rose-800">¿Quitar la clave fiscal de {nombreEmpresa}? El robot no va a poder entrar a ARCA por esta empresa.</p>
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={() => setConfirmarQuitar(false)} className="rounded-xl px-3 py-2 text-sm text-slate-600">Volver</button>
                <button type="button" disabled={guardando} onClick={() => void quitar()} className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Quitar</button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => { setModo('cuits'); setClave(''); }} className={BTN_SECUNDARIO}>Editar CUIT</button>
              <button type="button" onClick={() => { setModo('clave'); setClave(''); }} className={BTN_SECUNDARIO}>Reemplazar clave</button>
              <button type="button" onClick={() => setConfirmarQuitar(true)} className="rounded-xl px-3 py-2 text-sm font-bold text-rose-700 hover:bg-rose-50">Quitar</button>
            </div>
          )}
        </div>
      )}

      {!cargando && modo === 'nueva' && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {campoCuitLogin}
          {campoCuitRepresentado}
          {campoClave}
          {otras.length > 0 && (
            <fieldset className="sm:col-span-2 rounded-xl border border-slate-200 bg-white p-3" data-arca-extender>
              <legend className="px-1 text-[10px] font-black uppercase tracking-wider text-slate-500">Usar estas credenciales también en:</legend>
              <div className="space-y-2">
                {otras.map((e) => {
                  const fila = extender[e.empresaId] || { on: false, cuitRepresentado: soloDigitos(e.cuit) };
                  return (
                    <div key={e.empresaId} className="flex flex-wrap items-center gap-2">
                      <label className="flex min-w-[12rem] items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          data-arca-extender-empresa={e.empresaId}
                          checked={fila.on}
                          onChange={(ev) => setExtender({ ...extender, [e.empresaId]: { ...fila, on: ev.target.checked } })}
                        />
                        <span className="font-semibold">{e.nombre}</span>
                        {e.configurada && <span className="text-[10px] font-bold uppercase text-amber-700">ya configurada, se reemplaza</span>}
                      </label>
                      {fila.on && (
                        <input
                          value={fila.cuitRepresentado}
                          onChange={(ev) => setExtender({ ...extender, [e.empresaId]: { ...fila, cuitRepresentado: soloDigitos(ev.target.value) } })}
                          inputMode="numeric"
                          maxLength={11}
                          placeholder="CUIT representado"
                          className="w-44 rounded-xl border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-800"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </fieldset>
          )}
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <button type="button" data-arca-guardar-credenciales disabled={guardando || !puedeGuardarNueva} onClick={() => void guardarNueva()} className={BTN_PRIMARIO}>
              {guardando ? 'Guardando…' : 'Guardar credenciales'}
            </button>
            {meta?.configurada && (
              <button type="button" onClick={cancelarEdicion} className="rounded-xl px-3 py-2 text-sm text-slate-500">Cancelar</button>
            )}
            {!puedeGuardarNueva && !guardando && (
              <span className="text-xs text-slate-500">Completá los dos CUIT (11 dígitos) y la clave para habilitar el botón.</span>
            )}
          </div>
        </div>
      )}

      {!cargando && modo === 'cuits' && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {campoCuitLogin}
          {campoCuitRepresentado}
          <p className="text-xs text-slate-500 sm:col-span-2">Si cambia el CUIT de ingreso, la clave guardada pasa al nuevo CUIT sin volver a escribirla.</p>
          <div className="flex gap-2 sm:col-span-2">
            <button type="button" data-arca-guardar-cuits disabled={guardando || !puedeGuardarCuits} onClick={() => void guardarCuits()} className={BTN_PRIMARIO}>
              {guardando ? 'Guardando…' : 'Guardar CUIT'}
            </button>
            <button type="button" onClick={cancelarEdicion} className="rounded-xl px-3 py-2 text-sm text-slate-500">Cancelar</button>
          </div>
        </div>
      )}

      {!cargando && modo === 'clave' && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {campoClave}
          {comparten.length > 0 && (
            <p className="text-xs text-slate-500 sm:col-span-2">La clave nueva también vale para {comparten.map((e) => e.nombre).join(', ')} (mismo CUIT de ingreso).</p>
          )}
          <div className="flex gap-2 sm:col-span-2">
            <button type="button" data-arca-guardar-clave disabled={guardando || !puedeGuardarClave} onClick={() => void guardarClave()} className={BTN_PRIMARIO}>
              {guardando ? 'Guardando…' : 'Guardar clave nueva'}
            </button>
            <button type="button" onClick={cancelarEdicion} className="rounded-xl px-3 py-2 text-sm text-slate-500">Cancelar</button>
          </div>
        </div>
      )}
    </section>
  );
}