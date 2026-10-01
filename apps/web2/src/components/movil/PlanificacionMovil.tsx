import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { toast } from 'sonner';
import { httpsCallable } from 'firebase/functions';
import { Timestamp, addDoc, collection, doc, onSnapshot, serverTimestamp, setDoc, updateDoc, type QueryDocumentSnapshot } from 'firebase/firestore';
import { BottomSheet } from '@/components/movil/BottomSheet';
import { MovilBottomNav } from '@/components/movil/MovilBottomNav';
import { CambioPuntual, CandidatosHueco, PlanificacionMovilView, type EventualMovil } from '@/components/movil/PlanificacionMovilView';
import { useOnlineFlag } from '@/components/movil/OperacionScreens';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';
import { db, functions } from '@/lib/firebase';
import { getDateKeyInTimezone } from '@/lib/crm/crmDateUtils';
import { runCallableOnline, movilCallableGate } from '@/lib/movil/callableOnline';
import { enqueueFirestoreWrite, movilWriteQueue } from '@/lib/movil/writeQueue';
import {
  aplicarCambios,
  bandaDe,
  bandaParaCubrir,
  candidatosParaHueco,
  conflictosDeHorario,
  conflictosDePermuta,
  franjasDe,
  horasMesEmpleado,
  hoyArgentina,
  instantesJornada,
  proximosDias,
  turnoMovilDesdeDoc,
  type CambioLocal,
  type EmpleadoMovil,
  type TabCandidato,
  type TurnoMovil,
} from '@/lib/movil/planificacionBasica';
import { canAssignFrancoTrabajado } from '@/lib/planificacion/francoTrabajadoAccess';
import { buildPlanningMonthTurnosQuery } from '@/lib/planificacion/loadPlanningMonthShifts';
import { ingestPlanningTurnosSnapshot } from '@/lib/planificacion/planningTurnosIngest';
import { belongsToEmpresaView, empresaCollectionQuery, fetchPlanificacionPublishStatus, stampEmpresaId } from '@/lib/multiempresa';
import { shouldScopeQueriesToEmpresa } from '@/lib/tenantScope';
import { asignarEventualPlanificacion, canConvocarEventuales, eventualErrorMessage } from '@/services/eventualesPlanificacionService';

type ObjGeo = { id: string; name: string; clientId: string; clientName: string; lat: number | null; lng: number | null };

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

export function PlanificacionMovil() {
  const { empresaId, empresa } = useEmpresa();
  const { isSuperAdmin, rolePermissions, canReadModule, user } = useAuth();
  const online = useOnlineFlag();
  const [readyTurnos, setReadyTurnos] = useState(false);
  const [turnos, setTurnos] = useState<TurnoMovil[]>([]);
  const [empleados, setEmpleados] = useState<EmpleadoMovil[]>([]);
  const [objetivos, setObjetivos] = useState<ObjGeo[]>([]);
  const [publicado, setPublicado] = useState<Record<string, boolean>>({});
  const [cambios, setCambios] = useState<CambioLocal[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [dia, setDia] = useState(() => hoyArgentina());
  const [sheet, setSheet] = useState<{ tipo: 'cubrir' | 'cambiar'; franjaId: string } | null>(null);
  const [tab, setTab] = useState<TabCandidato | 'eventuales'>('plantel');
  const [elegido, setElegido] = useState<string | null>(null);
  const [codigo, setCodigo] = useState<string | null>(null);
  const [companeroId, setCompaneroId] = useState<string | null>(null);
  const [eventuales, setEventuales] = useState<EventualMovil[]>([]);
  const [hoy] = useState(() => hoyArgentina());
  const dias = useMemo(() => proximosDias(hoy, 4), [hoy]);

  const migracionCompleta = (empresa as { migracionCompleta?: boolean } | null)?.migracionCompleta === true;
  const scopeEmpresa = shouldScopeQueriesToEmpresa(empresaId, migracionCompleta);
  const puedeLeer = isSuperAdmin || canReadModule('PLANNING');
  const puedeEditar = isSuperAdmin || (rolePermissions.PLANNING || []).some((a) => a === 'create' || a === 'update');
  const puedeCorregir = isSuperAdmin || (rolePermissions.PLANNING || []).includes('correct');
  const puedeFt = canAssignFrancoTrabajado(isSuperAdmin, rolePermissions);
  const puedeEventuales = canConvocarEventuales(isSuperAdmin, rolePermissions);
  const actorName = user?.displayName || user?.email || 'Planificación celular';

  useEffect(() => movilWriteQueue.subscribe(() => {
    const labels = [...movilWriteQueue.pending(), ...movilCallableGate.pending()];
    setPending(labels[0] || null);
  }), []);

  useEffect(() => {
    if (!empresaId || !puedeLeer) return;
    const months = [...new Set(dias.map((fecha) => fecha.slice(0, 7)))];
    const bags = new Map<string, TurnoMovil[]>();
    const unsubs = months.map((ym) => {
      const [year, month] = ym.split('-').map(Number);
      const q = buildPlanningMonthTurnosQuery({ empresaId, scopeEmpresa, year, month });
      return onSnapshot(q, (snap) => {
        const ingested = ingestPlanningTurnosSnapshot(
          snap.docs as QueryDocumentSnapshot[],
          empresaId,
          migracionCompleta,
          (input: { toDate?: () => Date }) => getDateKeyInTimezone(input?.toDate ? input.toDate() : new Date(input as unknown as string)),
        );
        const rows: TurnoMovil[] = [];
        for (const list of Object.values(ingested.cellTurnosMap)) {
          for (const view of list as Array<Record<string, unknown> & { id: string }>) {
            const row = turnoMovilDesdeDoc(String(view.id), view);
            if (row) rows.push(row);
          }
        }
        bags.set(ym, rows);
        setTurnos([...bags.values()].flat());
        setReadyTurnos(true);
      });
    });
    return () => unsubs.forEach((unsub) => unsub());
  }, [empresaId, scopeEmpresa, migracionCompleta, puedeLeer, dias]);

  useEffect(() => {
    if (!empresaId || !puedeLeer) return;
    const q = empresaCollectionQuery('empleados', empresaId, scopeEmpresa);
    return onSnapshot(q, (snap) => {
      const list: EmpleadoMovil[] = [];
      snap.forEach((item) => {
        const data = item.data() as Record<string, unknown>;
        if (!belongsToEmpresaView(data, empresaId, migracionCompleta)) return;
        if (String(data.status || 'ACTIVE').toUpperCase() === 'INACTIVE') return;
        const dot = data.planificacionDotacion as Record<string, unknown> | undefined;
        list.push({
          id: item.id,
          name: String(data.name || data.nombre || item.id),
          preferredObjectiveId: dot ? Object.keys(dot)[0] : String(data.objectiveId || ''),
          lat: num(data.lat ?? data.latitude),
          lng: num(data.lng ?? data.longitude),
          monthHours: 0,
        });
      });
      setEmpleados(list);
    });
  }, [empresaId, scopeEmpresa, migracionCompleta, puedeLeer]);

  useEffect(() => {
    if (!empresaId || !puedeLeer) return;
    const q = empresaCollectionQuery('clients', empresaId, scopeEmpresa);
    return onSnapshot(q, (snap) => {
      const list: ObjGeo[] = [];
      snap.forEach((item) => {
        const data = item.data() as Record<string, unknown>;
        if (!belongsToEmpresaView(data, empresaId, migracionCompleta)) return;
        if (String(data.status || 'ACTIVE').toUpperCase() === 'INACTIVE') return;
        const objetivosCliente = Array.isArray(data.objetivos) ? data.objetivos as Record<string, unknown>[] : [];
        for (const obj of objetivosCliente) {
          const id = String(obj.id || '');
          if (!id) continue;
          list.push({
            id,
            name: String(obj.name || obj.nombre || id),
            clientId: item.id,
            clientName: String(data.name || data.razonSocial || ''),
            lat: num(obj.lat ?? obj.latitude),
            lng: num(obj.lng ?? obj.longitude),
          });
        }
      });
      setObjetivos(list);
    });
  }, [empresaId, scopeEmpresa, migracionCompleta, puedeLeer]);

  const visibles = useMemo(() => aplicarCambios(turnos, cambios), [turnos, cambios]);
  const franjas = useMemo(() => franjasDe(visibles, dias), [visibles, dias]);
  const franjaAbierta = sheet ? franjas.find((f) => f.id === sheet.franjaId) || null : null;
  const objetivo = objetivos.find((o) => o.id === franjaAbierta?.objectiveId);
  const mesesPublicados = useMemo(() => {
    const keys = new Set(franjas.map((f) => `${f.objectiveId}|${f.date.slice(0, 7)}`));
    if (keys.size === 0) return false;
    return [...keys].every((key) => publicado[key] === true);
  }, [franjas, publicado]);

  useEffect(() => {
    const keys = [...new Set(turnos.map((t) => `${t.objectiveId}|${t.date.slice(0, 7)}`))].filter((key) => key.split('|')[0]);
    if (!empresaId || keys.length === 0) return;
    let alive = true;
    void Promise.all(keys.map(async (key) => {
      const [objectiveId, ym] = key.split('|');
      const [year, month] = ym.split('-').map(Number);
      const status = await fetchPlanificacionPublishStatus(empresaId, objectiveId, year, month);
      return [key, Boolean(status?.publishedAt)] as const;
    })).then((rows) => {
      if (!alive) return;
      setPublicado(Object.fromEntries(rows));
    }).catch(() => {});
    return () => { alive = false; };
  }, [empresaId, turnos]);

  const candidatos = useMemo(() => {
    if (!franjaAbierta || franjaAbierta.kind === 'ok') return [];
    const ym = franjaAbierta.date.slice(0, 7);
    return candidatosParaHueco({
      hueco: franjaAbierta,
      turnos: visibles,
      objLat: objetivo?.lat,
      objLng: objetivo?.lng,
      empleados: empleados.map((emp) => ({ ...emp, monthHours: horasMesEmpleado(emp.id, ym, visibles) })),
    });
  }, [franjaAbierta, visibles, empleados, objetivo]);

  const companeros = franjaAbierta
    ? franjas.filter((f) => f.date === franjaAbierta.date && f.kind === 'ok' && f.id !== franjaAbierta.id && !f.franco)
    : [];
  const bandaElegida = codigo ? bandaDe(codigo) : null;
  const avisoHorario = franjaAbierta && bandaElegida
    ? conflictosDeHorario(franjaAbierta, codigo!, bandaElegida.start, bandaElegida.end, bandaElegida.hours, visibles).reason
    : null;
  const companero = companeros.find((c) => c.id === companeroId) || null;
  const avisoPermuta = franjaAbierta && companero ? conflictosDePermuta(franjaAbierta, companero, visibles).reason : null;
  const aviso = avisoHorario || avisoPermuta;

  const cerrar = () => {
    setSheet(null);
    setElegido(null);
    setCodigo(null);
    setCompaneroId(null);
    setTab('plantel');
    setEventuales([]);
  };

  const exigirEdicion = () => {
    if (puedeEditar) return true;
    toast.error('No tenés permiso para modificar la planificación.');
    return false;
  };

  const stage = (cambio: CambioLocal) => {
    setCambios((prev) => [...prev, cambio]);
    cerrar();
    toast.message('Quedó para publicar');
  };

  const confirmarCandidato = async () => {
    if (!franjaAbierta || !elegido || !exigirEdicion()) return;
    if (tab === 'eventuales') {
      const ev = eventuales.find((row) => row.cuil === elegido);
      const banda = bandaParaCubrir(franjaAbierta);
      try {
        const res = await runCallableOnline('Asignar eventual', () => asignarEventualPlanificacion({
          empresaId,
          cuil: elegido,
          modo: 'LEGAJO',
          objectiveId: franjaAbierta.objectiveId,
          objectiveName: franjaAbierta.objectiveName,
          clientId: franjaAbierta.clientId || objetivo?.clientId,
          clientName: franjaAbierta.clientName || objetivo?.clientName,
          positionName: franjaAbierta.positionName,
          objetivoGeo: objetivo?.lat != null && objetivo.lng != null ? { lat: objetivo.lat, lng: objetivo.lng } : null,
          turnos: [{ fecha: franjaAbierta.date, horaInicio: banda.start, horaFin: banda.end, horas: banda.hours, code: banda.code, positionName: franjaAbierta.positionName }],
        }));
        stage({ kind: 'asignar', franjaId: franjaAbierta.id, employeeId: res.employeeId, employeeName: res.nombre || ev?.nombre || 'Eventual', ft: false, bolsaCuil: elegido });
      } catch (error) {
        toast.error(eventualErrorMessage(error, 'La bolsa requiere conexión.'));
      }
      return;
    }
    const cand = candidatos.find((c) => c.employeeId === elegido);
    if (!cand || cand.blocked) return;
    if (cand.tab === 'ft' && !puedeFt) {
      toast.error('Falta el permiso de franco trabajado.');
      return;
    }
    stage({ kind: 'asignar', franjaId: franjaAbierta.id, employeeId: cand.employeeId, employeeName: cand.name, ft: cand.tab === 'ft' });
  };

  useEffect(() => {
    if (tab !== 'eventuales' || !franjaAbierta || !puedeEventuales) return;
    const banda = bandaParaCubrir(franjaAbierta);
    let alive = true;
    void runCallableOnline('Bolsa de eventuales', async () => {
      const call = httpsCallable<Record<string, unknown>, { candidatos: EventualMovil[] }>(functions, 'listarCandidatosEventuales');
      const res = await call({
        empresaId,
        objectiveId: franjaAbierta.objectiveId,
        clientId: franjaAbierta.clientId || objetivo?.clientId || null,
        objetivoGeo: objetivo?.lat != null && objetivo.lng != null ? { lat: objetivo.lat, lng: objetivo.lng } : null,
        jornadas: [{ fecha: franjaAbierta.date, horaInicio: banda.start, horaFin: banda.end, horas: banda.hours }],
      });
      if (alive) setEventuales(res.data?.candidatos || []);
    }).catch((error: unknown) => {
      if (alive) toast.error(error instanceof Error ? error.message : 'La bolsa requiere conexión.');
    });
    return () => { alive = false; };
  }, [tab, franjaAbierta, puedeEventuales, empresaId, objetivo]);

  const publicar = async () => {
    if (!puedeCorregir) {
      toast.error('Falta el permiso para publicar la corrección.');
      return;
    }
    const afectados = new Set<string>();
    for (const cambio of cambios) {
      const id = cambio.kind === 'permuta' ? cambio.franjaId : cambio.franjaId;
      const base = turnos.find((t) => t.id === id);
      if (base?.objectiveId) afectados.add(`${base.objectiveId}|${base.date.slice(0, 7)}`);
    }
    for (const key of afectados) {
      const [objectiveId, ym] = key.split('|');
      const [year, month] = ym.split('-').map(Number);
      const status = await fetchPlanificacionPublishStatus(empresaId, objectiveId, year, month);
      if (!status?.publishedAt) {
        toast.error('Ese mes no está publicado. La primera publicación se hace en el escritorio.');
        return;
      }
    }
    const lote = cambios;
    const base = turnos;
    const result = await enqueueFirestoreWrite(`Corrección de ${lote.length} cambio${lote.length === 1 ? '' : 's'}`, async () => {
      let actuales = base.map((t) => ({ ...t }));
      const creados = new Map<string, string>();
      for (const cambio of lote) {
        actuales = aplicarCambios(actuales, [cambio]);
        await escribirCambio(cambio, base, actuales, empresaId, actorName, creados);
      }
    });
    setCambios([]);
    if (result === 'queued') toast.message('Pendiente de enviar');
    else toast.success('Corrección publicada. El guardia recibe el aviso.');
  };

  if (!puedeLeer) {
    return <p className="p-6 text-sm font-bold text-slate-600">No tenés permiso de planificación.</p>;
  }

  return (
    <>
      <Head><title>Planificación · COSP</title></Head>
      <PlanificacionMovilView
        empresa={empresa?.name || empresaId}
        online={online}
        pendingLabel={pending}
        dias={dias}
        dia={dias.includes(dia) ? dia : dias[0]}
        franjas={franjas}
        porPublicar={cambios.length}
        puedePublicar={puedeCorregir && mesesPublicados}
        mesPublicado={mesesPublicados || !readyTurnos}
        onDia={setDia}
        onHueco={(franja) => { if (exigirEdicion()) setSheet({ tipo: 'cubrir', franjaId: franja.id }); }}
        onAsignado={(franja) => { if (exigirEdicion()) setSheet({ tipo: 'cambiar', franjaId: franja.id }); }}
        onPublicar={() => { void publicar(); }}
      />
      <BottomSheet open={sheet?.tipo === 'cubrir'} title={franjaAbierta ? `Cubrir ${franjaAbierta.code} ${franjaAbierta.start}` : 'Cubrir'} onClose={cerrar}>
        {franjaAbierta && (
          <CandidatosHueco
            tab={tab}
            onTab={setTab}
            candidatos={candidatos}
            eventuales={eventuales}
            elegidoId={elegido}
            puedeFt={puedeFt}
            puedeEventuales={puedeEventuales}
            onElegir={setElegido}
            onConfirmar={() => { void confirmarCandidato(); }}
          />
        )}
      </BottomSheet>
      <BottomSheet open={sheet?.tipo === 'cambiar'} title={franjaAbierta ? `${franjaAbierta.employeeName} · ${franjaAbierta.code}` : 'Cambiar'} onClose={cerrar}>
        <CambioPuntual
          codigo={codigo}
          onCodigo={setCodigo}
          companeros={companeros.map((c) => ({ id: c.id, nombre: c.employeeName, detalle: `${c.code} ${c.start}–${c.end}` }))}
          companeroId={companeroId}
          onCompanero={setCompaneroId}
          aviso={aviso}
          bloqueado={Boolean(aviso)}
          onHorario={() => {
            if (!franjaAbierta || !bandaElegida || !codigo || avisoHorario || !exigirEdicion()) return;
            stage({ kind: 'horario', franjaId: franjaAbierta.id, code: codigo, start: bandaElegida.start, end: bandaElegida.end, hours: bandaElegida.hours });
          }}
          onPermuta={() => {
            if (!franjaAbierta || !companero || avisoPermuta || !exigirEdicion()) return;
            stage({ kind: 'permuta', franjaId: franjaAbierta.id, otroId: companero.id });
          }}
          onFranco={() => {
            if (!franjaAbierta || !exigirEdicion()) return;
            stage({ kind: 'franco', franjaId: franjaAbierta.id });
          }}
        />
      </BottomSheet>
      <MovilBottomNav />
    </>
  );
}

async function escribirCambio(cambio: CambioLocal, originales: TurnoMovil[], aplicados: TurnoMovil[], empresaId: string, actorName: string, creados: Map<string, string>) {
  const origen = originales.find((t) => t.id === cambio.franjaId) || aplicados.find((t) => t.id === cambio.franjaId);
  if (!origen) return;
  const idReal = creados.get(cambio.franjaId);
  if (cambio.kind === 'asignar') {
    const banda = bandaParaCubrir({ ...origen, kind: origen.vacante ? 'vacante' : origen.licencia ? 'licencia' : 'ok' });
    if (origen.licencia) {
      await updateDoc(doc(db, 'turnos', origen.id), stampEmpresaId({ coveredBy: cambio.employeeName, draft: false, actorName }, empresaId));
      await addDoc(collection(db, 'turnos'), stampEmpresaId(payloadTurno({
        ...origen,
        employeeId: cambio.employeeId,
        employeeName: cambio.employeeName,
        code: banda.code,
        start: banda.start,
        end: banda.end,
        hours: banda.hours,
        franco: false,
        ft: cambio.ft,
        bolsaCuil: cambio.bolsaCuil,
        actorName,
        comments: 'Cobertura de licencia desde el celular',
      }), empresaId));
      return;
    }
    const inst = instantesJornada(origen.date, banda.start, banda.end, false);
    const destino = idReal || origen.id;
    if (idReal || originales.some((t) => t.id === origen.id)) {
    await updateDoc(doc(db, 'turnos', destino), stampEmpresaId({
      employeeId: cambio.employeeId,
      employeeName: cambio.employeeName,
      code: banda.code,
      type: banda.code,
      startTime: Timestamp.fromDate(inst.start),
      endTime: Timestamp.fromDate(inst.end),
      isUnassigned: false,
      isFrancoTrabajado: cambio.ft,
      draft: false,
      esEventual: Boolean(cambio.bolsaCuil),
      bolsaCuil: cambio.bolsaCuil || null,
      actorName,
      comments: 'Asignación desde el celular',
      updatedAt: serverTimestamp(),
    }, empresaId));
    return;
    }
    return;
  }
  if (cambio.kind === 'horario') {
    const inst = instantesJornada(origen.date, cambio.start, cambio.end, false);
    await updateDoc(doc(db, 'turnos', origen.id), stampEmpresaId({
      code: cambio.code,
      type: cambio.code,
      startTime: Timestamp.fromDate(inst.start),
      endTime: Timestamp.fromDate(inst.end),
      hours: cambio.hours,
      isFranco: false,
      draft: false,
      actorName,
      comments: 'Cambio de horario desde el celular',
      updatedAt: serverTimestamp(),
    }, empresaId));
    return;
  }
  if (cambio.kind === 'franco') {
    const inst = instantesJornada(origen.date, origen.start, origen.end, true);
    await updateDoc(doc(db, 'turnos', origen.id), stampEmpresaId({
      code: 'F',
      type: 'F',
      isFranco: true,
      startTime: Timestamp.fromDate(inst.start),
      endTime: Timestamp.fromDate(inst.end),
      hours: 0,
      draft: false,
      actorName,
      comments: 'Franco desde el celular',
      updatedAt: serverTimestamp(),
    }, empresaId));
    const vacanteRef = doc(collection(db, 'turnos'));
    await setDoc(vacanteRef, stampEmpresaId(payloadTurno({
      ...origen,
      employeeId: 'VACANTE',
      employeeName: 'Vacante',
      franco: false,
      ft: false,
      actorName,
      comments: 'Hueco por franco desde el celular',
    }), empresaId));
    creados.set(`vacante:${origen.id}`, vacanteRef.id);
    return;
  }
  const otro = originales.find((t) => t.id === cambio.otroId);
  const a = aplicados.find((t) => t.id === cambio.franjaId);
  const b = aplicados.find((t) => t.id === cambio.otroId);
  if (!otro || !a || !b) return;
  await updateDoc(doc(db, 'turnos', origen.id), stampEmpresaId({
    employeeId: a.employeeId, employeeName: a.employeeName, draft: false, actorName, comments: 'Permuta desde el celular', updatedAt: serverTimestamp(),
  }, empresaId));
  await updateDoc(doc(db, 'turnos', otro.id), stampEmpresaId({
    employeeId: b.employeeId, employeeName: b.employeeName, draft: false, actorName, comments: 'Permuta desde el celular', updatedAt: serverTimestamp(),
  }, empresaId));
}

function payloadTurno(input: TurnoMovil & { ft: boolean; actorName: string; comments: string; bolsaCuil?: string }) {
  const inst = instantesJornada(input.date, input.start, input.end, input.franco);
  return {
    employeeId: input.employeeId,
    employeeName: input.employeeName,
    clientId: input.clientId,
    clientName: input.clientName,
    objectiveId: input.objectiveId,
    objectiveName: input.objectiveName,
    code: input.code,
    type: input.code,
    startTime: Timestamp.fromDate(inst.start),
    endTime: Timestamp.fromDate(inst.end),
    scheduleDate: input.date,
    isFranco: input.franco,
    isFrancoTrabajado: input.ft,
    isUnassigned: input.employeeId === 'VACANTE',
    positionName: input.positionName,
    hours: input.hours,
    draft: false,
    esEventual: Boolean(input.bolsaCuil),
    bolsaCuil: input.bolsaCuil || null,
    comments: input.comments,
    actorName: input.actorName,
    createdAt: serverTimestamp(),
  };
}
