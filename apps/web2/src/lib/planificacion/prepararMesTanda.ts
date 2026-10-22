/**
 * «Preparar el mes»: arma las unidades (objetivos sueltos y grupos) y corre la simulación de cada una en orden.
 * La lectura de Firestore entra por parámetro (`historia`, `publicado`), así la pantalla y el script de medición
 * corren exactamente lo mismo. Solo lectura.
 */
import { clasePrepararServicio, clienteInactivoParaCopia, mesAnterior, slaCubreMes, slaOrigenCerrado } from '../servicios/copiarSlaMes';
import { toYyyyMmDd } from '../firestoreDates';
import {
  buildPlanningPositionStructure,
  filterSlasForPlanningContext,
  isPlanningPositionExcludedOnDate,
  isPlanningShiftExcludedOnDate,
  pickSlaForPlanningMonth,
  planningMonthHasActiveSla,
} from '../slaPlanningMatch';
import { positionIsActiveOn } from './autoScheduleEngineV4';
import { franjasParaMesSiguiente } from './refuerzosRapido';
import { isActiveAbsence } from './absenceCodes';
import { esCeldaLicencia } from './seleccionLicencia';
import type { CeldaPropuesta, PuestoSla, TurnoPrevio } from './continuarMesAnterior';
import type { TipoGuardiaArmado } from './armarMesServicio';
import { simularUnidad, turnoHabilitadoPorEstructura, type Estrategia, type Metricas, type TurnoMes } from './prepararMes';

export type ModoTanda = 'auto' | Estrategia;

export type UnidadTanda = {
  key: string;
  nombre: string;
  cliente: string;
  clientId: string;
  objetivos: Array<{ id: string; nombre: string; clientId: string }>;
  grupo: boolean;
  /** Cliente inactivo: se lista en «Fuera de operación» y no se simula. */
  fueraOperacion?: boolean;
};

export type FilaTanda = UnidadTanda & {
  estado: 'ok' | 'publicado' | 'sin_servicio' | 'sin_guardias' | 'error' | 'fuera_operacion';
  notas: string[];
  continuar?: Metricas;
  armar?: Metricas;
  recomendada?: Estrategia;
  porQue?: string;
  elegida?: Estrategia;
  /** Celdas de la estrategia elegida (solo objetivos que no están publicados). */
  celdas?: CeldaPropuesta[];
};

/** Borrador que entró por Preparar / Continuar / Armar. Al guardar se vuelve a leer la publicación. */
export const DESDE_PREPARAR = 'desdePreparar' as const;

export function avisoObjetivoYaPublicado(nombre: string): string {
  return `${nombre} ya está publicado: se corrige desde el cronograma, no con Preparar`;
}

export function avisoNoSePudoVerificarPublicado(nombre: string): string {
  return `No se pudo verificar si ${nombre} está publicado: no se escribió con Preparar`;
}

export function estaPublicadoEstado(data: { publishedAt?: unknown } | null | undefined): boolean {
  return !!data && data.publishedAt != null && data.publishedAt !== '';
}

/** Lectura fresca, un doc de `planificacion_estados` por objetivo. Si no se puede leer, no se escribe. */
export async function leerObjetivosPublicados(
  objectiveIds: string[],
  leer: (objectiveId: string) => Promise<{ publishedAt?: unknown } | null | undefined>,
): Promise<{ publicados: Set<string>; sinLeer: Set<string> }> {
  const publicados = new Set<string>();
  const sinLeer = new Set<string>();
  const ids = [...new Set(objectiveIds.map((id) => String(id || '').trim()).filter(Boolean))];
  await Promise.all(ids.map(async (oid) => {
    try {
      const data = await leer(oid);
      if (estaPublicadoEstado(data)) publicados.add(oid);
    } catch {
      sinLeer.add(oid);
    }
  }));
  return { publicados, sinLeer };
}

export function celdaPrepararBloqueada(
  objectiveId: unknown,
  publicados: ReadonlySet<string>,
  sinLeer: ReadonlySet<string>,
): 'publicado' | 'sin_verificar' | null {
  const oid = String(objectiveId ?? '').trim();
  if (!oid) return null;
  if (sinLeer.has(oid)) return 'sin_verificar';
  if (publicados.has(oid)) return 'publicado';
  return null;
}

/**
 * Aplica propuestas de Preparar sobre un borrador. No pisa celdas que ya estaban
 * ni escribe objetivos publicados (o que no se pudieron re-chequear).
 */
export function aplicarPropuestasPreparar(
  borrador: Record<string, any>,
  propuestas: Array<{ key: string; objectiveId: string; [k: string]: unknown }>,
  publicados: ReadonlySet<string>,
  sinLeer: ReadonlySet<string> = new Set(),
): { borrador: Record<string, any>; bloqueados: string[]; sinVerificar: string[] } {
  const next = { ...borrador };
  const bloqueados = new Set<string>();
  const sinVerificar = new Set<string>();
  for (const c of propuestas) {
    const motivo = celdaPrepararBloqueada(c.objectiveId, publicados, sinLeer);
    if (motivo === 'publicado') { bloqueados.add(String(c.objectiveId)); continue; }
    if (motivo === 'sin_verificar') { sinVerificar.add(String(c.objectiveId)); continue; }
    const prev = next[c.key];
    if (prev && !prev.isDeleted) continue;
    next[c.key] = { ...c, [DESDE_PREPARAR]: true };
  }
  return { borrador: next, bloqueados: [...bloqueados], sinVerificar: [...sinVerificar] };
}

/** Al guardar: saca solo lo que puso Preparar si ese objetivo quedó publicado. Lo manual sigue. */
export function quitarBorradorPrepararPublicado(
  pending: Record<string, any>,
  publicados: ReadonlySet<string>,
  sinLeer: ReadonlySet<string> = new Set(),
): { pending: Record<string, any>; bloqueados: string[]; sinVerificar: string[]; quitadas: string[] } {
  const bloqueados = new Set<string>();
  const sinVerificar = new Set<string>();
  const quitadas: string[] = [];
  const next: Record<string, any> = {};
  for (const [k, v] of Object.entries(pending)) {
    if (!v?.[DESDE_PREPARAR]) { next[k] = v; continue; }
    const motivo = celdaPrepararBloqueada(v?.objectiveId, publicados, sinLeer);
    if (motivo === 'publicado') { bloqueados.add(String(v.objectiveId)); quitadas.push(k); continue; }
    if (motivo === 'sin_verificar') { sinVerificar.add(String(v.objectiveId)); quitadas.push(k); continue; }
    next[k] = v;
  }
  return { pending: next, bloqueados: [...bloqueados], sinVerificar: [...sinVerificar], quitadas };
}

type GrupoLike = { id?: string; nombre?: string; objectiveIds?: string[] };

const AR = 'America/Argentina/Buenos_Aires';
const fmtDia = new Intl.DateTimeFormat('en-CA', { timeZone: AR });
const up = (v: unknown) => String(v ?? '').trim().toUpperCase();
const pad = (n: number) => String(n).padStart(2, '0');
const LETRAS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

export function ymdAr(v: unknown): string | null {
  const o = v as { toDate?: () => Date } | null;
  const d = o?.toDate ? o.toDate() : v instanceof Date ? v : null;
  return d && !Number.isNaN(d.getTime()) ? fmtDia.format(d) : null;
}

function letraDia(ds: string): string {
  const [y, m, d] = ds.split('-').map(Number);
  return LETRAS[new Date(y, m - 1, d).getDay()];
}

function horasDoc(t: any): number {
  const a = t?.startTime?.toDate?.();
  const b = t?.endTime?.toDate?.();
  if (a && b) {
    let h = (b.getTime() - a.getTime()) / 36e5;
    if (h <= 0) h += 24;
    if (h < 20) return Math.round(h * 100) / 100;
  }
  return Number(t?.hours) || 0;
}

const esFrancoDoc = (t: any) => !!t?.isFranco || ['F', 'FF', 'FP'].includes(up(t?.code));

export function turnoHabilitadoDe(estructura: PuestoSla[]) {
  return (positionName: string, code: string, ds: string) => {
    const pos: any = estructura.find((p) => p.positionName === positionName);
    if (!pos) return false;
    const def = {
      positionName: String(pos.positionName || ''), qty: pos.qty, shifts: pos.shifts, activeDays: pos.activeDays, coverageType: pos.coverageType,
      excludedDates: pos.excludedDates, excludedShiftDates: pos.excludedShiftDates, excludedShiftPaxDates: pos.excludedShiftPaxDates,
    };
    if (!positionIsActiveOn(def as any, letraDia(ds), ds) || isPlanningPositionExcludedOnDate(pos, ds)) return false;
    if (isPlanningShiftExcludedOnDate(pos, ds, code)) return false;
    return turnoHabilitadoPorEstructura([pos], positionName, code, ds);
  };
}

/** Objetivos activos de clientes activos. Los grupos (2+ objetivos activos) van como una sola unidad. */
export function unidadesDelMes(clients: any[], grupos: GrupoLike[]): UnidadTanda[] {
  const activos: Array<{ id: string; nombre: string; clientId: string; cliente: string }> = [];
  for (const c of clients) {
    if (clienteInactivoParaCopia(c)) continue;
    for (const o of (c.objetivos || []) as Array<{ id?: string; name?: string; status?: string }>) {
      const st = up(o.status || 'ACTIVE');
      if (st === 'INACTIVE' || st === 'INACTIVO') continue;
      const id = String(o.id || '');
      if (id) activos.push({ id, nombre: String(o.name || id), clientId: String(c.id), cliente: String(c.name || '') });
    }
  }
  const porId = new Map(activos.map((o) => [o.id, o]));
  const enGrupo = new Set<string>();
  const out: UnidadTanda[] = [];
  for (const g of grupos) {
    const objs = (g.objectiveIds || []).map((id) => porId.get(id)).filter(Boolean) as typeof activos;
    if (objs.length < 2) continue;
    objs.forEach((o) => enGrupo.add(o.id));
    out.push({
      key: `grupo:${g.id}`,
      nombre: g.nombre || objs.map((o) => o.nombre).join(' + '),
      cliente: [...new Set(objs.map((o) => o.cliente))].join(' · '),
      clientId: objs[0].clientId,
      objetivos: objs.map((o) => ({ id: o.id, nombre: o.nombre, clientId: o.clientId })),
      grupo: true,
    });
  }
  for (const o of activos) {
    if (enGrupo.has(o.id)) continue;
    out.push({ key: o.id, nombre: o.nombre, cliente: o.cliente, clientId: o.clientId, objetivos: [{ id: o.id, nombre: o.nombre, clientId: o.clientId }], grupo: false });
  }
  for (const c of clients) {
    if (!clienteInactivoParaCopia(c)) continue;
    for (const o of (c.objetivos || []) as Array<{ id?: string; name?: string }>) {
      const id = String(o.id || '');
      if (!id || out.some((u) => u.key === id || u.objetivos.some((x) => x.id === id))) continue;
      out.push({
        key: id,
        nombre: String(o.name || id),
        cliente: String(c.name || ''),
        clientId: String(c.id),
        objetivos: [{ id, nombre: String(o.name || id), clientId: String(c.id) }],
        grupo: false,
        fueraOperacion: true,
      });
    }
  }
  return out;
}

export type TandaInput = {
  unidades: UnidadTanda[];
  year: number;
  /** 0-11 */
  month: number;
  modo: ModoTanda;
  /** SLA de la empresa (ya filtrados por tenant). */
  allSla: any[];
  clients: any[];
  employees: any[];
  slaIdToObjId: Record<string, string>;
  /** Turnos del mes (toda la empresa), clave `${empId}_${yyyy-mm-dd}`. */
  shiftsMap: Record<string, any>;
  absencesMap: Record<string, any>;
  /** Turnos del objetivo entre esas fechas (docs con `startTime` Timestamp). */
  historia: (objectiveId: string, desde: Date, hasta: Date) => Promise<any[]>;
  publicado: (objectiveId: string) => Promise<boolean>;
  onFila?: (filas: FilaTanda[]) => void;
  onAvance?: (hechos: number, total: number, actual: string) => void;
  cortado?: () => boolean;
};

export async function correrTanda(input: TandaInput): Promise<FilaTanda[]> {
  const { year, month, allSla, clients, employees, slaIdToObjId, shiftsMap, absencesMap } = input;
  const mesKey = `${year}-${pad(month + 1)}`;
  const nDias = new Date(year, month + 1, 0).getDate();
  const dias = Array.from({ length: nDias }, (_, i) => `${mesKey}-${pad(i + 1)}`);
  const primerDia = dias[0];
  const ultimoDia = dias[dias.length - 1];
  const mesNombre = new Date(year, month, 1).toLocaleDateString('es-AR', { month: 'long' });
  const mesPorEmp = new Map<string, Map<string, any>>();
  for (const [key, t] of Object.entries(shiftsMap)) {
    const m = key.match(/^(.*)_(\d{4}-\d{2}-\d{2})$/);
    if (!m || !t || t.isDeleted || m[2] < primerDia || m[2] > ultimoDia) continue;
    if (!mesPorEmp.has(m[1])) mesPorEmp.set(m[1], new Map());
    mesPorEmp.get(m[1])!.set(m[2], t);
  }
  const asignado = new Map<string, Map<string, TurnoMes & { unidad: string }>>();
  const nombreEmp = new Map(employees.map((e: any) => [String(e.id), String(e.name || e.id)]));
  const nombreObj = new Map(input.unidades.flatMap((u) => u.objetivos.map((o) => [o.id, o.nombre] as [string, string])));
  const resultado: FilaTanda[] = [];
  const lista = input.unidades;

  for (let i = 0; i < lista.length; i++) {
    if (input.cortado?.()) break;
    const u = lista[i];
    input.onAvance?.(i, lista.length, u.nombre);
    await new Promise((r) => setTimeout(r, 0));
    const fila: FilaTanda = { ...u, estado: 'ok', notas: [] };
    const cerrar = () => { resultado.push(fila); input.onFila?.([...resultado]); };
    if (u.fueraOperacion) {
      fila.estado = 'fuera_operacion';
      fila.notas.push('Fuera de operación: cliente inactivo');
      cerrar();
      continue;
    }
    try {
      const objIds = u.objetivos.map((o) => o.id);
      const unidadId = u.grupo ? '__grupo__' : objIds[0];
      const nombresGrupo = new Map<string, string>();
      const usados = new Set<string>();
      for (const o of u.objetivos) {
        const n = usados.has(o.nombre) ? `${o.nombre} (${o.id.slice(0, 4)})` : o.nombre;
        usados.add(o.nombre);
        nombresGrupo.set(o.id, n);
      }
      const etiquetar = (oid: unknown, pos: unknown) => {
        const p = String(pos || '');
        return u.grupo && p && p !== 'General' ? `${nombresGrupo.get(String(oid)) || nombreObj.get(String(oid)) || oid} · ${p}` : p;
      };
      const publicados = await Promise.all(objIds.map((oid) => input.publicado(oid).catch(() => false)));
      const idsPublicados = new Set(objIds.filter((_, i) => publicados[i]));
      const objetivosAbiertos = u.objetivos.filter((o) => !idsPublicados.has(o.id));
      if (objetivosAbiertos.length === 0) { fila.estado = 'publicado'; cerrar(); continue; }
      if (idsPublicados.size > 0) fila.notas.push('parte del grupo ya publicada');
      const idsAbiertos = objetivosAbiertos.map((o) => o.id);

      // Servicio del mes. Sin él, solo se simula con el M-1 abierto. Cliente inactivo o último SLA cerrado/vencido anterior a M-1 no piden servicio.
      const estructura: PuestoSla[] = [];
      const rangos: Array<{ desde: string; hasta: string }> = [];
      let sinServicio = 0;
      let fuera = 0;
      const mesPrevio = mesAnterior(mesKey);
      for (const o of objetivosAbiertos) {
        const matching = filterSlasForPlanningContext(allSla, o.clientId, o.id, clients, slaIdToObjId) as any[];
        const cliente = clients.find((c: any) => String(c.id) === o.clientId);
        const clase = clasePrepararServicio(matching, mesKey, cliente);
        const pref = u.grupo ? `${o.nombre}: ` : '';
        let srv: any = null;
        if (clase.clase === 'vigente') {
          const pick = pickSlaForPlanningMonth(matching, year, month);
          srv = planningMonthHasActiveSla(matching, year, month) && pick.vigente ? pick.vigente : null;
          if (srv) rangos.push({ desde: toYyyyMmDd(srv.startDate) || primerDia, hasta: toYyyyMmDd(srv.endDate) || ultimoDia });
        } else if (clase.clase === 'copiable') {
          const prev = matching
            .filter((s) => slaCubreMes(s, mesPrevio) && !slaOrigenCerrado(s))
            .sort((a, b) => String(toYyyyMmDd(b.endDate)).localeCompare(String(toYyyyMmDd(a.endDate))))[0];
          if (prev) {
            srv = { ...prev, positions: franjasParaMesSiguiente((prev.positions || []) as any[], mesKey) };
            fila.notas.push(`${pref}servicio de ${mesNombre} sin activar (se toma el anterior)`);
            rangos.push({ desde: primerDia, hasta: ultimoDia });
          } else {
            sinServicio += 1;
            fila.notas.push(`${pref}sin servicio de ${mesNombre}`);
          }
        } else if (clase.clase === 'fuera') {
          fuera += 1;
          fila.notas.push(`${pref}${clase.nota}`);
        } else {
          sinServicio += 1;
          fila.notas.push(`${pref}${clase.nota}`);
        }
        if (!srv) continue;
        const { structure } = buildPlanningPositionStructure(srv, { monthHasSla: true, hasExactMatch: true });
        for (const p of structure as any[]) estructura.push({ ...p, positionName: etiquetar(o.id, p.positionName) });
      }
      if (!estructura.length) {
        fila.estado = fuera > 0 && sinServicio === 0 ? 'fuera_operacion' : 'sin_servicio';
        cerrar();
        continue;
      }
      const turnoHabilitado = turnoHabilitadoDe(estructura);
      const diaBloqueado = (ds: string) => !rangos.some((r) => ds >= r.desde && ds <= r.hasta);

      // Dotación: preferido, volante o dotación del objetivo, o ya tiene algo cargado en el mes.
      const enUnidadMes = new Set<string>();
      for (const [emp, porDia] of mesPorEmp) for (const t of porDia.values()) if (idsAbiertos.includes(String(t.objectiveId || ''))) enUnidadMes.add(emp);
      const prefDe = (e: any) => String(slaIdToObjId[e.preferredObjectiveId] || e.preferredObjectiveId || '');
      const dotacion = employees.filter((e: any) => e.status !== 'inactivo' && (
        idsAbiertos.includes(prefDe(e))
        || idsAbiertos.some((oid) => (e.volante || []).includes(oid) || !!e.planificacionDotacion?.[oid])
        || enUnidadMes.has(String(e.id))));
      if (!dotacion.length) { fila.estado = 'sin_guardias'; cerrar(); continue; }
      const ids = new Set(dotacion.map((e: any) => String(e.id)));

      // Historia: hasta 3 meses antes.
      const docs = (await Promise.all(idsAbiertos.map((oid) => input.historia(oid, new Date(year, month - 3, 1), new Date(year, month, 0, 23, 59, 59))))).flat();
      const previos = new Map<string, TurnoPrevio[]>();
      const salientes = new Map<string, { nombre: string; previos: TurnoPrevio[] }>();
      for (const raw of docs) {
        const t: any = { ...raw };
        if (!t.employeeId || t.isDeleted) continue;
        const dateStr = ymdAr(t.startTime);
        if (!dateStr) continue;
        if (u.grupo) {
          t.positionName = etiquetar(t.objectiveId, t.positionName);
          if (t.originalPositionName) t.originalPositionName = etiquetar(t.objectiveId, t.originalPositionName);
          t.objectiveId = unidadId;
        }
        const row = { ...t, dateStr } as TurnoPrevio;
        if (ids.has(t.employeeId)) previos.set(t.employeeId, [...(previos.get(t.employeeId) || []), row]);
        else {
          const nombre = String(t.employeeName || '');
          if (!nombre || /^VACANTE|SIN COBERTURA/i.test(nombre)) continue;
          const sl = salientes.get(t.employeeId) || { nombre, previos: [] };
          sl.previos.push(row);
          salientes.set(t.employeeId, sl);
        }
      }

      const tipoDe = (e: any): TipoGuardiaArmado => {
        if (idsAbiertos.includes(prefDe(e))) return 'propio';
        if (idsAbiertos.some((oid) => (e.volante || []).includes(oid))) return 'volante';
        return 'otro';
      };
      const turnoDelMes = (id: string, ds: string): TurnoMes | null => {
        const a = asignado.get(id)?.get(ds);
        if (a && a.unidad !== u.key) return a;
        const t = mesPorEmp.get(id)?.get(ds);
        if (!t) return null;
        const enU = idsAbiertos.includes(String(t.objectiveId || ''));
        const sinHoras = esFrancoDoc(t) || up(t.code) === 'RET';
        return {
          code: up(t.code),
          positionName: enU ? etiquetar(t.objectiveId, t.positionName) : String(t.positionName || ''),
          startTime: t.startTime,
          endTime: t.endTime,
          hours: sinHoras ? 0 : horasDoc(t),
          isFranco: esFrancoDoc(t),
          enUnidad: enU,
        };
      };
      const licencia = (id: string, ds: string) => {
        const aus = absencesMap[`${id}_${ds}`];
        if (aus && isActiveAbsence(aus)) return true;
        const t = mesPorEmp.get(id)?.get(ds);
        return !!t && esCeldaLicencia({ code: up(t.code), tieneAusencia: false });
      };
      const horasFueraDe = (id: string) => {
        let h = 0;
        for (const ds of dias) {
          const t = turnoDelMes(id, ds);
          if (t && !t.enUnidad && !t.isFranco && !licencia(id, ds)) h += t.hours;
        }
        return h;
      };
      const retFuera = (ds: string) => {
        const out: Array<{ id: string; nombre: string; objetivo: string }> = [];
        for (const [emp, porDia] of mesPorEmp) {
          const t = porDia.get(ds);
          if (t && up(t.code) === 'RET' && !objIds.includes(String(t.objectiveId || '')) && !asignado.get(emp)?.get(ds)) {
            out.push({ id: emp, nombre: nombreEmp.get(emp) || String(t.employeeName || emp), objetivo: nombreObj.get(String(t.objectiveId)) || 'otro objetivo' });
          }
        }
        return out;
      };
      const cargados = [...ids].reduce((a, id) => a + dias.filter((ds) => turnoDelMes(id, ds)?.enUnidad).length, 0);
      if (cargados) fila.notas.push(`ya tiene ${cargados} celdas cargadas (no se tocan)`);

      const sim = simularUnidad({
        unidadId,
        dias,
        estructura,
        guardias: dotacion.map((e: any) => {
          const oidPref = idsAbiertos.includes(prefDe(e)) ? prefDe(e) : idsAbiertos[0];
          const pos = e.planificacionDotacion?.[oidPref]?.positionName;
          return { id: String(e.id), nombre: String(e.name || e.id), previos: previos.get(String(e.id)) || [], puestoPreferido: pos ? etiquetar(oidPref, pos) : undefined, tipo: tipoDe(e) };
        }),
        salientes: [...salientes].map(([id, s]) => ({ id, nombre: s.nombre, previos: s.previos })),
        licencia,
        turnoDelMes,
        horasFueraDe,
        retFuera,
        diaBloqueado,
        turnoHabilitado,
      });
      fila.continuar = sim.continuar.metricas;
      fila.armar = sim.armar.metricas;
      fila.recomendada = sim.recomendada;
      fila.porQue = sim.porQue;
      fila.elegida = input.modo === 'auto' ? sim.recomendada : input.modo;
      const celdasElegidas = fila.elegida === 'armar' ? sim.armar.celdas : sim.continuar.celdas;
      fila.celdas = celdasElegidas;
      // Lo elegido cuenta para las unidades que siguen.
      for (const c of celdasElegidas) {
        if (!asignado.has(c.employeeId)) asignado.set(c.employeeId, new Map());
        const sinHoras = c.isFranco || up(c.code) === 'RET';
        asignado.get(c.employeeId)!.set(c.dateStr, {
          code: up(c.code), positionName: c.positionName, startTime: c.startTime, endTime: c.endTime,
          hours: sinHoras ? 0 : Number(c.hours) || 0, isFranco: c.isFranco, enUnidad: false, unidad: u.key,
        });
      }
    } catch (err) {
      console.error('[preparar mes]', u.nombre, err);
      fila.estado = 'error';
      fila.notas.push(String((err as Error)?.message || err));
    }
    cerrar();
  }
  input.onAvance?.(resultado.length, lista.length, '');
  return resultado;
}
