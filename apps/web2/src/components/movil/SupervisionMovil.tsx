import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { Timestamp, collection, doc, getDocs, limit, onSnapshot, orderBy, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { toast } from 'sonner';
import { BottomSheet } from '@/components/movil/BottomSheet';
import { MovilBottomNav } from '@/components/movil/MovilBottomNav';
import { useOnlineFlag } from '@/components/movil/OperacionScreens';
import { SupervisionScreens, type SupervisionPanel } from '@/components/movil/SupervisionScreens';
import { useEmpresaSheet } from '@/components/movil/useEmpresaSheet';
import { MOVIL_BTN_PRIMARY, MOVIL_BTN_SECONDARY, MOVIL_PRIMARY_BG, MOVIL_TEXT } from '@/components/movil/ui/tones';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';
import { db } from '@/lib/firebase';
import { movilCallableGate } from '@/lib/movil/callableOnline';
import { MENU_TURNOS_ATRAS_MS } from '@/lib/movil/menuLayout';
import { crearNovedadRapida } from '@/lib/movil/novedadRapida';
import {
  alertasSupervision,
  buildSupervisionRows,
  clientesSupervision,
  SUPERVISION_DIAS_SIN_VISITA,
  SUPERVISION_NOVEDAD_TYPE,
  SUPERVISION_SOURCE,
  SUPERVISION_VISITAS_VENTANA_MS,
  VISITA_RESULTADOS,
  type SupervisionNovedadLite,
  type SupervisionObjetivo,
  type SupervisionTurnoLite,
  type SupervisionVisitaLite,
} from '@/lib/movil/supervisionMovil';
import { enqueueFirestoreWrite, movilWriteQueue } from '@/lib/movil/writeQueue';
import { belongsToEmpresaView, shouldScopeQueriesToEmpresa } from '@/lib/tenantScope';
import { supervisionFieldService, type SupervisionVisita } from '@/services/supervisionFieldService';

const DIAS_LARGOS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const diaLargo = (d: Date) => `${DIAS_LARGOS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`;
const CACHE = 'cosp-movil-supervision';
const GPS_TIMEOUT_MS = 6000;

function toMs(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();
  if (value && typeof (value as { toMillis?: () => number }).toMillis === 'function') return (value as { toMillis: () => number }).toMillis();
  if (typeof value === 'string' || typeof value === 'number') {
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function numOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** GPS del celular si lo da en pocos segundos; si no, la visita se guarda sin coordenadas. */
function leerGps(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
    const timer = setTimeout(() => resolve(null), GPS_TIMEOUT_MS);
    navigator.geolocation.getCurrentPosition(
      (pos) => { clearTimeout(timer); resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }); },
      () => { clearTimeout(timer); resolve(null); },
      { enableHighAccuracy: true, timeout: GPS_TIMEOUT_MS, maximumAge: 60_000 },
    );
  });
}

/** Supervisión en el celular: lista de objetivos, visitas, novedad con foto y alertas propias. */
export function SupervisionMovil() {
  const { isSuperAdmin, canReadModule, user } = useAuth();
  const { empresaId, empresa } = useEmpresa();
  const online = useOnlineFlag();
  const empresaSheet = useEmpresaSheet();
  const router = useRouter();
  const permitido = isSuperAdmin || canReadModule('SUPERVISION');
  const migracionCompleta = (empresa as { migracionCompleta?: boolean } | null)?.migracionCompleta === true;
  const panel: SupervisionPanel = String(router.query.panel || '') === 'alertas' ? 'alertas' : 'objetivos';
  const [objetivos, setObjetivos] = useState<SupervisionObjetivo[]>([]);
  const [loading, setLoading] = useState(true);
  const [turnos, setTurnos] = useState<SupervisionTurnoLite[]>([]);
  const [visitas, setVisitas] = useState<SupervisionVisitaLite[]>([]);
  const [novedades, setNovedades] = useState<SupervisionNovedadLite[]>([]);
  const [clienteId, setClienteId] = useState('');
  const [buscar, setBuscar] = useState('');
  const [abiertoId, setAbiertoId] = useState<string | null>(null);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [visitaOpen, setVisitaOpen] = useState(false);
  const [resultado, setResultado] = useState<'OK' | 'OBSERVADO' | 'CRITICO'>('OK');
  const [observaciones, setObservaciones] = useState('');
  const [novedadOpen, setNovedadOpen] = useState(false);
  const [novedadTexto, setNovedadTexto] = useState('');
  const [foto, setFoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const supervisorUid = user?.uid || '';
  const supervisorNombre = user?.displayName || user?.email || 'Supervisor';

  useEffect(() => {
    const sync = () => setPendingLabel(movilWriteQueue.pending()[0] || movilCallableGate.pending()[0] || null);
    const offA = movilWriteQueue.subscribe(sync);
    const offB = movilCallableGate.subscribe(sync);
    sync();
    return () => { offA(); offB(); };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const alInicio = () => { setAbiertoId(null); };
    window.addEventListener('cosp-modulo-inicio', alInicio);
    return () => window.removeEventListener('cosp-modulo-inicio', alInicio);
  }, []);

  useEffect(() => { setAbiertoId(null); }, [panel]);

  // Objetivos con dirección y coordenadas desde `clients.objetivos` (clientes y objetivos activos).
  useEffect(() => {
    if (!empresaId || !permitido) return;
    let cancel = false;
    const scope = shouldScopeQueriesToEmpresa(empresaId, migracionCompleta);
    const col = collection(db, 'clients');
    const q = scope && empresaId.toLowerCase() !== 'bacarsa' ? query(col, where('empresaId', '==', empresaId)) : query(col);
    setLoading(true);
    getDocs(q).then((snap) => {
      if (cancel) return;
      const out: SupervisionObjetivo[] = [];
      snap.docs.forEach((d) => {
        const data = d.data() as Record<string, unknown>;
        if (!belongsToEmpresaView(data, empresaId, migracionCompleta)) return;
        if (String(data.status || 'ACTIVE').toUpperCase() === 'INACTIVE') return;
        const clientName = String(data.name || data.fantasyName || d.id);
        const lista = Array.isArray(data.objetivos) ? data.objetivos : Array.isArray(data.objectives) ? data.objectives : [];
        for (const raw of lista as Array<Record<string, unknown>>) {
          if (!raw?.id) continue;
          if (String(raw.status || 'ACTIVE').toUpperCase() === 'INACTIVE') continue;
          out.push({
            id: String(raw.id),
            name: String(raw.name || raw.nombre || raw.id),
            clientId: d.id,
            clientName,
            address: raw.address ? String(raw.address) : raw.direccion ? String(raw.direccion) : null,
            lat: numOrNull(raw.lat ?? raw.latitude),
            lng: numOrNull(raw.lng ?? raw.longitude),
          });
        }
      });
      setObjetivos(out);
      setLoading(false);
      try { sessionStorage.setItem(`${CACHE}:${empresaId}`, JSON.stringify(out)); } catch { /* caché llena */ }
    }).catch(() => {
      if (cancel) return;
      setLoading(false);
      try {
        const raw = sessionStorage.getItem(`${CACHE}:${empresaId}`);
        if (raw) setObjetivos(JSON.parse(raw) as SupervisionObjetivo[]);
      } catch { /* sin caché */ }
    });
    return () => { cancel = true; };
  }, [empresaId, migracionCompleta, permitido]);

  // Turnos en curso (misma ventana que el menú: 14 h atrás → ahora + 2 h) para el estado resumido.
  useEffect(() => {
    if (!empresaId || !permitido) return;
    const scope = shouldScopeQueriesToEmpresa(empresaId, migracionCompleta);
    const desde = Timestamp.fromMillis(Date.now() - MENU_TURNOS_ATRAS_MS);
    const hasta = Timestamp.fromMillis(Date.now() + 2 * 60 * 60 * 1000);
    const col = collection(db, 'turnos');
    const q = scope && empresaId.toLowerCase() !== 'bacarsa'
      ? query(col, where('empresaId', '==', empresaId), where('startTime', '>=', desde), where('startTime', '<=', hasta))
      : query(col, where('startTime', '>=', desde), where('startTime', '<=', hasta));
    return onSnapshot(q, (snap) => {
      const rows: SupervisionTurnoLite[] = [];
      snap.forEach((d) => {
        const data = d.data() as Record<string, unknown>;
        if (!belongsToEmpresaView(data, empresaId, migracionCompleta)) return;
        rows.push({
          objectiveId: typeof data.objectiveId === 'string' ? data.objectiveId : null,
          startTime: toMs(data.startTime),
          endTime: toMs(data.endTime),
          isPresent: data.isPresent === true,
          isAbsent: data.isAbsent === true,
          isCompleted: data.isCompleted === true,
          isRetention: data.isRetention === true,
          realEndTime: data.realEndTime ?? null,
          draft: data.draft === true,
          isFranco: data.isFranco === true,
          isVirtual: data.isVirtual === true,
        });
      });
      setTurnos(rows);
    }, () => setTurnos([]));
  }, [empresaId, migracionCompleta, permitido]);

  // Visitas de los últimos 30 días (índice empresaId + createdAt que ya existe).
  useEffect(() => {
    if (!empresaId || !permitido) return;
    const desde = Timestamp.fromMillis(Date.now() - SUPERVISION_VISITAS_VENTANA_MS);
    const q = query(collection(db, 'supervision_visitas'), where('empresaId', '==', empresaId), where('createdAt', '>=', desde), orderBy('createdAt', 'desc'), limit(500));
    return onSnapshot(q, (snap) => {
      setVisitas(snap.docs.map((d) => {
        const data = d.data() as SupervisionVisita;
        return { id: d.id, objectiveId: data.objectiveId, createdAtMs: toMs(data.createdAt), supervisorNombre: data.supervisorNombre, resultado: data.resultado };
      }));
    }, () => setVisitas([]));
  }, [empresaId, permitido]);

  // Novedades de supervisión pendientes (solo igualdades: sin índice nuevo).
  useEffect(() => {
    if (!empresaId || !permitido) return;
    const q = query(collection(db, 'novedades'), where('empresaId', '==', empresaId), where('source', '==', SUPERVISION_SOURCE), where('status', '==', 'pending'));
    return onSnapshot(q, (snap) => {
      setNovedades(snap.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          type: typeof data.type === 'string' ? data.type : null,
          source: typeof data.source === 'string' ? data.source : null,
          status: data.status,
          title: typeof data.title === 'string' ? data.title : '',
          description: typeof data.description === 'string' ? data.description : '',
          objectiveId: typeof data.objectiveId === 'string' ? data.objectiveId : null,
          objectiveName: typeof data.objectiveName === 'string' ? data.objectiveName : null,
          createdAtMs: toMs(data.createdAt),
          reportedBy: typeof data.reportedBy === 'string' ? data.reportedBy : null,
          imageUrl: typeof data.imageUrl === 'string' ? data.imageUrl : null,
        };
      }));
    }, () => setNovedades([]));
  }, [empresaId, permitido]);

  const clientes = useMemo(() => clientesSupervision(objetivos), [objetivos]);
  const rowsTodas = useMemo(() => buildSupervisionRows({ objetivos, turnos, visitas, nowMs }), [objetivos, turnos, visitas, nowMs]);
  const rows = useMemo(() => buildSupervisionRows({ objetivos, turnos, visitas, nowMs, clientId: clienteId, buscar }), [objetivos, turnos, visitas, nowMs, clienteId, buscar]);
  const row = rowsTodas.find((r) => r.id === abiertoId) || null;
  const visitasObjetivo = useMemo(() => (row ? visitas.filter((v) => v.objectiveId === row.id) : []), [visitas, row]);
  const alertas = useMemo(() => alertasSupervision({ rows: rowsTodas, novedades }), [rowsTodas, novedades]);

  const cerrarVisita = useCallback(() => { setVisitaOpen(false); setObservaciones(''); setResultado('OK'); }, []);
  const cerrarNovedad = useCallback(() => { setNovedadOpen(false); setNovedadTexto(''); setFoto(null); }, []);

  const guardarVisita = () => {
    if (!row || !empresaId || busy) return;
    setBusy(true);
    const objetivo = row;
    const label = `Visita ${objetivo.name}`;
    void leerGps().then((gps) => enqueueFirestoreWrite(label, async () => {
      const data: Omit<SupervisionVisita, 'id' | 'createdAt'> = {
        empresaId,
        objectiveId: objetivo.id,
        objectiveName: objetivo.name,
        clientId: objetivo.clientId,
        clientName: objetivo.clientName,
        supervisorUid,
        supervisorNombre,
        observaciones: observaciones.trim(),
        resultado,
        ...(gps ? { lat: gps.lat, lng: gps.lng } : {}),
      };
      await supervisionFieldService.createVisita(data);
    })).then((result) => {
      toast[result === 'queued' ? 'message' : 'success'](result === 'queued' ? 'Visita pendiente de enviar' : 'Visita registrada');
      cerrarVisita();
    }).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'No se pudo registrar la visita.');
    }).finally(() => setBusy(false));
  };

  const guardarNovedad = () => {
    if (!row || !empresaId || busy) return;
    if (!novedadTexto.trim() && !foto) {
      toast.error('Escribí la novedad o sacá una foto.');
      return;
    }
    setBusy(true);
    const objetivo = row;
    const texto = novedadTexto.trim() || 'Foto de la visita';
    const archivo = foto;
    const visitaId = objetivo.ultimaVisita?.id || null;
    void enqueueFirestoreWrite(`Novedad ${objetivo.name}`, async () => {
      await crearNovedadRapida({
        empresaId,
        type: SUPERVISION_NOVEDAD_TYPE,
        title: `Supervisión · ${objetivo.name}`,
        description: texto,
        reportedBy: supervisorNombre,
        objectiveId: objetivo.id,
        objectiveName: objetivo.name,
        clientId: objetivo.clientId,
        source: SUPERVISION_SOURCE,
        foto: archivo,
        extra: { visitaId, supervisorUid },
      });
    }).then((result) => {
      toast[result === 'queued' ? 'message' : 'success'](result === 'queued' ? 'Novedad pendiente de enviar' : 'Novedad cargada');
      cerrarNovedad();
    }).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'No se pudo cargar la novedad.');
    }).finally(() => setBusy(false));
  };

  const marcarNovedadVista = (id: string) => {
    void enqueueFirestoreWrite('Novedad vista', async () => {
      await updateDoc(doc(db, 'novedades', id), {
        status: 'ATENDIDA',
        atendidaAt: serverTimestamp(),
        atendidaPor: supervisorNombre,
        atendidaPorUid: supervisorUid,
      });
    }).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'No se pudo marcar.');
    });
  };

  if (!permitido) {
    return <p className="p-6 text-sm font-semibold text-slate-600">No tenés permiso de Supervisión.</p>;
  }

  return (
    <>
      <SupervisionScreens
        empresa={empresa?.name || empresaId || 'Empresa'}
        onEmpresa={empresaSheet.onEmpresa}
        online={online}
        pendingLabel={pendingLabel}
        panel={panel}
        fechaLabel={diaLargo(new Date(nowMs))}
        loading={loading}
        clientes={clientes}
        clienteId={clienteId}
        onCliente={setClienteId}
        buscar={buscar}
        onBuscar={setBuscar}
        rows={rows}
        row={row}
        visitasObjetivo={visitasObjetivo}
        onOpen={setAbiertoId}
        onBack={() => setAbiertoId(null)}
        onMarcarVisita={() => setVisitaOpen(true)}
        onNovedad={() => setNovedadOpen(true)}
        alertas={alertas}
        diasLimite={SUPERVISION_DIAS_SIN_VISITA}
        nowMs={nowMs}
        onNovedadVista={marcarNovedadVista}
      />
      <BottomSheet open={visitaOpen && !!row} title={`Marcar visita · ${row?.name || ''}`} onClose={cerrarVisita}>
        <p className="text-[12px] text-slate-500">Queda la hora, quién la hizo y la ubicación del celular si la da.</p>
        <div className="mt-3 flex gap-1.5">
          {VISITA_RESULTADOS.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setResultado(r.id)}
              aria-pressed={resultado === r.id}
              className={`min-h-10 flex-1 rounded-md border px-2 text-[12px] font-semibold ${resultado === r.id ? `border-transparent ${MOVIL_PRIMARY_BG}` : `border-slate-300 bg-white ${MOVIL_TEXT[r.tono]}`}`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <textarea
          value={observaciones}
          onChange={(event) => setObservaciones(event.target.value)}
          rows={3}
          placeholder="Observaciones (opcional)"
          className="mt-3 w-full rounded-lg border border-slate-300 bg-white p-3 text-base text-slate-800 outline-none focus:border-[var(--movil-primary,#111827)]"
        />
        <button type="button" disabled={busy} onClick={guardarVisita} className={`mt-3 min-h-12 w-full rounded-lg text-sm font-semibold disabled:opacity-40 ${MOVIL_BTN_PRIMARY}`}>
          {busy ? 'Guardando…' : online ? 'Registrar visita' : 'Registrar · pendiente de enviar'}
        </button>
      </BottomSheet>
      <BottomSheet open={novedadOpen && !!row} title={`Novedad · ${row?.name || ''}`} onClose={cerrarNovedad}>
        <textarea
          value={novedadTexto}
          onChange={(event) => setNovedadTexto(event.target.value)}
          rows={4}
          placeholder="Qué encontraste en la visita"
          className="w-full rounded-lg border border-slate-300 bg-white p-3 text-base text-slate-800 outline-none focus:border-[var(--movil-primary,#111827)]"
        />
        <label className={`mt-2 flex min-h-11 cursor-pointer items-center justify-center rounded-lg text-sm font-semibold ${MOVIL_BTN_SECONDARY}`}>
          {foto ? foto.name : 'Sacar foto'}
          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(event) => setFoto(event.target.files?.[0] || null)} />
        </label>
        <button type="button" disabled={busy} onClick={guardarNovedad} className={`mt-3 min-h-12 w-full rounded-lg text-sm font-semibold disabled:opacity-40 ${MOVIL_BTN_PRIMARY}`}>
          {busy ? 'Guardando…' : online ? 'Guardar novedad' : 'Guardar · pendiente de enviar'}
        </button>
      </BottomSheet>
      {empresaSheet.sheet}
      <MovilBottomNav alertCount={alertas.total} />
    </>
  );
}
