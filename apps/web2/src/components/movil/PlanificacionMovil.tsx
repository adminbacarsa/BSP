import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { toast } from 'sonner';
import { httpsCallable } from 'firebase/functions';
import { onSnapshot, type QueryDocumentSnapshot } from 'firebase/firestore';
import { BottomSheet } from '@/components/movil/BottomSheet';
import { MovilBottomNav } from '@/components/movil/MovilBottomNav';
import { useEmpresaSheet } from '@/components/movil/useEmpresaSheet';
import { CambioPuntual, CandidatosHueco, PlanificacionMovilView, type EventualMovil } from '@/components/movil/PlanificacionMovilView';
import { ConsultaDisponibilidadEstado } from '@/components/eventuales/ConsultaDisponibilidadEstado';
import { ConsultasEnCursoPill } from '@/components/planificacion/ConsultasEnCurso';
import { useConsultasDisponibilidadObjetivo } from '@/hooks/useConsultasDisponibilidadObjetivo';
import { consultaAbiertaEnFecha, novedadesDeConsultas, textoIndicadorConsulta, textoTooltipConsulta, type ConsultaCurso } from '@/lib/planificacion/coberturaEventualesUx';
import {
  BarraPublicar, CeldaSheetBody, SelectorObjetivoSheetBody, SemanaEncabezado, SemanaGrilla, type PanelPlanificacion,
} from '@/components/movil/PlanificacionSemanaView';
import { useOnlineFlag } from '@/components/movil/OperacionScreens';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';
import { useGuardiaPuntaje } from '@/context/guardiaPuntajeStore';
import { useCronogramaSinPublicar } from '@/hooks/useCronogramaSinPublicar';
import { functions } from '@/lib/firebase';
import { getDateKeyInTimezone } from '@/lib/crm/crmDateUtils';
import { runCallableOnline, movilCallableGate } from '@/lib/movil/callableOnline';
import { enqueueFirestoreWrite, movilWriteQueue } from '@/lib/movil/writeQueue';
import {
  aplicarCambios,
  bandaParaCubrir,
  aplicarCoberturaExistenteMovil,
  candidatosParaHueco,
  companerosCompatibles,
  conflictosDeHorario,
  conflictosDePermuta,
  franjasDe,
  horasMesEmpleado,
  hoyArgentina,
  proximosDias,
  turnoMovilDesdeDoc,
  type BandaCobertura,
  type CambioLocal,
  type EmpleadoMovil,
  type FranjaMovil,
  type TabCandidato,
  type TurnoMovil,
} from '@/lib/movil/planificacionBasica';
import { escribirLote } from '@/lib/movil/planificacionEscritura';
import {
  AVISO_MES_SIN_PUBLICAR,
  celdasSemana,
  clientesParaSelector,
  estructuraSlaDelMes,
  esSlotSintetico,
  eventosSemana,
  filasSemana,
  guardarSeleccion,
  huecoDeCelda,
  huecosSemana,
  leerSeleccion,
  licenciasSemana,
  lunesDe,
  mesDeSemana,
  mesPublicadoDe,
  mesesDeSemana,
  opcionDelTurno,
  opcionesTurnoDelDia,
  plantelDe,
  puedeCorregirEnCelular,
  AVISO_MES_CERRADO,
  puestoDe,
  semanaAnterior,
  semanaDe,
  semanaSiguiente,
  type CeldaSemana,
  type ClienteCatalogo,
  type OpcionTurno,
  type SeleccionPlan,
} from '@/lib/movil/planificacionSemana';
import { canAssignFrancoTrabajado } from '@/lib/planificacion/francoTrabajadoAccess';
import { mesCerrado } from '@/lib/planificacion/mesCerradoPlanif';
import { buildPlanningMonthTurnosQuery } from '@/lib/planificacion/loadPlanningMonthShifts';
import { ingestPlanningTurnosSnapshot } from '@/lib/planificacion/planningTurnosIngest';
import { belongsToEmpresaView, empresaCollectionQuery, fetchPlanificacionPublishStatus } from '@/lib/multiempresa';
import type { SlaPlanningRow } from '@/lib/slaPlanningMatch';
import { shouldScopeQueriesToEmpresa } from '@/lib/tenantScope';
import { canConsultarDisponibilidad, canConvocarEventuales, eventualErrorMessage } from '@/services/eventualesPlanificacionService';

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
  const { totalDe } = useGuardiaPuntaje();
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
  const [opcionCubrir, setOpcionCubrir] = useState<string | null>(null);
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
  // El celular no publica meses ni guarda borradores: solo corrige un mes publicado (permiso `correct`).
  const puedeCorregir = isSuperAdmin || (rolePermissions.PLANNING || []).includes('correct');
  const puedeFt = canAssignFrancoTrabajado(isSuperAdmin, rolePermissions);
  const puedeEventuales = canConvocarEventuales(isSuperAdmin, rolePermissions);
  const puedeConsultar = canConsultarDisponibilidad(isSuperAdmin, rolePermissions);
  const veBolsa = puedeEventuales || puedeConsultar;
  const [consultaCuils, setConsultaCuils] = useState<string[]>([]);
  /** Francos marcados para consultarlos como FT (regla 06/10: al franco se le pregunta, no se asigna). */
  const [consultaFtIds, setConsultaFtIds] = useState<string[]>([]);
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
        const views = Object.values(ingested.cellTurnosMap).flat() as Array<Record<string, unknown> & { id: string }>;
        const rows: TurnoMovil[] = [];
        for (const view of views) {
          const row = turnoMovilDesdeDoc(String(view.id), view);
          if (row) rows.push(row);
        }
        bags.set(ym, aplicarCoberturaExistenteMovil(rows, views));
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
  const consultasObj = useConsultasDisponibilidadObjetivo(empresaId, objetivoSel?.id, !!objetivoSel && puedeConsultar);
  const consultasPrevRef = useRef<typeof consultasObj | null>(null);
  const [consultaFoco, setConsultaFoco] = useState<string | null>(null);
  const [consultaTick, setConsultaTick] = useState(0);
  const clienteSel = clientesCat.find((c) => c.id === (seleccion?.clientId || objetivoSel?.clientId)) || null;
  const estructura = useMemo(() => {
    if (!objetivoSel) return null;
    return estructuraSlaDelMes({
      slas, empresaId, scopeEmpresa, clientes: clientesCat, clientId: clienteSel?.id || objetivoSel.clientId, objectiveId: objetivoSel.id, ym: ymSemana,
    });
  }, [slas, empresaId, scopeEmpresa, clientesCat, clienteSel, objetivoSel, ymSemana]);
  const filasBase = useMemo(() => (estructura ? filasSemana(estructura.estructura) : []), [estructura]);
  const celdasBase = useMemo(() => (objetivoSel ? celdasSemana(filasBase, diasSemana, visibles, objetivoSel.id) : []), [filasBase, diasSemana, visibles, objetivoSel]);
  const exigeCobertura = estructura?.exigeCobertura !== false;
  const filas = useMemo(() => {
    if (exigeCobertura) return filasBase;
    return filasBase.filter((_, i) => (celdasBase[i] || []).some((c) => c.guardias.some((g) => !g.vacante)));
  }, [filasBase, celdasBase, exigeCobertura]);
  const celdas = useMemo(() => {
    if (exigeCobertura) return celdasBase;
    return celdasBase.filter((row) => row.some((c) => c.guardias.some((g) => !g.vacante)));
  }, [celdasBase, exigeCobertura]);
  const licencias = useMemo(() => (objetivoSel ? licenciasSemana(diasSemana, visibles, objetivoSel.id) : []), [diasSemana, visibles, objetivoSel]);
  // Guardias del plantel afectados a un evento: el EV vive en el objetivo del evento, se busca por guardia.
  const eventosPlantel = useMemo(() => (objetivoSel ? eventosSemana(diasSemana, visibles, plantelDe(visibles, objetivoSel.id, empleados)) : []), [diasSemana, visibles, objetivoSel, empleados]);
  const huecos = useMemo(() => huecosSemana(celdas, licencias), [celdas, licencias]);
  const keyMes = objetivoSel ? `${objetivoSel.id}|${ymSemana}` : null;
  const estadoMes = keyMes ? publicado[keyMes] ?? null : null;
  /** Semana en solo lectura hasta que el mes figure publicado (sin estado = sin publicar). */
  const [anioSemana, mesSemanaNum] = ymSemana.split('-').map(Number);
  const semanaCerrada = mesCerrado(anioSemana, mesSemanaNum);
  const semanaSoloLectura = semanaCerrada || estadoMes?.publishedAt !== true;

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

  // Turnos del SLA de ese puesto y ese día: la misma estructura que arma la semana (y la grilla).
  const opcionesFranja: OpcionTurno[] = useMemo(() => {
    if (!franjaAbierta) return [];
    const ym = franjaAbierta.date.slice(0, 7);
    const obj = objetivos.find((o) => o.id === franjaAbierta.objectiveId);
    const estr = estructura && objetivoSel?.id === franjaAbierta.objectiveId && ym === ymSemana
      ? estructura.estructura
      : obj
        ? estructuraSlaDelMes({ slas, empresaId, scopeEmpresa, clientes: clientesCat, clientId: franjaAbierta.clientId || obj.clientId, objectiveId: obj.id, ym }).estructura
        : null;
    return opcionesTurnoDelDia(puestoDe(estr, franjaAbierta.positionName), franjaAbierta.date);
  }, [franjaAbierta, objetivos, estructura, objetivoSel, ymSemana, slas, empresaId, scopeEmpresa, clientesCat]);
  const opcionActual = franjaAbierta && !franjaAbierta.licencia ? opcionDelTurno(opcionesFranja, franjaAbierta) : null;
  const opcionCubrirSel = opcionesFranja.find((o) => o.id === opcionCubrir) || opcionActual || opcionesFranja[0] || null;
  const bandaCubrir: BandaCobertura | null = sheet?.tipo === 'cubrir' && opcionCubrirSel
    ? { code: opcionCubrirSel.code, start: opcionCubrirSel.start, end: opcionCubrirSel.end, hours: opcionCubrirSel.hours }
    : null;

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
      banda: bandaCubrir,
      empleados: empleados.map((emp) => {
        const puntaje = totalDe(emp.id);
        return { ...emp, monthHours: horasMesEmpleado(emp.id, ym, base), ...(puntaje == null ? {} : { puntaje }) };
      }),
    }).filter((c) => !(sheet?.tipo === 'cubrir' && sheet.reemplazo && c.employeeId === franjaAbierta.employeeId));
  }, [franjaAbierta, visibles, empleados, objetivo, sheet, bandaCubrir?.code, bandaCubrir?.start, bandaCubrir?.end, totalDe]);

  // Permuta: compañeros del mismo objetivo ese día con los que el cambio no rompe tope, solape ni descanso.
  const companeros = franjaAbierta ? companerosCompatibles(franjaAbierta, visibles) : [];
  const bandaElegida = opcionesFranja.find((o) => o.id === codigo) || null;
  const avisoHorario = franjaAbierta && bandaElegida
    ? conflictosDeHorario(franjaAbierta, bandaElegida.code, bandaElegida.start, bandaElegida.end, bandaElegida.hours, visibles).reason
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
    setOpcionCubrir(null);
    setCompaneroId(null);
    setTab('plantel');
    setEventuales([]);
    setConsultaCuils([]);
    setConsultaFtIds([]);
  };

  /**
   * Solo se corrige un mes publicado y con permiso `correct`. Sin franja se evalúa el mes de la
   * semana abierta; con franja (Próximos días), el mes de esa franja.
   */
  const exigirEdicion = (franja?: Pick<FranjaMovil, 'objectiveId' | 'date'> | null) => {
    const publicadoMes = franja ? mesPublicadoDe(publicado, franja.objectiveId, franja.date) : (estadoMes ? estadoMes.publishedAt : null);
    const fechaMes = franja?.date || lunes;
    const gate = puedeCorregirEnCelular(publicadoMes, puedeCorregir, fechaMes);
    if (gate.ok) return true;
    if (gate.motivo === AVISO_MES_SIN_PUBLICAR) toast.message(gate.motivo);
    else toast.error(gate.motivo || 'No tenés permiso para modificar la planificación.');
    return false;
  };

  const stage = (cambio: CambioLocal) => {
    const fecha = franjaAbierta?.date;
    const abierta = fecha ? consultaAbiertaEnFecha(consultasObj, fecha, franjaAbierta?.employeeId && franjaAbierta.employeeId !== 'VACANTE' ? franjaAbierta.employeeId : null) : null;
    if (abierta) {
      const ok = window.confirm('Ese día lo resuelve una consulta abierta. Si lo cambiás a mano, se cancela la consulta y se avisa que ya no hace falta. ¿Seguir?');
      if (!ok) return;
      const call = httpsCallable(functions, 'cancelarConsultaDisponibilidad');
      void call({ consultaId: abierta.id, empresaId }).catch(() => toast.error('No se pudo cancelar la consulta.'));
    }
    setCambios((prev) => [...prev, cambio]);
    cerrar();
    toast.message('Quedó para publicar la corrección');
  };

  const elegirObjetivo = useCallback((clientId: string, objectiveId: string) => {
    const sel = { clientId, objectiveId };
    setSeleccion(sel);
    guardarSeleccion(empresaId, sel);
    setSheet(null);
    if (router.query.objectiveId) void router.replace({ pathname: router.pathname, query: {} }, undefined, { shallow: true });
  }, [empresaId, router]);

  const confirmarCandidato = async () => {
    if (!franjaAbierta || !elegido || !exigirEdicion(franjaAbierta)) return;
    const sintetico = esSlotSintetico(franjaAbierta.id);
    const banda = bandaCubrir ?? bandaParaCubrir(franjaAbierta);
    const emitir = (employeeId: string, employeeName: string, ft: boolean, bolsaCuil?: string) => {
      if (sintetico) stage({ kind: 'nuevo', franja: { ...franjaAbierta, ...banda }, employeeId, employeeName, ft, bolsaCuil });
      else stage({ kind: 'asignar', franjaId: franjaAbierta.id, employeeId, employeeName, ft, bolsaCuil, banda });
    };
    // Regla 06/10: al eventual y al franco solo se les pregunta; no hay asignación directa desde acá.
    if (tab === 'eventuales') {
      toast.message('A los eventuales solo se les pregunta: marcá a quién y enviá la consulta.');
      return;
    }
    const cand = candidatos.find((c) => c.employeeId === elegido);
    if (!cand || cand.blocked) return;
    if (cand.tab === 'ft') {
      toast.message('Al franco se le pregunta: marcá a quién y enviá la consulta.');
      return;
    }
    emitir(cand.employeeId, cand.name, false);
  };

  useEffect(() => {
    if (tab !== 'eventuales' || !franjaAbierta || !veBolsa) return;
    const banda = bandaCubrir ?? bandaParaCubrir(franjaAbierta);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, franjaAbierta, veBolsa, empresaId, objetivo, opcionCubrirSel?.id]);

  const consultarDisponibilidad = async (cuils: string[]) => {
    if (!franjaAbierta || cuils.length === 0) return;
    const banda = bandaCubrir ?? bandaParaCubrir(franjaAbierta);
    try {
      await runCallableOnline('Consultar disponibilidad', async () => {
        const call = httpsCallable<Record<string, unknown>, { resumen?: string; status?: string }>(functions, 'crearConsultaDisponibilidad');
        const res = await call({
          empresaId,
          objectiveId: franjaAbierta.objectiveId,
          objectiveName: franjaAbierta.objectiveName,
          clientId: franjaAbierta.clientId || objetivo?.clientId || null,
          clientName: franjaAbierta.clientName || objetivo?.clientName || null,
          positionName: franjaAbierta.positionName,
          objetivoGeo: objetivo?.lat != null && objetivo.lng != null ? { lat: objetivo.lat, lng: objetivo.lng } : null,
          jornadas: [{ fecha: franjaAbierta.date, horaInicio: banda.start, horaFin: banda.end, horas: banda.hours, code: banda.code, positionName: franjaAbierta.positionName }],
          cuils,
          titularEmployeeId: franjaAbierta.employeeId && franjaAbierta.employeeId !== 'VACANTE' ? franjaAbierta.employeeId : null,
          // Un hueco de un puesto: siempre un lugar, el primero que acepte cubre.
          lugares: 1,
          venceMinutos: 120,
        });
        if (res.data?.status === 'SIN_DESTINATARIOS') {
          toast.message(res.data?.resumen || 'No le llegó a nadie.');
        } else {
          toast.success(res.data?.resumen || 'Consulta enviada.');
          toast.message('Podés cerrar esta ventana. El día queda en espera.');
        }
        setConsultaCuils([]);
      });
    } catch (error) {
      toast.error(eventualErrorMessage(error, 'La consulta requiere conexión.'));
    }
  };

  /**
   * Consulta a los francos como FT por la misma callable (`guardias`). El PIN de descanso o tope lo
   * resuelve el escritorio; acá, si el servidor lo pide, se muestra el motivo.
   */
  const consultarFrancos = async (employeeIds: string[]) => {
    if (!franjaAbierta || employeeIds.length === 0) return;
    if (!puedeFt) {
      toast.error('Falta el permiso de franco trabajado.');
      return;
    }
    const banda = bandaCubrir ?? bandaParaCubrir(franjaAbierta);
    const guardias = employeeIds.map((employeeId) => ({
      employeeId,
      tipo: 'FT' as const,
      nombre: candidatos.find((c) => c.employeeId === employeeId)?.name || employeeId,
    }));
    try {
      await runCallableOnline('Consultar francos', async () => {
        const call = httpsCallable<Record<string, unknown>, { resumen?: string; status?: string; omitidos?: { motivo: string }[] }>(functions, 'crearConsultaDisponibilidad');
        const res = await call({
          empresaId,
          objectiveId: franjaAbierta.objectiveId,
          objectiveName: franjaAbierta.objectiveName,
          clientId: franjaAbierta.clientId || objetivo?.clientId || null,
          clientName: franjaAbierta.clientName || objetivo?.clientName || null,
          positionName: franjaAbierta.positionName,
          jornadas: [{ fecha: franjaAbierta.date, horaInicio: banda.start, horaFin: banda.end, horas: banda.hours, code: banda.code, positionName: franjaAbierta.positionName }],
          guardias,
          cubreEmployeeId: franjaAbierta.employeeId && franjaAbierta.employeeId !== 'VACANTE' ? franjaAbierta.employeeId : null,
          cubreNombre: franjaAbierta.employeeId && franjaAbierta.employeeId !== 'VACANTE' ? franjaAbierta.employeeName : null,
          lugares: 1,
          venceMinutos: 120,
        });
        toast.success(res.data?.resumen || 'Consulta enviada.');
        const omitidos = res.data?.omitidos || [];
        if (omitidos.length) toast.message(omitidos.slice(0, 3).map((o) => o.motivo).join(' · '), { duration: 8000 });
        toast.message('Podés cerrar esta ventana. El día queda en espera.');
        setConsultaFtIds([]);
      });
    } catch (error) {
      toast.error(eventualErrorMessage(error, 'La consulta requiere conexión.'));
    }
  };

  /**
   * Publica la corrección (`draft:false`, con aviso al guardia). Se vuelve a verificar en el servidor
   * de estados que cada mes afectado siga publicado: el celular nunca guarda borradores ni publica meses.
   */
  const guardarCambios = async () => {
    if (cambios.length === 0) return;
    if (!puedeCorregir) {
      toast.error('Falta el permiso para publicar la corrección.');
      return;
    }
    const afectados = new Set<string>();
    for (const cambio of cambios) {
      const franja = cambio.kind === 'nuevo' ? cambio.franja : turnos.find((t) => t.id === cambio.franjaId) || visibles.find((t) => t.id === cambio.franjaId);
      if (franja?.objectiveId) afectados.add(`${franja.objectiveId}|${franja.date.slice(0, 7)}`);
    }
    for (const key of afectados) {
      const [objectiveId, ym] = key.split('|');
      const [year, month] = ym.split('-').map(Number);
      const status = await fetchPlanificacionPublishStatus(empresaId, objectiveId, year, month);
      if (!status?.publishedAt) {
        toast.error(`${AVISO_MES_SIN_PUBLICAR} (${mesLabelDe(ym)}). Los cambios no se guardaron.`);
        setPublicado((prev) => ({ ...prev, [key]: { publishedAt: false, publishedBy: null } }));
        return;
      }
    }
    const lote = cambios;
    const base = turnos;
    const label = `Corrección de ${lote.length} cambio${lote.length === 1 ? '' : 's'}`;
    const result = await enqueueFirestoreWrite(label, () => escribirLote(lote, base, { empresaId, actorName }));
    setCambios([]);
    if (result === 'queued') toast.message('Pendiente de enviar');
    else toast.success('Corrección publicada. El guardia recibe el aviso.');
  };

  const irAPanel = (p: PanelPlanificacion) => {
    const query = p === 'dias' ? { panel: 'dias' } : {};
    void router.replace({ pathname: router.pathname, query }, undefined, { shallow: true });
  };

  const abrirHuecoConsulta = (consulta: ConsultaCurso) => {
    const fecha = (consulta.jornadas || [])[0]?.fecha;
    if (!fecha || !objetivoSel) {
      toast.message('Elegí el objetivo y abrí ese día en la semana.');
      return;
    }
    const flat = celdas.flat();
    const celda = flat.find((x) => x.fecha === fecha && (!consulta.positionName || x.fila.positionName === consulta.positionName) && x.kind === 'hueco')
      || flat.find((x) => x.fecha === fecha && x.kind !== 'sin-servicio');
    if (!celda) {
      toast.message('Ese día no está en la semana abierta.');
      return;
    }
    if (celda.kind === 'hueco') setSheet({ tipo: 'cubrir', franja: huecoDeCelda(celda, objetivoSel), reemplazo: false });
    else setSheet({ tipo: 'celda', filaId: celda.fila.id, fecha: celda.fecha });
    setConsultaFoco(null);
  };

  useEffect(() => {
    const prev = consultasPrevRef.current;
    consultasPrevRef.current = consultasObj;
    if (prev === null) return;
    for (const n of novedadesDeConsultas(prev, consultasObj)) {
      if (n.tipo === 'ACEPTO') {
        toast.success(n.texto);
        continue;
      }
      const consulta = consultasObj.find((c) => c.id === n.id);
      toast.warning(n.texto, {
        duration: 14000,
        action: consulta ? { label: 'Consultar a otros', onClick: () => abrirHuecoConsulta(consulta) } : undefined,
        cancel: consulta ? { label: 'Cubrir de otra forma', onClick: () => abrirHuecoConsulta(consulta) } : undefined,
      });
    }
  }, [consultasObj]);

  if (!puedeLeer) {
    return <p className="p-6 text-sm font-medium text-slate-600">No tenés permiso de planificación.</p>;
  }

  const sinEstructura = objetivoSel && estructura && !estructura.conSla
    ? 'Sin contrato vigente en este mes: se muestra la estructura por defecto (M/T/N).'
    : null;

  return (
    <>
      <Head><title>Planificación · COSP</title></Head>
      {puedeConsultar && (
        <ConsultasEnCursoPill
          consultas={consultasObj}
          focoId={consultaFoco}
          focoTick={consultaTick}
          anclaje="celular"
          onCancelar={(id) => {
            const call = httpsCallable(functions, 'cancelarConsultaDisponibilidad');
            void call({ consultaId: id, empresaId })
              .then(() => toast.success('Consulta cancelada. Se avisó que ya no hace falta.'))
              .catch(() => toast.error('No se pudo cancelar la consulta.'));
          }}
          onConsultarOtros={abrirHuecoConsulta}
          onCubrirOtraForma={abrirHuecoConsulta}
        />
      )}
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
              huecos={exigeCobertura ? huecos : 0}
              ocultarHuecos={!exigeCobertura}
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
                  sinHuecos={!exigeCobertura}
                  licencias={licencias}
                  eventos={eventosPlantel}
                  sinEstructura={sinEstructura}
                  onAnterior={() => setLunes((l) => semanaAnterior(l))}
                  onSiguiente={() => setLunes((l) => semanaSiguiente(l))}
                  marcaConsulta={(fecha, positionName) => {
                    const c = consultasObj.find((x) => x.status === 'ABIERTA' && (x.jornadas || []).some((j) => j.fecha === fecha) && (!x.positionName || x.positionName === positionName));
                    return c ? { texto: textoIndicadorConsulta(c), tooltip: textoTooltipConsulta(c) } : null;
                  }}
                  onConsulta={(fecha, positionName) => {
                    const c = consultasObj.find((x) => x.status === 'ABIERTA' && (x.jornadas || []).some((j) => j.fecha === fecha) && (!x.positionName || x.positionName === positionName));
                    if (c) { setConsultaFoco(c.id); setConsultaTick((n) => n + 1); }
                  }}
                  onCelda={(celda) => {
                    // Mes sin publicar: la celda se abre en solo lectura con el aviso.
                    if (semanaSoloLectura) {
                      setSheet({ tipo: 'celda', filaId: celda.fila.id, fecha: celda.fecha });
                      return;
                    }
                    // Hueco sin nadie asignado: directo a los candidatos con la franja del SLA ya elegida.
                    if (celda.kind === 'hueco' && celda.guardias.every((g) => g.vacante) && objetivoSel) {
                      if (exigirEdicion()) setSheet({ tipo: 'cubrir', franja: huecoDeCelda(celda, objetivoSel), reemplazo: false });
                      return;
                    }
                    setSheet({ tipo: 'celda', filaId: celda.fila.id, fecha: celda.fecha });
                  }}
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
        puedeCorregir={puedeCorregir}
        mesPublicado={mesesPublicados || !readyTurnos}
        cronograma={cronograma.gruposPlanificacion}
        onCronogramaVista={(ids) => {
          void cronograma.marcarVista(ids, 'PLANIFICACION')
            .then((n) => { if (n > 0) toast.success(n === 1 ? 'Alerta marcada como vista' : `${n} alertas marcadas como vistas`); })
            .catch(() => toast.error('No se pudo marcar como vista'));
        }}
        onCronogramaAbrir={(item) => {
          // Abre ese objetivo y mes en la semana, en solo lectura: se publica desde la computadora.
          const obj = objetivos.find((o) => o.id === item.objectiveId);
          elegirObjetivo(item.clientId || obj?.clientId || '', item.objectiveId);
          setLunes(lunesDe(`${item.year}-${String(item.month).padStart(2, '0')}-01`));
          if (panel !== 'semana') irAPanel('semana');
          toast.message(AVISO_MES_SIN_PUBLICAR);
        }}
        onDia={setDia}
        onHueco={(franja) => { if (exigirEdicion(franja)) setSheet({ tipo: 'cubrir', franja, reemplazo: false }); }}
        onAsignado={(franja) => {
          if (franja.evento) { toast.message('Turno de evento: se gestiona desde Eventos (solo lectura acá).'); return; }
          if (exigirEdicion(franja)) setSheet({ tipo: 'cambiar', franjaId: franja.id });
        }}
        onPublicar={() => { void guardarCambios(); }}
      />
      {panel === 'semana' && objetivoSel && (
        <BarraPublicar
          cambios={cambios.length}
          publicado={semanaCerrada ? false : (estadoMes ? estadoMes.publishedAt : null)}
          aviso={semanaCerrada ? AVISO_MES_CERRADO : undefined}
          puedeCorregir={puedeCorregir}
          onGuardar={() => { void guardarCambios(); }}
        />
      )}
      <BottomSheet open={sheet?.tipo === 'selector'} title="Cliente y objetivo" onClose={cerrar}>
        <SelectorObjetivoSheetBody clientes={clientesParaSelector(clientesCat)} seleccion={seleccion} onElegir={elegirObjetivo} />
      </BottomSheet>
      <BottomSheet open={sheet?.tipo === 'celda'} title={celdaAbierta ? `${celdaAbierta.fila.code} · ${celdaAbierta.fecha.slice(8, 10)}/${celdaAbierta.fecha.slice(5, 7)}` : 'Celda'} onClose={cerrar}>
        {celdaAbierta && objetivoSel && (
          <CeldaSheetBody
            celda={celdaAbierta}
            soloLectura={semanaSoloLectura}
            onGuardia={(turno) => { if (exigirEdicion()) setSheet({ tipo: 'cambiar', franjaId: turno.id }); }}
            onCubrir={() => { if (exigirEdicion()) setSheet({ tipo: 'cubrir', franja: huecoDeCelda(celdaAbierta, objetivoSel), reemplazo: false }); }}
          />
        )}
      </BottomSheet>
      <BottomSheet open={sheet?.tipo === 'cubrir'} title={franjaAbierta ? `${sheet?.tipo === 'cubrir' && sheet.reemplazo ? 'Cambiar guardia' : 'Cubrir'} · ${franjaAbierta.positionName} ${franjaAbierta.date.slice(8, 10)}/${franjaAbierta.date.slice(5, 7)}` : 'Cubrir'} onClose={cerrar}>
        {franjaAbierta && (
          <CandidatosHueco
            opciones={sheet?.tipo === 'cubrir' && sheet.reemplazo ? undefined : opcionesFranja}
            opcionId={opcionCubrirSel?.id ?? null}
            onOpcion={(id) => { setOpcionCubrir(id); setElegido(null); }}
            tab={tab}
            onTab={setTab}
            candidatos={candidatos}
            eventuales={eventuales}
            elegidoId={elegido}
            puedeFt={puedeFt}
            puedeEventuales={veBolsa}
            consultaCuils={consultaCuils}
            onToggleConsulta={puedeConsultar ? (cuil) => {
              setConsultaCuils((prev) => (prev.includes(cuil) ? prev.filter((c) => c !== cuil) : [...prev, cuil]));
            } : undefined}
            onConsultar={puedeConsultar ? (cuils) => { void consultarDisponibilidad(cuils); } : undefined}
            consultaFtIds={consultaFtIds}
            onToggleConsultaFt={puedeConsultar && puedeFt ? (id) => {
              setConsultaFtIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
            } : undefined}
            onConsultarFt={puedeConsultar && puedeFt ? (ids) => { void consultarFrancos(ids); } : undefined}
            onElegir={setElegido}
            onConfirmar={() => { void confirmarCandidato(); }}
          />
        )}
        {puedeConsultar && franjaAbierta && (
          <ConsultaDisponibilidadEstado
            empresaId={empresaId}
            objectiveId={franjaAbierta.objectiveId}
            positionName={franjaAbierta.positionName}
            jornadas={[{
              fecha: franjaAbierta.date,
              code: (bandaCubrir ?? bandaParaCubrir(franjaAbierta)).code,
              horaInicio: (bandaCubrir ?? bandaParaCubrir(franjaAbierta)).start,
              horaFin: (bandaCubrir ?? bandaParaCubrir(franjaAbierta)).end,
            }]}
          />
        )}
      </BottomSheet>
      <BottomSheet open={sheet?.tipo === 'cambiar'} title={franjaAbierta ? `${franjaAbierta.employeeName} · ${franjaAbierta.code}` : 'Cambiar'} onClose={cerrar}>
        <CambioPuntual
          opciones={opcionesFranja}
          actualId={opcionActual?.id ?? null}
          codigo={codigo}
          onCodigo={setCodigo}
          companeros={companeros.map((c) => ({ id: c.id, nombre: c.employeeName, detalle: `${c.code} ${c.start}–${c.end}` }))}
          companeroId={companeroId}
          onCompanero={setCompaneroId}
          aviso={aviso}
          bloqueado={Boolean(aviso)}
          onCambiarGuardia={() => {
            if (!franjaAbierta || !exigirEdicion(franjaAbierta)) return;
            setSheet({ tipo: 'cubrir', franja: { ...franjaAbierta, kind: 'vacante' }, reemplazo: true });
          }}
          onHorario={() => {
            if (!franjaAbierta || !bandaElegida || avisoHorario || !exigirEdicion(franjaAbierta)) return;
            stage({ kind: 'horario', franjaId: franjaAbierta.id, code: bandaElegida.code, start: bandaElegida.start, end: bandaElegida.end, hours: bandaElegida.hours });
          }}
          onPermuta={() => {
            if (!franjaAbierta || !companero || avisoPermuta || !exigirEdicion(franjaAbierta)) return;
            stage({ kind: 'permuta', franjaId: franjaAbierta.id, otroId: companero.id });
          }}
          onFranco={() => {
            if (!franjaAbierta || !exigirEdicion(franjaAbierta)) return;
            stage({ kind: 'franco', franjaId: franjaAbierta.id });
          }}
          onBorrar={() => {
            if (!franjaAbierta || !exigirEdicion(franjaAbierta)) return;
            stage({ kind: 'borrar', franjaId: franjaAbierta.id });
          }}
        />
      </BottomSheet>
      {empresaSheet.sheet}
      <MovilBottomNav />
    </>
  );
}
