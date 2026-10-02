import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { toast } from 'sonner';
import { EventualesScreens, type ArcaMovil, type EventualMovil, type EventualesPanel } from '@/components/movil/EventualesScreens';
import { EscalaMovilPanel } from '@/components/movil/EscalaMovilPanel';
import { MovilBottomNav } from '@/components/movil/MovilBottomNav';
import { useEmpresaSheet } from '@/components/movil/useEmpresaSheet';
import { useOnlineFlag } from '@/components/movil/OperacionScreens';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';
import { db, functions } from '@/lib/firebase';
import { normalizeCuil } from '@/lib/eventuales/cuil.mjs';
import { filtrarFichas, fmtFechaAr } from '@/lib/eventuales/fichaUx.mjs';
import { marcoDeBolsa } from '@/lib/eventuales/marcoTexto.mjs';
import { GRUPO_EVENTUALES_ID } from '@/lib/eventuales/grupo.mjs';
import { movilCallableGate, runCallableOnline } from '@/lib/movil/callableOnline';
import { movilWriteQueue } from '@/lib/movil/writeQueue';

const CACHE = 'cosp-movil-eventuales';
const MARCO: Record<string, string> = {
  MARCO_VIGENTE: 'Marco vigente',
  VENCIDO: 'Marco vencido',
  SIN_MARCO: 'Sin marco',
};

type Ficha = {
  id: string;
  cuil: string;
  dni: string;
  nombre: string;
  mail: string;
  telefono: string;
  legajoPlanilla: string;
  primerIngreso: string;
  disponibilidad: string;
  empresasHabilitadas: string[];
  marcos: Record<string, { firmado?: boolean; fechaFirma?: string; vigenciaDias?: number }>;
  /** Switches de pruebas (ausente = true). */
  exigirMarco: boolean;
  exigirAltaArca: boolean;
};

type EnvioArcaServidor = {
  id: string;
  nombre?: string;
  cuil?: string;
  tipo?: string;
  estado?: string;
  fecha?: string;
  nroTransaccion?: string;
  fechaInicioArca?: string;
  nroTransaccionAlta?: string;
  venceAnulacionMs?: number;
  pasos?: string[];
  observacionesInternas?: string;
  revista?: string;
};

function hoy(): string {
  const date = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function formatoCuil(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 11) return raw;
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
}

function envioAMovil(row: EnvioArcaServidor): ArcaMovil {
  return {
    id: row.id,
    nombre: String(row.nombre || ''),
    cuil: formatoCuil(String(row.cuil || '')),
    tipo: String(row.tipo || ''),
    estado: String(row.estado || ''),
    fecha: fmtFechaAr(String(row.fecha || '')),
    nroTransaccion: String(row.nroTransaccion || ''),
    cuil11: String(row.cuil || '').replace(/\D/g, ''),
    fechaInicioArca: String(row.fechaInicioArca || ''),
    nroTransaccionAlta: String(row.nroTransaccionAlta || ''),
    venceAnulacionMs: Number(row.venceAnulacionMs) || 0,
    pasos: row.pasos,
    observacionesInternas: String(row.observacionesInternas || ''),
    revista: String(row.revista || ''),
  };
}

export function EventualesMovil() {
  const { isSuperAdmin, canReadModule, rolePermissions } = useAuth();
  const { empresaId, empresa } = useEmpresa();
  const online = useOnlineFlag();
  const empresaSheet = useEmpresaSheet();
  const permitido = isSuperAdmin || canReadModule('EVENTUALES') || canReadModule('RRHH');
  const router = useRouter();
  const panelQuery = String(router.query.panel || '');
  const panel: EventualesPanel = panelQuery === 'arca' || panelQuery === 'alta' || panelQuery === 'escala' ? panelQuery : 'bolsa';
  const cerrarAlta = () => { void router.push('/admin/rrhh/eventuales/'); };
  const [fichas, setFichas] = useState<Ficha[]>([]);
  const [buscar, setBuscar] = useState('');
  const [elegidaId, setElegidaId] = useState('');
  const [cuil, setCuil] = useState('');
  const [nombre, setNombre] = useState('');
  const [mail, setMail] = useState('');
  const [telefono, setTelefono] = useState('');
  const [arca, setArca] = useState<ArcaMovil[]>([]);
  const [arcaCargando, setArcaCargando] = useState(false);
  const [arcaEnviando, setArcaEnviando] = useState(false);
  const [arcaId, setArcaId] = useState('');
  const [nro, setNro] = useState('');
  const [acuse, setAcuse] = useState('');
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => setPendingLabel(movilWriteQueue.pending()[0] || movilCallableGate.pending()[0] || null);
    const offA = movilWriteQueue.subscribe(sync);
    const offB = movilCallableGate.subscribe(sync);
    return () => { offA(); offB(); };
  }, []);

  useEffect(() => {
    if (!permitido) return;
    const q = query(collection(db, 'eventuales_bolsa'), where('grupoId', '==', GRUPO_EVENTUALES_ID));
    return onSnapshot(q, (snap) => {
      const rows = snap.docs.map((docSnap): Ficha => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          cuil: String(data.cuil || docSnap.id),
          dni: String(data.dni || ''),
          nombre: String(data.nombre || ''),
          mail: String(data.mail || ''),
          telefono: String(data.telefono || ''),
          legajoPlanilla: String(data.legajoPlanilla || ''),
          primerIngreso: String(data.primerIngreso || ''),
          disponibilidad: String(data.disponibilidad || ''),
          empresasHabilitadas: Array.isArray(data.empresasHabilitadas) ? data.empresasHabilitadas.map(String) : [],
          marcos: (data.marcos && typeof data.marcos === 'object' ? data.marcos : {}) as Ficha['marcos'],
          exigirMarco: data.exigirMarco !== false,
          exigirAltaArca: data.exigirAltaArca !== false,
        };
      });
      setFichas(rows);
      try { sessionStorage.setItem(CACHE, JSON.stringify(rows)); } catch { /* ignore */ }
    }, () => {
      try {
        const raw = sessionStorage.getItem(CACHE);
        if (raw) setFichas(JSON.parse(raw) as Ficha[]);
      } catch { /* sin caché */ }
    });
  }, [permitido]);

  // Solo los envíos de la empresa activa: el servidor filtra por `empresaId` (arca_envios no se lee desde el cliente).
  const cargarArca = useCallback((silencioso = false) => {
    if (!empresaId || !online) return;
    setArcaCargando(true);
    void runCallableOnline('ARCA pendientes', async () => {
      const fn = httpsCallable(functions, 'gestionarEventual');
      const res = await fn({ accion: 'arcaPendientes', empresaId });
      const data = res.data as { envios?: EnvioArcaServidor[] };
      const nuevos = (data.envios || []).map(envioAMovil);
      setArca((previos) => {
        const confirmadosRecientes = previos.filter((envio) => (envio.estado === 'CONFIRMADO' || envio.estado === 'ANULADO') && !nuevos.some((n) => n.id === envio.id));
        return [...nuevos, ...confirmadosRecientes];
      });
    }).catch((error: unknown) => {
      if (!silencioso) toast.error(error instanceof Error ? error.message : 'No se pudieron leer los envíos ARCA.');
    }).finally(() => setArcaCargando(false));
  }, [empresaId, online]);

  useEffect(() => {
    setArca([]);
    setArcaId('');
    setNro('');
    cargarArca(true);
  }, [cargarArca]);

  const habilitadas = useMemo(
    () => filtrarFichas({ fichas, empresaId: empresaId || '', todaLaBolsa: false, filtro: 'TODOS', buscar: '', hoy: hoy() }) as Ficha[],
    [empresaId, fichas],
  );

  const personas = useMemo(() => {
    const lista = filtrarFichas({ fichas, empresaId: empresaId || '', todaLaBolsa: false, filtro: 'TODOS', buscar, hoy: hoy() }) as Ficha[];
    return lista
      .slice(0, 30)
      .map((ficha): EventualMovil => {
        const marco = marcoDeBolsa(ficha, empresaId || '', hoy()) as { estado?: string };
        const estado = marco.estado || 'SIN_MARCO';
        return {
          id: ficha.id,
          nombre: ficha.nombre,
          cuil: formatoCuil(ficha.id),
          marco: MARCO[estado] || 'Sin marco',
          marcoEstado: estado,
          telefono: ficha.telefono,
          legajo: ficha.legajoPlanilla,
          primerIngreso: fmtFechaAr(ficha.primerIngreso),
          exigirMarco: ficha.exigirMarco,
          exigirAltaArca: ficha.exigirAltaArca,
        };
      });
  }, [buscar, empresaId, fichas]);

  // Switches de pruebas: solo con EVENTUALES.update (o SuperAdmin); el servidor vuelve a exigirlo y escribe audit_logs.
  const puedeSwitch = isSuperAdmin || (rolePermissions?.EVENTUALES || []).includes('update');
  const [switchGuardando, setSwitchGuardando] = useState('');
  const cambiarSwitch = (campo: 'exigirMarco' | 'exigirAltaArca', valor: boolean) => {
    if (!elegidaId || !online) {
      toast.error('El switch requiere conexión.');
      return;
    }
    setSwitchGuardando(campo);
    void llamar('Switch de pruebas', { accion: 'switchesPruebas', cuil: elegidaId, [campo]: valor }).then(() => {
      toast.success(valor ? 'Vuelve a exigirse.' : 'Modo pruebas activado.');
    }).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar el switch.');
    }).finally(() => setSwitchGuardando(''));
  };

  const elegido = personas.find((persona) => persona.id === elegidaId) || null;
  const cuilOk = normalizeCuil(cuil);

  const llamar = (label: string, data: Record<string, unknown>) => runCallableOnline(label, async () => {
    const fn = httpsCallable(functions, label === 'Crear acceso' ? 'crearAccesoEventual' : 'gestionarEventual');
    const res = await fn(data);
    return res.data as Record<string, unknown>;
  });

  const guardarAlta = () => {
    if (!cuilOk || !nombre.trim() || !empresaId) {
      toast.error(cuilOk ? 'Completá el nombre.' : 'El CUIL no es válido.');
      return;
    }
    void llamar('Alta en la bolsa', {
      accion: 'crear',
      cuil: cuilOk,
      nombre: nombre.trim(),
      mail: mail.trim(),
      telefono: telefono.trim(),
      empresasHabilitadas: [empresaId],
    }).then(() => {
      toast.success('Alta en la bolsa.');
      cerrarAlta();
      setCuil('');
      setNombre('');
      setMail('');
      setTelefono('');
    }).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'No se pudo dar de alta.');
    });
  };

  const crearAcceso = () => {
    if (!elegido) return;
    void llamar('Crear acceso', { cuil: elegido.id }).then(() => {
      toast.success('Acceso creado.');
    }).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'No se pudo crear el acceso.');
    });
  };

  // Alta/baja → nro de transacción → CONFIRMADO (callable gestionarEventual/arcaConfirmar; el servidor propaga el alta a los turnos).
  const confirmarArca = () => {
    const envio = arca.find((row) => row.id === arcaId) || null;
    const numero = nro.trim();
    if (!envio || !numero) {
      toast.error('Elegí el envío y el número de transacción.');
      return;
    }
    if (!online) {
      toast.error('ARCA requiere conexión.');
      return;
    }
    setArcaEnviando(true);
    void llamar('ARCA', { accion: 'arcaConfirmar', envioId: envio.id, nroTransaccion: numero }).then(() => {
      toast.success(`${envio.tipo === 'BT' ? 'Baja' : 'Alta'} confirmada en ARCA.`);
      setNro('');
      setArcaId('');
      setArca((lista) => lista.map((row) => (row.id === envio.id ? { ...row, estado: 'CONFIRMADO', nroTransaccion: numero } : row)));
      cargarArca(true);
    }).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'No se pudo confirmar.');
    }).finally(() => setArcaEnviando(false));
  };

  const registrarAcuse = () => {
    const envio = arca.find((row) => row.id === arcaId) || null;
    const texto = acuse.trim();
    if (!envio || envio.tipo !== 'ANULACION' || texto.length < 3) {
      toast.error('Pegá el acuse que devolvió ARCA.');
      return;
    }
    if (!online) {
      toast.error('ARCA requiere conexión.');
      return;
    }
    setArcaEnviando(true);
    void llamar('ARCA', { accion: 'arcaAcuseAnulacion', envioId: envio.id, acuse: texto }).then(() => {
      toast.success('Anulación registrada. El envío quedó ANULADO.');
      setAcuse('');
      setArcaId('');
      setArca((lista) => lista.map((row) => (row.id === envio.id ? { ...row, estado: 'ANULADO' } : row)));
      cargarArca(true);
    }).catch((error: unknown) => {
      const msg = error instanceof Error ? error.message : 'No se pudo registrar el acuse.';
      toast.error(msg.includes('PLAZO_VENCIDO') ? 'El plazo venció: el envío pasa a baja código 30.' : msg);
      if (msg.includes('PLAZO_VENCIDO')) cargarArca(true);
    }).finally(() => setArcaEnviando(false));
  };

  if (!permitido) {
    return <p className="p-6 text-sm font-semibold text-slate-600">No tenés permiso de Eventuales.</p>;
  }

  return (
    <>
      <EventualesScreens
        empresa={empresa?.name || 'Empresa'}
        onEmpresa={empresaSheet.onEmpresa}
        online={online}
        pendingLabel={pendingLabel}
        panel={panel}
        buscar={buscar}
        onBuscar={setBuscar}
        personas={personas}
        totalEmpresa={habilitadas.length}
        onElegir={(id) => setElegidaId((prev) => (prev === id ? '' : id))}
        onCerrarAlta={cerrarAlta}
        cuil={cuil}
        onCuil={setCuil}
        cuilEstado={cuilOk ? `${formatoCuil(cuilOk)} válido` : (cuil ? 'CUIL inválido' : '')}
        nombre={nombre}
        onNombre={setNombre}
        mail={mail}
        onMail={setMail}
        telefono={telefono}
        onTelefono={setTelefono}
        onGuardarAlta={guardarAlta}
        onCrearAcceso={crearAcceso}
        arca={arca}
        arcaCargando={arcaCargando}
        onRecargarArca={() => cargarArca(false)}
        nro={nro}
        onNro={setNro}
        arcaId={arcaId}
        onArca={(id) => { setArcaId(id); setNro(''); }}
        onConfirmarArca={confirmarArca}
        acuse={acuse}
        onAcuse={setAcuse}
        onRegistrarAcuse={registrarAcuse}
        arcaEnviando={arcaEnviando}
        elegido={elegido}
        puedeSwitch={puedeSwitch}
        switchGuardando={switchGuardando}
        onSwitch={cambiarSwitch}
        escala={panel === 'escala' ? <EscalaMovilPanel /> : null}
      />
      {empresaSheet.sheet}
      <MovilBottomNav />
    </>
  );
}
