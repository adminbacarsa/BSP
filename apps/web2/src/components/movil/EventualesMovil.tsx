import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { toast } from 'sonner';
import { EventualesScreens, type ArcaMovil, type EventualMovil } from '@/components/movil/EventualesScreens';
import { MovilBottomNav } from '@/components/movil/MovilBottomNav';
import { useOnlineFlag } from '@/components/movil/OperacionScreens';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';
import { db, functions } from '@/lib/firebase';
import { normalizeCuil } from '@/lib/eventuales/cuil.mjs';
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
  nombre: string;
  mail: string;
  telefono: string;
  empresasHabilitadas: string[];
  marcos: Record<string, { firmado?: boolean; fechaFirma?: string; vigenciaDias?: number }>;
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

export function EventualesMovil() {
  const { isSuperAdmin, canReadModule } = useAuth();
  const { empresaId, empresa } = useEmpresa();
  const online = useOnlineFlag();
  const permitido = isSuperAdmin || canReadModule('EVENTUALES') || canReadModule('RRHH');
  const [fichas, setFichas] = useState<Ficha[]>([]);
  const [buscar, setBuscar] = useState('');
  const [elegidaId, setElegidaId] = useState('');
  const [altaAbierta, setAltaAbierta] = useState(false);
  const [cuil, setCuil] = useState('');
  const [nombre, setNombre] = useState('');
  const [mail, setMail] = useState('');
  const [telefono, setTelefono] = useState('');
  const [arca, setArca] = useState<ArcaMovil[]>([]);
  const [arcaId, setArcaId] = useState('');
  const [nro, setNro] = useState('');
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
      const rows = snap.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          nombre: String(data.nombre || ''),
          mail: String(data.mail || ''),
          telefono: String(data.telefono || ''),
          empresasHabilitadas: Array.isArray(data.empresasHabilitadas) ? data.empresasHabilitadas.map(String) : [],
          marcos: (data.marcos && typeof data.marcos === 'object' ? data.marcos : {}) as Ficha['marcos'],
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

  useEffect(() => {
    if (!empresaId || !online) return;
    void runCallableOnline('ARCA pendientes', async () => {
      const fn = httpsCallable(functions, 'gestionarEventual');
      const res = await fn({ accion: 'arcaPendientes', empresaId });
      const data = res.data as { envios?: ArcaMovil[] };
      setArca(data.envios || []);
    }).catch(() => { /* el gate avisa al confirmar */ });
  }, [empresaId, online]);

  const personas = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return fichas
      .filter((ficha) => !empresaId || ficha.empresasHabilitadas.includes(empresaId))
      .filter((ficha) => !q || ficha.nombre.toLowerCase().includes(q) || ficha.id.includes(q.replace(/\D/g, '')))
      .slice(0, 20)
      .map((ficha): EventualMovil => {
        const marco = marcoDeBolsa(ficha, empresaId || '', hoy()) as { estado?: string };
        return {
          id: ficha.id,
          nombre: ficha.nombre,
          cuil: formatoCuil(ficha.id),
          marco: MARCO[marco.estado || ''] || 'Sin marco',
          telefono: ficha.telefono,
        };
      });
  }, [buscar, empresaId, fichas]);

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
      setAltaAbierta(false);
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

  const confirmarArca = () => {
    if (!arcaId || !nro.trim()) {
      toast.error('Elegí el envío y el número de transacción.');
      return;
    }
    void llamar('ARCA', { accion: 'arcaConfirmar', envioId: arcaId, nroTransaccion: nro.trim() }).then(() => {
      toast.success('Transacción cargada.');
      setNro('');
      setArca((lista) => lista.filter((envio) => envio.id !== arcaId));
    }).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'No se pudo confirmar.');
    });
  };

  if (!permitido) {
    return <p className="p-6 text-sm font-semibold text-slate-600">No tenés permiso de Eventuales.</p>;
  }

  return (
    <>
      <EventualesScreens
        empresa={empresa?.name || 'Empresa'}
        online={online}
        pendingLabel={pendingLabel}
        buscar={buscar}
        onBuscar={setBuscar}
        personas={personas}
        onElegir={setElegidaId}
        altaAbierta={altaAbierta}
        onAbrirAlta={() => setAltaAbierta(true)}
        onCerrarAlta={() => setAltaAbierta(false)}
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
        nro={nro}
        onNro={setNro}
        arcaId={arcaId}
        onArca={setArcaId}
        onConfirmarArca={confirmarArca}
        elegido={elegido}
      />
      <MovilBottomNav />
    </>
  );
}
