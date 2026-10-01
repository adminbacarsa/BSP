import { useCallback, useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { toast } from 'sonner';
import { httpsCallable } from 'firebase/functions';
import { onSnapshot, type QueryDocumentSnapshot } from 'firebase/firestore';
import { BottomSheet } from '@/components/movil/BottomSheet';
import { MovilBottomNav } from '@/components/movil/MovilBottomNav';
import { useEmpresaSheet } from '@/components/movil/useEmpresaSheet';
import { CambioPuntual, CandidatosHueco, PlanificacionMovilView, type EventualMovil } from '@/components/movil/PlanificacionMovilView';
import {
  BarraPublicar, CeldaSheetBody, SelectorObjetivoSheetBody, SemanaEncabezado, SemanaGrilla, type PanelPlanificacion,
} from '@/components/movil/PlanificacionSemanaView';
import { useOnlineFlag } from '@/components/movil/OperacionScreens';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';
import { useCronogramaSinPublicar } from '@/hooks/useCronogramaSinPublicar';
import { functions } from '@/lib/firebase';
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
  proximosDias,
  turnoMovilDesdeDoc,
  type CambioLocal,
  type EmpleadoMovil,
  type FranjaMovil,
  type TabCandidato,
  type TurnoMovil,
} from '@/lib/movil/planificacionBasica';
import { escribirLote, publicarMes } from '@/lib/movil/planificacionEscritura';
import {
  celdasSemana,
  clientesParaSelector,
  estructuraSlaDelMes,
  esSlotSintetico,
  filasSemana,
  guardarSeleccion,
  huecoDeCelda,
  huecosSemana,
  leerSeleccion,
  licenciasSemana,
  lunesDe,
  mesDeSemana,
  mesesDeSemana,
  semanaAnterior,
  semanaDe,
  semanaSiguiente,
  type CeldaSemana,
  type ClienteCatalogo,
  type SeleccionPlan,
} from '@/lib/movil/planificacionSemana';
import { canAssignFrancoTrabajado } from '@/lib/planificacion/francoTrabajadoAccess';
import { buildPlanningMonthTurnosQuery } from '@/lib/planificacion/loadPlanningMonthShifts';
import { ingestPlanningTurnosSnapshot } from '@/lib/planificacion/planningTurnosIngest';
import { belongsToEmpresaView, empresaCollectionQuery, fetchPlanificacionPublishStatus } from '@/lib/multiempresa';
import type { SlaPlanningRow } from '@/lib/slaPlanningMatch';
import { shouldScopeQueriesToEmpresa } from '@/lib/tenantScope';
import { asignarEventualPlanificacion, canConvocarEventuales, eventualErrorMessage } from '@/services/eventualesPlanificacionService';

type ObjGeo = { id: string; name: string; clientId: string; clientName: string; lat: number | null; lng: number | null };
type Sheet =
  | { tipo: 'selector' }
  | { tipo: 'celda'; filaId: string; fecha: string }
  | { tipo: 'cubrir'; franja: FranjaMovil; reemplazo: boolean }
  | { tipo: 'cambiar'; franjaId: string };

const MESES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

function primero(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || '' : value || '';
}

function mesLabelDe(ym: string): string {
  const [, m] = ym.split('-').map(Number);
  return MESES_LARGO[m - 1] || ym;
}

export function PlanificacionMovil() {
  const { empresaId, empresa } = useEmpresa();
  const { isSuperAdmin, rolePermissions, canReadModule, user } = useAuth();
  const online = useOnlineFlag();
  const empresaSheet = useEmpresaSheet();
  const router = useRouter();
  const [readyTurnos, setReadyTurnos] = useState(false);
  const [turnos, setTurnos] = useState<TurnoMovil[]>([]);
  const [empleados, setEmpleados] = useState<EmpleadoMovil[]>([]);
  const [objetivos, setObjetivos] = useState<ObjGeo[]>([]);
  const [clientesCat, setClientesCat] = useState<ClienteCatalogo[]>([]);
  const [slas, setSlas] = useState<SlaPlanningRow[]>([]);
  const [publicado, setPublicado] = useState<Record<string, { publishedAt: boolean; publishedBy: string | null }>>({});
  const [cambios, setCambios] = useState<CambioLocal[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [dia, setDia] = useState(() => hoyArgentina());
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [tab, setTab] = useState<TabCandidato | 'eventuales'>('plantel');
  const [elegido, setElegido] = useState<string | null>(null);
  const [codigo, setCodigo] = useState<string | null>(null);
  const [companeroId, setCompaneroId] = useState<string | null>(null);
  const [eventuales, setEventuales] = useState<EventualMovil[]>([]);
  const [hoy] = useState(() => hoyArgentina());
  const [lunes, setLunes] = useState(() => lunesDe(hoyArgentina()));
  const [seleccion, setSeleccion] = useState<SeleccionPlan>(null);
  const [seleccionLista, setSeleccionLista] = useState(false);
  const dias = useMemo(() => proximosDias(hoy, 4), [hoy]);

  const panel: PanelPlanificacion = primero(router.query.panel as string | string[] | undefined) === 'dias' ? 'dias' : 'semana';
  const migracionCompleta = (empresa as { migracionCompleta?: boolean } | null)?.migracionCompleta === true;
  const scopeEmpresa = shouldScopeQueriesToEmpresa(empresaId, migracionCompleta);
  const puedeLeer = isSuperAdmin || canReadModule('PLANNING');
  const puedeEditar = isSuperAdmin || (rolePermissions.PLANNING || []).some((a) => a === 'create' || a === 'update');
  const puedeCorregir = isSuperAdmin || (rolePermissions.PLANNING || []).includes('correct');
  const puedePublicarMes = isSuperAdmin || (rolePermissions.PLANNING || []).includes('publish');
  const puedeFt = canAssignFrancoTrabajado(isSuperAdmin, rolePermissions);
  const puedeEventuales = canConvocarEventuales(isSuperAdmin, rolePermissions);
  const actorName = user?.displayName || user?.email || 'Planificación celular';
  const cronograma = useCronogramaSinPublicar(empresaId, puedeLeer);

  useEffect(() => movilWriteQueue.subscribe(() => {
    const labels = [...movilWriteQueue.pending(), ...movilCallableGate.pending()];
    setPending(labels[0] || null);
  }), []);

  // Deep link (`?objectiveId=&clientId=&year=&month=`, el mismo de la alerta de cronograma) o el último objetivo elegido.
  useEffect(() => {
    if (!empresaId || !router.isReady) return;
    const objectiveId = primero(router.query.objectiveId as string | string[] | undefined);
    const clientId = primero(router.query.clientId as string | string[] | undefined);
    const year = Number(primero(router.query.year as string | string[] | undefined));
    const month = Number(primero(router.query.month as string | string[] | undefined));
    if (objectiveId) {
      setSeleccion({ clientId, objectiveId });
      if (year > 2000 && month >= 1 && month <= 12) setLunes(lunesDe(`${year}-${String(month).padStart(2, '0')}-01`));
    } else {
      setSeleccion(leerSeleccion(empresaId));
    }
    setSeleccionLista(true);
  }, [empresaId, router.isReady, router.query.objectiveId, router.query.clientId, router.query.year, router.query.month]);

  const mesesCarga = useMemo(() => [...new Set([...dias.map((f) => f.slice(0, 7)), ...mesesDeSemana(lunes)])].sort(), [dias, lunes]);

  useEffect(() => {
    if (!empresaId || !puedeLeer) return;
    const bags = new Map<string, TurnoMovil[]>();
    const unsubs = mesesCarga.map((ym) => {
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
  }, [empresaId, scopeEmpresa, migracionCompleta, puedeLeer, mesesCarga]);

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
      const cat: ClienteCatalogo[] = [];
      snap.forEach((item) => {
        const data = item.data() as Record<string, unknown>;
        if (!belongsToEmpresaView(data, empresaId, migracionCompleta)) return;
        if (String(data.status || 'ACTIVE').toUpperCase() === 'INACTIVE') return;
        const objetivosCliente = Array.isArray(data.objetivos) ? data.objetivos as Record<string, unknown>[] : [];
        const clientName = String(data.name || data.razonSocial || '');
        const objs: ClienteCatalogo['objetivos'] = [];
        for (const obj of objetivosCliente) {
          const id = String(obj.id || '');
          if (!id) continue;
          if (String(obj.status || 'ACTIVE').toUpperCase() === 'INACTIVE') continue;
          const name = String(obj.name || obj.nombre || id);
          objs.push({ id, name, objectiveId: typeof obj.objectiveId === 'string' ? obj.objectiveId : undefined });
          list.push({ id, name, clientId: item.id, clientName, lat: num(obj.lat ?? obj.latitude), lng: num(obj.lng ?? obj.longitude) });
        }
        cat.push({ id: item.id, name: clientName, objetivos: objs });
      });
      setObjetivos(list);
      setClientesCat(cat);
    });
  }, [empresaId, scopeEmpresa, migracionCompleta, puedeLeer]);

  useEffect(() => {
    if (!empresaId || !puedeLeer) return;
    const q = empresaCollectionQuery('servicios_sla', empresaId, scopeEmpresa);
    return onSnapshot(q, (snap) => {
      setSlas(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as SlaPlanningRow));
    });
  }, [empresaId, scopeEmpresa, puedeLeer]);

  const visibles = useMemo(() => aplicarCambios(turnos, cambios), [turnos, cambios]);
  const franjas = useMemo(() => franjasDe(visibles, dias), [visibles, dias]);

  const diasSemana = useMemo(() => semanaDe(lunes), [lunes]);
  const ymSemana = mesDeSemana(lunes);
  const objetivoSel = objetivos.find((o) => o.id === seleccion?.objectiveId) || null;
  const clienteSel = clientesCat.find((c) => c.id === (seleccion?.clientId || objetivoSel?.clientId)) || null;
  const estructura = useMemo(() => {
    if (!objetivoSel) return null;
    return estructuraSlaDelMes({
      slas, empresaId, scopeEmpresa, clientes: clientesCat, clientId: clienteSel?.id || objetivoSel.clientId, objectiveId: objetivoSel.id, ym: ymSemana,
    });
  }, [slas, empresaId, scopeEmpresa, clientesCat, clienteSel, objetivoSel, ymSemana]);
  const filas = useMemo(() => (estructura ? filasSemana(estructura.estructura) : []), [estructura]);
  const celdas = useMemo(() => (objetivoSel ? celdasSemana(filas, diasSemana, visibles, objetivoSel.id) : []), [filas, diasSemana, visibles, objetivoSel]);
  const licencias = useMemo(() => (objetivoSel ? licenciasSemana(diasSemana, visibles, objetivoSel.id) : []), [diasSemana, visibles, objetivoSel]);
  const huecos = useMemo(() => huecosSemana(celdas, licencias), [celdas, licencias]);
  const keyMes = objetivoSel ? `${objetivoSel.id}|${ymSemana}` : null;
  const estadoMes = keyMes ? publicado[keyMes] ?? null : null;

  useEffect(() => {
    const keys = new Set(turnos.map((t) => `${t.objectiveId}|${t.date.slice(0, 7)}`).filter((key) => key.split('|')[0]));
    if (keyMes) keys.add(keyMes);
    if (!empresaId || keys.size === 0) return;
    let alive = true;
    void Promise.all([...keys].map(async (key) => {
      const [objectiveId, ym] = key.split('|');
      const [year, month] = ym.split('-').map(Number);
      const status = await fetchPlanificacionPublishStatus(empresaId, objectiveId, year, month);
      return [key, { publishedAt: Boolean(status?.publishedAt), publishedBy: status?.publishedBy || null }] as const;
    })).then((rows) => {
      if (!alive) return;
      setPublicado(Object.fromEntries(rows));
    }).catch(() => {});
    return () => { alive = false; };
  }, [empresaId, turnos, keyMes]);

  const mesesPublicados = useMemo(() => {
    const keys = new Set(franjas.map((f) => `${f.objectiveId}|${f.date.slice(0, 7)}`));
    if (keys.size === 0) return false;
    return [...keys].every((key) => publicado[key]?.publishedAt === true);
  }, [franjas, publicado]);

  const celdaAbierta: CeldaSemana | null = sheet?.tipo === 'celda'
    ? celdas.flat().find((c) => c.fila.id === sheet.filaId && c.fecha === sheet.fecha) || null
    : null;
  const franjaAbierta: FranjaMovil | null = useMemo(() => {
    if (sheet?.tipo === 'cubrir') {
      const vivo = visibles.find((t) => t.id === sheet.franja.id);
      return vivo ? { ...vivo, kind: sheet.reemplazo ? 'vacante' : vivo.vacante ? 'vacante' : vivo.licencia ? 'licencia' : 'ok' } : sheet.franja;
    }
    if (sheet?.tipo === 'cambiar') {
      const vivo = visibles.find((t) => t.id === sheet.franjaId);
      return vivo ? { ...vivo, kind: vivo.vacante ? 'vacante' : vivo.licencia ? 'licencia' : 'ok' } : null;
    }
    return null;
  }, [sheet, visibles]);
  const objetivo = objetivos.find((o) => o.id === franjaAbierta?.objectiveId);

  const candidatos = useMemo(() => {
    if (!franjaAbierta || franjaAbierta.kind === 'ok') return [];
    const ym = franjaAbierta.date.slice(0, 7);
    // Al reemplazar, el titular actual no compite consigo mismo.
    const base = sheet?.tipo === 'cubrir' && sheet.reemplazo ? visibles.filter((t) => t.id !== franjaAbierta.id) : visibles;
    return candidatosParaHueco({
      hueco: franjaAbierta,
      turnos: base,
      objLat: objetivo?.lat,
      objLng: objetivo?.lng,
      empleados: empleados.map((emp) => ({ ...emp, monthHours: horasMesEmpleado(emp.id, ym, base) })),
    }).filter((c) => !(sheet?.tipo === 'cubrir' && sheet.reemplazo && c.employeeId === franjaAbierta.employeeId));
  }, [franjaAbierta, visibles, empleados, objetivo, sheet]);

  const companeros = franjaAbierta
    ? visibles.filter((f) => f.date === franjaAbierta.date && f.objectiveId === franjaAbierta.objectiveId && !f.vacante && !f.licencia && !f.franco && f.id !== franjaAbierta.id)
    : [];
  const bandaElegida = codigo ? bandaDe(codigo) : null;
  const avisoHorario = franjaAbierta && bandaElegida
    ? conflictosDeHorario(franjaAbierta, codigo!, bandaElegida.start, bandaElegida.end, bandaElegida.hours, visibles).reason
    : null;
  const companero = companeros.find((c) => c.id === companeroId) || null;
  const avisoPermuta = franjaAbierta && companero
    ? conflictosDePermuta(franjaAbierta, companero, visibles).reason
    : null;
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
    toast.message(estadoMes?.publishedAt ? 'Quedó para publicar la corrección' : 'Quedó en el borrador');
  };

  const elegirObjetivo = useCallback((clientId: string, objectiveId: string) => {
    const sel = { clientId, objectiveId };
    setSeleccion(sel);
    guardarSeleccion(empresaId, sel);
    setSheet(null);
    if (router.query.objectiveId) void router.replace({ pathname: router.pathname, query: {} }, undefined, { shallow: true });
  }, [empresaId, router]);

  const confirmarCandidato = async () => {
    if (!franjaAbierta || !elegido || !exigirEdicion()) return;
    const sintetico = esSlotSintetico(franjaAbierta.id);
    const emitir = (employeeId: string, employeeName: string, ft: boolean, bolsaCuil?: string) => {
      if (sintetico) stage({ kind: 'nuevo', franja: franjaAbierta, employeeId, employeeName, ft, bolsaCuil });
      else stage({ kind: 'asignar', franjaId: franjaAbierta.id, employeeId, employeeName, ft, bolsaCuil });
    };
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
        emitir(res.employeeId, res.nombre || ev?.nombre || 'Eventual', false, elegido);
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
    emitir(cand.employeeId, cand.name, cand.tab === 'ft');
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

  /** Guarda el lote: borrador si el mes no está publicado; corrección (`draft:false`, con aviso al guardia) si lo está. */
  const guardarCambios = async () => {
    if (cambios.length === 0) return;
    const afectados = new Set<string>();
    for (const cambio of cambios) {
      const franja = cambio.kind === 'nuevo' ? cambio.franja : turnos.find((t) => t.id === cambio.franjaId) || visibles.find((t) => t.id === cambio.franjaId);
      if (franja?.objectiveId) afectados.add(`${franja.objectiveId}|${franja.date.slice(0, 7)}`);
    }
    let algunoPublicado = false;
    let algunoBorrador = false;
    for (const key of afectados) {
      const [objectiveId, ym] = key.split('|');
      const [year, month] = ym.split('-').map(Number);
      const status = await fetchPlanificacionPublishStatus(empresaId, objectiveId, year, month);
      if (status?.publishedAt) algunoPublicado = true;
      else algunoBorrador = true;
    }
    if (algunoPublicado && !puedeCorregir) {
      toast.error('Falta el permiso para publicar la corrección.');
      return;
    }
    if (algunoBorrador && !puedeEditar) {
      toast.error('No tenés permiso para modificar la planificación.');
      return;
    }
    const lote = cambios;
    const base = turnos;
    const borrador = !algunoPublicado;
    const label = borrador ? `Borrador · ${lote.length} cambio${lote.length === 1 ? '' : 's'}` : `Corrección de ${lote.length} cambio${lote.length === 1 ? '' : 's'}`;
    const result = await enqueueFirestoreWrite(label, () => escribirLote(lote, base, { empresaId, actorName, borrador }));
    setCambios([]);
    if (result === 'queued') toast.message('Pendiente de enviar');
    else if (borrador) toast.success('Borrador guardado. Publicá el mes para avisar a los guardias.');
    else toast.success('Corrección publicada. El guardia recibe el aviso.');
  };

  const publicarElMes = async () => {
    if (!objetivoSel || !puedePublicarMes) {
      toast.error('Falta el permiso para publicar el cronograma.');
      return;
    }
    if (cambios.length > 0) {
      toast.error('Guardá primero los cambios pendientes.');
      return;
    }
    const ym = ymSemana;
    const result = await enqueueFirestoreWrite(`Publicar ${mesLabelDe(ym)} · ${objetivoSel.name}`, async () => {
      await publicarMes({ empresaId, objectiveId: objetivoSel.id, objectiveName: objetivoSel.name, clientId: objetivoSel.clientId, ym, migracionCompleta });
    });
    if (result === 'queued') {
      toast.message('Pendiente de enviar');
      return;
    }
    setPublicado((prev) => ({ ...prev, [`${objetivoSel.id}|${ym}`]: { publishedAt: true, publishedBy: actorName } }));
    toast.success(`Cronograma de ${mesLabelDe(ym)} publicado. Los guardias reciben el aviso.`);
  };

  const irAPanel = (p: PanelPlanificacion) => {
    const query = p === 'dias' ? { panel: 'dias' } : {};
    void router.replace({ pathname: router.pathname, query }, undefined, { shallow: true });
  };

  if (!puedeLeer) {
    return <p className="p-6 text-sm font-medium text-slate-600">No tenés permiso de planificación.</p>;
  }

  const sinEstructura = objetivoSel && estructura && !estructura.conSla
    ? 'Sin contrato vigente en este mes: se muestra la estructura por defecto (M/T/N).'
    : null;

  return (
    <>
      <Head><title>Planificación · COSP</title></Head>
      <PlanificacionMovilView
        empresa={empresa?.name || empresaId}
        onEmpresa={empresaSheet.onEmpresa}
        online={online}
        pendingLabel={pending}
        panel={panel}
        onPanel={irAPanel}
        semana={(
          <>
            <SemanaEncabezado
              clienteNombre={clienteSel?.name || objetivoSel?.clientName || null}
              objetivoNombre={objetivoSel?.name || (seleccionLista && seleccion && !objetivoSel ? 'Objetivo no disponible' : null)}
              onSelector={() => setSheet({ tipo: 'selector' })}
              publicado={estadoMes ? estadoMes.publishedAt : null}
              publicadoPor={estadoMes?.publishedBy}
              huecos={huecos}
              cambios={cambios.length}
              mesLabel={mesLabelDe(ymSemana)}
            />
            {objetivoSel ? (
              <div className="mt-3">
                <SemanaGrilla
                  lunes={lunes}
                  dias={diasSemana}
                  hoy={hoy}
                  filas={filas}
                  celdas={celdas}
                  licencias={licencias}
                  sinEstructura={sinEstructura}
                  onAnterior={() => setLunes((l) => semanaAnterior(l))}
                  onSiguiente={() => setLunes((l) => semanaSiguiente(l))}
                  onCelda={(celda) => setSheet({ tipo: 'celda', filaId: celda.fila.id, fecha: celda.fecha })}
                  onLicencia={(turno) => {
                    if (!exigirEdicion()) return;
                    if (turno.coveredBy) return;
                    setSheet({ tipo: 'cubrir', franja: { ...turno, kind: 'licencia' }, reemplazo: false });
                  }}
                />
              </div>
            ) : (
              <p className="px-3 pt-6 text-center text-[13px] font-medium text-slate-400">{seleccionLista ? 'Elegí un objetivo para ver la semana.' : 'Cargando…'}</p>
            )}
          </>
        )}
        dias={dias}
        dia={dias.includes(dia) ? dia : dias[0]}
        franjas={franjas}
        porPublicar={panel === 'dias' ? cambios.length : 0}
        puedePublicar={mesesPublicados ? puedeCorregir : puedeEditar}
        mesPublicado={mesesPublicados || !readyTurnos}
        cronograma={cronograma.gruposPlanificacion}
        onCronogramaVista={(ids) => {
          void cronograma.marcarVista(ids, 'PLANIFICACION')
            .then((n) => { if (n > 0) toast.success(n === 1 ? 'Alerta marcada como vista' : `${n} alertas marcadas como vistas`); })
            .catch(() => toast.error('No se pudo marcar como vista'));
        }}
        onCronogramaPublicar={(item) => {
          // Abre ese objetivo y mes en la semana; desde ahí se publica con el permiso `publish`.
          const obj = objetivos.find((o) => o.id === item.objectiveId);
          elegirObjetivo(item.clientId || obj?.clientId || '', item.objectiveId);
          setLunes(lunesDe(`${item.year}-${String(item.month).padStart(2, '0')}-01`));
          if (panel !== 'semana') irAPanel('semana');
        }}
        onDia={setDia}
        onHueco={(franja) => { if (exigirEdicion()) setSheet({ tipo: 'cubrir', franja, reemplazo: false }); }}
        onAsignado={(franja) => { if (exigirEdicion()) setSheet({ tipo: 'cambiar', franjaId: franja.id }); }}
        onPublicar={() => { void guardarCambios(); }}
      />
      {panel === 'semana' && objetivoSel && (
        <BarraPublicar
          cambios={cambios.length}
          publicado={estadoMes ? estadoMes.publishedAt : null}
          puedeEditar={puedeEditar}
          puedeCorregir={puedeCorregir}
          puedePublicar={puedePublicarMes}
          mesLabel={mesLabelDe(ymSemana)}
          onGuardar={() => { void guardarCambios(); }}
          onPublicarMes={() => { void publicarElMes(); }}
        />
      )}
      <BottomSheet open={sheet?.tipo === 'selector'} title="Cliente y objetivo" onClose={cerrar}>
        <SelectorObjetivoSheetBody clientes={clientesParaSelector(clientesCat)} seleccion={seleccion} onElegir={elegirObjetivo} />
      </BottomSheet>
      <BottomSheet open={sheet?.tipo === 'celda'} title={celdaAbierta ? `${celdaAbierta.fila.code} · ${celdaAbierta.fecha.slice(8, 10)}/${celdaAbierta.fecha.slice(5, 7)}` : 'Celda'} onClose={cerrar}>
        {celdaAbierta && objetivoSel && (
          <CeldaSheetBody
            celda={celdaAbierta}
            onGuardia={(turno) => { if (exigirEdicion()) setSheet({ tipo: 'cambiar', franjaId: turno.id }); }}
            onCubrir={() => { if (exigirEdicion()) setSheet({ tipo: 'cubrir', franja: huecoDeCelda(celdaAbierta, objetivoSel), reemplazo: false }); }}
          />
        )}
      </BottomSheet>
      <BottomSheet open={sheet?.tipo === 'cubrir'} title={franjaAbierta ? `${sheet?.tipo === 'cubrir' && sheet.reemplazo ? 'Cambiar guardia' : 'Cubrir'} ${franjaAbierta.code} ${franjaAbierta.start}` : 'Cubrir'} onClose={cerrar}>
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
          onCambiarGuardia={() => {
            if (!franjaAbierta || !exigirEdicion()) return;
            setSheet({ tipo: 'cubrir', franja: { ...franjaAbierta, kind: 'vacante' }, reemplazo: true });
          }}
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
          onBorrar={() => {
            if (!franjaAbierta || !exigirEdicion()) return;
            stage({ kind: 'borrar', franjaId: franjaAbierta.id });
          }}
        />
      </BottomSheet>
      {empresaSheet.sheet}
      <MovilBottomNav />
    </>
  );
}
