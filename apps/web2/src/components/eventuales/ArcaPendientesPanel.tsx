import { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { Landmark } from 'lucide-react';
import { toast } from 'sonner';
import { functions } from '@/lib/firebase';
import { cuentaRegresivaAnulacion, PASOS_ANULACION_MANUAL, textoEstadoAnulacion } from '@/lib/eventuales/plazoAnulacion.mjs';

type Envio = {
  id: string;
  nombre: string;
  cuil: string;
  tipo: string;
  estado: string;
  fecha: string;
  nroTransaccion: string;
  constanciaUrl?: string;
  codigoControl?: string;
  nroVerificador?: string;
  fechaInicioArca: string;
  nroTransaccionAlta: string;
  venceAnulacionMs: number;
  pasos: string[];
  observacionesInternas: string;
  revista: string;
  acuseAnulacion?: string;
  manualMotivo?: string;
};

function etiqueta(tipo: string): string {
  if (tipo === 'AT') return 'Alta';
  if (tipo === 'ANULACION') return 'Anulación';
  if (tipo === 'BAJA_NO_PRESENTACION' || tipo === 'BT') return 'Baja';
  return tipo || 'Envío';
}

export default function ArcaPendientesPanel(props: { empresaId: string; empresaNombre: string; puedeConfirmar: boolean }) {
  const [envios, setEnvios] = useState<Envio[]>([]);
  const [elegido, setElegido] = useState('');
  const [nro, setNro] = useState('');
  const [acuse, setAcuse] = useState('');
  const [ahora, setAhora] = useState(() => Date.now());
  const [cargando, setCargando] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const cargar = useCallback(() => {
    if (!props.empresaId) return;
    setCargando(true);
    const fn = httpsCallable(functions, 'gestionarEventual');
    void fn({ accion: 'arcaPendientes', empresaId: props.empresaId }).then((res) => {
      const data = res.data as { envios?: Partial<Envio>[] };
      setEnvios((data.envios || []).map((row) => ({
        id: String(row.id || ''),
        nombre: String(row.nombre || ''),
        cuil: String(row.cuil || '').replace(/\D/g, ''),
        tipo: String(row.tipo || ''),
        estado: String(row.estado || ''),
        fecha: String(row.fecha || ''),
        nroTransaccion: String(row.nroTransaccion || ''),
        constanciaUrl: String((row as { constanciaUrl?: string }).constanciaUrl || ''),
        codigoControl: String((row as { codigoControl?: string }).codigoControl || ''),
        nroVerificador: String((row as { nroVerificador?: string }).nroVerificador || ''),
        fechaInicioArca: String(row.fechaInicioArca || ''),
        nroTransaccionAlta: String(row.nroTransaccionAlta || ''),
        venceAnulacionMs: Number(row.venceAnulacionMs) || 0,
        pasos: Array.isArray(row.pasos) ? row.pasos.map(String) : [],
        observacionesInternas: String(row.observacionesInternas || ''),
        revista: String(row.revista || ''),
      })));
    }).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'No se pudieron leer los envíos ARCA.');
    }).finally(() => setCargando(false));
  }, [props.empresaId]);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => {
    const timer = window.setInterval(() => setAhora(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const envio = envios.find((row) => row.id === elegido) || null;
  const plazo = envio?.tipo === 'ANULACION' ? cuentaRegresivaAnulacion(envio.venceAnulacionMs, ahora) : null;
  const pasos = envio?.pasos?.length ? envio.pasos : PASOS_ANULACION_MANUAL;

  const confirmar = () => {
    if (!envio || !nro.trim() || !props.puedeConfirmar) return;
    setEnviando(true);
    const fn = httpsCallable(functions, 'gestionarEventual');
    void fn({ accion: 'arcaConfirmar', envioId: envio.id, nroTransaccion: nro.trim() }).then(() => {
      toast.success('Confirmado en ARCA.');
      setNro('');
      setElegido('');
      cargar();
    }).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'No se pudo confirmar.');
    }).finally(() => setEnviando(false));
  };

  const registrarAcuse = () => {
    if (!envio || acuse.trim().length < 3 || !props.puedeConfirmar) return;
    setEnviando(true);
    const fn = httpsCallable(functions, 'gestionarEventual');
    void fn({ accion: 'arcaAcuseAnulacion', envioId: envio.id, acuse: acuse.trim() }).then(() => {
      toast.success('Anulación registrada. El envío quedó ANULADO.');
      setAcuse('');
      setElegido('');
      cargar();
    }).catch((error: unknown) => {
      const msg = error instanceof Error ? error.message : 'No se pudo registrar el acuse.';
      toast.error(msg.includes('PLAZO_VENCIDO') ? 'El plazo venció: el envío pasa a baja código 30.' : msg);
      if (msg.includes('PLAZO_VENCIDO')) cargar();
    }).finally(() => setEnviando(false));
  };

  return (
    <section data-arca-pendientes="escritorio" className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-black text-slate-800"><Landmark size={16} /> ARCA pendientes · {props.empresaNombre}</h2>
          <button type="button" onClick={cargar} className="text-xs font-bold text-indigo-700">{cargando ? 'Actualizando…' : 'Actualizar'}</button>
        </div>
        <ul className="max-h-[28rem] space-y-2 overflow-auto">
          {envios.map((row) => (
            <li key={row.id}>
              <button type="button" onClick={() => { setElegido(row.id); setNro(''); setAcuse(''); }} data-arca={row.id} className={`w-full rounded-xl border px-3 py-2 text-left ${elegido === row.id ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
                <span className="block truncate text-sm font-bold text-slate-800">{row.nombre}</span>
                <span className="mt-0.5 block text-[11px] font-semibold tabular-nums text-slate-500">{etiqueta(row.tipo)} {row.tipo} · {row.estado}{row.fecha ? ` · ${row.fecha}` : ''}</span>
              </button>
            </li>
          ))}
          {envios.length === 0 && !cargando && <li className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">Sin altas, bajas ni anulaciones pendientes.</li>}
        </ul>
      </div>
      <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
        {!envio && <p className="text-sm text-slate-500">Elegí un envío.</p>}
        {envio && envio.tipo === 'ANULACION' && (
          <div data-anulacion-estado={envio.estado} className="space-y-3">
            <h3 className="text-sm font-black text-slate-800" data-anula-estado="1">{textoEstadoAnulacion(envio)} · {envio.nombre}</h3>
            {envio.estado === 'MANUAL' && <p className="text-xs text-slate-500">Simplificación Registral → Relaciones Laborales → Anular Registro.</p>}
            {envio.estado !== 'MANUAL' && envio.estado !== 'ANULADO' && <p className="text-xs text-slate-500">El robot la está cargando en ARCA.</p>}
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-xl bg-white px-3 py-2"><dt className="text-[10px] font-bold uppercase text-slate-400">CUIL</dt><dd className="font-bold tabular-nums" data-anula-cuil="1">{envio.cuil || '—'}</dd></div>
              <div className="rounded-xl bg-white px-3 py-2"><dt className="text-[10px] font-bold uppercase text-slate-400">Fecha de inicio</dt><dd className="font-bold tabular-nums" data-anula-fecha="1">{envio.fechaInicioArca || '—'}</dd></div>
              <div className="col-span-2 rounded-xl bg-white px-3 py-2"><dt className="text-[10px] font-bold uppercase text-slate-400">Transacción del alta</dt><dd className="font-bold tabular-nums" data-anula-nro="1">{envio.nroTransaccionAlta || '—'}</dd></div>
              {(envio.codigoControl || envio.nroVerificador || envio.constanciaUrl) && (
                <div className="col-span-2 rounded-xl bg-white px-3 py-2 text-xs">
                  {envio.nroVerificador ? <p>Nro. verificador: <span className="font-bold tabular-nums">{envio.nroVerificador}</span></p> : null}
                  {envio.codigoControl ? <p>Código de control: <span className="font-bold">{envio.codigoControl}</span></p> : null}
                  {envio.constanciaUrl ? <a className="font-bold text-indigo-600 underline" href={envio.constanciaUrl} target="_blank" rel="noreferrer">Ver constancia SETI</a> : null}
                </div>
              )}
            </dl>
            {envio.estado !== 'ANULADO' && <p data-anula-plazo={plazo?.vencido ? 'vencido' : 'abierto'} className={`text-sm font-bold ${plazo?.vencido ? 'text-rose-700' : 'text-slate-700'}`}>Plazo RG 2988 · {plazo?.texto}</p>}
            {envio.estado === 'MANUAL' && (
              <div data-anulacion-manual="1" className="space-y-3">
                <ol className="list-decimal space-y-1 pl-4 text-xs font-medium text-slate-600">{pasos.map((paso) => <li key={paso}>{paso}</li>)}</ol>
                <input value={acuse} onChange={(e) => setAcuse(e.target.value)} placeholder="Acuse de anulación" disabled={plazo?.vencido === true || !props.puedeConfirmar} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-100" />
                <button type="button" onClick={registrarAcuse} disabled={plazo?.vencido === true || acuse.trim().length < 3 || enviando || !props.puedeConfirmar} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">
                  {plazo?.vencido ? 'Plazo vencido' : enviando ? 'Guardando…' : 'Registrar acuse'}
                </button>
              </div>
            )}
          </div>
        )}
        {envio && envio.tipo !== 'ANULACION' && (
          <div className="space-y-3">
            <h3 className="text-sm font-black text-slate-800">{etiqueta(envio.tipo)} {envio.tipo} · {envio.nombre}</h3>
            {envio.observacionesInternas && <p className="text-xs font-semibold text-slate-600">{envio.observacionesInternas}{envio.revista ? ` · motivo ${envio.revista}` : ''}</p>}
            <p className="text-xs text-slate-500">Cargá el número de transacción que devolvió ARCA.</p>
            <input value={nro} onChange={(e) => setNro(e.target.value)} placeholder="Número de transacción" disabled={!props.puedeConfirmar} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" />
            <button type="button" onClick={confirmar} disabled={!nro.trim() || enviando || !props.puedeConfirmar} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">Confirmar en ARCA</button>
          </div>
        )}
      </div>
    </section>
  );
}
