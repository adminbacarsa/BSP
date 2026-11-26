import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import {
  addDoc,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocFromCache,
  getDocs,
  limit,
  onSnapshot,
  query,
  QueryDocumentSnapshot,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  ArrowDownAZ,
  ArrowDownUp,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  FileText,
  Flame,
  GripVertical,
  Hand,
  HelpCircle,
  LayoutList,
  Lock,
  Maximize,
  MessageSquare,
  Minimize2,
  Pin,
  Radio,
  Scissors,
  Search,
  ShieldCheck,
  Siren,
  Smartphone,
  UserX,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import ModalRetenesDia, {
  type RetenAviso,
  type RetenEnvioApp,
  type RetenesParaDestino,
  type RetenItem,
  type RetenTono,
} from '@/components/operaciones/ModalRetenesDia';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/lib/firebase';
import { openWhatsApp, waMensaje } from '@/lib/whatsapp';
import {
  mergeLegacyBridgeUrl,
  parseWhatsAppConfig,
} from '@/lib/whatsapp/empresaWhatsappConfig';
import { ChipsRetenEvaluado, type DestinoRetenOpcion } from '@/components/operaciones/RetenesDestinoPiezas';
import {
  compararRetenesEvaluados,
  evaluarRetenParaDestino,
  type EmpleadoRetenInfo,
  type RetenEvaluado,
} from '@/lib/operaciones/retenesParaDestino';
import { invokeCrearConvocatoriaCobertura } from '@/lib/operaciones/opsConvocatoriaCobertura';
import {
  absentShiftCoveragePatch,
  applyCoverage,
  CoverageApplyError,
  syncAusenciaCoberturaGestionada,
} from '@/lib/operaciones/syncAusenciaCobertura';
import {
  hoursRemainingUntilEnd,
  resolveEarlyWithdrawReplacePolicy,
  type EarlyWithdrawReplacePolicy,
} from '@/lib/operaciones/earlyWithdrawPolicy';
import { empresaCollectionQuery, shouldScopeQueriesToEmpresa } from '@/lib/multiempresa';
import { readPreferOpsModoRapido, writePreferOpsModoRapido } from '@/lib/panelViewPrefs';
import { isRevertAbsenceExpired } from '@/lib/operaciones/revertAbsenceWindow';
import { arHmOnYmdMs, arYmd } from '@/lib/arClock';
import { isRestFrancoShift } from '@/hooks/useOperacionesMonitor';
import { computeShiftCloseTimes, seriesHandoffKind } from '@cosp/ops-core';
import {
  ingresoDemasiadoAnticipado,
  textoConfirmacionIngresoWa,
  textoFueraDeRadioWa,
  textoIngresoAnticipadoWa,
  textoSalidaAntesDeFinWa,
  textoSalidaRegistradaWa,
  WA_RADIO_MAX_M,
} from '@/lib/operaciones/respuestasWaGuardia';
import {
  TurnoHoy,
  UseWABridgeReturn,
  WAConfirmedEntry,
  WAEntry,
  useWABridge,
} from '@/hooks/useWABridge';
import { generarModoRapidoReportePdf } from '@/lib/operaciones/modoRapidoReportePdf';

const LOG_PAGE = 10;
const BANDS = ['M', 'T', 'N', 'D12', 'N12'] as const;
const SKIP_CODES = new Set([
  'V',
  'L',
  'E',
  'A',
  'PG',
  'ART',
  'AA',
  'ESC',
  'F',
  'FF',
  'FP',
]);

function formatHHMM(ts: Timestamp | { toDate: () => Date } | null | undefined): string {
  if (!ts || typeof (ts as Timestamp).toDate !== 'function') return '--:--';
  try {
    return (ts as Timestamp).toDate().toLocaleTimeString('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return '--:--';
  }
}

function toStartMs(raw: unknown): number {
  if (raw && typeof (raw as Timestamp).toDate === 'function') {
    return (raw as Timestamp).toDate().getTime();
  }
  if (typeof raw === 'string' || typeof raw === 'number') {
    const t = new Date(raw).getTime();
    return Number.isNaN(t) ? NaN : t;
  }
  return NaN;
}

/** Turno cortado: dos o más tramos HH:MM válidos; null si el turno es de un solo horario. */
function bloquesDelTurno(raw: unknown): Array<{ startTime: string; endTime: string }> | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const out = raw
    .map((b) => ({
      startTime: String((b as { startTime?: unknown })?.startTime || '').slice(0, 5),
      endTime: String((b as { endTime?: unknown })?.endTime || '').slice(0, 5),
    }))
    .filter((b) => /^\d{2}:\d{2}$/.test(b.startTime) && /^\d{2}:\d{2}$/.test(b.endTime));
  return out.length >= 2 ? out : null;
}

/** Presencia de cada tramo de un turno cortado (`presenciaBloques.b1`, `.b2`…). El tramo 1 usa los campos del turno. */
type PresenciaBloque = {
  realStartTime?: unknown;
  realEndTime?: unknown;
  cerrado?: boolean;
  checkInSource?: string;
  checkOutSource?: string;
};

/**
 * Lee el turno desde la caché del listener (el CC ya lo tiene suscripto) y solo va al servidor
 * si no está. Evita una ida y vuelta de red en cada marca.
 */
async function leerTurnoRapido(id: string) {
  const ref = doc(db, 'turnos', id);
  try {
    const cached = await getDocFromCache(ref);
    if (cached.exists()) return cached;
  } catch {
    /* sin caché: se lee del servidor */
  }
  return getDoc(ref);
}

/** El tramo 2+ de un turno cortado es una fila virtual con id `<idTurno>#b<N>`; el documento es uno solo. */
function docIdDe(rowId: string): string {
  return String(rowId || '').replace(/#b\d+$/, '');
}

function indiceTramoDe(rowId: string): number {
  const m = /#b(\d+)$/.exec(String(rowId || ''));
  return m ? Number(m[1]) - 1 : 0;
}

function msDeTimestamp(v: unknown): number {
  const t = v as { toMillis?: () => number } | null | undefined;
  return typeof t?.toMillis === 'function' ? t.toMillis() || 0 : 0;
}

function esTramoCortado(t: Pick<TurnoHoy, 'bloquesTotal'>): boolean {
  return (t.bloquesTotal ?? 0) > 1;
}

function esUltimoTramo(t: Pick<TurnoHoy, 'bloque' | 'bloquesTotal'>): boolean {
  return !esTramoCortado(t) || (t.bloque ?? 1) >= (t.bloquesTotal ?? 1);
}

/** Campo del turno que guarda el ingreso/egreso real de ese tramo. */
function campoHoraTurno(t: TurnoHoy, campo: 'ingreso' | 'salida'): string {
  const n = t.bloque ?? 1;
  const cortado = esTramoCortado(t);
  if (campo === 'ingreso') return cortado && n > 1 ? `presenciaBloques.b${n}.realStartTime` : 'realStartTime';
  return cortado ? `presenciaBloques.b${n}.realEndTime` : 'realEndTime';
}

/** Inicio y fin (ms) de cada tramo: el primero parte del inicio del turno, los demás son del mismo día o del siguiente. */
function tramosDeTurno(
  startMs: number,
  blocks: Array<{ startTime: string; endTime: string }>,
): Array<{ startMs: number; endMs: number }> {
  const out: Array<{ startMs: number; endMs: number }> = [];
  const base = new Date(startMs);
  let prevEnd = startMs;
  blocks.forEach((b, i) => {
    const [sh, sm] = b.startTime.split(':').map(Number);
    const [eh, em] = b.endTime.split(':').map(Number);
    const durMin = (((eh * 60 + em) - (sh * 60 + sm) + 1440) % 1440) || 1440;
    let s = startMs;
    if (i > 0) {
      const d = new Date(base);
      d.setHours(sh, sm, 0, 0);
      s = d.getTime();
      while (s < prevEnd) s += 86400000;
    }
    const e = s + durMin * 60000;
    out.push({ startMs: s, endMs: e });
    prevEnd = e;
  });
  return out;
}

function nowHHMM(): string {
  return new Date().toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function parseHHMMToMins(hhmm: string): number | null {
  const parts = hhmm.split(':').map(Number);
  if (parts.length < 2 || parts.some((n) => Number.isNaN(n))) return null;
  return parts[0] * 60 + parts[1];
}

/** Minutos desde expected hasta nowMs. Positivo = tarde. Preferir startTimeRaw (fecha real). */
function minutesSinceExpected(
  expected: string,
  nowMs: number,
  startTimeRaw?: Timestamp,
): number | null {
  if (startTimeRaw && typeof startTimeRaw.toDate === 'function') {
    return Math.floor((nowMs - startTimeRaw.toDate().getTime()) / 60000);
  }
  const expMins = parseHHMMToMins(expected);
  if (expMins === null) return null;
  const d = new Date(nowMs);
  d.setHours(Math.floor(expMins / 60), expMins % 60, 0, 0);
  return Math.floor((nowMs - d.getTime()) / 60000);
}

type PresenciaMeta = {
  checkInSource: string;
  checkOutSource: string;
  presenciaSource: string;
  checkInMethod: string;
  isPresent: boolean;
  isCompleted: boolean;
  isRetention: boolean;
  /** Presencia inventada por Modo Demo / autoPresenciaYCierre (no fue App ni operador). */
  autoPresencia: boolean;
  /** Cierre inventado por el scheduler (autoCompletarTurnos), no egreso WA/Op. */
  autoCompleted: boolean;
  realEndLabel: string;
  /** HH:MM en que el guardia avisó su salida desde la app (turno todavía abierto). */
  salidaMarcada?: string;
};

/**
 * Banda horaria según la hora de inicio del turno (sin importar el código):
 * M 06:00–11:59 · T 12:00–20:59 · N 21:00–05:59.
 */
function bandaPorHoraInicio(expected: string): 'M' | 'T' | 'N' | '' {
  const mins = parseHHMMToMins(String(expected || ''));
  if (mins === null) return '';
  if (mins >= 6 * 60 && mins < 12 * 60) return 'M';
  if (mins >= 12 * 60 && mins < 21 * 60) return 'T';
  return 'N';
}

function pasaFiltroBanda(row: { band: string; turno: { expected: string } }, filtro: string): boolean {
  if (filtro === 'all') return true;
  // Los RET son personal pasivo del día, sin horario propio: nunca se ocultan por banda.
  if (row.band === 'RET') return true;
  if (filtro === 'M' || filtro === 'T' || filtro === 'N') {
    return bandaPorHoraInicio(row.turno.expected) === filtro;
  }
  return row.band === filtro;
}

function extractBand(shift: string): string {
  const code = String(shift || '')
    .trim()
    .split(/\s+/)[0]
    ?.toUpperCase() || '';
  if (code === 'RET') return 'RET';
  if (BANDS.includes(code as (typeof BANDS)[number])) return code;
  if (code.startsWith('D12')) return 'D12';
  if (code.startsWith('N12')) return 'N12';
  if (code.startsWith('M')) return 'M';
  if (code.startsWith('T')) return 'T';
  if (code.startsWith('N')) return 'N';
  return '';
}

/** Hook interno: turnos del día desde Firestore (misma ventana que Ops). */
function useTurnosHoy({
  empresaId,
  scopeEmpresa,
}: {
  empresaId: string | null;
  scopeEmpresa: boolean;
}): {
  turnos: Record<string, TurnoHoy>;
  loading: boolean;
  phones: string[];
  francos: TurnoHoy[];
  presenciaMeta: Record<string, PresenciaMeta>;
  cerrados: Record<string, TurnoHoy>;
  clientePorObj: Record<string, string>;
  /** Retenes del día siguiente (para cubrir una noche). No entran al dict del puente WA. */
  retenesManana: TurnoHoy[];
  /** Tramos cortados y coberturas OPERATIONS_COVERAGE que no entran al dict por nombre (una fila por turno). */
  tramosExtra: TurnoHoy[];
  /** Titular ausente → nombres de quien lo cubre (incluye EXT/ADV con horas en la fuente). */
  coberturaPorTitular: Record<string, string[]>;
  /** Domicilio geocodificado, objetivo titular y experiencia por objetivo (para elegir retenes). */
  empInfo: Record<string, EmpleadoRetenInfo>;
} {
  const [empInfo, setEmpInfo] = useState<Record<string, EmpleadoRetenInfo>>({});
  const [retenesManana, setRetenesManana] = useState<TurnoHoy[]>([]);
  const [tramosExtra, setTramosExtra] = useState<TurnoHoy[]>([]);
  const [coberturaPorTitular, setCoberturaPorTitular] = useState<Record<string, string[]>>({});
  const [turnos, setTurnos] = useState<Record<string, TurnoHoy>>({});
  const [cerrados, setCerrados] = useState<Record<string, TurnoHoy>>({});
  const [presenciaMeta, setPresenciaMeta] = useState<Record<string, PresenciaMeta>>({});
  const [loading, setLoading] = useState(true);
  const [phones, setPhones] = useState<string[]>([]);
  const [clientePorObj, setClientePorObj] = useState<Record<string, string>>({});
  const [francos, setFrancos] = useState<TurnoHoy[]>([]);
  const objMapRef = useRef<Map<string, {
    name: string;
    clientName: string;
    lat?: number;
    lng?: number;
    allowRemoteCheckIn?: boolean;
  }>>(new Map());
  const phoneMapRef = useRef<Map<string, string>>(new Map());
  const lastTurnosSnapRef = useRef<QueryDocumentSnapshot[] | null>(null);
  const francosHoyRef = useRef<TurnoHoy[]>([]);

  useEffect(() => {
    if (!empresaId) {
      setTurnos({});
      setRetenesManana([]);
      setTramosExtra([]);
      setCoberturaPorTitular({});
      setPhones([]);
      setEmpInfo({});
      setFrancos([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const start = new Date();
    start.setDate(start.getDate() - 1);
    start.setHours(12, 0, 0, 0);
    const end = new Date();
    end.setDate(end.getDate() + 1);
    end.setHours(23, 59, 59, 999);

    const buildObjMap = (docs: QueryDocumentSnapshot[]) => {
      const m = new Map<string, {
        name: string;
        clientName: string;
        lat?: number;
        lng?: number;
        allowRemoteCheckIn?: boolean;
      }>();
      docs.forEach((d) => {
        const data = d.data() as Record<string, unknown>;
        const clientName = String(data.name || '');
        const objs = Array.isArray(data.objetivos)
          ? (data.objetivos as Record<string, unknown>[])
          : [];
        objs.forEach((o) => {
          const key = String(o.id || o.objectiveId || '');
          const lat = o.lat != null ? Number(o.lat) : undefined;
          const lng = o.lng != null ? Number(o.lng) : undefined;
          if (key) m.set(key, {
            name: String(o.name || ''),
            clientName,
            lat: lat && !isNaN(lat) ? lat : undefined,
            lng: lng && !isNaN(lng) ? lng : undefined,
            allowRemoteCheckIn: o.allowRemoteCheckIn === true,
          });
        });
      });
      return m;
    };

    const applyTurnos = (docs: QueryDocumentSnapshot[]) => {
      francosHoyRef.current = [];
      const now = Date.now();
      const byName = new Map<string, { turno: TurnoHoy; startMs: number }>();
      const cerradosMap = new Map<string, TurnoHoy>();
      const retMananaList: TurnoHoy[] = [];
      const tramosAbiertos: TurnoHoy[] = [];
      /** Coberturas ops abiertas: todas van a la lista (no se colapsan por nombre). */
      const coberturasAbiertas: TurnoHoy[] = [];
      /** Titular → cubridores (incluye EXT/ADV con horas en fuente, que no generan fila propia). */
      const coberturaLinks = new Map<string, string[]>();
      const metaTramos: Record<string, PresenciaMeta> = {};
      const manana = new Date(now);
      manana.setDate(manana.getDate() + 1);
      const registrarCoberturaLink = (shift: Record<string, unknown>, employeeName: string) => {
        if (String(shift.origin || '').toUpperCase() !== 'OPERATIONS_COVERAGE') return;
        if (shift.coverageSuperseded === true || shift.isDeleted === true) return;
        if (String(shift.status || '').toUpperCase() === 'CANCELLED') return;
        const forId = String(
          shift.coverageForShiftId || shift.coveredShiftId || shift.absenceShiftId || '',
        ).trim();
        const quien = String(employeeName || shift.employeeName || '').trim();
        if (!forId || !quien) return;
        const prev = coberturaLinks.get(forId) || [];
        if (!prev.includes(quien)) coberturaLinks.set(forId, [...prev, quien]);
      };

      for (const d of docs) {
        const shift = d.data() as Record<string, unknown>;
        // Excluir turnos de otra empresa. Bacarsa devuelve la colección completa (sin WHERE en
        // Firestore para incluir legacy sin empresaId), así que el filtro en memoria aplica siempre.
        if (
          (!scopeEmpresa || (empresaId || '').toLowerCase() === 'bacarsa') &&
          shift.empresaId &&
          String(shift.empresaId).trim() !== '' &&
          String(shift.empresaId).trim().toLowerCase() !== (empresaId || '').toLowerCase()
        ) {
          continue;
        }
        if (shift.draft === true) continue;
        // Turnos que el motor de cobertura dio de baja (fuente convertida, cobertura cancelada o
        // reemplazada): no son operativos, el CC clásico tampoco los muestra.
        if (
          shift.isDeleted === true ||
          shift.coverageSuperseded === true ||
          String(shift.status || '').toUpperCase() === 'CANCELLED'
        ) {
          continue;
        }
        // D12/N12 (extender o adelantar): las horas se llevan en el turno del propio guardia, que sigue
        // siendo su fila con el horario ajustado. El doc de cobertura es solo el vínculo con el ausente.
        if (shift.coverageHoursOnSource === true) {
          registrarCoberturaLink(shift, String(shift.employeeName || '').trim());
          continue;
        }

        const employeeId = String(shift.employeeId ?? '');
        const employeeName = String(shift.employeeName ?? '').trim();
        if (employeeId === 'VACANTE' || !employeeName) continue;

        const code = String(shift.code || '').toUpperCase();
        const pushFranco = () => {
          francosHoyRef.current.push({
            shift: `${code} (franco)`,
            obj:
              objMapRef.current.get(String(shift.objectiveId || ''))?.name ||
              String(shift.objectiveName || '—'),
            rowId: d.id,
            expected: '—',
            turnoStatus: String(shift.status || 'PENDING'),
            name: employeeName,
            phone:
              phoneMapRef.current.get(employeeId) ||
              String(shift.employeePhone || shift.phone || '')
                .replace(/\D/g, '')
                .replace(/^549/, '') ||
              undefined,
            employeeId,
            objectiveId: String(shift.objectiveId || ''),
            positionName: String(shift.positionName || ''),
            code,
            empresaId: String(shift.empresaId || ''),
          });
        };
        // F/FF/FP salen acá (isRestFrancoShift) antes de SKIP_CODES; hay que capturarlos para FT.
        if (
          isRestFrancoShift({
            code,
            isFranco: shift.isFranco,
            isFrancoTrabajado: shift.isFrancoTrabajado,
            isFrancoCompensatorio: shift.isFrancoCompensatorio,
            objectiveName: shift.objectiveName,
            type: shift.type,
          })
        ) {
          if (code === 'F' || code === 'FF' || code === 'FP') pushFranco();
          continue;
        }
        if (SKIP_CODES.has(code)) {
          if (code === 'F' || code === 'FF' || code === 'FP') pushFranco();
          continue;
        }

        const startMs = toStartMs(shift.startTime);
        if (Number.isNaN(startMs)) continue;

        const cerrado = String(shift.status || '').toUpperCase() === 'COMPLETED' || shift.isCompleted === true;

        let endMs = toStartMs(shift.endTime);
        if (Number.isNaN(endMs)) endMs = startMs;
        if (endMs <= startMs) endMs += 24 * 3600000;
        const nowMs = Date.now();
        const startDate = new Date(startMs);
        const nowDate = new Date(nowMs);
        const sameCalendarDay =
          startDate.getFullYear() === nowDate.getFullYear() &&
          startDate.getMonth() === nowDate.getMonth() &&
          startDate.getDate() === nowDate.getDate();
        const inProgress = startMs <= nowMs && endMs > nowMs;
        const startsSoon = startMs > nowMs && startMs - nowMs <= 4 * 3600000;
        const esRetManana =
          code === 'RET' &&
          startDate.getFullYear() === manana.getFullYear() &&
          startDate.getMonth() === manana.getMonth() &&
          startDate.getDate() === manana.getDate();
        if (!esRetManana && !inProgress && !sameCalendarDay && !startsSoon) continue;

        // Retiro anticipado: el servidor mueve endTime a la hora del retiro; el egreso planificado
        // sigue siendo el original (plannedEndTime) y el retiro se muestra aparte.
        const retiroAnticipado = shift.completionReason === 'EARLY_WITHDRAW';
        // Horario ajustado por extender/adelantar (D12/N12): si es una marca de tiempo, es el horario real.
        const esMarca = (v: unknown): v is Timestamp =>
          !!v && typeof (v as { toMillis?: unknown }).toMillis === 'function';
        const finAjustado =
          shift.isExtended === true && esMarca(shift.adjustedEndTime) ? shift.adjustedEndTime : undefined;
        const inicioAjustado =
          shift.isEarlyStart === true && esMarca(shift.adjustedStartTime) ? shift.adjustedStartTime : undefined;
        const endTs = (
          retiroAnticipado && shift.plannedEndTime ? shift.plannedEndTime : finAjustado ?? shift.endTime
        ) as Timestamp | undefined;
        const startTs = (inicioAjustado ?? shift.startTime) as Timestamp;
        const realTs = shift.realStartTime as Timestamp | undefined;

        const bloquesCortado = bloquesDelTurno(shift.blocks);
        const mapped: TurnoHoy = {
          shift: `${code || '?'} ${bloquesCortado ? bloquesCortado.map((b) => `${b.startTime}–${b.endTime}`).join(' + ') : `${formatHHMM(startTs)}–${formatHHMM(endTs)}`}`,
          ...(bloquesCortado ? { blocks: bloquesCortado } : {}),
          ...(retiroAnticipado
            ? {
                retiro: {
                  motivo: String(shift.interruptionReason || ''),
                  hora: formatHHMM((shift.realEndTime || shift.endTime) as Timestamp | undefined),
                },
              }
            : {}),
          obj:
            objMapRef.current.get(String(shift.objectiveId || ''))?.name ||
            String(shift.objectiveName || '—'),
          rowId: d.id,
          expected: formatHHMM(startTs),
          turnoStatus: String(shift.status || 'PENDING'),
          realStartTime: realTs ? formatHHMM(realTs) : undefined,
          name: employeeName,
          phone:
            phoneMapRef.current.get(employeeId) ||
            String(shift.employeePhone || shift.phone || '')
              .replace(/\D/g, '')
              .replace(/^549/, '') ||
            undefined,
          objLat: objMapRef.current.get(String(shift.objectiveId || ''))?.lat,
          objLng: objMapRef.current.get(String(shift.objectiveId || ''))?.lng,
          allowRemoteCheckIn:
            objMapRef.current.get(String(shift.objectiveId || ''))?.allowRemoteCheckIn === true,
          employeeId,
          objectiveId: String(shift.objectiveId || ''),
          positionName: String(shift.positionName || ''),
          code,
          startTimeRaw: startTs,
          endTimeRaw: endTs,
          empresaId: String(shift.empresaId || ''),
          origin: String(shift.origin || '').toUpperCase() || undefined,
          // Un RET que cubrió el resto de un retiro anticipado queda con coverageAssignedTo: también está usado.
          coverageUsed: shift.coverageUsed === true || (code === 'RET' && !!shift.coverageAssignedTo),
          coverageDocId: String(shift.coverageDocId || '').trim() || undefined,
          coverageStatus: String(shift.coverageStatus || '').toUpperCase() || undefined,
          operacionallyCovered: shift.operacionallyCovered === true,
          coveredByName:
            shift.operacionallyCovered === true || String(shift.coverageStatus || '').toUpperCase() === 'COVERED'
              ? String(shift.coveringDisplayName || shift.coveredByEmployeeName || '')
                  .replace(/\s*\([^)]*\)\s*$/, '')
                  .trim() || undefined
              : undefined,
          coversEmployeeName:
            String(shift.coversEmployeeName || '').trim() || undefined,
          coverageForShiftId:
            String(shift.coverageForShiftId || shift.coveredShiftId || shift.absenceShiftId || '')
              .trim() || undefined,
          ...(String(shift.comentarioOps || '').trim()
            ? {
                comentario: String(shift.comentarioOps).trim(),
                comentarioPor: String(shift.comentarioOpsPor || '').trim() || undefined,
              }
            : {}),
        };

        if (esRetManana) {
          // Un RET de mañana ya asignado a cubrir una noche de hoy sale de la lista: ya está usado.
          if (!mapped.coverageUsed) retMananaList.push(mapped);
          continue;
        }

        const considerar = (turno: TurnoHoy, turnoStartMs: number) => {
          const prev = byName.get(employeeName);
          if (!prev) {
            byName.set(employeeName, { turno, startMs: turnoStartMs });
          } else {
            // Regla Mauro: el cubridor debe verse en el puesto cubierto (todas las
            // OPERATIONS_COVERAGE van aparte). En el dict por nombre gana el turno propio;
            // RET/origen ya usado queda atrás; cobertura solo si no hay otro turno vivo.
            const prioridad = (t: TurnoHoy) => {
              if (t.coverageUsed) return 0;
              if (t.origin === 'OPERATIONS_COVERAGE') return 1;
              return 2;
            };
            const prevPrio = prioridad(prev.turno);
            const nextPrio = prioridad(turno);
            if (nextPrio !== prevPrio) {
              if (nextPrio > prevPrio) byName.set(employeeName, { turno, startMs: turnoStartMs });
              return;
            }
            const prevDist = Math.abs(prev.startMs - now);
            const nextDist = Math.abs(turnoStartMs - now);
            if (nextDist < prevDist) {
              byName.set(employeeName, { turno, startMs: turnoStartMs });
            }
          }
        };

        // Turno cortado: un solo documento, una fila por tramo con su propia presencia.
        if (bloquesCortado) {
          const pb = (shift.presenciaBloques && typeof shift.presenciaBloques === 'object'
            ? shift.presenciaBloques
            : {}) as Record<string, PresenciaBloque | undefined>;
          const docStatus = String(shift.status || 'PENDING').toUpperCase();
          const docEndMs = toStartMs(shift.realEndTime);
          const tramos = tramosDeTurno(startMs, bloquesCortado);
          const abiertosDoc: Array<{ turno: TurnoHoy; startMs: number; endMs: number }> = [];
          tramos.forEach((tr, i) => {
            const n = i + 1;
            const p: PresenciaBloque = pb[`b${n}`] || {};
            const tsIni = Timestamp.fromMillis(tr.startMs);
            const tsFin = Timestamp.fromMillis(tr.endMs);
            const realIni = i === 0 ? realTs : (p.realStartTime as Timestamp | undefined);
            const tramoCerrado =
              p.cerrado === true ||
              (cerrado && (i === 0 || Number.isNaN(docEndMs) || docEndMs >= tr.startMs));
            let status: string;
            if (tramoCerrado) status = 'COMPLETED';
            else if (docStatus === 'ABSENT') status = 'ABSENT';
            else if (i === 0) status = docStatus === 'PRESENT' && !realTs ? 'PENDING' : docStatus;
            else status = realIni ? 'PRESENT' : 'PENDING';
            const turnoTramo: TurnoHoy = {
              ...mapped,
              rowId: i === 0 ? d.id : `${d.id}#b${n}`,
              docId: d.id,
              bloque: n,
              bloquesTotal: tramos.length,
              shift: `${code || '?'} ${formatHHMM(tsIni)}–${formatHHMM(tsFin)}`,
              expected: formatHHMM(tsIni),
              turnoStatus: status,
              realStartTime: realIni ? formatHHMM(realIni) : undefined,
              startTimeRaw: tsIni,
              endTimeRaw: tsFin,
            };
            const realFin = p.realEndTime as Timestamp | undefined;
            const esUltimo = i === tramos.length - 1;
            metaTramos[turnoTramo.rowId] = {
              checkInSource: i === 0 ? String(shift.checkInSource || '') : String(p.checkInSource || ''),
              checkOutSource: i === 0 ? String(shift.checkOutSource || '') : String(p.checkOutSource || ''),
              presenciaSource: i === 0 ? String(shift.presenciaSource || '') : '',
              checkInMethod: i === 0 ? String(shift.checkInMethod || '') : '',
              isPresent: status === 'PRESENT',
              isCompleted: tramoCerrado,
              isRetention: false,
              autoPresencia: shift.autoPresencia === true || !!shift.modoDemoAt,
              autoCompleted:
                !!shift.autoCompletedAt
                || shift.autoCierre === true
                || String(shift.autoCompletedBy || '').length > 0
                || String(shift.completionReason || '').toUpperCase().startsWith('FIN_')
                || String(shift.completionReason || '').toUpperCase().startsWith('SIN_')
                || String(shift.checkOutSource || '').toUpperCase() === 'AUTO',
              realEndLabel: realFin
                ? formatHHMM(realFin)
                : tramoCerrado && esUltimo && shift.realEndTime
                  ? formatHHMM(shift.realEndTime as Timestamp)
                  : '',
            };
            if (tramoCerrado) {
              cerradosMap.set(turnoTramo.rowId, turnoTramo);
            } else {
              abiertosDoc.push({ turno: turnoTramo, startMs: tr.startMs, endMs: tr.endMs });
              tramosAbiertos.push(turnoTramo);
            }
          });
          // Cada tramo lleva su propia ubicación/WhatsApp: el mensaje del guardia cuenta para el tramo
          // vigente (el primero abierto que todavía no terminó), no para el más cercano a la hora actual.
          // El tramo 2 recién recibe WA cuando termina el 1 o éste se cierra.
          const vigente = abiertosDoc.find((a) => a.endMs > now) ?? abiertosDoc[0];
          if (vigente) considerar(vigente.turno, vigente.startMs);
          // Cobertura cortada: todos los tramos abiertos deben figurar en el puesto (no solo el vigente).
          if (mapped.origin === 'OPERATIONS_COVERAGE') {
            for (const a of abiertosDoc) coberturasAbiertas.push(a.turno);
            registrarCoberturaLink(shift, employeeName);
          }
          continue;
        }

        if (cerrado) {
          cerradosMap.set(d.id, mapped);
          continue;
        }

        if (mapped.origin === 'OPERATIONS_COVERAGE') {
          coberturasAbiertas.push(mapped);
          registrarCoberturaLink(shift, employeeName);
        }
        considerar(mapped, startMs);
      }

      const next: Record<string, TurnoHoy> = {};
      const metaNext: Record<string, PresenciaMeta> = {};
      byName.forEach((v, name) => {
        next[name] = v.turno;
      });
      const idsEnDict = new Set(Object.values(next).map((t) => t.rowId));
      const extrasTramos = [
        ...tramosAbiertos.filter((t) => !idsEnDict.has(t.rowId)),
        ...coberturasAbiertas.filter((t) => !idsEnDict.has(t.rowId)),
      ];
      // Dedup por rowId (un tramo cortado de cobertura puede estar en ambos arrays).
      const extrasUnicos: TurnoHoy[] = [];
      const vistosExtra = new Set<string>();
      for (const t of extrasTramos) {
        if (!t.rowId || vistosExtra.has(t.rowId)) continue;
        vistosExtra.add(t.rowId);
        extrasUnicos.push(t);
      }
      const coberturaNext: Record<string, string[]> = {};
      coberturaLinks.forEach((names, forId) => {
        coberturaNext[forId] = names;
      });
      for (const d of docs) {
        const shift = d.data() as Record<string, unknown>;
        const realEnd = shift.realEndTime as Timestamp | undefined;
        metaNext[d.id] = {
          checkInSource: String(shift.checkInSource || ''),
          checkOutSource: String(shift.checkOutSource || ''),
          presenciaSource: String(shift.presenciaSource || ''),
          checkInMethod: String(shift.checkInMethod || ''),
          isPresent: shift.isPresent === true,
          isCompleted: String(shift.status || '').toUpperCase() === 'COMPLETED' || shift.isCompleted === true,
          isRetention: shift.isRetention === true,
          autoPresencia: shift.autoPresencia === true || !!shift.modoDemoAt,
          autoCompleted:
            !!shift.autoCompletedAt
            || shift.autoCierre === true
            || String(shift.autoCompletedBy || '').length > 0
            || String(shift.completionReason || '').toUpperCase().startsWith('FIN_')
            || String(shift.completionReason || '').toUpperCase().startsWith('SIN_')
            || String(shift.checkOutSource || '').toUpperCase() === 'AUTO',
          realEndLabel: realEnd ? formatHHMM(realEnd) : '',
          salidaMarcada:
            shift.salidaMarcadaAt &&
            !realEnd &&
            String(shift.status || '').toUpperCase() !== 'COMPLETED'
              ? formatHHMM(shift.salidaMarcadaAt as Timestamp)
              : undefined,
        };
      }
      Object.assign(metaNext, metaTramos);
      const cerradosNext: Record<string, TurnoHoy> = {};
      cerradosMap.forEach((turno, id) => {
        cerradosNext[id] = turno;
      });
      setTurnos(next);
      setTramosExtra(extrasUnicos);
      setCoberturaPorTitular(coberturaNext);
      setRetenesManana(retMananaList);
      setCerrados(cerradosNext);
      setPresenciaMeta(metaNext);
      setFrancos(francosHoyRef.current);
      setLoading(false);
    };

    const clientsQ = empresaCollectionQuery('clients', empresaId, scopeEmpresa);
    const unsubClients = onSnapshot(clientsQ, (snap) => {
      objMapRef.current = buildObjMap(snap.docs);
      const porNombre: Record<string, string> = {};
      objMapRef.current.forEach((v) => {
        if (v.name && v.clientName) porNombre[v.name] = v.clientName;
      });
      setClientePorObj(porNombre);
      if (lastTurnosSnapRef.current) applyTurnos(lastTurnosSnapRef.current);
    });

    // Mapa employeeId → phone normalizado (turnos no traen employeePhone)
    const empQ = empresaCollectionQuery('empleados', empresaId, scopeEmpresa);
    const unsubEmps = onSnapshot(empQ, (snap) => {
      const m = new Map<string, string>();
      const infoNext: Record<string, EmpleadoRetenInfo> = {};
      snap.docs.forEach((d) => {
        const data = d.data() as Record<string, unknown>;
        const raw = String(data.telefono || data.phone || '').replace(/\D/g, '');
        const norm = raw.replace(/^549/, '');
        if (norm) m.set(d.id, norm);
        const lat = Number(data.lat ?? data.latitude);
        const lng = Number(data.lng ?? data.longitude);
        const exp = data.experienciaObjetivos;
        infoNext[d.id] = {
          lat: Number.isFinite(lat) ? lat : null,
          lng: Number.isFinite(lng) ? lng : null,
          preferredObjectiveId: data.preferredObjectiveId ? String(data.preferredObjectiveId) : null,
          experienciaObjetivos:
            exp && typeof exp === 'object' ? (exp as EmpleadoRetenInfo['experienciaObjetivos']) : undefined,
        };
      });
      setEmpInfo(infoNext);
      phoneMapRef.current = m;
      setPhones(Array.from(m.values()).filter(Boolean));
      if (lastTurnosSnapRef.current) applyTurnos(lastTurnosSnapRef.current);
    });

    const q = query(
      empresaCollectionQuery('turnos', empresaId, scopeEmpresa),
      where('startTime', '>=', Timestamp.fromDate(start)),
      where('startTime', '<=', Timestamp.fromDate(end)),
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        lastTurnosSnapRef.current = snap.docs;
        applyTurnos(snap.docs);
      },
      (err) => {
        console.warn('[modo-rapido] turnos listener error:', err);
        setLoading(false);
      },
    );

    return () => {
      unsubClients();
      unsubEmps();
      unsub();
      lastTurnosSnapRef.current = null;
    };
  }, [empresaId, scopeEmpresa]);

  return {
    turnos,
    loading,
    phones,
    francos,
    presenciaMeta,
    cerrados,
    clientePorObj,
    retenesManana,
    tramosExtra,
    coberturaPorTitular,
    empInfo,
  };
}

type GuardEstado =
  | 'PRESENTE_PLAT'
  | 'PRESENTE_WA'
  | 'PENDIENTE_WA'
  | 'AUSENTE'
  | 'ESPERANDO'
  | 'TARDANZA'
  | 'NO_LLEGO'
  | 'CERRADO';

type StatsFilter =
  | 'all'
  | 'critico'
  | 'tardanza'
  | 'sin_confirmar'
  | 'ok'
  | 'sin_presencia'
  | 'radio'
  | 'app'
  | 'cerrado';

type FuenteMarca = 'WA' | 'Radio' | 'App' | 'Op' | 'Demo' | 'Auto' | '—';

function fuenteDe(estado: GuardEstado, meta?: PresenciaMeta): FuenteMarca {
  if (estado === 'PENDIENTE_WA' || estado === 'PRESENTE_WA') return 'WA';
  // Cerrado: la columna refleja el egreso. Nunca reutilizar el check-in (Op) como si fuera la salida.
  if (estado === 'CERRADO') {
    const out = String(meta?.checkOutSource || '').toUpperCase();
    if (out === 'WA' || out === 'WHATSAPP') return 'WA';
    if (out === 'AUTO' || out === 'SISTEMA' || out === 'SYSTEM' || meta?.autoCompleted === true) {
      return 'Auto';
    }
    if (out === 'MANUAL_RADIO' || out.includes('RADIO')) return 'Radio';
    if (out === 'PORTAL_GPS' || out === 'APP_GEO' || out === 'APP_QR') return 'App';
    if (out === 'MANUAL' || out === 'OPERATIONS' || out === 'MANUAL_PHONE') return 'Op';
    if (out === 'MODO_DEMO' || out === 'DEMO') return 'Demo';
    return '—';
  }
  const src = String(meta?.presenciaSource || meta?.checkInMethod || meta?.checkInSource || '').toUpperCase();
  if (src === 'MODO_DEMO' || src === 'DEMO' || meta?.autoPresencia === true) return 'Demo';
  if (src === 'PORTAL_GPS' || src === 'APP_GEO' || src === 'APP_QR') return 'App';
  if (src === 'MANUAL_RADIO' || src.includes('RADIO')) return 'Radio';
  if (src === 'WA' || src === 'WHATSAPP') return 'WA';
  if (src === 'MANUAL' || src === 'OPERATIONS' || src === 'MANUAL_PHONE') return 'Op';
  // Presente en plataforma sin fuente: operador/sistema, nunca App (antes el fallback mentía).
  if (estado === 'PRESENTE_PLAT') return 'Op';
  return '—';
}

type GuardRowModel = {
  employeeName: string;
  turno: TurnoHoy;
  estado: GuardEstado;
  pendingEntry?: WAEntry;
  realDisplay: string;
  diffLabel: string;
  diffTone: 'late' | 'early' | 'countdown' | 'neutral';
  band: string;
  fuente: FuenteMarca;
  salida: string;
  salidaReal?: string;
  /** Nombre de quien ya cubrió este turno (mismo objetivo+puesto+horario), si aplica. */
  coveredByName?: string;
  /** Quién releva a este guardia en el puesto (mismo objetivo y puesto, entra cerca de su hora de salida). */
  relevoNombre?: string;
  /** Hora (HH:MM) en que el guardia avisó su salida por WhatsApp con ubicación. */
  salidaAvisada?: string;
  /** Avisó su salida pero su relevo programado todavía no está presente: queda retenido hasta que el operador lo cierre. */
  salidaSinRelevo?: boolean;
  /** El puesto no tiene relevo programado: el servicio termina con este guardia. */
  finSinRelevo?: boolean;
};

const CODIGOS_SIN_RELEVO = new Set(["RET", "ESC", "REF", "F", "FF", "FP", "V", "L", "E", "A", "PG", "ART", "AA"]);

const esRelevoDe = (row: GuardRowModel, o: GuardRowModel, incluirAusentes = false): boolean => {
  if (o.turno.rowId === row.turno.rowId) return false;
  if (!row.turno.objectiveId || o.turno.objectiveId !== row.turno.objectiveId) return false;
  if (row.turno.positionName && o.turno.positionName && row.turno.positionName !== o.turno.positionName) return false;
  // Relevo solo en puesto 24 h: M→T→N (M2→T2) o D12↔N12. C0, C1, EN, SA y el resto
  // no se relevan aunque compartan objetivo y nombre de puesto.
  if (seriesHandoffKind(row.turno.code, o.turno.code) !== 'SERIES') return false;
  if (o.turno.employeeId && o.turno.employeeId === row.turno.employeeId) return false;
  if (CODIGOS_SIN_RELEVO.has(String(o.turno.code || "").toUpperCase())) return false;
  if (o.estado === "CERRADO") return false;
  if (!incluirAusentes && (o.estado === "AUSENTE" || o.estado === "NO_LLEGO")) return false;
  const finMs = toStartMs(row.turno.endTimeRaw);
  const st = toStartMs(o.turno.startTimeRaw);
  if (Number.isNaN(finMs) || Number.isNaN(st)) return false;
  return st >= finMs - 30 * 60000 && st <= finMs + 2 * 3600000;
};

const estaPresente = (r: GuardRowModel): boolean => r.estado === "PRESENTE_PLAT" || r.estado === "PRESENTE_WA";

/** Relevo del guardia en el puesto: prefiere al que ya está presente y, entre iguales, al que entra más cerca de su salida. */
function buscarRelevo(row: GuardRowModel, rows: GuardRowModel[]): GuardRowModel | undefined {
  const finMs = toStartMs(row.turno.endTimeRaw);
  let mejor: GuardRowModel | undefined;
  let mejorPuntaje = Number.POSITIVE_INFINITY;
  for (const o of rows) {
    if (!esRelevoDe(row, o)) continue;
    const puntaje = Math.abs(toStartMs(o.turno.startTimeRaw) - finMs) + (estaPresente(o) ? 0 : 1e12);
    if (puntaje < mejorPuntaje) {
      mejor = o;
      mejorPuntaje = puntaje;
    }
  }
  return mejor;
}

/**
 * Puesto 24 h con relevo de la serie siguiente (aunque todavía no haya llegado o esté ausente).
 * Un código que no es 24 h no tiene relevo: el servicio termina con este guardia.
 */
function hayRelevoProgramado(row: GuardRowModel, rows: GuardRowModel[]): boolean {
  return rows.some((o) => esRelevoDe(row, o, true));
}

/** Hay un relevo presente que todavía no tomó otro saliente del mismo puesto (cerrados con salida cercana). */
function hayRelevoLibre(row: GuardRowModel, rows: GuardRowModel[]): boolean {
  const finMs = toStartMs(row.turno.endTimeRaw);
  const presentes = rows.filter((o) => esRelevoDe(row, o) && estaPresente(o)).length;
  const yaRelevados = rows.filter((o) => {
    if (o.estado !== "CERRADO" || o.turno.rowId === row.turno.rowId) return false;
    if (!row.turno.objectiveId || o.turno.objectiveId !== row.turno.objectiveId) return false;
    if (row.turno.positionName && o.turno.positionName && row.turno.positionName !== o.turno.positionName) return false;
    if (o.turno.employeeId && o.turno.employeeId === row.turno.employeeId) return false;
    const fin = toStartMs(o.turno.endTimeRaw);
    return !Number.isNaN(fin) && Math.abs(fin - finMs) <= 30 * 60000;
  }).length;
  return presentes > yaRelevados;
}

const COLS_DEFAULT =
  '3px minmax(270px,2.2fr) 96px 52px 5.5rem 5.5rem 5.5rem 5.5rem 6.5rem 4.5rem 6.5rem minmax(11rem,auto)';

const SHEET_COLS = 'grid-cols-[var(--mr-cols)]';

/** Anchos mínimos (px) de las 11 columnas ajustables: Guardia … Acción (sin Objetivo: ya va en el grupo). */
const COLS_MIN = [150, 60, 40, 60, 60, 60, 60, 50, 50, 80, 140];
const COLS_ANCHOS_KEY = 'mr-col-anchos-v2';

function plantillaColumnas(anchos: number[] | null): string {
  if (!anchos || anchos.length !== COLS_MIN.length) return COLS_DEFAULT;
  const fijos = anchos.slice(0, -1).map((w) => `${Math.round(w)}px`).join(' ');
  return `3px ${fijos} minmax(${Math.round(anchos[anchos.length - 1])}px,1fr)`;
}

function CabeceraCol({
  idx,
  onResizeStart,
  onResizeReset,
  className,
  title,
  children,
}: {
  idx: number;
  onResizeStart: (idx: number, e: React.PointerEvent<HTMLSpanElement>) => void;
  onResizeReset: () => void;
  className?: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span className={`relative ${className || ''}`} title={title}>
      {children}
      <span
        role="separator"
        aria-orientation="vertical"
        aria-label="Ajustar ancho de columna. Doble clic restablece"
        title="Arrastrá para ajustar el ancho · doble clic restablece todas"
        onPointerDown={(e) => onResizeStart(idx, e)}
        onDoubleClick={onResizeReset}
        onClick={(e) => e.stopPropagation()}
        className="absolute right-0 top-0 z-20 h-full w-2 cursor-col-resize touch-none select-none hover:bg-indigo-300/60 active:bg-indigo-400/70"
      />
    </span>
  );
}

type OrdenModo = 'prioridad' | 'alfabetico' | 'cliente' | 'horario' | 'manual';

type IconoSheet = LucideIcon;

const ORDEN_OPCIONES: Array<{ id: OrdenModo; label: string; title: string; icon: IconoSheet }> = [
  { id: 'prioridad', label: 'Prioridad', title: 'Primero los objetivos con problemas', icon: Flame },
  { id: 'alfabetico', label: 'A–Z', title: 'Objetivos por orden alfabético', icon: ArrowDownAZ },
  { id: 'cliente', label: 'Cliente', title: 'Agrupados por cliente', icon: Users },
  { id: 'horario', label: 'Horario', title: 'Primero los objetivos cuyo turno empieza antes', icon: Clock },
  { id: 'manual', label: 'Manual', title: 'Arrastrá los objetivos al lugar que quieras', icon: Hand },
];

/** Texto que el bridge le manda al guardia cuando el operador confirma su ingreso. */
function textoConfirmacionWA(nombreCompleto: string, hora: string, turno?: TurnoHoy): string {
  return textoConfirmacionIngresoWa(nombreCompleto, hora, turno);
}

function RelojCabecera() {
  const [ahora, setAhora] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setAhora(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const hora = ahora.toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const fecha = ahora.toLocaleDateString('es-AR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  return (
    <div
      className="ml-auto flex items-center gap-2 px-3 py-1 rounded-2xl bg-slate-900 text-white shadow-sm"
      title="Hora actual"
      aria-label={`Hora actual ${hora}`}
    >
      <Clock size={14} className="text-emerald-400" />
      <span className="font-mono text-lg font-black leading-none tabular-nums tracking-wide">{hora}</span>
      <span className="text-[10px] font-semibold uppercase text-slate-300 leading-none">{fecha}</span>
    </div>
  );
}

function ChipIcono({
  icon: Icono,
  label,
  count,
  active,
  accent,
  tono,
  siempre,
  onClick,
}: {
  icon: IconoSheet;
  label: string;
  count: number;
  active: boolean;
  accent: string;
  tono?: string;
  siempre?: boolean;
  onClick: () => void;
}) {
  const apagado = !active && !siempre && count === 0;
  return (
    <button
      type="button"
      title={`${label}: ${count}`}
      aria-label={`${label}: ${count}`}
      aria-pressed={active}
      onClick={onClick}
      className={`flex items-center gap-1 px-2 py-1.5 rounded-full text-[11px] font-bold whitespace-nowrap border transition-colors flex-shrink-0 ${
        active ? accent : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
      } ${apagado ? 'opacity-50' : ''}`}
    >
      <Icono size={13} className={active ? '' : tono || ''} />
      <span className="tabular-nums">{count}</span>
    </button>
  );
}

const SIN_CLIENTE = 'Sin cliente';

function compararTexto(a: string, b: string): number {
  return a.localeCompare(b, 'es', { sensitivity: 'base', numeric: true });
}

function abrirWa(phone: string | undefined, text: string): boolean {
  if (!phone) return false;
  openWhatsApp(phone, text);
  return true;
}

const SHEET_ALIGN =
  'gap-x-0 text-left [&>*]:min-w-0 [&>*:not(:first-child)]:px-2 [&>*]:text-left';

const SHEET_SHADE = 'mr-head';

function rowRank(row: GuardRowModel): number {
  if (row.estado === 'NO_LLEGO' && !row.coveredByName) return 0;
  if (row.estado === 'TARDANZA') return 1;
  if (row.estado === 'PENDIENTE_WA') return 2;
  if (row.estado === 'AUSENTE' && !row.coveredByName) return 3;
  if (row.estado === 'ESPERANDO') return 4;
  if (row.estado === 'CERRADO') return 6;
  return 5;
}

function pasaFiltro(row: GuardRowModel, statsFilter: StatsFilter): boolean {
  if (statsFilter === 'critico') return row.estado === 'NO_LLEGO' && !row.coveredByName;
  if (statsFilter === 'tardanza') return row.estado === 'TARDANZA';
  if (statsFilter === 'sin_confirmar') return row.estado === 'PENDIENTE_WA';
  if (statsFilter === 'ok') return row.estado === 'PRESENTE_WA' || row.estado === 'PRESENTE_PLAT';
  if (statsFilter === 'sin_presencia') {
    return (
      row.fuente === '—' &&
      (row.estado === 'ESPERANDO' || row.estado === 'TARDANZA' || row.estado === 'NO_LLEGO')
    );
  }
  if (statsFilter === 'radio') return row.fuente === 'Radio';
  if (statsFilter === 'app') return row.fuente === 'App';
  if (statsFilter === 'cerrado') return row.estado === 'CERRADO';
  return true;
}

function classifyEstado(
  turno: TurnoHoy,
  wa: UseWABridgeReturn,
  nowMs: number,
): { estado: GuardEstado; pendingEntry?: WAEntry } {
  const pendingEntry = wa.pending.find((e) => e.rowId === turno.rowId);
  if (turno.turnoStatus === 'PRESENT') return { estado: 'PRESENTE_PLAT', pendingEntry };
  if (wa.confirmedRowIds.has(turno.rowId)) return { estado: 'PRESENTE_WA', pendingEntry };
  if (pendingEntry) return { estado: 'PENDIENTE_WA', pendingEntry };
  if (turno.turnoStatus === 'ABSENT') return { estado: 'AUSENTE', pendingEntry };
  // El RET es pasivo (espera que lo activen): no corre tardanza ni "no llegó".
  if (String(turno.code || '').toUpperCase() === 'RET') return { estado: 'ESPERANDO', pendingEntry };

  const late = minutesSinceExpected(
    turno.expected,
    nowMs,
    turno.startTimeRaw as Timestamp | undefined,
  );
  if (late !== null && late > 30) return { estado: 'NO_LLEGO', pendingEntry };
  if (late !== null && late > 10) return { estado: 'TARDANZA', pendingEntry };
  return { estado: 'ESPERANDO', pendingEntry };
}

/** Tolerancia de puntualidad: hasta T+5 sigue siendo puntual (igual que el reloj de pago). */
const PUNTUAL_HASTA_MIN = 5;

function buildDiff(
  expected: string,
  real: string | undefined,
  nowMs: number,
  startTimeRaw?: Timestamp,
): { label: string; tone: GuardRowModel['diffTone'] } {
  if (real) {
    const exp = parseHHMMToMins(expected);
    const re = parseHHMMToMins(real);
    if (exp === null || re === null) return { label: '—', tone: 'neutral' };
    const diff = re - exp;
    // Hasta T+5 es puntual; desde T+6 figura la demora.
    if (diff > PUNTUAL_HASTA_MIN) return { label: `+${diff} min`, tone: 'late' };
    if (diff < 0) return { label: `${diff} min antes`, tone: 'early' };
    return { label: 'puntual', tone: 'early' };
  }

  const late = minutesSinceExpected(expected, nowMs, startTimeRaw);
  if (late === null) return { label: '—', tone: 'neutral' };
  if (late < 0) return { label: `en ${Math.abs(late)} min`, tone: 'countdown' };
  if (late === 0) return { label: 'en 0 min', tone: 'countdown' };
  return { label: `hace ${late} min`, tone: 'countdown' };
}

function barClass(estado: GuardEstado): string {
  switch (estado) {
    case 'NO_LLEGO':
      return 'bg-red-500';
    case 'TARDANZA':
      return 'bg-orange-400';
    case 'PENDIENTE_WA':
      return 'bg-blue-400 animate-pulse';
    case 'ESPERANDO':
      return 'bg-amber-300';
    case 'PRESENTE_WA':
      return 'bg-emerald-400';
    case 'PRESENTE_PLAT':
      return 'bg-emerald-600';
    case 'AUSENTE':
      return 'bg-slate-300';
    case 'CERRADO':
      return 'bg-slate-400';
    default:
      return 'bg-slate-200';
  }
}

function estadoPill(estado: GuardEstado): { label: string; className: string } {
  switch (estado) {
    case 'NO_LLEGO':
      return { label: 'NO LLEGÓ', className: 'mr-pill mr-pill-red' };
    case 'TARDANZA':
      return { label: 'TARDANZA', className: 'mr-pill mr-pill-orange' };
    case 'PENDIENTE_WA':
      return { label: '● WA', className: 'mr-pill mr-pill-blue animate-pulse' };
    case 'ESPERANDO':
      return { label: 'ESPERANDO', className: 'mr-pill mr-pill-amber' };
    case 'PRESENTE_WA':
      return { label: '✓ WA', className: 'mr-pill mr-pill-green' };
    case 'PRESENTE_PLAT':
      return { label: '✓ PRESENTE', className: 'mr-pill mr-pill-green-strong' };
    case 'AUSENTE':
      return { label: 'AUSENTE', className: 'mr-pill mr-pill-red' };
    case 'CERRADO':
      return { label: 'CERRADO', className: 'mr-pill mr-pill-slate' };
    default:
      return { label: estado, className: 'mr-pill mr-pill-mute' };
  }
}

type MotivoRetiro = 'ENFERMEDAD' | 'FAMILIAR' | 'AUTORIZADO' | 'ABANDONO';

const MOTIVOS_RETIRO: Array<{ id: MotivoRetiro; tecla: string; label: string; detalle: string }> = [
  { id: 'ENFERMEDAD', tecla: '1', label: 'Enfermedad', detalle: 'Ausencia parcial E' },
  { id: 'FAMILIAR', tecla: '2', label: 'Emergencia familiar', detalle: 'Ausencia parcial A' },
  { id: 'AUTORIZADO', tecla: '3', label: 'Autorizado / operativo', detalle: 'Ausencia parcial A' },
  { id: 'ABANDONO', tecla: '4', label: 'Abandono de puesto', detalle: 'AA parcial + novedad disciplinaria' },
];

function ModalRetiro({
  row,
  hoursLeft,
  policy,
  colleagues,
  motivo,
  reemplazo,
  busy,
  onMotivo,
  onReemplazo,
  onConfirm,
  onClose,
}: {
  row: GuardRowModel;
  hoursLeft: number;
  policy: EarlyWithdrawReplacePolicy;
  colleagues: number;
  motivo: MotivoRetiro;
  reemplazo: boolean | null;
  busy: boolean;
  onMotivo: (m: MotivoRetiro) => void;
  onReemplazo: (v: boolean) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const necesitaDecision = policy === 'OPERATOR_CHOICE';
  const buscaReemplazo = policy === 'REPLACE' || policy === 'AUTO_REPLACE' || (necesitaDecision && reemplazo === true);
  const horas = `${Math.floor(hoursLeft)} h ${String(Math.round((hoursLeft % 1) * 60)).padStart(2, '0')} min`;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-3 bg-purple-50">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-black text-purple-800">Retiro anticipado</div>
            <div className="text-[11px] text-slate-600 truncate">
              {row.employeeName} · {row.turno.obj} · {row.turno.shift}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-purple-100 text-slate-400"
          >
            ✕
          </button>
        </div>

        <div className="px-4 py-3 space-y-3">
          <div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">
              Motivo del retiro
            </div>
            <div className="grid grid-cols-1 gap-1.5">
              {MOTIVOS_RETIRO.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onMotivo(m.id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-left transition-colors ${
                    motivo === m.id
                      ? 'border-purple-400 bg-purple-50 text-purple-900'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span className="w-5 h-5 rounded-md bg-slate-100 text-[10px] font-black flex items-center justify-center text-slate-600">
                    {m.tecla}
                  </span>
                  <span className="flex-1 text-[12px] font-bold">{m.label}</span>
                  <span className="text-[10px] text-slate-500">{m.detalle}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
            <div className="flex justify-between">
              <span>Faltan para el cierre</span>
              <span className="font-mono font-bold text-slate-800">{horas}</span>
            </div>
            <div className="flex justify-between mt-0.5">
              <span>Compañeros presentes en el objetivo</span>
              <span className="font-mono font-bold text-slate-800">{colleagues}</span>
            </div>
          </div>

          {necesitaDecision && (
            <div className="p-3 rounded-xl border border-amber-200 bg-amber-50 space-y-2">
              <div className="text-[11px] font-bold text-amber-900">
                Quedan entre 2 y 3 h: ¿buscar reemplazo para el resto?
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onReemplazo(true)}
                  className={`flex-1 py-1.5 rounded-lg text-[11px] font-black border ${
                    reemplazo === true ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-700 border-slate-200'
                  }`}
                >
                  S · Sí, cubrir
                </button>
                <button
                  type="button"
                  onClick={() => onReemplazo(false)}
                  className={`flex-1 py-1.5 rounded-lg text-[11px] font-black border ${
                    reemplazo === false ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-700 border-slate-200'
                  }`}
                >
                  N · No reemplazar
                </button>
              </div>
            </div>
          )}

          <div
            className={`text-[11px] rounded-xl px-3 py-2 border ${
              buscaReemplazo
                ? 'bg-violet-50 border-violet-200 text-violet-800'
                : 'bg-slate-50 border-slate-200 text-slate-600'
            }`}
          >
            {necesitaDecision && reemplazo === null
              ? 'Elegí si se reemplaza el resto del turno.'
              : buscaReemplazo
                ? 'Al confirmar se cierra su turno y se abre la búsqueda de reemplazo: RET, franco trabajado u otra opción.'
                : 'Al confirmar se cierra su turno. Falta menos de 2 h y hay compañeros: no se busca reemplazo.'}
          </div>
        </div>

        <div className="px-4 py-3 border-t border-slate-100 flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl text-[11px] font-bold text-slate-600 bg-slate-100 hover:bg-slate-200"
          >
            Cancelar (Esc)
          </button>
          <button
            type="button"
            disabled={busy || (necesitaDecision && reemplazo === null)}
            onClick={onConfirm}
            className="px-4 py-1.5 rounded-xl text-[11px] font-black text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50"
          >
            Confirmar retiro (Enter)
          </button>
        </div>
      </div>
    </div>
  );
}

type BandaPuesto = 'M' | 'T' | 'N';

/**
 * D12 + N12 (puesto 24 h): dos guardias cubren el día completo, D12 06:00–18:00 y N12 18:00–06:00.
 * Si falta la T, extiende el de la M y adelanta el de la N. Si falta la M o la N, uno de la T se
 * intercambia al lugar del ausente (queda D12 si falta la M, N12 si falta la N) y la T pasa a ser el
 * hueco que cubren D12 y N12.
 */
type PlanD12N12 = {
  banda: BandaPuesto;
  bandaD12: BandaPuesto;
  bandaN12: BandaPuesto;
  /** Rol del guardia de la T que se intercambia al lugar del ausente (null si falta la T). */
  rolIntercambio: 'D12' | 'N12' | null;
  explicacion: string;
};

type SeccionCobertura = 'ret' | 'dual' | 'cambio' | 'ft';

function ModalCobertura({
  absent,
  remanente,
  retCandidates,
  retEsManana,
  retEval,
  extCandidates,
  intercambioCandidates,
  francoCandidates,
  planD12N12,
  busy,
  onClose,
  onAsignarRet,
  onAplicarDual,
  onIntercambiar,
  onConvocarFt,
  onAvisarWa,
}: {
  absent: GuardRowModel;
  /** Retiro anticipado: se cubre solo el resto del turno (desde/hasta HH:MM). */
  remanente?: { desde: string; hasta: string } | null;
  retCandidates: GuardRowModel[];
  retEsManana: boolean;
  /** Distancia y conocimiento del objetivo de cada RET (por rowId), si se pudo evaluar. */
  retEval?: Record<string, RetenEvaluado>;
  extCandidates: GuardRowModel[];
  intercambioCandidates: GuardRowModel[];
  francoCandidates: GuardRowModel[];
  /** D12 + N12: quién puede ser cada uno según la banda que falta. */
  planD12N12: PlanD12N12 | null;
  busy: boolean;
  onClose: () => void;
  onAsignarRet: (c: GuardRowModel) => void;
  onAplicarDual: (d12: GuardRowModel, n12: GuardRowModel) => void;
  onIntercambiar: (c: GuardRowModel) => void;
  onConvocarFt: (c: GuardRowModel) => void;
  onAvisarWa: (c: GuardRowModel, plantilla: 'cobertura' | 'intercambio') => void;
}) {
  // Puesto 24 h: el turno es exactamente M/T/N/D12/N12 (código del catálogo). Cualquier otro código
  // es un puesto custom (EN, C1, SA…): solo admite RET y franco trabajado.
  const codigoAusente = String(absent.turno.code || '').trim().toUpperCase();
  const esCustom = !BANDS.includes(codigoAusente as (typeof BANDS)[number]);
  // Turno cortado: se cubre completo con RET o FT; extender e intercambiar no aplican.
  const esCortado = esTramoCortado(absent.turno);
  const esPuesto24h = !esCustom && !esCortado && ['M', 'T', 'N'].includes(absent.band) && !remanente && !!planD12N12;
  const hayIntercambio = !remanente && !esCustom && !esCortado;

  // Secciones visibles, en orden. Se muestra una sola abierta: al plegar una se abre la siguiente.
  const visibles = useMemo((): SeccionCobertura[] => {
    const lista: SeccionCobertura[] = ['ret'];
    if (esPuesto24h) lista.push('dual');
    if (hayIntercambio) lista.push('cambio');
    lista.push('ft');
    return lista;
  }, [esPuesto24h, hayIntercambio]);

  const [abierta, setAbierta] = useState<SeccionCobertura | null>(() => {
    if (retCandidates.length > 0) return 'ret';
    if (esPuesto24h && extCandidates.length > 0) return 'dual';
    if (hayIntercambio && intercambioCandidates.length > 0) return 'cambio';
    return 'ft';
  });

  const alternar = (id: SeccionCobertura) => {
    if (abierta !== id) {
      setAbierta(id);
      return;
    }
    if (visibles.length <= 1) {
      setAbierta(null);
      return;
    }
    const idx = visibles.indexOf(id);
    setAbierta(visibles[(idx + 1) % visibles.length]);
  };

  const numero = (id: SeccionCobertura): number => visibles.indexOf(id) + 1;

  // D12 + N12: el operador elige quién queda D12 y quién N12, los dos a la vez.
  const [selD12, setSelD12] = useState<string | null>(null);
  const [selN12, setSelN12] = useState<string | null>(null);

  const candidatosD12 = useMemo(
    () => (planD12N12 ? extCandidates.filter((c) => c.band === planD12N12.bandaD12) : []),
    [extCandidates, planD12N12],
  );
  const candidatosN12 = useMemo(
    () => (planD12N12 ? extCandidates.filter((c) => c.band === planD12N12.bandaN12) : []),
    [extCandidates, planD12N12],
  );
  const elegidoD12 = candidatosD12.find((c) => c.turno.rowId === selD12) ?? null;
  const elegidoN12 = candidatosN12.find((c) => c.turno.rowId === selN12) ?? null;
  const nombreCorto = (n: string): string => n.split(',')[0] || n;

  const Cabecera = ({
    id,
    titulo,
    cantidad,
    tono,
  }: {
    id: SeccionCobertura;
    titulo: string;
    cantidad: number;
    tono: string;
  }) => (
    <button
      type="button"
      onClick={() => alternar(id)}
      aria-expanded={abierta === id}
      className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-slate-50 rounded-2xl"
    >
      {abierta === id ? (
        <ChevronDown size={14} className="text-slate-400 flex-shrink-0" />
      ) : (
        <ChevronRight size={14} className="text-slate-400 flex-shrink-0" />
      )}
      <span className={`flex-1 text-[11px] font-bold uppercase tracking-wide ${tono}`}>{titulo}</span>
      <span className="px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold tabular-nums">
        {cantidad}
      </span>
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl shadow-lg max-w-md w-full overflow-hidden max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2 flex-shrink-0">
          <span className="text-base">🚨</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-black text-red-700">
              {remanente ? 'Retiro anticipado: cubrir el resto del turno' : 'Cobertura urgente'}
            </div>
            <div className="text-[11px] text-slate-500 truncate">
              {absent.employeeName} · {absent.turno.obj} · {absent.turno.shift}
              {remanente ? ` · cubrir ${remanente.desde}–${remanente.hasta}` : ''}
            </div>
            {esCortado && (
              <div className="text-[10px] font-semibold text-indigo-600">
                Turno cortado: el reemplazo cubre el turno completo (los dos tramos).
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-100 text-slate-400"
          >
            ✕
          </button>
        </div>

        <div className="px-3 py-3 overflow-y-auto space-y-2">
          {/* RET disponible */}
          <div className="rounded-2xl border border-violet-200 bg-white shadow-sm">
            <Cabecera
              id="ret"
              titulo={`🛡️ ${numero('ret')}. RET ${retEsManana ? 'de mañana (cubre la noche)' : 'de hoy'}`}
              cantidad={retCandidates.length}
              tono="text-violet-700"
            />
            {abierta === 'ret' && (
              <div className="px-3 pb-3">
                {retCandidates.length === 0 ? (
                  <div className="text-[11px] text-slate-400 py-2">
                    {retEsManana ? 'Sin retenes cargados para mañana' : 'Sin retenes disponibles'}
                  </div>
                ) : (
                  <div className="space-y-1 max-h-56 overflow-y-auto">
                    {retCandidates.map((c) => (
                      <div
                        key={c.turno.rowId}
                        className="flex items-center gap-2 p-2 rounded-xl border border-violet-200 bg-violet-50"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] font-semibold text-slate-800 truncate">{c.employeeName}</div>
                          {retEval?.[c.turno.rowId] && <ChipsRetenEvaluado ev={retEval[c.turno.rowId]} />}
                        </div>
                        <button
                          type="button"
                          disabled={busy || !c.turno.phone}
                          title={c.turno.phone ? 'Convocar por WhatsApp, sin asignar' : 'Sin teléfono'}
                          onClick={() => onAvisarWa(c, 'cobertura')}
                          className="px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold disabled:opacity-50"
                        >
                          WA
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => onAsignarRet(c)}
                          className="px-2.5 py-1 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-[10px] font-bold disabled:opacity-50"
                        >
                          Asignar RET
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* D12 + N12 — solo si el puesto es 24hs */}
          {esPuesto24h && planD12N12 && (
            <div className="rounded-2xl border border-amber-200 bg-white shadow-sm">
              <Cabecera
                id="dual"
                titulo={`⏱ ${numero('dual')}. D12 + N12`}
                cantidad={candidatosD12.length + candidatosN12.length}
                tono="text-amber-700"
              />
              {abierta === 'dual' && (
                <div className="px-3 pb-3 space-y-3">
                  <div className="text-[11px] text-slate-600 rounded-xl bg-amber-50 border border-amber-100 px-2.5 py-2">
                    {planD12N12.explicacion}
                  </div>
                  {([
                    {
                      rol: 'D12' as const,
                      horario: '06:00–18:00',
                      banda: planD12N12.bandaD12,
                      lista: candidatosD12,
                      seleccion: selD12,
                      elegir: setSelD12,
                      claseOn: 'bg-amber-500 text-white border-amber-500',
                    },
                    {
                      rol: 'N12' as const,
                      horario: '18:00–06:00',
                      banda: planD12N12.bandaN12,
                      lista: candidatosN12,
                      seleccion: selN12,
                      elegir: setSelN12,
                      claseOn: 'bg-slate-800 text-white border-slate-800',
                    },
                  ]).map((grupo) => (
                    <div key={grupo.rol}>
                      <div className="text-[11px] font-bold text-slate-700 mb-1">
                        {grupo.rol} · {grupo.horario}{' '}
                        <span className="font-semibold text-slate-400">
                          (guardia de la {grupo.banda}
                          {planD12N12.rolIntercambio === grupo.rol ? ' · se intercambia al lugar del ausente' : ''})
                        </span>
                      </div>
                      {grupo.lista.length === 0 ? (
                        <div className="text-[11px] text-slate-400 py-1">
                          Sin guardias de la {grupo.banda} disponibles en este objetivo
                        </div>
                      ) : (
                        <div className="space-y-1 max-h-40 overflow-y-auto">
                          {grupo.lista.map((c) => {
                            const activo = grupo.seleccion === c.turno.rowId;
                            return (
                              <button
                                key={c.turno.rowId}
                                type="button"
                                disabled={busy}
                                aria-pressed={activo}
                                onClick={() => grupo.elegir(activo ? null : c.turno.rowId)}
                                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl border text-left active:scale-95 disabled:opacity-50 ${
                                  activo
                                    ? grupo.claseOn
                                    : 'bg-white text-slate-800 border-slate-200 hover:bg-slate-50'
                                }`}
                              >
                                <span className="flex-1 min-w-0 text-[12px] font-semibold truncate">
                                  {c.employeeName}
                                </span>
                                <span className={`text-[10px] ${activo ? 'opacity-80' : 'text-slate-500'}`}>
                                  {c.band} · {c.turno.expected}–{c.salida || '—'}
                                </span>
                                {activo && <span className="text-[11px] font-black">✓</span>}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                  <div className="rounded-xl bg-slate-50 border border-slate-200 p-2 text-[11px] text-slate-600 space-y-0.5">
                    <div>
                      D12: <b>{elegidoD12 ? nombreCorto(elegidoD12.employeeName) : 'sin elegir'}</b>
                    </div>
                    <div>
                      N12: <b>{elegidoN12 ? nombreCorto(elegidoN12.employeeName) : 'sin elegir'}</b>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busy || !elegidoD12 || !elegidoN12}
                    onClick={() => {
                      if (elegidoD12 && elegidoN12) onAplicarDual(elegidoD12, elegidoN12);
                    }}
                    className="w-full py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-[12px] font-bold shadow-sm disabled:opacity-50 active:scale-95"
                  >
                    {elegidoD12 && elegidoN12 ? 'Aplicar D12 + N12' : 'Elegí el D12 y el N12'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Intercambio (no aplica al resto de un retiro anticipado ni a puestos custom) */}
          {hayIntercambio && (
            <div className="rounded-2xl border border-blue-200 bg-white shadow-sm">
              <Cabecera
                id="cambio"
                titulo={`🔄 ${numero('cambio')}. Intercambio con otro turno`}
                cantidad={intercambioCandidates.length}
                tono="text-blue-700"
              />
              {abierta === 'cambio' && (
                <div className="px-3 pb-3">
                  {intercambioCandidates.length === 0 ? (
                    <div className="text-[11px] text-slate-400 py-2">Sin candidatos para intercambiar</div>
                  ) : (
                    <div className="space-y-1 max-h-56 overflow-y-auto">
                      {intercambioCandidates.map((c) => (
                        <div
                          key={c.turno.rowId}
                          className="flex items-center gap-2 p-2 rounded-xl border border-blue-200 bg-blue-50"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="text-[12px] font-semibold text-slate-800 truncate">
                              {c.employeeName}
                            </div>
                            <div className="text-[10px] text-slate-500 truncate">
                              {c.turno.obj} · {c.turno.shift}
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={busy || !c.turno.phone}
                            title={c.turno.phone ? 'Pedir el cambio por WhatsApp' : 'Sin teléfono'}
                            onClick={() => onAvisarWa(c, 'intercambio')}
                            className="px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold disabled:opacity-50"
                          >
                            WA
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => onIntercambiar(c)}
                            className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold disabled:opacity-50"
                          >
                            Intercambiar
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* FT — último recurso */}
          <div className="rounded-2xl border border-red-200 bg-white shadow-sm">
            <Cabecera
              id="ft"
              titulo={`💰 ${numero('ft')}. Franco trabajado — último recurso`}
              cantidad={francoCandidates.length}
              tono="text-red-700"
            />
            {abierta === 'ft' && (
              <div className="px-3 pb-3">
                {francoCandidates.length === 0 ? (
                  <div className="text-[11px] text-slate-400 py-2">Sin guardias de franco hoy</div>
                ) : (
                  <div className="space-y-1 max-h-56 overflow-y-auto">
                    {francoCandidates.map((c) => (
                      <div
                        key={c.turno.rowId}
                        className="flex items-center gap-2 p-2 rounded-xl border border-red-200 bg-red-50"
                      >
                        <div className="flex-1 min-w-0 text-[12px] font-semibold text-slate-800 truncate">
                          {c.employeeName}
                        </div>
                        <button
                          type="button"
                          disabled={busy || !c.turno.phone}
                          title={c.turno.phone ? 'Convocar por WhatsApp, sin asignar' : 'Sin teléfono'}
                          onClick={() => onAvisarWa(c, 'cobertura')}
                          className="px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold disabled:opacity-50"
                        >
                          WA
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => onConvocarFt(c)}
                          className="px-2.5 py-1 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[10px] font-bold disabled:opacity-50"
                        >
                          App + WA
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="px-4 py-3 border-t border-slate-100 flex justify-end flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl text-[11px] font-bold text-slate-600 bg-slate-100 hover:bg-slate-200"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Confirmación propia de la planilla. `window.confirm` hace que el navegador salga de pantalla completa,
 * por eso toda confirmación se resuelve acá adentro (queda dentro del panel a pantalla completa).
 */
type ConfirmacionPlanilla = {
  titulo: string;
  mensaje: string;
  textoOk: string;
  tono: 'indigo' | 'rojo';
};

function ModalConfirmar({
  datos,
  onResolver,
}: {
  datos: ConfirmacionPlanilla;
  onResolver: (ok: boolean) => void;
}) {
  const okRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    okRef.current?.focus();
  }, []);
  const rojo = datos.tono === 'rojo';
  return (
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/40 p-4"
      onClick={() => onResolver(false)}
    >
      <div
        className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`px-5 py-3 border-b border-slate-200 ${rojo ? 'bg-red-50' : 'bg-indigo-50'}`}>
          <div className={`text-sm font-black ${rojo ? 'text-red-800' : 'text-indigo-800'}`}>{datos.titulo}</div>
        </div>
        <div className="px-5 py-4 text-[12px] text-slate-600 whitespace-pre-line">{datos.mensaje}</div>
        <div className="px-5 pb-4 flex gap-2">
          <button
            type="button"
            onClick={() => onResolver(false)}
            className="flex-1 py-2.5 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-[12px] font-bold active:scale-95"
          >
            Cancelar <span className="text-slate-400 font-medium">(Esc)</span>
          </button>
          <button
            ref={okRef}
            type="button"
            onClick={() => onResolver(true)}
            className={`flex-1 py-2.5 rounded-2xl text-white text-[12px] font-bold shadow-sm active:scale-95 ${
              rojo ? 'bg-red-600 hover:bg-red-700' : 'bg-indigo-600 hover:bg-indigo-700'
            }`}
          >
            {datos.textoOk} <span className="opacity-70 font-medium">(Enter)</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function ModalRevertirAusencia({
  row,
  busy,
  onLiberarCobertura,
  onDejarAusencia,
  onClose,
}: {
  row: GuardRowModel;
  busy: boolean;
  onLiberarCobertura: (row: GuardRowModel) => void;
  onDejarAusencia: (row: GuardRowModel) => void;
  onClose: () => void;
}) {
  const cubre = row.coveredByName || row.turno.coveredByName || '';
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-slate-200 bg-indigo-50">
          <div className="text-sm font-black text-indigo-800">Revertir ausencia</div>
          <div className="text-[11px] text-slate-600 truncate">
            {row.employeeName} · {row.turno.obj} · {row.turno.shift}
          </div>
        </div>
        <div className="px-4 py-3 text-[12px] text-slate-600">
          {cubre ? (
            <>
              El lugar ya lo cubre <b>{cubre}</b>. Si {row.employeeName} llegó quedan dos para un lugar: elegí a quién
              liberás.
            </>
          ) : (
            <>{row.employeeName} tiene cobertura o convocatorias activas. ¿Qué hacemos?</>
          )}
        </div>
        <div className="px-4 pb-4 flex flex-col gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onLiberarCobertura(row)}
            className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-[12px] font-bold disabled:opacity-50"
          >
            {cubre ? `Liberar a ${cubre} · vuelve ${row.employeeName}` : 'Cancelar cobertura y revertir'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onDejarAusencia(row)}
            className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-[12px] font-bold disabled:opacity-50"
          >
            {cubre ? `Liberar a ${row.employeeName} · sigue ${cubre} (queda AA)` : 'Dejar AA'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full py-1.5 text-[11px] text-slate-400 hover:text-slate-600"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

const COMENTARIO_MAX = 300;

function ModalComentario({
  row,
  onGuardar,
  onClose,
}: {
  row: GuardRowModel;
  onGuardar: (row: GuardRowModel, texto: string) => void;
  onClose: () => void;
}) {
  const [texto, setTexto] = useState(row.turno.comentario || '');
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    taRef.current?.focus();
    taRef.current?.select();
  }, []);

  const guardar = () => {
    onGuardar(row, texto.trim().slice(0, COMENTARIO_MAX));
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-3 bg-indigo-50">
          <MessageSquare size={16} className="text-indigo-600 flex-shrink-0" aria-hidden />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-black text-indigo-800">Comentario del turno</div>
            <div className="text-[11px] text-slate-600 truncate">
              {row.employeeName} · {row.turno.obj} · {row.turno.shift}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-indigo-100 text-slate-400"
          >
            ✕
          </button>
        </div>
        <div className="px-4 py-3 space-y-2">
          <textarea
            ref={taRef}
            value={texto}
            maxLength={COMENTARIO_MAX}
            rows={4}
            placeholder="Ej.: avisó que llega 20 min tarde, viene del otro objetivo…"
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
                return;
              }
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                guardar();
              }
            }}
            className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
          <div className="flex items-center justify-between text-[10px] text-slate-400">
            <span>
              {row.turno.comentarioPor ? `Último: ${row.turno.comentarioPor} · ` : ''}Ctrl+Enter guarda · Esc cierra
            </span>
            <span className="tabular-nums">
              {texto.length}/{COMENTARIO_MAX}
            </span>
          </div>
        </div>
        <div className="px-4 pb-4 flex items-center gap-2">
          {row.turno.comentario && (
            <button
              type="button"
              onClick={() => {
                onGuardar(row, '');
                onClose();
              }}
              className="px-3 py-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-[12px] font-bold"
            >
              Quitar
            </button>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-[12px] font-bold"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={guardar}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-[12px] font-bold"
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

function ModalAcciones({
  row,
  busy,
  onClose,
  onMarcarPresente,
  onMarcarAusente,
  onIntercambio,
  onRetiro,
  onAvisarWa,
  onComentario,
}: {
  row: GuardRowModel;
  busy: boolean;
  onClose: () => void;
  onComentario: (row: GuardRowModel) => void;
  onMarcarPresente: (row: GuardRowModel) => void;
  onMarcarAusente: (row: GuardRowModel) => void;
  onIntercambio: (row: GuardRowModel) => void;
  onRetiro: (row: GuardRowModel) => void;
  onAvisarWa: (row: GuardRowModel) => void;
}) {
  const pill = estadoPill(row.estado);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-sm font-black text-slate-600 flex-shrink-0">
            {row.employeeName.split(' ')[0]?.[0]?.toUpperCase()}
            {row.employeeName.split(' ')[1]?.[0]?.toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-black text-slate-800 truncate">{row.employeeName}</div>
            <div className="text-[11px] text-slate-500 truncate">{row.turno.obj}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-100 text-slate-400"
          >
            ✕
          </button>
        </div>

        <div className="px-4 py-3 space-y-2">
          <div className="flex justify-between items-center text-[11px]">
            <span className="text-slate-500">Turno</span>
            <span className="font-mono text-slate-700">{row.turno.shift}</span>
          </div>
          <div className="flex justify-between items-center text-[11px]">
            <span className="text-slate-500">Esperado</span>
            <span className="font-mono text-slate-700">{row.turno.expected}</span>
          </div>
          {row.turno.phone && (
            <div className="flex justify-between items-center text-[11px]">
              <span className="text-slate-500">Teléfono</span>
              <a
                href={`tel:${row.turno.phone}`}
                className="font-mono text-emerald-700 hover:underline"
              >
                {row.turno.phone}
              </a>
            </div>
          )}
          <div className="flex justify-between items-center text-[11px]">
            <span className="text-slate-500">Estado</span>
            <span className={`px-2 py-0.5 text-[9px] font-bold rounded-full ${pill.className}`}>
              {pill.label}
            </span>
          </div>
        </div>

        <div className="px-4 pb-4 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => {
              onComentario(row);
              onClose();
            }}
            className="w-full py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 text-[12px] font-bold"
          >
            {row.turno.comentario ? 'Editar comentario del turno' : 'Agregar comentario al turno'}
          </button>
          {row.estado !== 'CERRADO' &&
            row.estado !== 'NO_LLEGO' &&
            row.estado !== 'AUSENTE' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  onIntercambio(row);
                  onClose();
                }}
                className="w-full py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-[12px] font-bold disabled:opacity-50"
              >
                Cambiar turno (anticipado)
              </button>
            )}
          {(row.estado === 'PRESENTE_PLAT' || row.estado === 'PRESENTE_WA') && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                onRetiro(row);
                onClose();
              }}
              className="w-full py-2 rounded-xl bg-purple-50 hover:bg-purple-100 text-purple-800 border border-purple-200 text-[12px] font-bold disabled:opacity-50"
            >
              Retiro anticipado (se siente mal)
            </button>
          )}
          <button
            type="button"
            disabled={!row.turno.phone}
            title={row.turno.phone ? 'Abre WhatsApp con el aviso del turno' : 'Sin teléfono'}
            onClick={() => {
              onAvisarWa(row);
              onClose();
            }}
            className="w-full py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[12px] font-bold disabled:opacity-50"
          >
            Avisar por WhatsApp
          </button>
          {row.estado !== 'PRESENTE_PLAT' &&
            row.estado !== 'PRESENTE_WA' &&
            row.estado !== 'AUSENTE' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  onMarcarPresente(row);
                  onClose();
                }}
                className="w-full py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[12px] font-bold disabled:opacity-50"
              >
                ✓ Marcar presente ahora
              </button>
            )}
          {row.estado !== 'AUSENTE' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                onMarcarAusente(row);
                onClose();
              }}
              className="w-full py-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-[12px] font-bold disabled:opacity-50"
            >
              Registrar ausencia (AA)
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-[12px] font-bold"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

function GuardRow({
  row,
  busy,
  active,
  hourValue,
  hourCampo,
  onSelect,
  onHourChange,
  onHourCommit,
  onBeginEdit,
  onMarcarPresente,
  onConfirmarWA,
  onCerrar,
  onCobertura,
  onIntercambio,
  onRetiro,
  swapOrigin,
  onMore,
  onComentario,
  onRevertirAusencia,
  onReabrir,
}: {
  row: GuardRowModel;
  busy: boolean;
  active: boolean;
  hourValue: string | null;
  hourCampo: 'ingreso' | 'salida' | null;
  swapOrigin: boolean;
  onSelect: (row: GuardRowModel) => void;
  onBeginEdit: (row: GuardRowModel, campo: 'ingreso' | 'salida') => void;
  onHourChange: (value: string) => void;
  onHourCommit: (row: GuardRowModel, value: string) => void;
  onMarcarPresente: (row: GuardRowModel) => void;
  onConfirmarWA: (row: GuardRowModel) => void;
  onCerrar: (row: GuardRowModel) => void;
  onCobertura: (row: GuardRowModel) => void;
  onRevertirAusencia: (row: GuardRowModel) => void;
  onIntercambio: (row: GuardRowModel) => void;
  onRetiro: (row: GuardRowModel) => void;
  onMore: (row: GuardRowModel) => void;
  onComentario: (row: GuardRowModel) => void;
  onReabrir: (row: GuardRowModel) => void;
}) {
  const pill = estadoPill(row.estado);
  const motivoRetiro = row.turno.retiro
    ? MOTIVOS_RETIRO.find((m) => m.id === row.turno.retiro?.motivo)?.label ||
      (row.turno.retiro.motivo ? row.turno.retiro.motivo.toLowerCase() : 'sin motivo')
    : '';
  const retiroTexto = row.turno.retiro
    ? `Retiro anticipado a las ${row.turno.retiro.hora} · ${motivoRetiro}. No trabaja el resto del turno (hasta ${row.salida || '—'}).`
    : '';
  const diffClass =
    row.diffTone === 'late'
      ? 'text-red-600'
      : row.diffTone === 'early'
        ? 'text-emerald-600'
        : 'text-slate-500';

  let primary: React.ReactNode = null;
  if (row.estado === 'NO_LLEGO' && row.coveredByName) {
    primary = (
      <span className="px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold whitespace-nowrap">
        ✓ Cubierto por {row.coveredByName}
      </span>
    );
  } else if (row.estado === 'NO_LLEGO') {
    primary = (
      <>
        <button
          type="button"
          disabled={busy}
          title="Declara la ausencia (si pasaron 30 min) y abre las opciones de cobertura"
          onClick={() => onCobertura(row)}
          className="px-2 py-1 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[10px] font-bold disabled:opacity-50"
        >
          🚨 Cobertura
        </button>
        <button
          type="button"
          disabled={busy}
          title="El guardia llegó: registrar presencia"
          onClick={() => onMarcarPresente(row)}
          className="mr-btn-neutral px-2 py-1 rounded-lg text-[10px] font-bold disabled:opacity-50"
        >
          ✓ Llegó
        </button>
      </>
    );
  } else if (row.estado === 'AUSENTE' && row.coveredByName) {
    primary = (
      <>
        <span className="px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold whitespace-nowrap">
          ✓ Cubierto por {row.coveredByName}
        </span>
        <button
          type="button"
          disabled={busy}
          title="Revertir la ausencia: el guardia llegó (hasta T+60)"
          onClick={() => onRevertirAusencia(row)}
          className="mr-btn-neutral px-2 py-1 rounded-lg text-[10px] font-bold disabled:opacity-50"
        >
          ↩ Llegó
        </button>
      </>
    );
  } else if (row.estado === 'AUSENTE') {
    primary = (
      <>
        <button
          type="button"
          disabled={busy}
          onClick={() => onCobertura(row)}
          className="px-2 py-1 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[10px] font-bold disabled:opacity-50"
        >
          🚨 Cobertura
        </button>
        <button
          type="button"
          disabled={busy}
          title="Revertir la ausencia: el guardia llegó (hasta T+60)"
          onClick={() => onRevertirAusencia(row)}
          className="mr-btn-neutral px-2 py-1 rounded-lg text-[10px] font-bold disabled:opacity-50"
        >
          ↩ Llegó
        </button>
      </>
    );
  } else if (row.estado === 'TARDANZA') {
    primary = (
      <>
        <button
          type="button"
          disabled={busy}
          onClick={() => onMarcarPresente(row)}
          className="px-2 py-1 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-[10px] font-bold disabled:opacity-50"
        >
          Registrar
        </button>
        <button
          type="button"
          disabled={busy}
          title="Intercambio anticipado: elegí el otro guardia y Enter"
          onClick={() => onIntercambio(row)}
          className="mr-btn-swap px-2 py-1 rounded-lg text-[10px] font-bold disabled:opacity-50"
        >
          {swapOrigin ? 'Origen' : 'Cambiar'}
        </button>
      </>
    );
  } else if (row.estado === 'PENDIENTE_WA') {
    primary = (
      <button
        type="button"
        disabled={busy}
        onClick={() => onConfirmarWA(row)}
        className="px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold disabled:opacity-50"
      >
        ✓ Confirmar
      </button>
    );
  } else if (row.estado === 'ESPERANDO') {
    primary = (
      <>
        <button
          type="button"
          disabled={busy}
          onClick={() => onMarcarPresente(row)}
          className="mr-btn-neutral px-2 py-1 rounded-lg text-[10px] font-bold disabled:opacity-50"
        >
          ✓ Llegó
        </button>
        <button
          type="button"
          disabled={busy}
          title="Intercambio anticipado: elegí el otro guardia y Enter"
          onClick={() => onIntercambio(row)}
          className="mr-btn-swap px-2 py-1 rounded-lg text-[10px] font-bold disabled:opacity-50"
        >
          {swapOrigin ? 'Origen' : 'Cambiar'}
        </button>
      </>
    );
  } else if (row.estado === 'PRESENTE_PLAT' || row.estado === 'PRESENTE_WA') {
    primary = (
      <>
        <button
          type="button"
          disabled={busy}
          onClick={() => onCerrar(row)}
          className="mr-btn-close px-2 py-1 rounded-lg text-[10px] font-bold disabled:opacity-50"
        >
          Cerrar
        </button>
        <button
          type="button"
          disabled={busy}
          title="Retiro anticipado por enfermedad"
          onClick={() => onRetiro(row)}
          className="mr-btn-retiro px-2 py-1 rounded-lg text-[10px] font-bold disabled:opacity-50"
        >
          Retiro
        </button>
      </>
    );
  } else if (row.estado === 'CERRADO') {
    primary = (
      <>
        <button
          type="button"
          disabled={busy}
          onClick={() => onBeginEdit(row, 'ingreso')}
          className="px-2 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold disabled:opacity-50"
        >
          Horario
        </button>
        <button
          type="button"
          disabled={busy}
          title="Cerré el turno sin querer: vuelve a presente"
          onClick={() => onReabrir(row)}
          className="px-2 py-1 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-800 border border-amber-300 text-[10px] font-bold disabled:opacity-50"
        >
          Reabrir
        </button>
      </>
    );
  }

  const fuenteClass =
    row.fuente === 'WA'
      ? 'text-blue-700'
      : row.fuente === 'App'
        ? 'text-indigo-700'
        : row.fuente === 'Radio'
          ? 'text-emerald-700'
          : row.fuente === 'Demo'
            ? 'text-amber-700'
            : row.fuente === 'Auto'
              ? 'text-slate-600'
              : 'text-slate-500';

  return (
    <div
      data-rowid={row.turno.rowId}
      style={{ scrollMarginTop: 72, scrollMarginBottom: 16 }}
      onClick={() => onSelect(row)}
      className={`mr-row grid ${SHEET_COLS} ${SHEET_ALIGN} items-center px-0 py-0 border-b border-slate-100 cursor-pointer [&>*]:py-1.5 [&>*:not(:first-child)]:border-r [&>*:not(:first-child)]:border-slate-100 [&>*:last-child]:border-r-0 ${
        active ? 'mr-row-active' : swapOrigin ? 'mr-row-swap' : row.turno.retiro || row.estado === 'AUSENTE' ? 'mr-row-retiro' : ''
      }`}
      title={retiroTexto || undefined}
    >
      <div className={`self-stretch rounded-full ${barClass(row.estado)}`} />
      <div className="min-w-0 break-words text-sm font-medium leading-tight text-slate-800" title={row.employeeName}>
        {row.employeeName}
        {esTramoCortado(row.turno) && (
          <span
            className="ml-1.5 inline-flex items-center gap-0.5 align-middle rounded-md bg-indigo-100 px-1 py-0.5 text-[9px] font-black text-indigo-700"
            title={`Turno cortado, tramo ${row.turno.bloque} de ${row.turno.bloquesTotal}: ${(row.turno.blocks || []).map((b) => `${b.startTime}–${b.endTime}`).join(' + ')}`}
          >
            <Scissors size={9} aria-hidden />
            {row.turno.bloque}/{row.turno.bloquesTotal}
          </span>
        )}
        {row.turno.origin === 'OPERATIONS_COVERAGE' && row.turno.coversEmployeeName && (
          <span
            className="mt-0.5 flex w-full min-w-0 items-start gap-1 rounded-md bg-violet-50 px-1.5 py-0.5 text-left text-[10px] font-bold leading-snug text-violet-700"
            title={`Cobertura operativa ${row.turno.expected || ''}–${row.salida || ''}: fichada en este puesto (titular ${row.turno.coversEmployeeName})`}
          >
            Cubre a {row.turno.coversEmployeeName}
            {row.turno.expected ? ` · ${row.turno.expected}–${row.salida || '—'}` : ''}
          </span>
        )}
        {row.turno.comentario && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onComentario(row);
            }}
            className="mt-0.5 flex w-full min-w-0 items-start gap-1 rounded-md bg-indigo-50 px-1.5 py-0.5 text-left text-[10px] font-medium leading-snug text-indigo-700 hover:bg-indigo-100"
            title={`${row.turno.comentario}${row.turno.comentarioPor ? ` — ${row.turno.comentarioPor}` : ''}`}
          >
            <MessageSquare size={10} className="mt-0.5 flex-shrink-0" aria-hidden />
            <span className="min-w-0 break-words">{row.turno.comentario}</span>
          </button>
        )}
      </div>
      <div className="truncate text-[11px] text-slate-500" title={row.turno.positionName}>{row.turno.positionName || '—'}</div>
      <div className="truncate font-mono text-[11px] text-slate-700">{row.turno.code || row.band || '—'}</div>
      <div
        className="mr-plan whitespace-nowrap font-mono text-[11px] tabular-nums"
        title={row.turno.blocks?.length ? `Turno cortado: ${row.turno.blocks.map((b) => `${b.startTime}–${b.endTime}`).join(' + ')}` : 'Ingreso planificado'}
        data-turno-cortado={row.turno.blocks?.length ? '1' : undefined}
      >
        {row.turno.expected}
      </div>
      <div
        className="mr-real whitespace-nowrap font-mono text-[12px] font-black tabular-nums"
        title="Ingreso real"
        onClick={(e) => {
          e.stopPropagation();
          if (row.estado === 'CERRADO' && hourCampo !== 'ingreso') onBeginEdit(row, 'ingreso');
        }}
      >
        {hourValue !== null && hourCampo !== 'salida' ? (
            <input
            value={hourValue}
            onChange={(e) => onHourChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                onHourCommit(row, hourValue);
              }
            }}
            onFocus={(e) => e.currentTarget.select()}
            className="w-14 px-1 py-0.5 text-[11px] font-mono border border-indigo-300 rounded-md bg-white focus:outline-none"
          />
        ) : (
          row.realDisplay
        )}
      </div>
      <div
        className="mr-plan whitespace-nowrap font-mono text-[11px] tabular-nums"
        title={row.turno.blocks?.length ? `Turno cortado: ${row.turno.blocks.map((b) => `${b.startTime}–${b.endTime}`).join(' + ')}` : 'Egreso planificado'}
      >
        {row.salida || '—'}
        {row.relevoNombre ? (
          <span className="block max-w-full truncate text-[8px] font-sans font-semibold leading-none opacity-80" title={`Releva: ${row.relevoNombre}`}>
            ↳ {row.relevoNombre.split(',')[0]}
          </span>
        ) : row.finSinRelevo ? (
          <span className="block max-w-full truncate text-[8px] font-sans font-semibold leading-none opacity-70" title="Sin relevo programado: el servicio termina con este guardia">
            sin relevo
          </span>
        ) : null}
      </div>
      <div
        className="mr-real whitespace-nowrap font-mono text-[12px] font-black tabular-nums"
        title={row.estado === 'CERRADO' ? 'Egreso real. Clic para corregir' : 'Egreso real'}
        onClick={(e) => {
          e.stopPropagation();
          if (row.estado === 'CERRADO' && hourCampo !== 'salida') onBeginEdit(row, 'salida');
        }}
      >
        {hourValue !== null && hourCampo === 'salida' ? (
          <input
            value={hourValue}
            onChange={(e) => onHourChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                onHourCommit(row, hourValue);
              }
            }}
            onFocus={(e) => e.currentTarget.select()}
            className="w-14 px-1 py-0.5 text-[11px] font-mono border border-indigo-300 rounded-md bg-white focus:outline-none"
          />
        ) : (
          row.salidaReal && row.salidaReal !== '--:--' ? (
            row.salidaReal
          ) : row.salidaAvisada ? (
            <span
              className={`text-[10px] font-bold ${row.salidaSinRelevo ? 'text-amber-600' : 'text-emerald-700'}`}
              title={
                row.salidaSinRelevo
                  ? `Avisó su salida a las ${row.salidaAvisada} por WhatsApp, pero su relevo todavía no está presente: queda retenido hasta que lo cierres`
                  : `Avisó su salida a las ${row.salidaAvisada} por WhatsApp`
              }
            >
              avisó {row.salidaAvisada}
            </span>
          ) : (
            '—'
          )
        )}
      </div>
      <div
        className={`whitespace-nowrap text-[10px] font-semibold tabular-nums ${row.turno.retiro ? 'text-red-700' : diffClass}`}
        title={retiroTexto || undefined}
      >
        {row.turno.retiro ? `retiro ${row.turno.retiro.hora}` : row.diffLabel}
      </div>
      <div className={`whitespace-nowrap text-[10px] font-bold ${fuenteClass}`}>{row.fuente}</div>
      <div className="flex justify-start">
        <span
          className={`px-2 py-0.5 text-[9px] font-bold rounded-full whitespace-nowrap ${
            row.turno.retiro ? 'mr-pill mr-pill-red' : pill.className
          }`}
          title={retiroTexto || undefined}
        >
          {row.turno.retiro ? 'RETIRO' : pill.label}
        </span>
      </div>
      <div className="flex items-center justify-start gap-1" onClick={(e) => e.stopPropagation()}>
        {primary}
        <button
          type="button"
          onClick={() => onComentario(row)}
          className={`px-1.5 py-1 rounded-lg hover:bg-slate-100 ${
            row.turno.comentario ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'
          }`}
          title={row.turno.comentario ? 'Editar comentario del turno' : 'Agregar comentario al turno'}
        >
          <MessageSquare size={13} aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => onMore(row)}
          className="px-1.5 py-1 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 text-[11px] font-bold"
          title="Más acciones"
        >
          ···
        </button>
      </div>
    </div>
  );
}

function retenTonoDe(estado: GuardEstado): RetenTono {
  if (estado === 'PRESENTE_WA' || estado === 'PRESENTE_PLAT') return 'ok';
  if (estado === 'ESPERANDO' || estado === 'PENDIENTE_WA') return 'espera';
  if (estado === 'NO_LLEGO' || estado === 'AUSENTE' || estado === 'TARDANZA') return 'alerta';
  if (estado === 'CERRADO') return 'cerrado';
  return 'neutro';
}

function ObjectiveGroup({
  objName,
  rows,
  open,
  onToggle,
  busy,
  activeRowId,
  hourEdit,
  onSelect,
  onHourChange,
  onHourCommit,
  onBeginEdit,
  onMarcarPresente,
  onConfirmarWA,
  onCerrar,
  onCobertura,
  onRevertirAusencia,
  onIntercambio,
  onRetiro,
  swapFromId,
  onMore,
  cliente,
  arrastrando,
  soltarAca,
  onDragStartGrupo,
  onDragOverGrupo,
  onDropGrupo,
  onDragEndGrupo,
  onComentario,
  onReabrir,
}: {
  objName: string;
  cliente: string | null;
  arrastrando: boolean;
  soltarAca: boolean;
  onDragStartGrupo: (name: string) => void;
  onDragOverGrupo: (name: string) => void;
  onDropGrupo: (name: string) => void;
  onDragEndGrupo: () => void;
  rows: GuardRowModel[];
  open: boolean;
  onToggle: () => void;
  busy: boolean;
  activeRowId: string | null;
  hourEdit: { rowId: string; value: string; campo: 'ingreso' | 'salida' } | null;
  swapFromId: string | null;
  onSelect: (row: GuardRowModel) => void;
  onHourChange: (value: string) => void;
  onHourCommit: (row: GuardRowModel, value: string) => void;
  onBeginEdit: (row: GuardRowModel, campo: 'ingreso' | 'salida') => void;
  onMarcarPresente: (row: GuardRowModel) => void;
  onConfirmarWA: (row: GuardRowModel) => void;
  onCerrar: (row: GuardRowModel) => void;
  onCobertura: (row: GuardRowModel) => void;
  onRevertirAusencia: (row: GuardRowModel) => void;
  onIntercambio: (row: GuardRowModel) => void;
  onRetiro: (row: GuardRowModel) => void;
  onMore: (row: GuardRowModel) => void;
  onComentario: (row: GuardRowModel) => void;
  onReabrir: (row: GuardRowModel) => void;
}) {
  const hasNoLlego = rows.some((r) => r.estado === 'NO_LLEGO' && !r.coveredByName);
  const hasTardanza = rows.some((r) => r.estado === 'TARDANZA');

  return (
    <div
      className={`border-b border-slate-200 ${arrastrando ? 'opacity-50' : ''} ${soltarAca ? 'shadow-[inset_0_3px_0_0_#6366f1]' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        onDragOverGrupo(objName);
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDropGrupo(objName);
      }}
    >
      <div
        role="button"
        tabIndex={-1}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', objName);
          onDragStartGrupo(objName);
        }}
        onDragEnd={onDragEndGrupo}
        onClick={onToggle}
        title="Arrastrá para mover el objetivo. Clic para abrir o cerrar."
        className="mr-group-head w-full flex items-center gap-2 pl-4 pr-3 py-2.5 text-left cursor-grab active:cursor-grabbing select-none"
      >
        <GripVertical size={14} className="text-slate-400 flex-shrink-0" />
        {open ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
        <span className="mr-group-name text-sm font-black tracking-tight truncate">{objName}</span>
        {cliente && (
          <span className="text-[10px] font-semibold text-slate-400 truncate flex-1">· {cliente}</span>
        )}
        {!cliente && <span className="flex-1" />}
        {hasNoLlego && (
          <span className="px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 text-[9px] font-bold">
            Crítico
          </span>
        )}
        {!hasNoLlego && hasTardanza && (
          <span className="px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 text-[9px] font-bold">
            Tardanza
          </span>
        )}
        <span className="text-[10px] text-slate-500 font-medium">{rows.length}</span>
      </div>
      {open && (
        <div>
          {rows.map((row) => (
            <GuardRow
              key={row.turno.rowId}
              row={row}
              busy={busy}
              active={activeRowId === row.turno.rowId}
              hourValue={hourEdit?.rowId === row.turno.rowId ? hourEdit.value : null}
              hourCampo={hourEdit?.rowId === row.turno.rowId ? hourEdit.campo : null}
              onSelect={onSelect}
              onHourChange={onHourChange}
              onHourCommit={onHourCommit}
              onBeginEdit={onBeginEdit}
              onMarcarPresente={onMarcarPresente}
              onConfirmarWA={onConfirmarWA}
              onCerrar={onCerrar}
              onReabrir={onReabrir}
              onCobertura={onCobertura}
              onRevertirAusencia={onRevertirAusencia}
              onIntercambio={onIntercambio}
              onRetiro={onRetiro}
              swapOrigin={
                !!swapFromId && docIdDe(swapFromId) === docIdDe(row.turno.rowId)
              }
              onMore={onMore}
              onComentario={onComentario}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/** Radio (m) dentro del cual un check-in o una salida por WhatsApp con ubicación se confirma sola. */
const AUTO_WA_RADIO_M = WA_RADIO_MAX_M;

/**
 * Un check-in de WhatsApp se puede confirmar sin operador cuando está atado a un turno de hoy y trae
 * ubicación dentro del radio del objetivo (o el objetivo tiene check-in remoto). Foto sola solo vale
 * en remoto. Sin eso: queda pendiente para el operador.
 */
function entradaWaVerificada(e: WAEntry): boolean {
  if (!e.rowId) return false;
  if (e.allowRemoteCheckIn) return e.hasLocation || !!e.photo;
  if (!e.hasLocation) return false;
  if (e.lat == null || e.lng == null || e.objLat == null || e.objLng == null) return false;
  return haversineM(e.lat, e.lng, e.objLat, e.objLng) <= AUTO_WA_RADIO_M;
}

function WACard({
  entry,
  onConfirm,
  onDismiss,
  busy,
}: {
  entry: WAEntry;
  onConfirm: () => void;
  onDismiss: () => void;
  busy?: boolean;
}) {
  const thumb =
    entry.photo ? (
      <img
        src={entry.photo}
        alt=""
        className="w-9 h-9 rounded-lg object-cover border border-slate-200 flex-shrink-0"
      />
    ) : entry.hasLocation && entry.lat && entry.lng ? (
      <a
        href={`https://www.google.com/maps?q=${entry.lat},${entry.lng}`}
        target="_blank"
        rel="noopener noreferrer"
        className="w-9 h-9 rounded-lg border border-slate-200 bg-blue-50 flex items-center justify-center text-lg flex-shrink-0 no-underline"
      >
        📍
      </a>
    ) : (
      <div className="w-9 h-9 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-500 flex-shrink-0">
        {entry.name.split(' ')[0]?.[0]?.toUpperCase()}
      </div>
    );

  return (
    <div className="flex items-start gap-2 p-3 border-b border-slate-100">
      {thumb}
      <div className="flex-1 min-w-0">
        <div className="text-xs font-bold text-slate-800 leading-tight">{entry.name}</div>
        {entry.obj && (
          <div className="text-[10px] text-slate-500 truncate" title={entry.obj}>
            📍 {entry.obj}
          </div>
        )}
        <div className="text-[10px] text-slate-400 flex gap-2">
          {entry.shift && <span className="font-medium text-slate-600">{entry.shift}</span>}
          {entry.phone && <span className="font-mono">{entry.phone}</span>}
        </div>
        {entry.tardanzaMins !== undefined && entry.tardanzaMins !== null && (
          <div
            className={`text-[10px] font-medium ${
              entry.tardanzaMins <= PUNTUAL_HASTA_MIN ? 'text-emerald-600' : 'text-amber-600'
            }`}
          >
            {entry.tardanzaMins <= PUNTUAL_HASTA_MIN
              ? 'Puntual'
              : `+${entry.tardanzaMins} min tarde`}
          </div>
        )}
        {entry.allowRemoteCheckIn ? (
          <div className="text-[10px] font-medium text-amber-600">REMOTO · sin control de radio</div>
        ) : entry.lat != null && entry.lng != null && entry.objLat != null && entry.objLng != null ? (() => {
          const d = haversineM(entry.lat!, entry.lng!, entry.objLat!, entry.objLng!);
          const ok = d <= 80;
          const warn = d <= 300;
          return (
            <div className={`text-[10px] font-medium ${ok ? 'text-emerald-600' : warn ? 'text-amber-500' : 'text-red-500'}`}>
              {ok ? '✓' : '⚠'} {d < 1000 ? `${d} m` : `${(d / 1000).toFixed(1)} km`} del objetivo
            </div>
          );
        })() : null}
      </div>
      <div className="flex flex-col items-end gap-1 flex-shrink-0">
        <span className="text-[10px] text-slate-400 font-mono">{entry.arrivedAt}</span>
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[9px] font-bold rounded-lg transition-colors disabled:opacity-50"
        >
          Confirmar
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onDismiss}
          title="Descartar este mensaje sin marcar presencia (duplicado o error)"
          className="px-2 py-0.5 bg-white hover:bg-red-50 text-red-600 border border-red-200 text-[9px] font-bold rounded-lg transition-colors disabled:opacity-50"
        >
          Descartar
        </button>
      </div>
    </div>
  );
}

function ConfirmedCard({ entry }: { entry: WAConfirmedEntry }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 opacity-70">
      {entry.lat && entry.lng ? (
        <a
          href={`https://www.google.com/maps?q=${entry.lat},${entry.lng}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-base"
        >
          📍
        </a>
      ) : (
        <span className="text-base text-emerald-500">✓</span>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-medium text-slate-700 truncate">{entry.name}</div>
        <div className="text-[10px] text-slate-500 truncate">
          {entry.shift || ''}
          {entry.obj ? ` · ${entry.obj}` : ''}
        </div>
      </div>
      <span className="text-[10px] text-slate-400 font-mono flex-shrink-0">{entry.arrivedAt}</span>
    </div>
  );
}

function WASidebar({
  wa,
  confirmados,
  collapsed,
  onExpand,
  onCollapse,
  logOpen,
  setLogOpen,
  logFilter,
  setLogFilter,
  logPage,
  setLogPage,
  LOG_PAGE: pageSize,
  busy,
  onConfirmEntry,
  onDismissEntry,
}: {
  wa: UseWABridgeReturn;
  /** Check-ins WA confirmados hoy desde cualquier sesión (sale de la planilla compartida). */
  confirmados: WAConfirmedEntry[];
  collapsed: boolean;
  onExpand: () => void;
  onCollapse: () => void;
  logOpen: boolean;
  setLogOpen: (v: boolean) => void;
  logFilter: string;
  setLogFilter: (v: string) => void;
  logPage: number;
  setLogPage: React.Dispatch<React.SetStateAction<number>>;
  LOG_PAGE: number;
  busy: boolean;
  onConfirmEntry: (entry: WAEntry) => void;
  onDismissEntry: (entry: WAEntry) => void;
}) {
  const filtered = confirmados.filter(
    (e) => !logFilter || e.name.toLowerCase().includes(logFilter.toLowerCase()),
  );
  const visible = filtered.slice(0, logPage * pageSize);
  const remaining = filtered.length - logPage * pageSize;

  if (collapsed) {
    return (
      <aside className="w-11 flex-shrink-0 border-l border-slate-200 bg-white flex flex-col items-center py-3 gap-2">
        <button
          type="button"
          onClick={onExpand}
          className="relative p-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700"
          title="Abrir check-ins WA"
        >
          <MessageSquare size={18} />
          {wa.badge > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-[8px] flex items-center justify-center font-bold">
              {wa.badge}
            </span>
          )}
        </button>
      </aside>
    );
  }

  return (
    <aside className="w-72 flex-shrink-0 border-l border-slate-200 bg-white flex flex-col overflow-hidden">
      <div className="px-3 py-2.5 border-b border-slate-200 flex items-center gap-2 flex-shrink-0">
        <span className="text-emerald-600 text-xs font-black">⬡ Check-ins</span>
        <span className="text-[10px] text-slate-500">· {wa.badge} pendientes</span>
        <button
          type="button"
          onClick={onCollapse}
          className="ml-auto p-1 rounded-lg hover:bg-slate-100 text-slate-400"
          title="Colapsar"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {wa.groups.length > 0 && (
        <div className="border-b border-slate-200 flex-shrink-0">
          <details className="group">
            <summary className="px-3 py-2 text-[10px] font-bold text-slate-500 cursor-pointer hover:text-slate-700 flex items-center gap-1 list-none">
              <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
              Grupos WA
              {wa.monitoredGroupIds.size > 0 && (
                <span className="ml-auto px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-[9px]">
                  {wa.monitoredGroupIds.size} activos
                </span>
              )}
            </summary>
            <div className="max-h-48 overflow-y-auto">
              {wa.groups.map((g) => (
                <label
                  key={g.id}
                  className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={wa.monitoredGroupIds.has(g.id)}
                    onChange={(e) => void wa.toggleGroup(g.id, e.target.checked)}
                    className="accent-emerald-600 w-3 h-3 flex-shrink-0"
                  />
                  <span className="text-[10px] text-slate-700 truncate flex-1">{g.name}</span>
                  <span className="text-[9px] text-slate-400 flex-shrink-0">{g.participants}</span>
                </label>
              ))}
            </div>
          </details>
        </div>
      )}

      <div className="flex-1 overflow-y-auto min-h-0">
        {wa.pending.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-xs text-slate-400 p-6 text-center">
            Sin check-ins pendientes
          </div>
        ) : (
          wa.pending.map((entry) => (
            <WACard
              key={entry.id}
              entry={entry}
              busy={busy}
              onConfirm={() => onConfirmEntry(entry)}
              onDismiss={() => onDismissEntry(entry)}
            />
          ))
        )}
      </div>

      <div className="border-t border-slate-200 flex-shrink-0 max-h-[45%] flex flex-col">
        <div className="px-3 py-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setLogOpen(!logOpen)}
            className="flex items-center gap-1 text-[10px] font-bold text-slate-600 hover:text-slate-800"
          >
            {logOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            Confirmados hoy
            <span className="px-1.5 py-0.5 bg-slate-100 rounded-full text-[9px]">
              {confirmados.length}
            </span>
          </button>
          <span
            className="ml-auto text-[9px] font-semibold text-slate-400"
            title="Solo ingresos por WhatsApp (todas las pantallas y sesiones). App/Op no entran acá."
          >
            <Lock size={10} className="inline -mt-0.5 mr-0.5" aria-hidden />
            Solo WA
          </span>
        </div>
        {logOpen && (
          <div className="overflow-y-auto flex-1 min-h-0">
            {confirmados.length === 0 ? (
              <p className="px-3 py-3 text-[10px] text-slate-400 text-center leading-snug">
                Nadie confirmó ingreso por WhatsApp hoy. Los presentes por App u Op no se listan acá.
              </p>
            ) : (
              <>
                {confirmados.length > pageSize && (
                  <div className="px-3 pb-2">
                    <input
                      placeholder="Filtrar…"
                      value={logFilter}
                      onChange={(e) => {
                        setLogFilter(e.target.value);
                        setLogPage(1);
                      }}
                      className="w-full px-2 py-1 text-[11px] border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                    />
                  </div>
                )}
                {visible.map((e) => (
                  <ConfirmedCard key={e.rowId || e.name + e.arrivedAt} entry={e} />
                ))}
                {remaining > 0 && (
                  <button
                    type="button"
                    onClick={() => setLogPage((p) => p + 1)}
                    className="w-full py-2 text-[10px] font-bold text-slate-500 hover:bg-slate-50"
                  >
                    Ver más · {remaining} restantes
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {typeof wa.addFakePending === 'function' && process.env.NODE_ENV === 'development' && (
        <div className="border-t border-slate-100 px-3 py-2 flex-shrink-0">
          <button
            type="button"
            onClick={() => wa.addFakePending()}
            className="text-[10px] text-slate-400 hover:text-slate-600 font-medium"
          >
            ▶ Demo sin conexión
          </button>
        </div>
      )}
    </aside>
  );
}

export default function ModoRapidoPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { empresaId, empresa } = useEmpresa();
  const migracionCompleta = !!(empresa as { migracionCompleta?: boolean } | null)?.migracionCompleta;
  const scopeEmpresa = useMemo(
    () => shouldScopeQueriesToEmpresa(empresaId, migracionCompleta),
    [empresaId, migracionCompleta],
  );

  const turnosData = useTurnosHoy({
    empresaId: empresaId || null,
    scopeEmpresa,
  });
  const {
    turnos,
    loading,
    francos,
    presenciaMeta,
    cerrados,
    clientePorObj,
    retenesManana,
    tramosExtra,
    coberturaPorTitular,
    empInfo,
  } = turnosData;
  const wa = useWABridge(turnos, empresaId, tramosExtra);

  const [bridgeUrl, setBridgeUrl] = useState('');
  /** Proveedor WA activo de la empresa (Configuración → WhatsApp). */
  const [waProvider, setWaProvider] = useState<
    'cargando' | 'off' | 'bridge' | 'cloud' | 'sin_config'
  >('cargando');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [logOpen, setLogOpen] = useState(true);
  const [logFilter, setLogFilter] = useState('');
  const [logPage, setLogPage] = useState(1);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [search, setSearch] = useState('');
  const [bandFilter, setBandFilter] = useState<string>('all');
  const [statsFilter, setStatsFilter] = useState<StatsFilter>('all');
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>({});
  const [groupInitDone, setGroupInitDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ msg: string; color: string } | null>(null);
  const [coberturaModal, setCoberturaModal] = useState<GuardRowModel | null>(null);
  const [accionesModal, setAccionesModal] = useState<GuardRowModel | null>(null);
  const [comentarioModal, setComentarioModal] = useState<GuardRowModel | null>(null);
  const [retenesModalOpen, setRetenesModalOpen] = useState(false);
  const [pdfModalOpen, setPdfModalOpen] = useState(false);
  const [pdfYmd, setPdfYmd] = useState(() => arYmd(Date.now()));
  const [pdfBusy, setPdfBusy] = useState(false);
  const [autoWa, setAutoWa] = useState(true);
  const [autoWaCount, setAutoWaCount] = useState(0);
  const autoWaProcesadosRef = useRef<Set<string>>(new Set());
  const [revertirChoice, setRevertirChoice] = useState<GuardRowModel | null>(null);
  const [confirmacion, setConfirmacion] = useState<ConfirmacionPlanilla | null>(null);
  const confirmacionResolverRef = useRef<((ok: boolean) => void) | null>(null);
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const [hourEdit, setHourEdit] = useState<{ rowId: string; value: string; campo: 'ingreso' | 'salida' } | null>(null);
  const [arm, setArm] = useState<null | { kind: 'ausente' | 'quitar' | 'radio' | 'cerrar'; rowId: string }>(null);
  const [retiroModal, setRetiroModal] = useState<GuardRowModel | null>(null);
  const [retiroMotivo, setRetiroMotivo] = useState<MotivoRetiro>('ENFERMEDAD');
  const [retiroReemplazo, setRetiroReemplazo] = useState<boolean | null>(null);
  /** Retiro anticipado con reemplazo: ventana del resto del turno a cubrir. */
  const [huecoRetiro, setHuecoRetiro] = useState<{ docId: string; desdeMs: number; hastaMs: number } | null>(null);
  const [swapFromId, setSwapFromId] = useState<string | null>(null);
  const [pantallaCompleta, setPantallaCompleta] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const [ordenModo, setOrdenModo] = useState<OrdenModo>('prioridad');
  const [horarioDir, setHorarioDir] = useState<'asc' | 'desc'>('asc');
  const [colAnchos, setColAnchos] = useState<number[] | null>(null);
  const cabeceraRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(COLS_ANCHOS_KEY) || 'null') as unknown;
      if (
        Array.isArray(raw) &&
        raw.length === COLS_MIN.length &&
        raw.every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0)
      ) {
        setColAnchos(raw as number[]);
      }
    } catch {
      /* ignore */
    }
  }, []);

  function restablecerColumnas() {
    setColAnchos(null);
    try {
      localStorage.removeItem(COLS_ANCHOS_KEY);
    } catch {
      /* ignore */
    }
  }

  function iniciarAjusteColumna(idx: number, e: React.PointerEvent<HTMLSpanElement>) {
    e.preventDefault();
    e.stopPropagation();
    const cab = cabeceraRef.current;
    if (!cab) return;
    const base =
      colAnchos && colAnchos.length === COLS_MIN.length
        ? [...colAnchos]
        : Array.from({ length: COLS_MIN.length }, (_, i) => {
            const el = cab.children[i + 1] as HTMLElement | undefined;
            return Math.max(COLS_MIN[i], Math.round(el?.getBoundingClientRect().width || COLS_MIN[i]));
          });
    const inicioX = e.clientX;
    const anchoInicial = base[idx];
    let ultimo = base;
    let movido = false;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const mover = (ev: PointerEvent) => {
      movido = true;
      const siguiente = [...base];
      siguiente[idx] = Math.max(COLS_MIN[idx], Math.round(anchoInicial + ev.clientX - inicioX));
      ultimo = siguiente;
      setColAnchos(siguiente);
    };
    const soltar = () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      window.removeEventListener('pointercancel', soltar);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (!movido) return;
      try {
        localStorage.setItem(COLS_ANCHOS_KEY, JSON.stringify(ultimo));
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
    window.addEventListener('pointercancel', soltar);
  }
  const [ordenManual, setOrdenManual] = useState<string[]>([]);
  const [dragObj, setDragObj] = useState<string | null>(null);
  const [dropObj, setDropObj] = useState<string | null>(null);
  const ordenKey = `cosp_mr_orden_v1_${user?.uid || 'anon'}_${empresaId || ''}`;
  const [preferOpsRapido, setPreferOpsRapido] = useState(false);
  const undoRef = useRef<Array<{ rowId: string; data: Record<string, unknown> }>>([]);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setPreferOpsRapido(readPreferOpsModoRapido(user?.uid));
  }, [user?.uid]);

  const showToast = useCallback((msg: string, color = 'bg-slate-800') => {
    setToast({ msg, color });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const generarPdfDia = useCallback(async () => {
    if (!empresaId || pdfBusy) return;
    setPdfBusy(true);
    try {
      const res = await generarModoRapidoReportePdf({
        empresaId,
        scopeEmpresa,
        empresaNombre: empresa?.name || empresaId,
        ymd: pdfYmd,
      });
      setPdfModalOpen(false);
      showToast(`PDF · ${res.filas} filas · ${res.fileName}`, 'bg-emerald-700');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'No se pudo generar el PDF';
      showToast(msg, 'bg-red-700');
    } finally {
      setPdfBusy(false);
    }
  }, [empresaId, empresa?.name, scopeEmpresa, pdfYmd, pdfBusy, showToast]);

  const wabEnviar = wa.enviar;
  const wabConectado = wa.status === 'connected';

  /**
   * Avisa a los guardias por privado desde el bridge de la empresa, uno detrás de otro (con una pausa
   * corta entre envíos). Si el bridge no está conectado o no confirma el envío, abre wa.me como antes.
   * Devuelve el texto para sumar al toast.
   */
  const avisarPorWhatsApp = useCallback(
    async (avisos: { phone?: string; texto: string }[]): Promise<string> => {
      let porBridge = 0;
      let porWame = 0;
      let ultimoFueBridge = false;
      for (const a of avisos) {
        if (!a.phone) continue;
        if (ultimoFueBridge) await new Promise((r) => setTimeout(r, 1500));
        const ok = wabConectado ? await wabEnviar(a.phone, a.texto) : false;
        ultimoFueBridge = ok;
        if (ok) {
          porBridge += 1;
        } else if (abrirWa(a.phone, a.texto)) {
          porWame += 1;
        }
      }
      if (porBridge > 0 && porWame === 0) return ' · aviso enviado por WhatsApp';
      if (porBridge === 0 && porWame > 0) return ' · WhatsApp abierto (bridge sin conexión)';
      if (porBridge > 0 && porWame > 0) return ' · aviso enviado por WhatsApp (uno abierto a mano)';
      return '';
    },
    [wabEnviar, wabConectado],
  );

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Proveedor por empresa (Configuración → WhatsApp). Bridge = Baileys; cloud = Meta (webhook
    // en etapa siguiente); off / sin config = sin WA. Nunca cae al bridge de otra empresa.
    setBridgeUrl('');
    setWaProvider('cargando');
    wa.disconnect();
    (async () => {
      if (!empresaId) {
        setWaProvider('sin_config');
        return;
      }
      try {
        const [snapWa, snapLegacy] = await Promise.all([
          getDoc(doc(db, 'empresas', empresaId, 'config', 'whatsapp')),
          getDoc(doc(db, 'empresas', empresaId, 'config', 'wa-bridge')),
        ]);
        if (cancelled) return;
        let cfg = parseWhatsAppConfig(snapWa.exists() ? snapWa.data() : null);
        const legacyUrl =
          snapLegacy.exists() && typeof snapLegacy.data()?.url === 'string'
            ? String(snapLegacy.data()?.url)
            : '';
        cfg = mergeLegacyBridgeUrl(cfg, legacyUrl);
        if (cfg.provider === 'bridge' && cfg.bridge.url) {
          setBridgeUrl(cfg.bridge.url);
          setWaProvider('bridge');
        } else if (cfg.provider === 'cloud') {
          setWaProvider('cloud');
        } else if (cfg.provider === 'off') {
          setWaProvider('off');
        } else if (cfg.bridge.url) {
          // Doc incompleto pero hay URL legacy: seguir con bridge.
          setBridgeUrl(cfg.bridge.url);
          setWaProvider('bridge');
        } else {
          setWaProvider('sin_config');
        }
      } catch {
        if (!cancelled) setWaProvider('sin_config');
      }
    })();

    try {
      const sb = localStorage.getItem('wa-mr-sb');
      if (sb === '0') setSidebarCollapsed(true);
      else if (sb === '1') setSidebarCollapsed(false);
    } catch {
      /* ignore */
    }

    return () => {
      cancelled = true;
    };
  }, [empresaId]);

  useEffect(() => {
    if (waProvider === 'bridge' && bridgeUrl) wa.connect(bridgeUrl);
    else wa.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- connect al cambiar URL/proveedor; wa estable por refs
  }, [bridgeUrl, waProvider]);

  const syncedRef = useRef(false);
  useEffect(() => {
    if (wa.status === 'connected' && !syncedRef.current && turnosData.phones.length > 0) {
      syncedRef.current = true;
      void wa.syncPhones(turnosData.phones);
    }
  }, [wa.status, turnosData.phones, wa]);

  const setSidebar = useCallback((collapsed: boolean) => {
    setSidebarCollapsed(collapsed);
    try {
      localStorage.setItem('wa-mr-sb', collapsed ? '0' : '1');
    } catch {
      /* ignore */
    }
  }, []);

  /**
   * Escritura sin esperar el ack del servidor: el listener ya muestra el cambio al instante
   * (caché local) y la planilla no se traba. Si el servidor la rechaza, se avisa y la fila vuelve.
   */
  function escribir(p: Promise<unknown>, que: string) {
    p.catch((err) => {
      console.warn(`[modo-rapido] no se pudo guardar ${que}`, err);
      showToast(`No se pudo guardar ${que}. Revisá la fila.`, 'bg-red-600');
    });
  }

  async function marcarPresente(
    turnoId: string,
    empleado: { name: string; expected: string },
    realTime: string,
    source: 'WA' | 'MANUAL' | 'MANUAL_RADIO',
  ) {
    const punchDate = new Date();
    const [hh, mm] = realTime.split(':').map(Number);
    punchDate.setHours(hh, mm, 0, 0);
    const punchMs = punchDate.getTime();
    const docId = docIdDe(turnoId);
    const tramo = indiceTramoDe(turnoId) + 1;

    // CC / FICHADA: siempre la hora que marcó. Liquidación clampea al inicio planificado
    // (salvo adelanto formal isEarlyStart). T+5 solo define si es llegada tarde.
    const snap = await leerTurnoRapido(docId);
    const data = (snap.data() || {}) as Record<string, unknown>;
    const bloques = bloquesDelTurno(data.blocks);
    const baseMs = toStartMs(data.startTime);
    let payAnchorMs = baseMs;
    if (tramo === 1 && data.isEarlyStart === true) {
      const adj = toStartMs(data.adjustedStartTime);
      if (!Number.isNaN(adj) && adj > 0) payAnchorMs = adj;
    } else if (tramo > 1 && bloques && !Number.isNaN(baseMs)) {
      const tr = tramosDeTurno(baseMs, bloques)[tramo - 1];
      if (tr) payAnchorMs = tr.startMs;
    }
    const PAY_GRACE_MS = 5 * 60 * 1000;
    const pastGrace =
      !Number.isNaN(payAnchorMs) && payAnchorMs > 0 && punchMs > payAnchorMs + PAY_GRACE_MS;
    const realTs = Timestamp.fromMillis(punchMs);
    const isLate = pastGrace;
    const lateMinutes = pastGrace
      ? Math.max(0, Math.round((punchMs - payAnchorMs) / 60000))
      : 0;

    if (tramo === 1) {
      // `isPresent` es lo que leen el CC clásico, el cierre automático y la protección contra la
      // ausencia automática (AA): sin él, el guardia figuraba ausente fuera de Modo Rápido. Los campos
      // de ausencia se limpian igual que en `registrarPresencia` (si el servidor ya lo había marcado AA,
      // onTurnoWrite lo pasa a Llegada Tarde).
      escribir(
        updateDoc(doc(db, 'turnos', docId), {
          status: 'PRESENT',
          isPresent: true,
          isAbsent: false,
          absenceType: null,
          absenceDetectedAt: null,
          isAwaitingCoverageCheckIn: false,
          realStartTime: realTs,
          checkInSource: source,
          checkInAt: realTs,
          checkInTime: realTs,
          isLate,
          lateMinutes,
        }),
        'la presencia',
      );
    } else {
      // Tramo 2+ de un turno cortado: la presencia vive en `presenciaBloques.bN`. El turno pasa a
      // PRESENT y su fin planificado se corre al fin de este tramo para que el cierre automático
      // del servidor (que solo conoce el primer tramo) no lo cierre en el corte.
      const patch: Record<string, unknown> = {
        status: 'PRESENT',
        isPresent: true,
        isCompleted: false,
        [`presenciaBloques.b${tramo}.realStartTime`]: realTs,
        [`presenciaBloques.b${tramo}.checkInSource`]: source,
        [`presenciaBloques.b${tramo}.checkInAt`]: serverTimestamp(),
      };
      // Si el turno ya estaba cerrado por el corte, los tramos anteriores quedan cerrados.
      const yaCerrado = String(data.status || '').toUpperCase() === 'COMPLETED' || data.isCompleted === true;
      if (yaCerrado) {
        for (let k = 1; k < tramo; k += 1) {
          patch[`presenciaBloques.b${k}.cerrado`] = true;
          if (k === 1 && data.realEndTime) patch['presenciaBloques.b1.realEndTime'] = data.realEndTime;
        }
      }
      if (bloques && !Number.isNaN(baseMs)) {
        const tr = tramosDeTurno(baseMs, bloques)[tramo - 1];
        const finActual = toStartMs(data.endTime);
        if (tr && (Number.isNaN(finActual) || tr.endMs > finActual)) {
          patch.endTime = Timestamp.fromMillis(tr.endMs);
        }
      }
      escribir(updateDoc(doc(db, 'turnos', docId), patch), 'la presencia del tramo');
    }

    escribir(
      addDoc(collection(db, 'novedades'), {
        type: source === 'WA' ? 'CHECK_IN_WA' : source === 'MANUAL_RADIO' ? 'CHECK_IN_RADIO' : 'CHECK_IN_MANUAL',
        turnoId: docId,
        ...(tramo > 1 ? { bloque: tramo } : {}),
        employeeName: empleado.name,
        expected: empleado.expected,
        realTime,
        source,
        empresaId,
        operatorId: user?.uid ?? 'cc-modo-rapido',
        createdAt: serverTimestamp(),
      }),
      'la novedad de ingreso',
    );
  }

  /**
   * Ausencia por el camino oficial (el mismo que el Centro de Control clásico): el servidor marca
   * `isAbsent`, crea el registro de RRHH (`ausencias`), la novedad AUSENCIA_AUTO, la retención del
   * saliente y, si la empresa no está en modo manual, abre la vacante. Se espera la respuesta: si el
   * servidor no la acepta, la fila no queda a medias y el operador lo ve.
   */
  async function registrarAusencia(rowId: string, _empleado: { name: string }) {
    const turnoId = docIdDe(rowId);
    const fn = httpsCallable(functions, 'marcarAusenciaOperaciones');
    const res = (await fn({ shiftId: turnoId })) as { data?: { success?: boolean } };
    if (res?.data?.success !== true) {
      throw new Error('El servidor no registró la ausencia');
    }
  }

  /**
   * El turno de un ausente pasa a manos de otro guardia (RET, intercambio): deja de ser una ausencia
   * del turno —así el guardia que lo toma no hereda la AA ni una "llegada tarde" de otro— y el
   * registro de RRHH de la ausencia queda gestionado con quién cubrió. Solo aplica si el turno estaba
   * marcado ausente.
   */
  function parcheTurnoReasignadoDeAusente(turno: TurnoHoy): Record<string, unknown> {
    if (turno.turnoStatus !== 'ABSENT') return {};
    return {
      status: 'PENDING',
      isAbsent: false,
      absenceType: null,
      absenceDetectedAt: null,
      absenceDetectedBy: null,
      absenceCode: null,
      ausenteOriginalEmployeeId: turno.employeeId ?? null,
      ausenteOriginalEmployeeName: turno.name || null,
    };
  }

  /**
   * Si el titular tiene turno cortado, el turno de cobertura hereda los mismos tramos (el reemplazo no
   * trabaja ni cobra el corte). Va en el mismo batch que la cobertura.
   */
  async function heredarTramosEnCobertura(
    batch: ReturnType<typeof writeBatch>,
    titularId: string,
    coverDocId: string,
  ) {
    const raw = (await leerTurnoRapido(titularId)).data() || {};
    if (Array.isArray(raw.blocks) && raw.blocks.length > 1) {
      batch.set(doc(db, 'turnos', coverDocId), { blocks: raw.blocks }, { merge: true });
    }
  }

  /** Marca la ausencia de RRHH como gestionada. Un fallo no frena la cobertura ya hecha. */
  async function marcarAusenciaGestionada(
    turnoId: string,
    cubre: { id?: string | null; name: string },
    coverageType: string,
  ) {
    try {
      await syncAusenciaCoberturaGestionada(db, {
        shiftId: turnoId,
        coveredByEmployeeId: cubre.id ?? null,
        coveredByEmployeeName: cubre.name,
        coverageType,
        empresaId,
        resolvedBy: 'OPERACIONES',
      });
    } catch (err) {
      console.warn('[modo-rapido] no se pudo marcar la ausencia de RRHH como gestionada', err);
    }
  }

  const classifiedRowsBase = useMemo((): GuardRowModel[] => {
    const entradas: Array<[string, TurnoHoy]> = [
      ...Object.entries(turnos),
      ...tramosExtra.map((t): [string, TurnoHoy] => [t.name || '—', t]),
    ];
    const base = entradas
      .map(([employeeName, turno]) => {
        const { estado, pendingEntry } = classifyEstado(turno, wa, nowMs);
        let realDisplay = '—';
        if (turno.turnoStatus === 'PRESENT' && turno.realStartTime) {
          realDisplay = turno.realStartTime;
        } else if (estado === 'PENDIENTE_WA' && pendingEntry?.arrivedAt) {
          realDisplay = pendingEntry.arrivedAt;
        } else if (estado === 'PRESENTE_WA') {
          const conf = wa.confirmedEntries.find((e) => e.rowId === turno.rowId);
          if (conf?.arrivedAt) realDisplay = conf.arrivedAt;
          else if (turno.realStartTime) realDisplay = turno.realStartTime;
        }

        const realForDiff =
          realDisplay !== '—'
            ? realDisplay
            : undefined;
        const esRet = String(turno.code || '').toUpperCase() === 'RET';
        // Ausente ya quedó resuelto: no seguir contando "hace N min" desde el inicio.
        const diff =
          estado === 'AUSENTE'
            ? { label: '—', tone: 'neutral' as const }
            : esRet && !realForDiff
              ? { label: 'en espera', tone: 'neutral' as const }
              : buildDiff(
                  turno.expected,
                  realForDiff,
                  nowMs,
                  turno.startTimeRaw as Timestamp | undefined,
                );

        const fuente = fuenteDe(estado, presenciaMeta[turno.rowId]);
        return {
          employeeName,
          turno,
          estado,
          pendingEntry,
          realDisplay,
          diffLabel: diff.label,
          diffTone: diff.tone,
          band: extractBand(turno.shift),
          fuente,
          salida: formatHHMM(turno.endTimeRaw as Timestamp | undefined),
          salidaReal: presenciaMeta[turno.rowId]?.realEndLabel || undefined,
        };
      })
      .sort((a, b) => rowRank(a) - rowRank(b) || String(a.turno.expected).localeCompare(String(b.turno.expected)));

    // Segunda pasada: "Cubierto por X" solo con cobertura real (ops_cov) o campo oficial.
    // Puede haber varios (EXTEND 06–10 + FT resto): se listan todos.
    const normNombre = (s: string) =>
      String(s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
    return base.map((row): GuardRowModel => {
      if (row.estado !== 'NO_LLEGO' && row.estado !== 'AUSENTE') return row;
      const titularDocId = docIdDe(row.turno.rowId);
      const nombres: string[] = [];
      const pushNombre = (n: string) => {
        const t = String(n || '').trim();
        if (!t || nombres.some((x) => normNombre(x) === normNombre(t))) return;
        nombres.push(t);
      };
      for (const n of coberturaPorTitular[titularDocId] || []) pushNombre(n);
      for (const other of base) {
        if (other === row) continue;
        if (other.estado === 'NO_LLEGO' || other.estado === 'AUSENTE') continue;
        if (other.turno.origin !== 'OPERATIONS_COVERAGE') continue;
        if (!other.turno.objectiveId || other.turno.objectiveId !== row.turno.objectiveId) continue;
        const porId =
          other.turno.coverageForShiftId && other.turno.coverageForShiftId === titularDocId;
        const porNombre =
          !!other.turno.coversEmployeeName &&
          normNombre(other.turno.coversEmployeeName) === normNombre(row.employeeName);
        if (porId || porNombre) pushNombre(other.employeeName);
      }
      if (nombres.length) return { ...row, coveredByName: nombres.join(' + ') };
      if (row.turno.coveredByName) return { ...row, coveredByName: row.turno.coveredByName };
      return row;
    }).concat(
      Object.entries(cerrados).map(([rowId, turno]): GuardRowModel => {
        const nombre = turno.name || '—';
        const estado: GuardEstado = 'CERRADO';
        return {
          employeeName: nombre,
          turno: { ...turno, rowId: turno.rowId || rowId },
          estado,
          realDisplay: turno.realStartTime || '—',
          diffLabel: 'cerrado',
          diffTone: 'neutral' as const,
          band: extractBand(turno.shift),
          fuente: fuenteDe(estado, presenciaMeta[turno.rowId || rowId]),
          salida: formatHHMM(turno.endTimeRaw as Timestamp | undefined),
          salidaReal: presenciaMeta[turno.rowId || rowId]?.realEndLabel || undefined,
        };
      }),
    );
  }, [turnos, tramosExtra, coberturaPorTitular, wa, nowMs, presenciaMeta, cerrados]);

  // Relevo y aviso de salida de cada guardia presente (para la columna de egreso y el cierre automático).
  const classifiedRows = useMemo((): GuardRowModel[] => {
    const avisos = new Map(wa.salidas.filter((s) => s.rowId).map((s) => [s.rowId as string, s]));
    return classifiedRowsBase.map((row): GuardRowModel => {
      if (!estaPresente(row)) return row;
      const relevo = buscarRelevo(row, classifiedRowsBase);
      const aviso = avisos.get(row.turno.rowId);
      const programado = hayRelevoProgramado(row, classifiedRowsBase);
      return {
        ...row,
        relevoNombre: relevo?.employeeName,
        salidaAvisada: aviso?.arrivedAt ?? presenciaMeta[row.turno.rowId]?.salidaMarcada,
        finSinRelevo: !programado,
        salidaSinRelevo:
          (!!aviso || !!presenciaMeta[row.turno.rowId]?.salidaMarcada) &&
          programado &&
          !hayRelevoLibre(row, classifiedRowsBase),
      };
    });
  }, [classifiedRowsBase, wa.salidas, presenciaMeta]);

  // «Confirmados hoy» sale de la planilla compartida (presencias con fuente WA), no de lo que
  // confirmó esta sesión: así se ven los de todos los operadores. De la sesión local se toma
  // solo la ubicación, que no queda guardada en el turno.
  const confirmadosHoy = useMemo((): WAConfirmedEntry[] => {
    const locales = new Map(
      wa.confirmedEntries.filter((e) => e.rowId).map((e) => [e.rowId as string, e]),
    );
    const vistos = new Set<string>();
    const lista: WAConfirmedEntry[] = [];
    classifiedRows.forEach((row) => {
      if (row.fuente !== 'WA' || row.estado === 'PENDIENTE_WA') return;
      const rowId = row.turno.rowId;
      if (vistos.has(rowId)) return;
      vistos.add(rowId);
      const local = locales.get(rowId);
      lista.push({
        rowId,
        name: row.employeeName,
        arrivedAt: row.realDisplay !== '—' ? row.realDisplay : local?.arrivedAt || '',
        shift: row.turno.shift,
        obj: row.turno.obj,
        phone: row.turno.phone,
        lat: local?.lat,
        lng: local?.lng,
      });
    });
    wa.confirmedEntries.forEach((e) => {
      if (e.rowId && vistos.has(e.rowId)) return;
      lista.push(e);
    });
    return lista.sort((a, b) => String(b.arrivedAt).localeCompare(String(a.arrivedAt)));
  }, [classifiedRows, wa.confirmedEntries]);

  const stats = useMemo(() => {
    let critico = 0;
    let tardanza = 0;
    let sinConfirmar = 0;
    let ok = 0;
    let retenes = 0;
    let sinPresencia = 0;
    let radio = 0;
    let app = 0;
    let cerrado = 0;
    for (const r of classifiedRows) {
      if (r.band === 'RET') retenes += 1;
      if (pasaFiltro(r, 'critico')) critico += 1;
      if (pasaFiltro(r, 'tardanza')) tardanza += 1;
      if (pasaFiltro(r, 'sin_confirmar')) sinConfirmar += 1;
      if (pasaFiltro(r, 'ok')) ok += 1;
      if (pasaFiltro(r, 'sin_presencia')) sinPresencia += 1;
      if (pasaFiltro(r, 'radio')) radio += 1;
      if (pasaFiltro(r, 'app')) app += 1;
      if (pasaFiltro(r, 'cerrado')) cerrado += 1;
    }
    return { total: classifiedRows.length, critico, tardanza, sinConfirmar, ok, retenes, sinPresencia, radio, app, cerrado };
  }, [classifiedRows]);

  const retenesHoyItems = useMemo((): RetenItem[] => {
    return classifiedRows
      .filter((r) => r.band === 'RET' && !r.turno.coverageUsed)
      .map((r) => ({
        rowId: r.turno.rowId,
        employeeId: String(r.turno.employeeId || ''),
        nombre: r.employeeName,
        phone: r.turno.phone,
        objetivo: r.turno.obj,
        horario: r.turno.shift.replace(/^RET\s*/i, '') || r.turno.expected,
        estadoLabel: estadoPill(r.estado).label,
        estadoTono: retenTonoDe(r.estado),
        dia: 'hoy' as const,
        estadoRaw: r.estado,
      }))
      .sort((a, b) => compararTexto(a.nombre, b.nombre));
  }, [classifiedRows]);

  const retenesMananaItems = useMemo(
    (): RetenItem[] =>
      retenesManana
        .map((t) => ({
          rowId: t.rowId,
          employeeId: String(t.employeeId || ''),
          nombre: t.name,
          phone: t.phone,
          objetivo: t.obj,
          horario: t.shift.replace(/^RET\s*/i, '') || t.expected,
          estadoLabel: 'PROGRAMADO',
          estadoTono: 'neutro' as const,
          dia: 'manana' as const,
        }))
        .sort((a, b) => compararTexto(a.nombre, b.nombre)),
    [retenesManana],
  );

  /** Aviso por la app del guardia: queda en su bandeja y sale el push (mismo canal que los avisos del CC). */
  const enviarAppRetenes = useCallback(
    async (avisos: RetenAviso[]): Promise<RetenEnvioApp> => {
      let enviados = 0;
      let fallidos = 0;
      const operador = user?.displayName || user?.email || 'Operador';
      for (const { item, texto } of avisos) {
        try {
          await addDoc(collection(db, 'user_notifications'), {
            uid: null,
            employeeId: item.employeeId,
            userId: item.employeeId,
            type: 'AVISO_TURNO_PROXIMO',
            title: 'Mensaje de Operaciones',
            body: texto,
            target: 'employee',
            empresaId: empresaId || null,
            shiftId: docIdDe(item.rowId),
            turnoId: docIdDe(item.rowId),
            objectiveName: item.objetivo || null,
            shiftCode: 'RET',
            manual: true,
            origen: 'MODO_RAPIDO_RETENES',
            enviadoPor: operador,
            read: false,
            readAt: null,
            createdAt: serverTimestamp(),
          });
          enviados += 1;
        } catch (e) {
          fallidos += 1;
          console.error('[modo-rapido] aviso por app a retén', item.nombre, e);
        }
      }
      if (enviados > 0) {
        showToast(`Mensaje enviado por la app a ${enviados} retén${enviados === 1 ? '' : 'es'}`, 'bg-emerald-700');
      }
      if (fallidos > 0) {
        showToast(`No se pudo enviar por la app a ${fallidos} retén${fallidos === 1 ? '' : 'es'}`, 'bg-red-700');
      }
      return { enviados, fallidos };
    },
    [user?.displayName, user?.email, empresaId, showToast],
  );

  const enviarWaRetenes = useCallback(
    async (avisos: RetenAviso[]): Promise<string> => {
      const extra = await avisarPorWhatsApp(avisos.map((a) => ({ phone: a.item.phone, texto: a.texto })));
      showToast(`Retenes avisados${extra}`.trim(), 'bg-emerald-700');
      return extra;
    },
    [avisarPorWhatsApp, showToast],
  );

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return classifiedRows.filter((r) => {
      if (!pasaFiltroBanda(r, bandFilter)) return false;
      if (!pasaFiltro(r, statsFilter)) return false;
      if (q) {
        const hay =
          r.employeeName.toLowerCase().includes(q) ||
          r.turno.obj.toLowerCase().includes(q) ||
          String(r.turno.positionName || '').toLowerCase().includes(q);
        if (!hay) return false;
      }
      return true;
    });
  }, [classifiedRows, bandFilter, statsFilter, search]);

  const groups = useMemo(() => {
    const map = new Map<string, GuardRowModel[]>();
    for (const r of filteredRows) {
      const key = r.turno.obj || '—';
      const list = map.get(key) || [];
      list.push(r);
      map.set(key, list);
    }
    const clienteDe = (obj: string) => clientePorObj[obj] || SIN_CLIENTE;
    const posManual = new Map<string, number>();
    ordenManual.forEach((n, i) => posManual.set(n, i));
    const inicioMs = (r: GuardRowModel): number => {
      const ms = toStartMs(r.turno.startTimeRaw);
      return Number.isNaN(ms) ? Number.MAX_SAFE_INTEGER : ms;
    };
    const primerInicio = (rows: GuardRowModel[]): number => Math.min(...rows.map(inicioMs));
    const signo = horarioDir === 'desc' ? -1 : 1;
    return Array.from(map.entries())
      .map(([name, rows]) => [
        name,
        [...rows].sort((a, b) =>
          ordenModo === 'horario'
            ? signo * (inicioMs(a) - inicioMs(b)) || rowRank(a) - rowRank(b) || compararTexto(a.employeeName, b.employeeName)
            : rowRank(a) - rowRank(b) || a.turno.expected.localeCompare(b.turno.expected),
        ),
      ] as [string, GuardRowModel[]])
      .sort((a, b) => {
        if (ordenModo === 'alfabetico') return compararTexto(a[0], b[0]);
        if (ordenModo === 'horario') {
          return signo * (primerInicio(a[1]) - primerInicio(b[1])) || compararTexto(a[0], b[0]);
        }
        if (ordenModo === 'cliente') {
          const ca = clienteDe(a[0]);
          const cb = clienteDe(b[0]);
          if (ca === SIN_CLIENTE && cb !== SIN_CLIENTE) return 1;
          if (cb === SIN_CLIENTE && ca !== SIN_CLIENTE) return -1;
          return compararTexto(ca, cb) || compararTexto(a[0], b[0]);
        }
        if (ordenModo === 'manual') {
          const pa = posManual.has(a[0]) ? (posManual.get(a[0]) as number) : Number.MAX_SAFE_INTEGER;
          const pb = posManual.has(b[0]) ? (posManual.get(b[0]) as number) : Number.MAX_SAFE_INTEGER;
          return pa - pb || compararTexto(a[0], b[0]);
        }
        const ra = Math.min(...a[1].map(rowRank));
        const rb = Math.min(...b[1].map(rowRank));
        return ra - rb || a[0].localeCompare(b[0]);
      });
  }, [filteredRows, ordenModo, ordenManual, clientePorObj, horarioDir]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(ordenKey);
      if (!raw) {
        setOrdenModo('prioridad');
        setOrdenManual([]);
        setHorarioDir('asc');
        return;
      }
      const parsed = JSON.parse(raw) as { modo?: OrdenModo; manual?: unknown; dir?: string };
      const modo = ORDEN_OPCIONES.some((o) => o.id === parsed.modo) ? (parsed.modo as OrdenModo) : 'prioridad';
      setOrdenModo(modo);
      setOrdenManual(Array.isArray(parsed.manual) ? parsed.manual.map((x) => String(x)) : []);
      setHorarioDir(parsed.dir === 'desc' ? 'desc' : 'asc');
    } catch {
      setOrdenModo('prioridad');
      setOrdenManual([]);
      setHorarioDir('asc');
    }
  }, [ordenKey]);

  function guardarOrden(modo: OrdenModo, manual: string[], dir: 'asc' | 'desc' = horarioDir) {
    setOrdenModo(modo);
    setOrdenManual(manual);
    setHorarioDir(dir);
    try {
      localStorage.setItem(ordenKey, JSON.stringify({ modo, manual, dir }));
    } catch {
      /* sin almacenamiento: el orden vale solo para esta sesión */
    }
  }

  /** Clic en el título «Ing. P.»: horario programado ascendente, luego descendente, luego vuelve a Prioridad. */
  function alternarOrdenHorario() {
    if (ordenModo !== 'horario') {
      guardarOrden('horario', ordenManual, 'asc');
    } else if (horarioDir === 'asc') {
      guardarOrden('horario', ordenManual, 'desc');
    } else {
      guardarOrden('prioridad', ordenManual, 'asc');
    }
  }

  function moverObjetivo(origen: string, destino: string) {
    if (origen === destino) return;
    const conocidos = Array.from(new Set(classifiedRows.map((r) => r.turno.obj || '—')));
    const visibles = groups.map(([k]) => k);
    const base = ordenModo === 'manual'
      ? [
          ...ordenManual.filter((n) => conocidos.includes(n)),
          ...conocidos.filter((n) => !ordenManual.includes(n)).sort(compararTexto),
        ]
      : [
          ...visibles,
          ...conocidos.filter((n) => !visibles.includes(n)).sort(compararTexto),
        ];
    const desde = base.indexOf(origen);
    const hasta = base.indexOf(destino);
    if (desde < 0 || hasta < 0) return;
    const lista = base.filter((n) => n !== origen);
    const idx = lista.indexOf(destino);
    lista.splice(desde < hasta ? idx + 1 : idx, 0, origen);
    guardarOrden('manual', lista);
    showToast(`Orden manual · ${origen}`, 'bg-indigo-700');
  }

  const nonReteGroups = useMemo(
    () =>
      groups
        .map(([k, rows]) => [k, rows.filter((r) => r.band !== 'RET')] as [string, GuardRowModel[]])
        .filter(([, rows]) => rows.length > 0),
    [groups],
  );

  const sheetRows = useMemo(() => {
    const list: GuardRowModel[] = [];
    for (const [, rows] of nonReteGroups) list.push(...rows);
    return list;
  }, [nonReteGroups]);

  const activeRow = sheetRows.find((r) => r.turno.rowId === activeRowId) ?? null;

  useEffect(() => {
    if (groupInitDone || classifiedRows.length === 0) return;
    const init: Record<string, boolean> = {};
    const byObj = new Map<string, GuardRowModel[]>();
    for (const r of classifiedRows) {
      const key = r.turno.obj || '—';
      const list = byObj.get(key) || [];
      list.push(r);
      byObj.set(key, list);
    }
    byObj.forEach((rows, key) => {
      const hasProblem = rows.some(
        (r) => r.estado === 'NO_LLEGO' || r.estado === 'TARDANZA',
      );
      init[key] = hasProblem;
    });
    setGroupOpen(init);
    setGroupInitDone(true);
  }, [classifiedRows, groupInitDone]);

  const esCandidatoValido = (c: GuardRowModel, absent: GuardRowModel): boolean => {
    if (c.turno.rowId === absent.turno.rowId) return false;
    // Turno cortado = un solo documento: no intercambiar un tramo consigo mismo.
    if (docIdDe(c.turno.rowId) === docIdDe(absent.turno.rowId)) return false;
    const mismoObjetivoYHorario =
      !!c.turno.objectiveId &&
      c.turno.objectiveId === absent.turno.objectiveId &&
      c.turno.expected === absent.turno.expected &&
      (!c.turno.positionName || !absent.turno.positionName || c.turno.positionName === absent.turno.positionName);
    return !mismoObjetivoYHorario;
  };

  /**
   * Para cubrir M o T (o una N que arranca de madrugada) se usan los RET de hoy.
   * Para cubrir una N que arranca de noche se usan los RET del día siguiente.
   */
  const retUsaManana = useMemo((): boolean => {
    if (!coberturaModal) return false;
    const mins = parseHHMMToMins(String(coberturaModal.turno.expected || ''));
    return mins !== null && mins >= 21 * 60;
  }, [coberturaModal]);

  /** Una noche que arranca de las 21:00 en adelante se cubre con los RET del día siguiente. */
  const huecoUsaRetManana = (hueco: GuardRowModel): boolean => {
    const mins = parseHHMMToMins(String(hueco.turno.expected || ''));
    return mins !== null && mins >= 21 * 60;
  };

  /** RET que pueden cubrir ese hueco (de hoy, o de mañana si es una noche que arranca tarde). */
  const candidatosRetParaHueco = (hueco: GuardRowModel): { rows: GuardRowModel[]; esManana: boolean } => {
    if (huecoUsaRetManana(hueco)) {
      return {
        esManana: true,
        rows: retenesManana
          .filter((t) => esCandidatoValido({ turno: t } as GuardRowModel, hueco))
          .map((turno): GuardRowModel => ({
            employeeName: turno.name || '—',
            turno,
            estado: 'ESPERANDO',
            realDisplay: '—',
            diffLabel: '—',
            diffTone: 'neutral',
            band: 'RET',
            fuente: '—',
            salida: '—',
          })),
      };
    }
    return {
      esManana: false,
      rows: classifiedRows.filter((r) => r.band === 'RET' && esCandidatoValido(r, hueco)),
    };
  };

  const retCandidates = useMemo((): GuardRowModel[] => {
    if (!coberturaModal) return [];
    return candidatosRetParaHueco(coberturaModal).rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coberturaModal, classifiedRows, retenesManana, retUsaManana]);

  /** Distancia, conocimiento del objetivo y orden sugerido de los RET para el hueco abierto en cobertura. */
  const retEvaluados = useMemo((): Record<string, RetenEvaluado> => {
    if (!coberturaModal) return {};
    const salida: Record<string, RetenEvaluado> = {};
    for (const c of retCandidates) {
      salida[c.turno.rowId] = evaluarRetenParaDestino(
        String(c.turno.employeeId || ''),
        empInfo[String(c.turno.employeeId || '')],
        {
          objectiveId: coberturaModal.turno.objectiveId || '',
          lat: coberturaModal.turno.objLat,
          lng: coberturaModal.turno.objLng,
          positionName: coberturaModal.turno.positionName,
        },
      );
    }
    return salida;
  }, [coberturaModal, retCandidates, empInfo]);

  const retCandidatesOrdenados = useMemo(
    (): GuardRowModel[] =>
      [...retCandidates].sort((a, b) => {
        const ea = retEvaluados[a.turno.rowId];
        const eb = retEvaluados[b.turno.rowId];
        if (!ea || !eb) return 0;
        return compararRetenesEvaluados(ea, eb, 'cercania');
      }),
    [retCandidates, retEvaluados],
  );

  /** Destinos del panel de retenes: huecos sin cubrir primero, después los objetivos con turnos hoy. */
  const destinosRetenes = useMemo((): DestinoRetenOpcion[] => {
    const lista: DestinoRetenOpcion[] = [];
    const huecos = classifiedRows
      .filter(
        (r) =>
          r.band !== 'RET' &&
          (r.estado === 'NO_LLEGO' || r.estado === 'AUSENTE') &&
          !r.coveredByName,
      )
      .sort((a, b) => rowRank(a) - rowRank(b));
    for (const r of huecos) {
      lista.push({
        key: `hueco:${r.turno.rowId}`,
        tipo: 'hueco',
        objectiveId: r.turno.objectiveId || '',
        objetivo: r.turno.obj,
        positionName: r.turno.positionName || undefined,
        lat: r.turno.objLat,
        lng: r.turno.objLng,
        etiqueta: `${r.estado === 'NO_LLEGO' ? 'No llegó' : 'Ausente'} · ${r.turno.obj} · ${r.turno.expected}–${r.salida || '—'} · ${r.employeeName}`,
      });
    }
    const vistos = new Set<string>();
    for (const r of classifiedRows) {
      if (r.band === 'RET') continue;
      const objId = r.turno.objectiveId || '';
      if (!objId || vistos.has(objId)) continue;
      vistos.add(objId);
      lista.push({
        key: `obj:${objId}`,
        tipo: 'objetivo',
        objectiveId: objId,
        objetivo: r.turno.obj,
        lat: r.turno.objLat,
        lng: r.turno.objLng,
        etiqueta: r.turno.obj,
      });
    }
    return lista.sort((a, b) =>
      a.tipo === b.tipo ? (a.tipo === 'objetivo' ? compararTexto(a.etiqueta, b.etiqueta) : 0) : a.tipo === 'hueco' ? -1 : 1,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classifiedRows]);

  /** Retenes del panel para un destino: para un hueco aplican las mismas reglas que la ventana de cobertura. */
  const candidatosRetenesPanel = (d: DestinoRetenOpcion): { rows: GuardRowModel[]; esManana: boolean } => {
    if (d.tipo === 'hueco') {
      const hueco = classifiedRows.find((r) => `hueco:${r.turno.rowId}` === d.key);
      if (!hueco) return { rows: [], esManana: false };
      const cand = candidatosRetParaHueco(hueco);
      return { esManana: cand.esManana, rows: cand.rows.filter((r) => !r.turno.coverageUsed) };
    }
    return {
      esManana: false,
      rows: classifiedRows.filter(
        (r) =>
          r.band === 'RET' &&
          !r.turno.coverageUsed &&
          r.estado !== 'CERRADO' &&
          r.estado !== 'AUSENTE' &&
          r.estado !== 'NO_LLEGO',
      ),
    };
  };

  const extCandidates = useMemo((): GuardRowModel[] => {
    if (!coberturaModal) return [];
    return classifiedRows.filter(
      (r) =>
        esCandidatoValido(r, coberturaModal) &&
        r.turno.objectiveId &&
        r.turno.objectiveId === coberturaModal.turno.objectiveId &&
        (r.band === 'M' || r.band === 'T' || r.band === 'N') &&
        (r.estado === 'ESPERANDO' || r.estado === 'PRESENTE_PLAT' || r.estado === 'PRESENTE_WA'),
    );
  }, [coberturaModal, classifiedRows]);

  /** D12 + N12: quién puede ser cada uno según la banda que falta (M, T o N). */
  const planD12N12 = useMemo((): PlanD12N12 | null => {
    if (!coberturaModal) return null;
    const banda = coberturaModal.band;
    if (banda === 'M') {
      return {
        banda: 'M',
        bandaD12: 'T',
        bandaN12: 'N',
        rolIntercambio: 'D12',
        explicacion:
          'Falta la M: el guardia de la T que elijas pasa al lugar de la M y queda D12 (06:00–18:00); el de la N pasa a N12 (18:00–06:00).',
      };
    }
    if (banda === 'T') {
      return {
        banda: 'T',
        bandaD12: 'M',
        bandaN12: 'N',
        rolIntercambio: null,
        explicacion:
          'Falta la T: el de la M extiende a D12 (06:00–18:00) y el de la N adelanta a N12 (18:00–06:00).',
      };
    }
    if (banda === 'N') {
      return {
        banda: 'N',
        bandaD12: 'M',
        bandaN12: 'T',
        rolIntercambio: 'N12',
        explicacion:
          'Falta la N: el guardia de la T que elijas pasa al lugar de la N y queda N12 (18:00–06:00); el de la M extiende a D12 (06:00–18:00).',
      };
    }
    return null;
  }, [coberturaModal]);

  const intercambioCandidates = useMemo((): GuardRowModel[] => {
    if (!coberturaModal) return [];
    return classifiedRows.filter(
      (r) =>
        esCandidatoValido(r, coberturaModal) &&
        r.band !== 'RET' &&
        (r.estado === 'ESPERANDO' || r.estado === 'PRESENTE_PLAT' || r.estado === 'PRESENTE_WA'),
    );
  }, [coberturaModal, classifiedRows]);

  const francoCandidates = useMemo((): GuardRowModel[] => {
    return francos.map((turno) => ({
      employeeName: turno.name || '—',
      turno,
      estado: 'ESPERANDO' as GuardEstado,
      realDisplay: '—',
      diffLabel: '—',
      diffTone: 'neutral' as const,
      band: 'FRANCO',
      fuente: '—' as const,
      salida: '—',
    }));
  }, [francos]);

  const handleMarcarPresente = async (row: GuardRowModel) => {
    if (busy) return;
    setBusy(true);
    try {
      await marcarPresente(
        row.turno.rowId,
        { name: row.employeeName, expected: row.turno.expected },
        nowHHMM(),
        'MANUAL',
      );
      showToast(`Presente registrado · ${row.employeeName}`, 'bg-emerald-700');
    } catch (err) {
      console.warn('[modo-rapido] marcarPresente', err);
      showToast('Error al registrar presencia', 'bg-red-600');
    } finally {
      setBusy(false);
    }
  };

  /** Comentario libre del operador sobre el turno (vacío = se quita). Se guarda en el documento del turno. */
  function guardarComentario(row: GuardRowModel, texto: string) {
    const turnoId = docIdDe(row.turno.rowId);
    const limpio = texto.trim();
    escribir(
      updateDoc(
        doc(db, 'turnos', turnoId),
        limpio
          ? {
              comentarioOps: limpio,
              comentarioOpsPor: user?.displayName || user?.email || 'Operador',
              comentarioOpsUid: user?.uid ?? null,
              comentarioOpsAt: serverTimestamp(),
            }
          : {
              comentarioOps: deleteField(),
              comentarioOpsPor: deleteField(),
              comentarioOpsUid: deleteField(),
              comentarioOpsAt: deleteField(),
            },
      ),
      'el comentario',
    );
    showToast(limpio ? `Comentario guardado · ${row.employeeName}` : `Comentario quitado · ${row.employeeName}`, 'bg-indigo-700');
  }

  /**
   * Abre la cobertura de un guardia. «No llegó» es solo un estado (puede llegar hasta T+30): pasado ese
   * tiempo es ausencia, así que si todavía no está declarada se declara por el camino oficial (va a
   * Planificación y RRHH) antes de cubrir, pidiendo confirmación una vez.
   */
  function pedirConfirmacion(datos: ConfirmacionPlanilla): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      confirmacionResolverRef.current?.(false);
      confirmacionResolverRef.current = resolve;
      setConfirmacion(datos);
    });
  }

  function resolverConfirmacion(ok: boolean) {
    const resolver = confirmacionResolverRef.current;
    confirmacionResolverRef.current = null;
    setConfirmacion(null);
    resolver?.(ok);
  }

  async function abrirCobertura(row: GuardRowModel) {
    if (busy) return;
    if (coberturaBloqueadaPorTramo(row)) return;
    if (row.estado !== 'NO_LLEGO' || row.turno.turnoStatus === 'ABSENT') {
      setCoberturaModal(row);
      return;
    }
    const ok = await pedirConfirmacion({
      titulo: 'Declarar ausencia y cubrir',
      mensaje: `${row.employeeName} no llegó pasados 30 min del inicio.\n\nPara cubrir se declara la ausencia (AA): queda en RRHH y Planificación. Podés revertirla si llega.\n\n¿Declarar la ausencia y cubrir?`,
      textoOk: 'Declarar y cubrir',
      tono: 'rojo',
    });
    if (!ok) return;
    // La ventana abre al instante: la declaración oficial corre en segundo plano (el callable puede
    // tardar por arranque en frío o red). Si falla, se cierra la ventana y se avisa el motivo. Aunque
    // todavía no haya terminado, asignar la cobertura la declara igual (es idempotente por turno).
    const turnoRowId = row.turno.rowId;
    setCoberturaModal({
      ...row,
      estado: 'AUSENTE',
      turno: { ...row.turno, turnoStatus: 'ABSENT' },
    });
    void (async () => {
      let apilado = false;
      try {
        await recordarTurno(turnoRowId);
        apilado = true;
        await registrarAusencia(turnoRowId, { name: row.employeeName });
        showToast(`Ausencia declarada · ${row.employeeName}`, 'bg-red-700');
      } catch (err) {
        if (apilado) undoRef.current.pop();
        console.warn('[modo-rapido] abrirCobertura', err);
        const detalle = (err as { message?: string })?.message || '';
        setCoberturaModal((actual) => (actual && actual.turno.rowId === turnoRowId ? null : actual));
        showToast(
          `No se pudo declarar la ausencia de ${row.employeeName}${detalle ? `: ${detalle}` : ''}`,
          'bg-red-600',
        );
      }
    })();
  }

  /**
   * Revertir ausencia: mismo criterio que el CC clásico. Se puede hasta T+60; si ya hay cobertura o
   * convocatorias en curso se pregunta qué hacer (liberar a quien cubre y vuelve el titular, o dejar la AA).
   */
  async function revertirAusencia(row: GuardRowModel) {
    if (busy) return;
    const turnoId = docIdDe(row.turno.rowId);
    try {
      const actual = (await leerTurnoRapido(turnoId)).data() || {};
      if (isRevertAbsenceExpired(actual)) {
        showToast('No se puede revertir después de T+60', 'bg-red-600');
        return;
      }
      const covSt = String(actual.coverageStatus || '').toUpperCase();
      let convocatoriaPendiente = false;
      try {
        const qs = await getDocs(
          query(collection(db, 'convocatorias_cobertura'), where('shiftId', '==', turnoId), limit(15)),
        );
        convocatoriaPendiente = qs.docs.some((d) => {
          const st = String(d.data().status || '').toUpperCase();
          return st === 'PENDING' || st === 'ESCALATED';
        });
      } catch {
        /* emulador sin índice */
      }
      const enCurso =
        !!String(actual.coverageDocId || '').trim() ||
        convocatoriaPendiente ||
        covSt === 'COVERED' ||
        covSt === 'PARTIAL' ||
        actual.operacionallyCovered === true;
      if (enCurso) {
        setRevertirChoice(row);
        return;
      }
      const okRevertir = await pedirConfirmacion({
        titulo: 'Revertir ausencia',
        mensaje: `¿Revertir la ausencia de ${row.employeeName}?`,
        textoOk: 'Revertir',
        tono: 'indigo',
      });
      if (!okRevertir) return;
      await ejecutarReversionAusencia(row, false);
    } catch (err) {
      console.warn('[modo-rapido] revertirAusencia', err);
      showToast('No se pudo revertir la ausencia', 'bg-red-600');
    }
  }

  async function ejecutarReversionAusencia(row: GuardRowModel, cancelCoverage: boolean) {
    if (busy) return;
    const turnoId = docIdDe(row.turno.rowId);
    setBusy(true);
    try {
      const antes = (await leerTurnoRapido(turnoId)).data() || {};
      const fn = httpsCallable(functions, 'revertirAusencia');
      await fn({ shiftId: turnoId, cancelCoverage });
      // Extensión hecha desde Modo Rápido (sin turno de cobertura aparte): se deshace acá.
      const candidatoExtId = String(antes.extensionCandidateTurnoId || '').trim();
      if (cancelCoverage && candidatoExtId) {
        try {
          await updateDoc(doc(db, 'turnos', candidatoExtId), {
            code: antes.extensionPrevCode ?? deleteField(),
            endTime: antes.extensionPrevEndTime ?? deleteField(),
            extensionPrevCode: deleteField(),
            extensionPrevEndTime: deleteField(),
            extensionParaTurnoId: deleteField(),
          });
          await updateDoc(doc(db, 'turnos', turnoId), {
            extensionCandidateTurnoId: deleteField(),
            operacionallyCovered: false,
            coverageStatus: deleteField(),
            coverageType: deleteField(),
            coveredAt: deleteField(),
            coveredByEmployeeId: deleteField(),
            coveredByEmployeeName: deleteField(),
          });
        } catch (err) {
          console.warn('[modo-rapido] no se pudo deshacer la extensión', err);
          showToast('Ausencia revertida, pero revisá la extensión del otro guardia', 'bg-amber-700');
          return;
        }
      }
      showToast(`Ausencia revertida · ${row.employeeName} figura presente (llegó tarde)`, 'bg-emerald-700');
    } catch (err) {
      const code = String((err as { code?: string })?.code || '');
      console.warn('[modo-rapido] ejecutarReversionAusencia', err);
      if (code.includes('deadline-exceeded')) {
        showToast('No se puede revertir después de T+60', 'bg-red-600');
      } else if (code.includes('failed-precondition')) {
        showToast('No se pudo revertir: revisá cobertura activa o convocatorias', 'bg-red-600');
      } else {
        showToast('No se pudo revertir la ausencia', 'bg-red-600');
      }
    } finally {
      setBusy(false);
    }
  }

  const handleRegistrarAusencia = async (row: GuardRowModel) => {
    if (busy) return;
    setBusy(true);
    let apilado = false;
    try {
      await recordarTurno(row.turno.rowId);
      apilado = true;
      await registrarAusencia(row.turno.rowId, { name: row.employeeName });
      showToast(`Ausencia registrada · ${row.employeeName}`, 'bg-red-700');
    } catch (err) {
      // La ausencia no se registró: no debe quedar un "deshacer" de algo que no pasó.
      if (apilado) undoRef.current.pop();
      console.warn('[modo-rapido] registrarAusencia', err);
      showToast('Error al registrar ausencia', 'bg-red-600');
    } finally {
      setBusy(false);
      setArm(null);
    }
  };

  async function recordarTurno(rowIdVirtual: string) {
    const rowId = docIdDe(rowIdVirtual);
    const snap = await leerTurnoRapido(rowId);
    const d = snap.data() || {};
    undoRef.current.push({
      rowId,
      data: {
        endTime: d.endTime ?? null,
        presenciaBloques: d.presenciaBloques ?? null,
        status: d.status ?? 'PENDING',
        realStartTime: d.realStartTime ?? null,
        checkInSource: d.checkInSource ?? null,
        checkInAt: d.checkInAt ?? null,
        isPresent: d.isPresent ?? false,
        isCompleted: d.isCompleted ?? false,
        realEndTime: d.realEndTime ?? null,
        isRetention: d.isRetention ?? false,
        absenceCode: d.absenceCode ?? null,
        isAbsent: d.isAbsent ?? false,
        absenceType: d.absenceType ?? null,
        absenceDetectedAt: d.absenceDetectedAt ?? null,
        absenceDetectedBy: d.absenceDetectedBy ?? null,
      },
    });
    if (undoRef.current.length > 8) undoRef.current.shift();
  }

  function horaSobre(base: unknown, hh: number, mm: number): Timestamp {
    const src = base && typeof (base as Timestamp).toDate === 'function' ? (base as Timestamp).toDate() : new Date();
    const d = new Date(src.getTime());
    d.setHours(hh, mm, 0, 0);
    return Timestamp.fromDate(d);
  }

  async function guardarHora(
    row: GuardRowModel,
    raw: string,
    comoRadio: boolean,
    campo: 'ingreso' | 'salida' = 'ingreso',
  ) {
    const hhmm = raw.trim();
    if (!/^\d{1,2}:\d{2}$/.test(hhmm)) {
      showToast('Hora inválida. Usá HH:MM', 'bg-red-600');
      return;
    }
    const [hh, mm] = hhmm.split(':').map(Number);
    if (hh > 23 || mm > 59) {
      showToast('Hora inválida. Usá HH:MM', 'bg-red-600');
      return;
    }
    const normal = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    if (row.estado === 'CERRADO' || campo === 'salida') {
      if (campo === 'salida' && row.estado !== 'CERRADO') {
        showToast('La salida real se corrige en un turno cerrado', 'bg-slate-700');
        setHourEdit(null);
        return;
      }
      if (busy) return;
      setBusy(true);
      try {
        await recordarTurno(row.turno.rowId);
        const base = campo === 'salida' ? row.turno.endTimeRaw : row.turno.startTimeRaw;
        const ts = horaSobre(base, hh, mm);
        const patchHora: Record<string, unknown> = { [campoHoraTurno(row.turno, campo)]: ts };
        if (campo === 'salida' && esTramoCortado(row.turno) && esUltimoTramo(row.turno)) {
          patchHora.realEndTime = ts;
        }
        escribir(updateDoc(doc(db, 'turnos', docIdDe(row.turno.rowId)), patchHora), 'el horario');
        escribir(
          addDoc(collection(db, 'novedades'), {
            type: campo === 'salida' ? 'CORRECCION_SALIDA' : 'CORRECCION_HORA',
            turnoId: docIdDe(row.turno.rowId),
            ...(esTramoCortado(row.turno) ? { bloque: row.turno.bloque ?? 1 } : {}),
            employeeName: row.employeeName,
            realTime: normal,
            empresaId,
            operatorId: user?.uid ?? 'cc-modo-rapido',
            createdAt: serverTimestamp(),
          }),
          'la novedad de corrección',
        );
        showToast(
          campo === 'salida'
            ? `Salida corregida · ${row.employeeName} ${normal}`
            : `Ingreso corregido · ${row.employeeName} ${normal}`,
          'bg-indigo-700',
        );
      } catch (err) {
        console.warn('[modo-rapido] guardarHora cerrado', err);
        showToast('Error al corregir el horario', 'bg-red-600');
      } finally {
        setBusy(false);
        setHourEdit(null);
        setArm(null);
      }
      return;
    }
    const esWa = row.estado === 'PENDIENTE_WA' || row.estado === 'PRESENTE_WA' || row.fuente === 'WA';
    if (esWa) {
      showToast('Ese turno se confirma por WhatsApp', 'bg-slate-700');
      setHourEdit(null);
      setArm(null);
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      await recordarTurno(row.turno.rowId);
      const yaPresente = row.estado === 'PRESENTE_PLAT';
      if (yaPresente && !comoRadio) {
        const today = new Date();
        today.setHours(hh, mm, 0, 0);
        escribir(
          updateDoc(doc(db, 'turnos', docIdDe(row.turno.rowId)), {
            [campoHoraTurno(row.turno, 'ingreso')]: Timestamp.fromDate(today),
          }),
          'la hora',
        );
        escribir(
          addDoc(collection(db, 'novedades'), {
            type: 'CORRECCION_HORA',
            turnoId: docIdDe(row.turno.rowId),
            ...(esTramoCortado(row.turno) ? { bloque: row.turno.bloque ?? 1 } : {}),
            employeeName: row.employeeName,
            realTime: normal,
            empresaId,
            operatorId: user?.uid ?? 'cc-modo-rapido',
            createdAt: serverTimestamp(),
          }),
          'la novedad de corrección',
        );
        showToast(`Hora corregida · ${row.employeeName} ${normal}`, 'bg-indigo-700');
      } else {
        await marcarPresente(
          row.turno.rowId,
          { name: row.employeeName, expected: row.turno.expected },
          normal,
          'MANUAL_RADIO',
        );
        showToast(`Radio · ${row.employeeName} ${normal}`, 'bg-emerald-700');
        // Carga seguida de presentes: el foco pasa al guardia siguiente, no se queda en el que se marcó.
        const idxActual = sheetRows.findIndex((r) => r.turno.rowId === row.turno.rowId);
        const siguiente = idxActual >= 0 ? sheetRows[idxActual + 1] : undefined;
        if (siguiente) {
          setActiveRowId(siguiente.turno.rowId);
          setGroupOpen((prev) => ({ ...prev, [siguiente.turno.obj || '—']: true }));
        }
      }
    } catch (err) {
      console.warn('[modo-rapido] guardarHora', err);
      showToast('Error al guardar la hora', 'bg-red-600');
    } finally {
      setBusy(false);
      setHourEdit(null);
      setArm(null);
    }
  }

  async function quitarPresencia(row: GuardRowModel) {
    if (row.fuente === 'WA' || row.estado === 'PRESENTE_WA' || row.estado === 'PENDIENTE_WA') {
      showToast('La presencia de WhatsApp queda en el puente', 'bg-slate-700');
      setArm(null);
      return;
    }
    if (row.estado !== 'PRESENTE_PLAT') {
      setArm(null);
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      await recordarTurno(row.turno.rowId);
      const refTurno = doc(db, 'turnos', docIdDe(row.turno.rowId));
      const tramoN = row.turno.bloque ?? 1;
      if (esTramoCortado(row.turno) && tramoN > 1) {
        const snapTurno = await leerTurnoRapido(docIdDe(row.turno.rowId));
        const dataTurno = (snapTurno.data() || {}) as Record<string, unknown>;
        const pbPrevio = (dataTurno.presenciaBloques || {}) as Record<string, PresenciaBloque | undefined>;
        const primerTramoAbierto = !!dataTurno.realStartTime && pbPrevio.b1?.cerrado !== true;
        escribir(
          updateDoc(refTurno, {
            [`presenciaBloques.b${tramoN}`]: deleteField(),
            isPresent: false,
            ...(primerTramoAbierto ? {} : { status: 'PENDING' }),
          }),
          'la presencia',
        );
      } else {
        escribir(
          updateDoc(refTurno, {
            status: 'PENDING',
            isPresent: false,
          }),
          'la presencia',
        );
      }
      escribir(
        addDoc(collection(db, 'novedades'), {
          type: 'PRESENCIA_REVERTIDA',
          turnoId: docIdDe(row.turno.rowId),
          employeeName: row.employeeName,
          empresaId,
          operatorId: user?.uid ?? 'cc-modo-rapido',
          createdAt: serverTimestamp(),
        }),
        'la novedad',
      );
      showToast(`Presencia quitada · ${row.employeeName}`, 'bg-slate-700');
    } catch {
      showToast('Error al quitar la presencia', 'bg-red-600');
    } finally {
      setBusy(false);
      setArm(null);
    }
  }

  async function deshacer() {
    const last = undoRef.current.pop();
    if (!last) {
      showToast('Nada para deshacer', 'bg-slate-700');
      return;
    }
    if (busy) {
      undoRef.current.push(last);
      return;
    }
    setBusy(true);
    try {
      // Si se deshace una ausencia, el registro de RRHH que creó el servidor se anula (igual que
      // «Revertir ausencia» del CC clásico) y se avisa si había convocatorias abiertas.
      let avisoAusencia = '';
      if (last.data.isAbsent !== true) {
        const actual = (await leerTurnoRapido(last.rowId)).data() || {};
        if (actual.isAbsent === true) {
          const aus = await getDocs(query(collection(db, 'ausencias'), where('shiftId', '==', last.rowId), limit(10)));
          for (const a of aus.docs) {
            if (String(a.data().status || '') === 'Anulada') continue;
            escribir(
              updateDoc(a.ref, { status: 'Anulada', anuladaAt: serverTimestamp() }),
              'la anulación de la ausencia',
            );
          }
          if (actual.absenceVacancyOpenedAt) {
            avisoAusencia = ' · revisá las convocatorias abiertas en Operaciones';
          }
        }
      }
      escribir(updateDoc(doc(db, 'turnos', last.rowId), last.data), 'el deshacer');
      showToast(`Corrección deshecha${avisoAusencia}`, 'bg-slate-700');
    } catch {
      undoRef.current.push(last);
      showToast('No se pudo deshacer', 'bg-red-600');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Cobertura de un turno cortado: se cubre el turno completo (los dos tramos) con un solo reemplazo,
   * que hereda los mismos tramos. Solo si ningún tramo ya fichó: la cobertura de un solo tramo (el otro
   * ya se trabajó) la sigue haciendo Operaciones, porque el motor oficial no parte la cobertura por tramo.
   */
  function coberturaBloqueadaPorTramo(row: GuardRowModel): boolean {
    if (!esTramoCortado(row.turno)) return false;
    const docId = docIdDe(row.turno.rowId);
    const hermanos = classifiedRows.filter((r) => docIdDe(r.turno.rowId) === docId);
    const algunoTrabajo = hermanos.some(
      (r) => r.estado === 'PRESENTE_PLAT' || r.estado === 'PRESENTE_WA' || r.estado === 'CERRADO',
    );
    if (!algunoTrabajo) return false;
    showToast(
      'Turno cortado con un tramo ya trabajado: la cobertura de un solo tramo se hace desde Operaciones por ahora',
      'bg-slate-700',
    );
    return true;
  }

  function pedirRetiro(row: GuardRowModel) {
    if (row.estado !== 'PRESENTE_PLAT' && row.estado !== 'PRESENTE_WA') {
      showToast('El retiro anticipado es de un guardia que ya está presente', 'bg-slate-700');
      return;
    }
    setHourEdit(null);
    setSwapFromId(null);
    setArm(null);
    setActiveRowId(row.turno.rowId);
    setRetiroMotivo('ENFERMEDAD');
    setRetiroReemplazo(null);
    setRetiroModal(row);
  }

  /** Fin planificado del retiro: en turno cortado, hasta el último tramo del mismo documento. */
  function finPlanificadoRetiroMs(row: GuardRowModel): number {
    let finMs = toStartMs(row.turno.endTimeRaw);
    if (!esTramoCortado(row.turno)) return finMs;
    const id = docIdDe(row.turno.rowId);
    for (const r of classifiedRows) {
      if (docIdDe(r.turno.rowId) !== id) continue;
      const e = toStartMs(r.turno.endTimeRaw);
      if (!Number.isNaN(e) && (Number.isNaN(finMs) || e > finMs)) finMs = e;
    }
    return finMs;
  }

  /** Datos del retiro que se está pidiendo: horas que faltan, compañeros y política de reemplazo. */
  const retiroInfo = useMemo(() => {
    if (!retiroModal) return null;
    const finMs = finPlanificadoRetiroMs(retiroModal);
    const hoursLeft = Number.isNaN(finMs) ? 0 : hoursRemainingUntilEnd(nowMs, finMs);
    const obj = retiroModal.turno.objectiveId;
    const colleagues = classifiedRows.filter(
      (r) =>
        !!obj &&
        r.turno.objectiveId === obj &&
        docIdDe(r.turno.rowId) !== docIdDe(retiroModal.turno.rowId) &&
        (r.estado === 'PRESENTE_PLAT' || r.estado === 'PRESENTE_WA'),
    ).length;
    const policy = resolveEarlyWithdrawReplacePolicy({
      hoursLeft,
      colleaguesPresent: colleagues,
      reemplazarRetiro2a3h: null,
      isAutoMode: false,
      operatorReplaceChoice: retiroReemplazo,
    });
    return { hoursLeft, colleagues, policy, finMs };
  }, [retiroModal, classifiedRows, nowMs, retiroReemplazo]);

  async function retirarTurno(row: GuardRowModel, motivo: MotivoRetiro, operatorReplaceChoice: boolean | null) {
    if (busy) return;
    if (row.estado !== 'PRESENTE_PLAT' && row.estado !== 'PRESENTE_WA') return;
    setBusy(true);
    try {
      const finPlanificadoMs = finPlanificadoRetiroMs(row);
      const retiroMs = Date.now();
      const fn = httpsCallable(functions, 'processEarlyWithdrawalCallable');
      const res = await fn({
        shiftId: docIdDe(row.turno.rowId),
        bloque: row.turno.bloque ?? 1,
        reason: motivo,
        operatorReplaceChoice,
      });
      const data = (res.data || {}) as { needsOperatorChoice?: boolean; remainderShiftId?: string };
      if (data.needsOperatorChoice) {
        showToast('Quedan entre 2 y 3 h: elegí si se reemplaza el resto (S o N).', 'bg-amber-700');
        return;
      }
      const etiqueta = MOTIVOS_RETIRO.find((m) => m.id === motivo)?.label.toLowerCase() || motivo.toLowerCase();
      setRetiroModal(null);
      if (data.remainderShiftId && !Number.isNaN(finPlanificadoMs) && finPlanificadoMs > retiroMs) {
        // Resto del turno sin cubrir: se abre la búsqueda de reemplazo (RET, franco trabajado).
        const desdeTs = Timestamp.fromMillis(retiroMs);
        const hastaTs = Timestamp.fromMillis(finPlanificadoMs);
        setHuecoRetiro({ docId: row.turno.rowId, desdeMs: retiroMs, hastaMs: finPlanificadoMs });
        setCoberturaModal({
          ...row,
          estado: 'AUSENTE',
          salida: formatHHMM(hastaTs),
          turno: { ...row.turno, startTimeRaw: desdeTs, endTimeRaw: hastaTs },
        });
        showToast(`Retiro por ${etiqueta} · ${row.employeeName}. Elegí quién cubre el resto.`, 'bg-purple-700');
      } else {
        showToast(`Retiro por ${etiqueta} · ${row.employeeName}`, 'bg-purple-700');
      }
      setArm(null);
    } catch (err) {
      const code = String((err as { code?: string })?.code || '');
      const raw = String((err as { message?: string })?.message || '');
      const msg = code === 'functions/not-found' || code === 'functions/unavailable'
        ? 'El emulador no tiene el retiro anticipado. No se escribió el turno.'
        : raw.replace(/^FirebaseError:\s*/i, '') || 'No se pudo registrar el retiro';
      console.warn('[modo-rapido] retiro', err);
      showToast(msg, 'bg-red-600');
      setArm(null);
    } finally {
      setBusy(false);
    }
  }

  function pedirCierre(row: GuardRowModel) {
    if (row.estado !== 'PRESENTE_PLAT' && row.estado !== 'PRESENTE_WA') {
      showToast('Primero tiene que estar presente', 'bg-slate-700');
      return;
    }
    if (arm?.kind === 'cerrar' && arm.rowId === row.turno.rowId) {
      void cerrarTurno(row);
      return;
    }
    setHourEdit(null);
    setSwapFromId(null);
    setActiveRowId(row.turno.rowId);
    setArm({ kind: 'cerrar', rowId: row.turno.rowId });
  }

  async function cerrarTurno(
    row: GuardRowModel,
    opts?: { auto?: boolean; finMs?: number; ubicacion?: { lat: number; lng: number; distM?: number } },
  ): Promise<boolean> {
    const auto = opts?.auto === true;
    if (!auto && busy) return false;
    if (row.estado !== 'PRESENTE_PLAT' && row.estado !== 'PRESENTE_WA') return false;
    if (!auto) setBusy(true);
    try {
      await recordarTurno(row.turno.rowId);
      const refTurno = doc(db, 'turnos', docIdDe(row.turno.rowId));
      const snap = await leerTurnoRapido(docIdDe(row.turno.rowId));
      const data = (snap.data() || {}) as Record<string, unknown>;
      const cortado = esTramoCortado(row.turno);
      const tramoN = row.turno.bloque ?? 1;
      const ultimoTramo = esUltimoTramo(row.turno);
      let dataCierre = data;
      if (cortado) {
        const pbData = (data.presenciaBloques || {}) as Record<string, PresenciaBloque | undefined>;
        dataCierre = {
          ...data,
          startTime: row.turno.startTimeRaw,
          endTime: row.turno.endTimeRaw,
          realStartTime: tramoN === 1 ? data.realStartTime : pbData[`b${tramoN}`]?.realStartTime,
        };
      }
      const close = computeShiftCloseTimes(dataCierre, opts?.finMs ?? Date.now());
      const realEndTime = Timestamp.fromMillis(close.realEndMs);
      const patch: Record<string, unknown> = {};
      if (cortado) {
        patch[`presenciaBloques.b${tramoN}.realEndTime`] = realEndTime;
        patch[`presenciaBloques.b${tramoN}.cerrado`] = true;
        patch.isPresent = false;
        if (ultimoTramo) {
          patch.status = 'COMPLETED';
          patch.isCompleted = true;
          patch.realEndTime = realEndTime;
        } else {
          // Corte entre tramos: el turno sigue vivo, pero deja de figurar presente para que el
          // cierre automático del servidor no lo complete en el corte.
          patch.status = 'PENDING';
        }
      } else {
        patch.status = 'COMPLETED';
        patch.isCompleted = true;
        patch.isPresent = false;
        patch.realEndTime = realEndTime;
      }
      if (data.isRetention === true && (!cortado || ultimoTramo)) {
        patch.isRetention = false;
        patch.retentionEndedAt = realEndTime;
        if (close.retentionMinutes != null) patch.retentionMinutes = close.retentionMinutes;
      }
      if (opts?.ubicacion) {
        // La salida avisada por WhatsApp guarda dónde estaba el guardia, igual que el ingreso (checkInCoords).
        patch.checkOutSource = 'WA';
        patch.checkOutCoords = { lat: opts.ubicacion.lat, lng: opts.ubicacion.lng };
        if (opts.ubicacion.distM != null) patch.checkOutDistanceM = opts.ubicacion.distM;
      }
      escribir(updateDoc(refTurno, patch), 'el cierre');
      escribir(
        addDoc(collection(db, 'novedades'), {
          type: 'CHECKOUT',
          turnoId: docIdDe(row.turno.rowId),
          ...(cortado ? { bloque: tramoN } : {}),
          employeeName: row.employeeName,
          realTime: formatHHMM(realEndTime),
          empresaId,
          operatorId: user?.uid ?? 'cc-modo-rapido',
          createdAt: serverTimestamp(),
        }),
        'la novedad de cierre',
      );
      showToast(
        auto
          ? `Salida automática por WA · ${row.employeeName} ${formatHHMM(realEndTime)}`
          : `Turno cerrado · ${row.employeeName} ${formatHHMM(realEndTime)}`,
        auto ? 'bg-emerald-700' : 'bg-slate-800',
      );
      return true;
    } catch (err) {
      console.warn('[modo-rapido] cerrarTurno', err);
      showToast('Error al cerrar el turno', 'bg-red-600');
      return false;
    } finally {
      if (!auto) {
        setBusy(false);
        setArm(null);
      }
    }
  }

  /**
   * Reabrir un turno cerrado (cierre hecho sin querer): vuelve a presente, se quita el egreso real y,
   * si el cierre había terminado una retención, la retención vuelve a estar en curso.
   */
  async function reabrirTurno(row: GuardRowModel) {
    if (busy) return;
    if (row.estado !== 'CERRADO') return;
    setBusy(true);
    try {
      await recordarTurno(row.turno.rowId);
      const docId = docIdDe(row.turno.rowId);
      const data = ((await leerTurnoRapido(docId)).data() || {}) as Record<string, unknown>;
      const cortado = esTramoCortado(row.turno);
      const tramoN = row.turno.bloque ?? 1;
      const ultimoTramo = esUltimoTramo(row.turno);
      const patch: Record<string, unknown> = {
        status: 'PRESENT',
        isPresent: true,
        isCompleted: false,
      };
      if (cortado) {
        patch[`presenciaBloques.b${tramoN}.cerrado`] = false;
        patch[`presenciaBloques.b${tramoN}.realEndTime`] = deleteField();
        if (ultimoTramo) patch.realEndTime = deleteField();
      } else {
        patch.realEndTime = deleteField();
      }
      if (data.retentionEndedAt && (!cortado || ultimoTramo)) {
        patch.isRetention = true;
        patch.retentionEndedAt = deleteField();
        patch.retentionMinutes = deleteField();
      }
      escribir(updateDoc(doc(db, 'turnos', docId), patch), 'la reapertura');
      escribir(
        addDoc(collection(db, 'novedades'), {
          type: 'REAPERTURA_TURNO',
          turnoId: docId,
          ...(cortado ? { bloque: tramoN } : {}),
          employeeName: row.employeeName,
          empresaId,
          operatorId: user?.uid ?? 'cc-modo-rapido',
          createdAt: serverTimestamp(),
        }),
        'la novedad de reapertura',
      );
      showToast(`Turno reabierto · ${row.employeeName}`, 'bg-indigo-700');
    } catch (err) {
      console.warn('[modo-rapido] reabrirTurno', err);
      showToast('No se pudo reabrir el turno', 'bg-red-600');
    } finally {
      setBusy(false);
    }
  }

  const handleAsignarRet = async (
    candidate: GuardRowModel,
    opciones?: { hueco?: GuardRowModel; mensaje?: 'asignacion' | 'consulta' | 'ninguno' },
  ) => {
    const hueco = opciones?.hueco ?? coberturaModal;
    // Desde la ventana de cobertura puede haber un retiro anticipado; asignando desde el panel de retenes no.
    const retiro = opciones?.hueco ? null : huecoRetiro;
    if (!hueco || busy) return;
    setBusy(true);
    try {
      if (retiro) {
        // Retiro anticipado: el turno del que se retira queda cerrado con sus horas trabajadas y el
        // resto lo cubre un turno nuevo del RET (desde el retiro hasta el fin planificado).
        const origenSnap = await leerTurnoRapido(retiro.docId);
        const origen = (origenSnap.data() || {}) as Record<string, unknown>;
        const copiar: Record<string, unknown> = {};
        for (const campo of [
          'empresaId',
          'objectiveId',
          'objectiveName',
          'positionName',
          'clientId',
          'clientName',
          'code',
          'scheduleDate',
          'type',
        ]) {
          if (origen[campo] !== undefined) copiar[campo] = origen[campo];
        }
        const horasResto = Math.round(((retiro.hastaMs - retiro.desdeMs) / 3600000) * 100) / 100;
        const nuevoRef = await addDoc(collection(db, 'turnos'), {
          ...copiar,
          employeeId: candidate.turno.employeeId,
          employeeName: candidate.employeeName,
          startTime: Timestamp.fromMillis(retiro.desdeMs),
          endTime: Timestamp.fromMillis(retiro.hastaMs),
          hours: horasResto,
          status: 'PENDING',
          draft: false,
          origin: 'RET_COBERTURA',
          resolvedBy: 'OPERACIONES',
          coberturaDesdeTurnoId: candidate.turno.rowId,
          remanenteDeTurnoId: retiro.docId,
          createdAt: serverTimestamp(),
        });
        await updateDoc(doc(db, 'turnos', candidate.turno.rowId), {
          coverageAssignedTo: nuevoRef.id,
        });
        await addDoc(collection(db, 'novedades'), {
          type: 'COBERTURA_RET',
          turnoAusenteId: retiro.docId,
          turnoAusenteEmpleado: hueco.employeeName,
          turnoAusenteObj: hueco.turno.obj,
          retEmpleado: candidate.employeeName,
          motivo: 'RETIRO_ANTICIPADO',
          empresaId,
          operatorId: user?.uid ?? 'cc-modo-rapido',
          createdAt: serverTimestamp(),
        });
        const avisoResto = abrirWa(
          candidate.turno.phone,
          waMensaje.cobertura(
            candidate.employeeName,
            hueco.turno.obj,
            formatHHMM(Timestamp.fromMillis(retiro.desdeMs)),
            hueco.salida || '—',
          ),
        );
        showToast(
          avisoResto
            ? `RET asignado al resto del turno · WhatsApp abierto · ${candidate.employeeName}`
            : `RET asignado al resto del turno · ${candidate.employeeName}. Sin teléfono para WhatsApp.`,
          avisoResto ? 'bg-violet-700' : 'bg-amber-700',
        );
        return;
      }
      // Motor oficial (el mismo del CC clásico): turno de cobertura aparte vinculado al ausente, el
      // RET queda como origen usado y la ausencia de RRHH como gestionada. Así se puede revertir.
      const titularId = docIdDe(hueco.turno.rowId);
      const batchRet = writeBatch(db);
      const coverDocId = await applyCoverage(db, batchRet, {
        titularShiftId: titularId,
        candidateEmployeeId: String(candidate.turno.employeeId || ''),
        candidateEmployeeName: candidate.employeeName,
        sourceShiftId: docIdDe(candidate.turno.rowId),
        coverageType: 'RET',
        resolvedBy: 'OPERACIONES',
        empresaId,
      });
      await heredarTramosEnCobertura(batchRet, titularId, coverDocId);
      await syncAusenciaCoberturaGestionada(
        db,
        {
          shiftId: titularId,
          coveredByEmployeeId: candidate.turno.employeeId ?? null,
          coveredByEmployeeName: candidate.employeeName,
          coverageType: 'RET',
          empresaId,
          resolvedBy: 'OPERACIONES',
        },
        batchRet,
      );
      await batchRet.commit();
      await addDoc(collection(db, 'novedades'), {
        type: 'CONVOCATORIA_COBERTURA',
        title: 'Cobertura RET',
        status: 'pending',
        employeeId: candidate.turno.employeeId ?? null,
        employeeName: candidate.employeeName,
        objectiveId: hueco.turno.objectiveId ?? null,
        objectiveName: hueco.turno.obj,
        shiftId: coverDocId,
        description: `${candidate.employeeName} (RET) cubre ${hueco.turno.expected}–${hueco.salida || '—'} en ${hueco.turno.obj} (titular: ${hueco.employeeName})`,
        empresaId,
        createdAt: serverTimestamp(),
        reportedBy: 'OPERACIONES',
        operatorId: user?.uid ?? 'cc-modo-rapido',
      });
      const textoAsignacion =
        opciones?.mensaje === 'asignacion'
          ? waMensaje.asignacionRet(
              candidate.employeeName,
              hueco.turno.obj,
              hueco.turno.positionName || '',
              hueco.turno.expected,
              hueco.salida || '—',
              hueco.employeeName,
            )
          : waMensaje.cobertura(
              candidate.employeeName,
              hueco.turno.obj,
              hueco.turno.expected,
              hueco.salida || '—',
            );
      if (opciones?.mensaje === 'ninguno') {
        // Ya confirmó que puede ir: se asigna sin mandarle otro mensaje.
        showToast(`RET asignado · ${candidate.employeeName}`, 'bg-violet-700');
        return;
      }
      const aviso = abrirWa(candidate.turno.phone, textoAsignacion);
      // Desde el panel de retenes el mensaje de asignación sale por los dos canales: WhatsApp y app del guardia.
      const porApp =
        opciones?.mensaje === 'asignacion'
          ? (await enviarAppRetenes([{ item: retenItemDe(candidate), texto: textoAsignacion }])).enviados > 0
          : false;
      showToast(
        aviso
          ? `RET asignado · WhatsApp abierto${porApp ? ' y aviso por la app' : ''} · ${candidate.employeeName}`
          : `RET asignado · ${candidate.employeeName}.${porApp ? ' Avisado por la app; sin teléfono para WhatsApp.' : ' Sin teléfono para WhatsApp.'}`,
        aviso || porApp ? 'bg-violet-700' : 'bg-amber-700',
      );
    } catch (err) {
      console.warn('[modo-rapido] asignar RET', err);
      showToast(
        err instanceof CoverageApplyError ? err.message : 'Error al asignar RET',
        'bg-red-600',
      );
    } finally {
      setBusy(false);
      setCoberturaModal(null);
    }
  };

  /** Un RET como ítem del modal de retenes. Con destino, objetivo y horario son los del destino (para armar el mensaje). */
  function retenItemModal(ret: GuardRowModel, dia: 'hoy' | 'manana', destino?: DestinoRetenOpcion): RetenItem {
    const hueco =
      destino?.tipo === 'hueco'
        ? classifiedRows.find((r) => `hueco:${r.turno.rowId}` === destino.key)
        : undefined;
    return {
      rowId: ret.turno.rowId,
      employeeId: String(ret.turno.employeeId || ''),
      nombre: ret.employeeName,
      phone: ret.turno.phone,
      objetivo: destino ? destino.objetivo : ret.turno.obj,
      horario: hueco
        ? `${hueco.turno.expected}–${hueco.salida || '—'}`
        : ret.turno.shift.replace(/^RET\s*/i, '') || ret.turno.expected,
      estadoLabel: dia === 'manana' ? 'PROGRAMADO' : estadoPill(ret.estado).label,
      estadoTono: dia === 'manana' ? 'neutro' : retenTonoDe(ret.estado),
      dia,
      estadoRaw: dia === 'manana' ? undefined : ret.estado,
    };
  }

  /** Retenes para un destino del modal (los mismos que el panel: de hoy, o de mañana si el hueco es una noche tardía). */
  const candidatosModalRetenes = (d: DestinoRetenOpcion): RetenesParaDestino => {
    const cand = candidatosRetenesPanel(d);
    const dia = cand.esManana ? 'manana' : 'hoy';
    return { esManana: cand.esManana, items: cand.rows.map((r) => retenItemModal(r, dia, d)) };
  };

  /** El modal trabaja con ítems; acá se vuelve al turno real para asignar con el motor de cobertura. */
  function asignarRetDesdeModal(item: RetenItem, destino: DestinoRetenOpcion, avisar: boolean) {
    const ret = candidatosRetenesPanel(destino).rows.find((r) => r.turno.rowId === item.rowId);
    if (!ret) {
      showToast('El retén ya no está disponible para este hueco', 'bg-amber-700');
      return;
    }
    void asignarRetDesdePanel(ret, destino, avisar);
  }

  function marcarPresenteDesdeItem(item: RetenItem) {
    const row = classifiedRows.find((r) => r.turno.rowId === item.rowId);
    if (row) void handleMarcarPresente(row);
  }

  function confirmarWADesdeItem(item: RetenItem) {
    const row = classifiedRows.find((r) => r.turno.rowId === item.rowId);
    if (row) void handleConfirmarWA(row);
  }

  /**
   * Asigna el RET elegido a un hueco sin cubrir y le manda el mensaje de asignación.
   * Usa el mismo motor que la ventana de cobertura (`handleAsignarRet`). Si el guardia todavía no está
   * declarado ausente (no llegó pasados 30 min) se declara antes, igual que al abrir la cobertura.
   */
  async function asignarRetDesdePanel(ret: GuardRowModel, destino: DestinoRetenOpcion, avisar = true) {
    if (busy || destino.tipo !== 'hueco') return;
    const hueco = classifiedRows.find((r) => `hueco:${r.turno.rowId}` === destino.key);
    if (!hueco) {
      showToast('El hueco ya no está disponible: se cubrió o cambió de estado', 'bg-amber-700');
      return;
    }
    if (coberturaBloqueadaPorTramo(hueco)) return;
    const declarar = hueco.estado === 'NO_LLEGO' && hueco.turno.turnoStatus !== 'ABSENT';
    const ok = await pedirConfirmacion({
      titulo: declarar ? 'Declarar ausencia y asignar retén' : 'Asignar retén',
      mensaje: `${ret.employeeName} (RET) cubre a ${hueco.employeeName} en ${hueco.turno.obj} de ${hueco.turno.expected} a ${hueco.salida || '—'}.${
        declarar
          ? `\n\n${hueco.employeeName} no llegó pasados 30 min: se declara la ausencia (AA), queda en RRHH y Planificación.`
          : ''
      }\n\n${avisar ? 'Se abre WhatsApp con el mensaje de asignación y se avisa por la app del guardia.' : 'No se le manda ningún mensaje.'} ¿Confirmás?`,
      textoOk: declarar ? 'Declarar y asignar' : avisar ? 'Asignar y avisar' : 'Asignar',
      tono: declarar ? 'rojo' : 'indigo',
    });
    if (!ok) return;
    if (declarar) {
      let apilado = false;
      try {
        await recordarTurno(hueco.turno.rowId);
        apilado = true;
        await registrarAusencia(hueco.turno.rowId, { name: hueco.employeeName });
      } catch (err) {
        if (apilado) undoRef.current.pop();
        console.warn('[modo-rapido] asignarRetDesdePanel', err);
        const detalle = (err as { message?: string })?.message || '';
        showToast(
          `No se pudo declarar la ausencia de ${hueco.employeeName}${detalle ? `: ${detalle}` : ''}`,
          'bg-red-600',
        );
        return;
      }
    }
    await handleAsignarRet(ret, {
      hueco: declarar ? { ...hueco, estado: 'AUSENTE', turno: { ...hueco.turno, turnoStatus: 'ABSENT' } } : hueco,
      mensaje: avisar ? 'asignacion' : 'ninguno',
    });
  }

  /** Datos mínimos de un RET para enviarle un aviso por la app (mismo formato que el modal de retenes). */
  function retenItemDe(ret: GuardRowModel): RetenItem {
    return {
      rowId: ret.turno.rowId,
      employeeId: String(ret.turno.employeeId || ''),
      nombre: ret.employeeName,
      phone: ret.turno.phone,
      objetivo: ret.turno.obj,
      horario: ret.turno.shift.replace(/^RET\s*/i, '') || ret.turno.expected,
      estadoLabel: 'RET',
      estadoTono: 'neutro',
      dia: 'hoy',
    };
  }

  /**
   * D12 + N12 en una sola vez. Si falta la T: el de la M extiende hasta las 18:00 (D12) y el de la N adelanta
   * su ingreso a las 18:00 (N12). Si falta la M o la N: primero un guardia de la T se intercambia al lugar del
   * ausente (la ausencia pasa al turno de la T, que queda como hueco) y después se aplica lo mismo. Todo por el
   * motor oficial (EXTEND + ADVANCE), en un solo lote, para que se pueda revertir como en el CC clásico.
   */
  const handleD12N12 = async (d12: GuardRowModel, n12: GuardRowModel) => {
    if (!coberturaModal || busy || !planD12N12) return;
    setBusy(true);
    try {
      const aRowId = coberturaModal.turno.rowId;
      const aId = docIdDe(aRowId);
      const guardiaIntercambio =
        planD12N12.rolIntercambio === 'D12' ? d12 : planD12N12.rolIntercambio === 'N12' ? n12 : null;
      const nombreCorto = (n: string): string => n.split(',')[0] || n;
      const fmt = (ms: number): string => formatHHMM(Timestamp.fromMillis(ms));
      const estaAusente = (d: Record<string, unknown>): boolean =>
        d.isAbsent === true || String(d.status || '').toUpperCase() === 'ABSENT';

      // Estado real del turno del ausente (servidor): la declaración de la ausencia puede estar en curso.
      let aData = ((await getDoc(doc(db, 'turnos', aId))).data() || {}) as Record<string, unknown>;
      if (!estaAusente(aData)) {
        await registrarAusencia(aRowId, { name: coberturaModal.employeeName });
        aData = ((await getDoc(doc(db, 'turnos', aId))).data() || {}) as Record<string, unknown>;
      }

      const batch = writeBatch(db);
      let titularId = aId;
      let titular: Record<string, unknown> = { id: aId, ...aData };
      let fuenteD12 = docIdDe(d12.turno.rowId);
      let fuenteN12 = docIdDe(n12.turno.rowId);

      if (guardiaIntercambio) {
        const pId = docIdDe(guardiaIntercambio.turno.rowId);
        const pData = ((await getDoc(doc(db, 'turnos', pId))).data() || null) as Record<string, unknown> | null;
        if (!pData) throw new CoverageApplyError('NOT_FOUND', 'No se encontró el turno del guardia a intercambiar');
        const ausenteId = String(aData.employeeId || coberturaModal.turno.employeeId || '');
        const ausenteNombre = String(aData.employeeName || coberturaModal.employeeName);
        const guardiaId = String(pData.employeeId || guardiaIntercambio.turno.employeeId || '');

        // El guardia de la T pasa al lugar del ausente, limpio de toda marca de ausencia.
        batch.update(doc(db, 'turnos', aId), {
          employeeId: guardiaId,
          employeeName: guardiaIntercambio.employeeName,
          status: 'PENDING',
          isAbsent: false,
          absenceType: null,
          absenceDetectedAt: null,
          absenceDetectedBy: null,
          absenceCode: null,
          origin: 'INTERCAMBIO',
          intercambioConTurnoId: pId,
          ausenteOriginalEmployeeId: ausenteId || null,
          ausenteOriginalEmployeeName: ausenteNombre || null,
        });
        // El ausente queda en el turno de la T (el hueco), ya como ausente: sin cascada ni retención duplicadas.
        batch.update(doc(db, 'turnos', pId), {
          employeeId: ausenteId,
          employeeName: ausenteNombre,
          origin: 'INTERCAMBIO',
          intercambioConTurnoId: aId,
          status: 'ABSENT',
          isAbsent: true,
          absenceType: String(aData.absenceType || 'AA'),
          absenceDetectedAt: aData.absenceDetectedAt ?? serverTimestamp(),
          absenceDetectedBy: String(aData.absenceDetectedBy || 'MANUAL_OPS'),
          absenceCascadeSkip: true,
          ...(aData.absenceCode ? { absenceCode: aData.absenceCode } : {}),
        });
        // El registro de RRHH sigue siendo uno solo: ahora apunta al turno de la T.
        const ausenciasSnap = await getDocs(
          query(collection(db, 'ausencias'), where('shiftId', '==', aId), limit(5)),
        );
        ausenciasSnap.docs.forEach((d) => {
          batch.update(d.ref, { shiftId: pId, shiftCode: String(pData.code || '').toUpperCase() || null });
        });

        titularId = pId;
        titular = {
          ...pData,
          id: pId,
          employeeId: ausenteId,
          employeeName: ausenteNombre,
          status: 'ABSENT',
          isAbsent: true,
          absenceType: String(aData.absenceType || 'AA'),
        };
        // El guardia intercambiado trabaja ahora sobre el turno que era del ausente.
        if (planD12N12.rolIntercambio === 'D12') fuenteD12 = aId;
        else fuenteN12 = aId;
      }

      const gapDesde = msDeTimestamp(titular.startTime);
      const gapHasta = msDeTimestamp(titular.endTime);
      if (!gapDesde || !gapHasta || gapHasta <= gapDesde) {
        throw new CoverageApplyError('INVALID', 'No se conoce el horario del hueco a cubrir');
      }
      const corte18 = arHmOnYmdMs(arYmd(gapDesde), 18, 0);
      const corte = corte18 > gapDesde && corte18 < gapHasta ? corte18 : gapDesde + Math.floor((gapHasta - gapDesde) / 2);

      const datosFuente = async (id: string): Promise<{ desde: number; hasta: number }> => {
        const data = id === aId ? aData : (((await getDoc(doc(db, 'turnos', id))).data() || {}) as Record<string, unknown>);
        return { desde: msDeTimestamp(data.startTime), hasta: msDeTimestamp(data.endTime) };
      };
      const tolMs = 60000;
      const horaD12 = await datosFuente(fuenteD12);
      if (!horaD12.hasta || Math.abs(horaD12.hasta - gapDesde) > tolMs) {
        throw new CoverageApplyError(
          'INVALID',
          `El turno de ${nombreCorto(d12.employeeName)} (${fmt(horaD12.desde)}–${fmt(horaD12.hasta)}) no empalma con el hueco ${fmt(gapDesde)}–${fmt(gapHasta)}`,
        );
      }
      const horaN12 = await datosFuente(fuenteN12);
      if (!horaN12.desde || Math.abs(horaN12.desde - gapHasta) > tolMs) {
        throw new CoverageApplyError(
          'INVALID',
          `El turno de ${nombreCorto(n12.employeeName)} (${fmt(horaN12.desde)}–${fmt(horaN12.hasta)}) no empalma con el hueco ${fmt(gapDesde)}–${fmt(gapHasta)}`,
        );
      }
      const tope = 12 * 3600000 + 59 * 60000;
      if (corte - horaD12.desde > tope || horaN12.hasta - corte > tope) {
        throw new CoverageApplyError('INVALID', 'Alguno de los dos pasaría de 12:59 h de jornada');
      }

      const etiquetaTitular = `${nombreCorto(d12.employeeName)} D12 ${fmt(horaD12.desde)}–${fmt(corte)} + ${nombreCorto(n12.employeeName)} N12 ${fmt(corte)}–${fmt(horaN12.hasta)}`;
      const corteTs = Timestamp.fromMillis(corte);
      await applyCoverage(db, batch, {
        titularShiftId: titularId,
        titularShift: titular,
        candidateEmployeeId: String(d12.turno.employeeId || ''),
        candidateEmployeeName: d12.employeeName,
        sourceShiftId: fuenteD12,
        coverageType: 'EXTEND',
        resolvedBy: 'OPERACIONES',
        empresaId,
        covSegmentStart: Timestamp.fromMillis(gapDesde),
        covSegmentEnd: corteTs,
        extensionEndTime: corteTs,
        titularCloseMode: 'PARTIAL',
      });
      await applyCoverage(db, batch, {
        titularShiftId: titularId,
        titularShift: titular,
        candidateEmployeeId: String(n12.turno.employeeId || ''),
        candidateEmployeeName: n12.employeeName,
        sourceShiftId: fuenteN12,
        coverageType: 'ADVANCE',
        resolvedBy: 'OPERACIONES',
        empresaId,
        covSegmentStart: corteTs,
        covSegmentEnd: Timestamp.fromMillis(gapHasta),
        adjustedStartTime: corteTs,
        titularCloseMode: 'FULL',
        coveredByLabel: etiquetaTitular,
      });
      // El registro de RRHH se busca por el turno original del ausente (antes de moverlo al turno de la T).
      await syncAusenciaCoberturaGestionada(
        db,
        {
          shiftId: aId,
          coveredByEmployeeId: d12.turno.employeeId ?? null,
          coveredByEmployeeName: etiquetaTitular,
          coverageType: 'RETENCION',
          empresaId,
          resolvedBy: 'OPERACIONES',
        },
        batch,
      );
      await batch.commit();

      await addDoc(collection(db, 'novedades'), {
        type: 'COBERTURA_ASIGNADA',
        title: 'Cobertura D12 + N12',
        status: 'pending',
        employeeId: d12.turno.employeeId ?? null,
        employeeName: etiquetaTitular,
        objectiveId: coberturaModal.turno.objectiveId ?? null,
        objectiveName: coberturaModal.turno.obj,
        shiftId: titularId,
        description: `${etiquetaTitular} · cubren a ${coberturaModal.employeeName} en ${coberturaModal.turno.obj}${guardiaIntercambio ? ` (${nombreCorto(guardiaIntercambio.employeeName)} se intercambió al lugar del ausente)` : ''}`,
        empresaId,
        createdAt: serverTimestamp(),
        reportedBy: 'OPERACIONES',
        operatorId: user?.uid ?? 'cc-modo-rapido',
      });

      const tituloToast = `D12 + N12 aplicado · ${etiquetaTitular}`;
      const avisos = [
        {
          phone: d12.turno.phone,
          texto: waMensaje.cobertura(d12.employeeName, coberturaModal.turno.obj, fmt(horaD12.desde), fmt(corte)),
        },
        {
          phone: n12.turno.phone,
          texto: waMensaje.cobertura(n12.employeeName, coberturaModal.turno.obj, fmt(corte), fmt(horaN12.hasta)),
        },
      ];
      const hayAvisos = avisos.some((a) => a.phone);
      showToast(`${tituloToast}${hayAvisos ? ' · enviando aviso…' : ''}`, 'bg-amber-700');
      if (hayAvisos) {
        void avisarPorWhatsApp(avisos).then((sufijo) => showToast(`${tituloToast}${sufijo}`, 'bg-amber-700'));
      }
    } catch (err) {
      console.warn('[modo-rapido] D12 + N12', err);
      showToast(err instanceof Error ? err.message : 'Error al aplicar D12 + N12', 'bg-red-600');
    } finally {
      setBusy(false);
      setCoberturaModal(null);
    }
  };

  const handleIntercambiarCobertura = async (candidate: GuardRowModel) => {
    if (!coberturaModal || busy) return;
    setBusy(true);
    try {
      const absentEmployeeId = String(
        coberturaModal.turno.employeeId ||
          (turnos[coberturaModal.employeeName] as TurnoHoy | undefined)?.employeeId ||
          '',
      );
      const ausenteDocId = docIdDe(coberturaModal.turno.rowId);
      const candDocId = docIdDe(candidate.turno.rowId);
      if (ausenteDocId === candDocId) {
        showToast('Elegí otro guardia: el cortado se intercambia completo', 'bg-slate-700');
        return;
      }
      await updateDoc(doc(db, 'turnos', ausenteDocId), {
        ...parcheTurnoReasignadoDeAusente(coberturaModal.turno),
        employeeId: candidate.turno.employeeId,
        employeeName: candidate.employeeName,
        origin: 'INTERCAMBIO',
        intercambioConTurnoId: candDocId,
      });
      await updateDoc(doc(db, 'turnos', candDocId), {
        employeeId: absentEmployeeId,
        employeeName: coberturaModal.employeeName,
        origin: 'INTERCAMBIO',
        intercambioConTurnoId: ausenteDocId,
      });
      if (coberturaModal.turno.turnoStatus === 'ABSENT') {
        await marcarAusenciaGestionada(
          ausenteDocId,
          { id: candidate.turno.employeeId, name: candidate.employeeName },
          'INTERCAMBIO',
        );
      }
      await addDoc(collection(db, 'novedades'), {
        type: 'INTERCAMBIO_TURNO',
        turnoAusenteId: ausenteDocId,
        turnoAusenteEmpleado: coberturaModal.employeeName,
        turnoAusenteObj: coberturaModal.turno.obj,
        intercambioEmpleado: candidate.employeeName,
        intercambioObj: candidate.turno.obj,
        empresaId,
        operatorId: user?.uid ?? 'cc-modo-rapido',
        createdAt: serverTimestamp(),
      });
      const tituloToast = `Intercambio · ${candidate.employeeName} ↔ ${coberturaModal.employeeName}`;
      const avisos = [
        {
          phone: candidate.turno.phone,
          texto: waMensaje.intercambioHecho(
            candidate.employeeName,
            coberturaModal.turno.obj,
            coberturaModal.turno.expected,
            coberturaModal.salida || '—',
          ),
        },
        {
          phone: coberturaModal.turno.phone,
          texto: waMensaje.intercambioHecho(
            coberturaModal.employeeName,
            candidate.turno.obj,
            candidate.turno.expected,
            candidate.salida || '—',
          ),
        },
      ];
      const hayAvisos = avisos.some((a) => a.phone);
      showToast(`${tituloToast}${hayAvisos ? ' · enviando aviso…' : ''}`, 'bg-blue-700');
      if (hayAvisos) {
        void avisarPorWhatsApp(avisos).then((sufijo) => showToast(`${tituloToast}${sufijo}`, 'bg-blue-700'));
      }
    } catch {
      showToast('Error al intercambiar turnos', 'bg-red-600');
    } finally {
      setBusy(false);
      setCoberturaModal(null);
    }
  };

  async function intercambiarFilas(origen: GuardRowModel, destino: GuardRowModel) {
    if (busy || origen.turno.rowId === destino.turno.rowId) return;
    const origenDocId = docIdDe(origen.turno.rowId);
    const destinoDocId = docIdDe(destino.turno.rowId);
    // Turno cortado: un solo documento / un solo legajo. Se intercambia la jornada completa
    // (todos los tramos), nunca un tramo contra otro del mismo doc.
    if (origenDocId === destinoDocId) {
      setSwapFromId(null);
      showToast('Elegí otro guardia: el cortado se intercambia completo, no tramo contra tramo', 'bg-slate-700');
      return;
    }
    setBusy(true);
    try {
      const origenEmployeeId = String(origen.turno.employeeId || '');
      await updateDoc(doc(db, 'turnos', origenDocId), {
        ...parcheTurnoReasignadoDeAusente(origen.turno),
        employeeId: destino.turno.employeeId,
        employeeName: destino.employeeName,
        origin: 'INTERCAMBIO',
        intercambioConTurnoId: destinoDocId,
      });
      await updateDoc(doc(db, 'turnos', destinoDocId), {
        ...parcheTurnoReasignadoDeAusente(destino.turno),
        employeeId: origenEmployeeId,
        employeeName: origen.employeeName,
        origin: 'INTERCAMBIO',
        intercambioConTurnoId: origenDocId,
      });
      if (origen.turno.turnoStatus === 'ABSENT') {
        await marcarAusenciaGestionada(
          origenDocId,
          { id: destino.turno.employeeId, name: destino.employeeName },
          'INTERCAMBIO',
        );
      }
      if (destino.turno.turnoStatus === 'ABSENT') {
        await marcarAusenciaGestionada(
          destinoDocId,
          { id: origenEmployeeId, name: origen.employeeName },
          'INTERCAMBIO',
        );
      }
      const anticipado =
        origen.estado !== 'NO_LLEGO' &&
        origen.estado !== 'AUSENTE' &&
        destino.estado !== 'NO_LLEGO' &&
        destino.estado !== 'AUSENTE';
      await addDoc(collection(db, 'novedades'), {
        type: anticipado ? 'INTERCAMBIO_ANTICIPADO' : 'INTERCAMBIO_TURNO',
        turnoAusenteId: origenDocId,
        turnoAusenteEmpleado: origen.employeeName,
        turnoAusenteObj: origen.turno.obj,
        intercambioEmpleado: destino.employeeName,
        intercambioObj: destino.turno.obj,
        empresaId,
        operatorId: user?.uid ?? 'cc-modo-rapido',
        createdAt: serverTimestamp(),
      });
      const cortadoTxt =
        esTramoCortado(origen.turno) || esTramoCortado(destino.turno) ? ' (turno completo)' : '';
      const tituloToast = `${anticipado ? 'Intercambio anticipado' : 'Intercambio'}${cortadoTxt} · ${origen.employeeName} ↔ ${destino.employeeName}`;
      const avisos = [
        {
          phone: origen.turno.phone,
          texto: waMensaje.intercambioHecho(
            origen.employeeName,
            destino.turno.obj,
            destino.turno.expected,
            destino.salida || '—',
          ),
        },
        {
          phone: destino.turno.phone,
          texto: waMensaje.intercambioHecho(
            destino.employeeName,
            origen.turno.obj,
            origen.turno.expected,
            origen.salida || '—',
          ),
        },
      ];
      const hayAvisos = avisos.some((a) => a.phone);
      showToast(`${tituloToast}${hayAvisos ? ' · enviando aviso…' : ''}`, 'bg-blue-700');
      if (hayAvisos) {
        void avisarPorWhatsApp(avisos).then((sufijo) => showToast(`${tituloToast}${sufijo}`, 'bg-blue-700'));
      }
      setSwapFromId(null);
    } catch {
      showToast('Error al intercambiar turnos', 'bg-red-600');
    } finally {
      setBusy(false);
    }
  }

  const handleConvocarFt = async (candidate: GuardRowModel) => {
    if (!coberturaModal || busy) return;
    const ausente = coberturaModal;
    setBusy(true);
    let porApp = false;
    try {
      const candidateEmployeeId = String(candidate.turno.employeeId || '').trim();
      // Turno cortado: la convocatoria por la app cubriría un solo tramo; se asigna directo el turno completo.
      if (candidateEmployeeId && empresaId && !esTramoCortado(ausente.turno)) {
        try {
          await invokeCrearConvocatoriaCobertura({
            absenceShift: {
              id: ausente.turno.rowId,
              employeeId: ausente.turno.employeeId || '',
              employeeName: ausente.employeeName,
              objectiveId: ausente.turno.objectiveId || '',
              objectiveName: ausente.turno.obj,
              positionName: ausente.turno.positionName || '',
              code: ausente.turno.code || '',
              startTime: ausente.turno.startTimeRaw,
              endTime: ausente.turno.endTimeRaw,
            },
            candidateEmployeeId,
            type: 'FT',
            empresaId,
            ftShiftId: candidate.turno.rowId,
            candidateShiftId: candidate.turno.rowId,
          });
          porApp = true;
        } catch (err) {
          console.warn('[modo-rapido] convocatoria app', err);
        }
      }
      if (!porApp) {
        // Motor oficial (igual que el CC clásico): cobertura FT aparte sobre el franco del guardia.
        const titularId = docIdDe(ausente.turno.rowId);
        const batchFt = writeBatch(db);
        const coverDocId = await applyCoverage(db, batchFt, {
          titularShiftId: titularId,
          candidateEmployeeId: candidateEmployeeId,
          candidateEmployeeName: candidate.employeeName,
          sourceShiftId: docIdDe(candidate.turno.rowId),
          coverageType: 'FT',
          resolvedBy: 'OPERACIONES',
          empresaId,
          code: 'FT',
        });
        await heredarTramosEnCobertura(batchFt, titularId, coverDocId);
        await syncAusenciaCoberturaGestionada(
          db,
          {
            shiftId: titularId,
            coveredByEmployeeId: candidateEmployeeId || null,
            coveredByEmployeeName: candidate.employeeName,
            coverageType: 'FT',
            empresaId,
            resolvedBy: 'OPERACIONES',
          },
          batchFt,
        );
        await batchFt.commit();
        await addDoc(collection(db, 'novedades'), {
          type: 'FRANCO_TRABAJADO',
          title: 'Franco trabajado',
          status: 'pending',
          employeeId: candidateEmployeeId || null,
          employeeName: candidate.employeeName,
          objectiveId: ausente.turno.objectiveId ?? null,
          objectiveName: ausente.turno.obj,
          shiftId: coverDocId,
          description: `${candidate.employeeName} trabaja su franco (titular: ${ausente.employeeName})`,
          empresaId,
          createdAt: serverTimestamp(),
          reportedBy: 'OPERACIONES',
          operatorId: user?.uid ?? 'cc-modo-rapido',
        });
      }
      const aviso = abrirWa(
        candidate.turno.phone,
        waMensaje.cobertura(
          candidate.employeeName,
          ausente.turno.obj,
          ausente.turno.expected,
          ausente.salida || '—',
        ),
      );
      showToast(
        porApp
          ? `FT convocado por la app${aviso ? ' y WhatsApp' : ''} · ${candidate.employeeName}`
          : aviso
            ? `FT asignado · WhatsApp abierto · ${candidate.employeeName}`
            : `FT asignado · ${candidate.employeeName}. Sin teléfono para WhatsApp.`,
        aviso || porApp ? 'bg-red-700' : 'bg-amber-700',
      );
    } catch (err) {
      console.warn('[modo-rapido] convocar FT', err);
      showToast(
        err instanceof CoverageApplyError ? err.message : 'Error al convocar FT',
        'bg-red-600',
      );
    } finally {
      setBusy(false);
      setCoberturaModal(null);
    }
  };

  const handleConfirmarWA = async (row: GuardRowModel) => {
    if (busy || !row.pendingEntry) return;
    const entry = row.pendingEntry;
    const marca = entry.msgTs ?? Date.now();
    if (ingresoDemasiadoAnticipado(row.turno.startTimeRaw, marca)) {
      wa.responder(entry, textoIngresoAnticipadoWa(row.employeeName, row.turno, marca));
      wa.dismissEntry(entry);
      showToast(
        `Muy anticipado · ${row.employeeName}: presencia recién desde 30 min antes del inicio`,
        'bg-amber-700',
      );
      return;
    }
    setBusy(true);
    try {
      wa.confirmEntry(entry);
      if (entry.rowId) {
        await marcarPresente(
          entry.rowId,
          { name: row.employeeName, expected: row.turno.expected },
          entry.arrivedAt || nowHHMM(),
          'WA',
        );
        wa.responder(entry, textoConfirmacionWA(row.employeeName, entry.arrivedAt || nowHHMM(), row.turno));
      }
      showToast(`Confirmado WA · ${row.employeeName}`, 'bg-emerald-700');
    } catch (err) {
      console.warn('[modo-rapido] confirmarWA', err);
      showToast('Error al confirmar check-in WA', 'bg-red-600');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Presente automático por WhatsApp: mismo camino que «Confirmar» del operador (marcarPresente con
   * fuente WA, respuesta privada al guardia), pero sin tocar la planilla ni bloquearla.
   */
  async function autoConfirmarWA(row: GuardRowModel, entry: WAEntry) {
    try {
      const hora = entry.arrivedAt || nowHHMM();
      await marcarPresente(
        entry.rowId as string,
        { name: row.employeeName, expected: row.turno.expected },
        hora,
        'WA',
      );
      wa.confirmEntry(entry);
      wa.responder(entry, textoConfirmacionWA(row.employeeName, hora, row.turno));
      setAutoWaCount((n) => n + 1);
      showToast(`Presente automático por WA · ${row.employeeName} ${hora}`, 'bg-emerald-700');
    } catch (err) {
      console.warn('[modo-rapido] presente automático WA', err);
      showToast(`No se pudo confirmar solo a ${row.employeeName}: queda para el operador`, 'bg-amber-700');
    }
  }

  useEffect(() => {
    try {
      const v = localStorage.getItem('mr-auto-wa');
      if (v === '0') setAutoWa(false);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!autoWa) return;
    for (const row of classifiedRows) {
      const entry = row.pendingEntry;
      if (!entry || row.estado !== 'PENDIENTE_WA') continue;
      if (autoWaProcesadosRef.current.has(entry.id)) continue;
      const marca = entry.msgTs ?? Date.now();

      if (ingresoDemasiadoAnticipado(row.turno.startTimeRaw, marca)) {
        autoWaProcesadosRef.current.add(entry.id);
        wa.responder(entry, textoIngresoAnticipadoWa(row.employeeName, row.turno, marca));
        wa.dismissEntry(entry);
        showToast(
          `WA anticipado · ${row.employeeName}: le avisamos que marque desde 30 min antes`,
          'bg-amber-700',
        );
        continue;
      }

      if (
        !entry.allowRemoteCheckIn
        && entry.hasLocation
        && entry.lat != null
        && entry.lng != null
        && entry.objLat != null
        && entry.objLng != null
      ) {
        const distM = haversineM(entry.lat, entry.lng, entry.objLat, entry.objLng);
        if (distM > AUTO_WA_RADIO_M) {
          autoWaProcesadosRef.current.add(entry.id);
          wa.responder(entry, textoFueraDeRadioWa(row.employeeName, distM, 'ingreso'));
          showToast(
            `WA lejos · ${row.employeeName} a ${distM} m (máx. ${AUTO_WA_RADIO_M}): le pedimos que se acerque`,
            'bg-amber-700',
          );
          continue;
        }
      }

      if (!entradaWaVerificada(entry)) continue;
      autoWaProcesadosRef.current.add(entry.id);
      void autoConfirmarWA(row, entry);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- autoConfirmarWA usa solo refs y callbacks estables de la sesión
  }, [classifiedRows, autoWa]);

  /**
   * Salida por WhatsApp: ubicación a menos de AUTO_WA_RADIO_M, ya pasado el fin planificado.
   * Cierra si no hay relevo de serie 24 h o si ese relevo ya está presente. El egreso no queda
   * antes del fin planificado. Si el relevo 24 h todavía no llegó, el aviso queda en la fila.
   */
  async function autoCerrarPorWA(row: GuardRowModel, entry: WAEntry, finMs?: number) {
    const tieneUbicacion = entry.lat != null && entry.lng != null;
    const distM =
      tieneUbicacion && entry.objLat != null && entry.objLng != null
        ? haversineM(entry.lat as number, entry.lng as number, entry.objLat, entry.objLng)
        : undefined;
    const cierreMs = finMs ?? entry.msgTs ?? Date.now();
    const ok = await cerrarTurno(row, {
      auto: true,
      finMs: cierreMs,
      ubicacion: tieneUbicacion ? { lat: entry.lat as number, lng: entry.lng as number, distM } : undefined,
    });
    if (!ok) return;
    wa.consumirSalida(entry);
    const hora = new Date(cierreMs).toLocaleTimeString('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'America/Argentina/Buenos_Aires',
    });
    wa.responder(entry, textoSalidaRegistradaWa(row.employeeName, hora));
  }

  const autoSalidaProcesadosRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!autoWa) return;
    for (const entry of wa.salidas) {
      if (autoSalidaProcesadosRef.current.has(entry.id)) continue;
      const row = classifiedRows.find((r) => r.turno.rowId === entry.rowId);
      if (!row || !estaPresente(row)) continue;

      const finPlan = toStartMs(row.turno.endTimeRaw);
      const marca = entry.msgTs ?? Date.now();
      // Antes del fin: le avisamos; el aviso queda en la fila y se cierra al llegar la hora si está en radio.
      if (Number.isFinite(finPlan) && finPlan > 0 && Date.now() < finPlan) {
        if (!autoSalidaProcesadosRef.current.has(`early:${entry.id}`)) {
          autoSalidaProcesadosRef.current.add(`early:${entry.id}`);
          wa.responder(
            entry,
            textoSalidaAntesDeFinWa(row.employeeName, row.salida || formatHHMM(row.turno.endTimeRaw as never)),
          );
        }
        continue;
      }

      if (
        !entry.allowRemoteCheckIn
        && entry.lat != null
        && entry.lng != null
        && entry.objLat != null
        && entry.objLng != null
      ) {
        const distM = haversineM(entry.lat, entry.lng, entry.objLat, entry.objLng);
        if (distM > AUTO_WA_RADIO_M) {
          autoSalidaProcesadosRef.current.add(entry.id);
          wa.responder(entry, textoFueraDeRadioWa(row.employeeName, distM, 'salida'));
          showToast(
            `Salida lejos · ${row.employeeName} a ${distM} m: le pedimos que se acerque`,
            'bg-amber-700',
          );
          continue;
        }
      }

      if (!entradaWaVerificada(entry)) continue;
      // Sin relevo de serie 24 h el servicio termina con este guardia: se cierra. Con relevo
      // programado hay que esperar a que esté presente.
      if (hayRelevoProgramado(row, classifiedRows) && !hayRelevoLibre(row, classifiedRows)) continue;
      const finCierre = Number.isFinite(finPlan) && finPlan > 0 ? Math.max(marca, finPlan) : marca;
      autoSalidaProcesadosRef.current.add(entry.id);
      void autoCerrarPorWA(row, entry, finCierre);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- autoCerrarPorWA usa solo refs y callbacks estables de la sesión
  }, [classifiedRows, wa.salidas, autoWa]);

  function alternarAutoWa() {
    const nuevo = !autoWa;
    setAutoWa(nuevo);
    try {
      localStorage.setItem('mr-auto-wa', nuevo ? '1' : '0');
    } catch {
      /* ignore */
    }
    showToast(
      nuevo
        ? `Presente y salida automáticos por WA activados (${AUTO_WA_RADIO_M} m; objetivos REMOTO sin radio)`
        : 'Presente y salida automáticos por WA desactivados: confirmás vos',
      'bg-slate-700',
    );
  }

  function descartarCheckIn(entry: WAEntry) {
    wa.dismissEntry(entry);
    showToast(`Check-in descartado · ${entry.name}`, 'bg-slate-700');
  }

  const handleConfirmEntrySidebar = async (entry: WAEntry) => {
    if (busy) return;
    const turnoSide =
      (entry.rowId && Object.values(turnos).find((t) => t.rowId === entry.rowId)) ||
      (entry.rowId && tramosExtra.find((t) => t.rowId === entry.rowId));
    const marca = entry.msgTs ?? Date.now();
    if (turnoSide && ingresoDemasiadoAnticipado(turnoSide.startTimeRaw, marca)) {
      const nombre = turnoSide.name || entry.name;
      wa.responder(entry, textoIngresoAnticipadoWa(nombre, turnoSide, marca));
      wa.dismissEntry(entry);
      showToast(
        `Muy anticipado · ${nombre}: presencia recién desde 30 min antes del inicio`,
        'bg-amber-700',
      );
      return;
    }
    setBusy(true);
    try {
      wa.confirmEntry(entry);
      if (entry.rowId) {
        const empName =
          Object.entries(turnos).find(([, t]) => t.rowId === entry.rowId)?.[0] ||
          entry.name;
        const expected =
          turnos[empName]?.expected || entry.expected || nowHHMM();
        await marcarPresente(
          entry.rowId,
          { name: empName, expected },
          entry.arrivedAt || nowHHMM(),
          'WA',
        );
        wa.responder(
          entry,
          textoConfirmacionWA(empName, entry.arrivedAt || nowHHMM(), turnoSide || Object.values(turnos).find((t) => t.rowId === entry.rowId)),
        );
      }
      showToast(`Confirmado WA · ${entry.name}`, 'bg-emerald-700');
    } catch (err) {
      console.warn('[modo-rapido] confirmEntry sidebar', err);
      showToast('Error al confirmar check-in WA', 'bg-red-600');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (activeRowId && sheetRows.some((r) => r.turno.rowId === activeRowId)) return;
    setActiveRowId(sheetRows[0]?.turno.rowId ?? null);
  }, [sheetRows, activeRowId]);

  // Con las flechas la fila activa siempre queda a la vista (el grupo puede abrirse en el mismo paso).
  useEffect(() => {
    if (!activeRowId) return;
    const id = window.requestAnimationFrame(() => {
      const nodes = document.querySelectorAll<HTMLElement>('[data-rowid]');
      for (const n of Array.from(nodes)) {
        if (n.dataset.rowid === activeRowId && n.offsetParent !== null) {
          n.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          break;
        }
      }
    });
    return () => window.cancelAnimationFrame(id);
  }, [activeRowId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!target?.isContentEditable;
      // El modal de comentario maneja sus propias teclas (Esc, Ctrl+Enter): los atajos de la planilla no corren.
      if (comentarioModal) return;
      // El modal de retenes maneja sus propias teclas (Esc): los atajos de la planilla no corren.
      if (retenesModalOpen) return;
      if (pdfModalOpen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          if (!pdfBusy) setPdfModalOpen(false);
        }
        return;
      }
      if (confirmacion) {
        if (e.key === 'Escape') {
          e.preventDefault();
          resolverConfirmacion(false);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (!e.repeat) resolverConfirmacion(true);
        }
        return;
      }
      if (revertirChoice) {
        if (e.key === 'Escape') setRevertirChoice(null);
        return;
      }
      if (retiroModal) {
        e.preventDefault();
        const k = e.key.toLowerCase();
        if (e.key === 'Escape') {
          setRetiroModal(null);
          return;
        }
        const motivoTecla = MOTIVOS_RETIRO.find((m) => m.tecla === e.key);
        if (motivoTecla) {
          setRetiroMotivo(motivoTecla.id);
          return;
        }
        if (retiroInfo?.policy === 'OPERATOR_CHOICE' || retiroReemplazo !== null) {
          if (k === 's') setRetiroReemplazo(true);
          if (k === 'n') setRetiroReemplazo(false);
        }
        if (e.key === 'Enter') {
          if (retiroInfo?.policy === 'OPERATOR_CHOICE' && retiroReemplazo === null) {
            showToast('Elegí si se reemplaza el resto del turno (S o N)', 'bg-amber-700');
            return;
          }
          void retirarTurno(retiroModal, retiroMotivo, retiroInfo?.policy === 'OPERATOR_CHOICE' ? retiroReemplazo : null);
        }
        return;
      }
      if (coberturaModal || accionesModal) {
        if (e.key === 'Escape') {
          setCoberturaModal(null);
          setAccionesModal(null);
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault();
        void deshacer();
        return;
      }
      if (typing) {
        if (e.key === 'Escape') target?.blur();
        return;
      }
      if (e.key === '/') {
        e.preventDefault();
        const nodes = document.querySelectorAll<HTMLInputElement>('input[data-mr-search="1"]');
        const visible = Array.from(nodes).find((n) => n.offsetParent !== null) || nodes[0];
        visible?.focus();
        return;
      }
      if (e.key === 'Escape') {
        if (hourEdit || arm || swapFromId) {
          e.preventDefault();
          setHourEdit(null);
          setArm(null);
          setSwapFromId(null);
          return;
        }
        if (pantallaCompleta) {
          setPantallaCompleta(false);
          if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
          return;
        }
        return;
      }
      const idx = sheetRows.findIndex((r) => r.turno.rowId === activeRowId);
      const row = idx >= 0 ? sheetRows[idx] : sheetRows[0];
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!sheetRows.length) return;
        const from = idx < 0 ? 0 : idx;
        const next = e.key === 'ArrowDown'
          ? sheetRows[Math.min(sheetRows.length - 1, from + 1)]
          : sheetRows[Math.max(0, from - 1)];
        setActiveRowId(next.turno.rowId);
        setGroupOpen((prev) => ({ ...prev, [next.turno.obj || '—']: true }));
        return;
      }
      if (!row) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        if (hourEdit && hourEdit.rowId === row.turno.rowId) {
          void guardarHora(row, hourEdit.value, arm?.kind === 'radio', hourEdit.campo);
          return;
        }
        if (arm?.kind === 'ausente' && arm.rowId === row.turno.rowId) {
          void handleRegistrarAusencia(row);
          return;
        }
        if (arm?.kind === 'quitar' && arm.rowId === row.turno.rowId) {
          void quitarPresencia(row);
          return;
        }
        if (arm?.kind === 'cerrar' && arm.rowId === row.turno.rowId) {
          void cerrarTurno(row);
          return;
        }
        if (swapFromId && docIdDe(swapFromId) !== docIdDe(row.turno.rowId)) {
          const from = sheetRows.find((r) => r.turno.rowId === swapFromId);
          if (from) void intercambiarFilas(from, row);
          return;
        }
        if (row.estado === 'PENDIENTE_WA') void handleConfirmarWA(row);
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 'p') {
        setSwapFromId(null);
        setArm({ kind: 'radio', rowId: row.turno.rowId });
        setHourEdit({ rowId: row.turno.rowId, value: nowHHMM(), campo: 'ingreso' });
        return;
      }
      if (k === 'h' || e.key === 'F2') {
        e.preventDefault();
        setArm(null);
        setHourEdit({
          rowId: row.turno.rowId,
          value: row.realDisplay !== '—' ? row.realDisplay : nowHHMM(),
          campo: 'ingreso',
        });
        return;
      }
      if (k === 'w' && row.estado === 'PENDIENTE_WA') {
        void handleConfirmarWA(row);
        return;
      }
      if (e.key === 'Delete' && row.estado === 'PENDIENTE_WA' && row.pendingEntry) {
        e.preventDefault();
        descartarCheckIn(row.pendingEntry);
        return;
      }
      if (k === 'a') {
        setHourEdit(null);
        setArm({ kind: 'ausente', rowId: row.turno.rowId });
        return;
      }
      if (k === 'u') {
        setHourEdit(null);
        setArm({ kind: 'quitar', rowId: row.turno.rowId });
        return;
      }
      if (k === 's' && (row.estado === 'PRESENTE_PLAT' || row.estado === 'PRESENTE_WA')) {
        pedirCierre(row);
        return;
      }
      if (k === 'r' && (row.estado === 'PRESENTE_PLAT' || row.estado === 'PRESENTE_WA')) {
        pedirRetiro(row);
        return;
      }
      if (k === 'c' && (row.estado === 'NO_LLEGO' || row.estado === 'AUSENTE')) {
        void abrirCobertura(row);
        return;
      }
      if (k === 'x') {
        setArm(null);
        setSwapFromId((prev) =>
          prev && docIdDe(prev) === docIdDe(row.turno.rowId) ? null : row.turno.rowId,
        );
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheetRows, activeRowId, hourEdit, arm, swapFromId, coberturaModal, accionesModal, comentarioModal, retenesModalOpen, pdfModalOpen, pdfBusy, revertirChoice, confirmacion, busy, pantallaCompleta, retiroModal, retiroMotivo, retiroReemplazo, retiroInfo]);

  useEffect(() => {
    if (!coberturaModal) setHuecoRetiro(null);
  }, [coberturaModal]);

  useEffect(() => {
    const onFs = () => setPantallaCompleta(document.fullscreenElement === sheetRef.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  async function togglePantalla() {
    const el = sheetRef.current;
    if (pantallaCompleta) {
      setPantallaCompleta(false);
      if (document.fullscreenElement) {
        try { await document.exitFullscreen(); } catch { /* el navegador ya salió */ }
      }
      return;
    }
    setPantallaCompleta(true);
    try {
      await el?.requestFullscreen();
    } catch {
      /* sin permiso del navegador: el panel igual cubre el menú */
    }
  }

  return (
    <DashboardLayout>
      <div
        ref={sheetRef}
        className={`mr-root flex flex-col bg-white ${pantallaCompleta ? 'fixed inset-0 z-[1100] h-screen w-screen' : 'relative h-[calc(100vh-56px)]'}`}
      >
        <header className="flex items-center gap-2 px-4 py-2 bg-white border-b border-slate-200 flex-shrink-0 min-h-11">
          <button
            type="button"
            onClick={() => void router.push('/admin/operaciones?classic=1')}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
            title="Volver al Centro de Control clásico"
          >
            <ArrowLeft size={15} />
          </button>
          <Zap size={14} className="text-emerald-600 ml-1" />
          <span className="text-sm font-black text-slate-800">CC Modo Rápido</span>
          <button
            type="button"
            onClick={() => {
              const next = !preferOpsRapido;
              writePreferOpsModoRapido(user?.uid, next);
              setPreferOpsRapido(next);
              showToast(
                next
                  ? 'Preferencia: al entrar a Operaciones se abre el modo rápido'
                  : 'Preferencia quitada: al entrar se abre el clásico',
                next ? 'bg-emerald-700' : 'bg-slate-700',
              );
            }}
            title={preferOpsRapido
              ? 'Preferencia activa: al entrar a Operaciones se abre el modo rápido'
              : 'Fijar modo rápido por preferencia al entrar'}
            aria-pressed={preferOpsRapido}
            className={`ml-1 px-1.5 py-1 rounded-lg border text-[10px] font-bold flex items-center gap-1 transition-colors ${preferOpsRapido ? 'border-emerald-700 bg-emerald-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-300 hover:text-emerald-700'}`}
          >
            <Pin size={11} className={preferOpsRapido ? 'fill-current' : ''} />
            Por defecto
          </button>
          {wa.badge > 0 && (
            <span className="px-1.5 py-0.5 bg-red-500 text-white text-[9px] font-bold rounded-full">
              {wa.badge}
            </span>
          )}
          <div
            className="flex items-center gap-1 ml-2 text-[10px] text-slate-500"
            title={
              waProvider === 'sin_config' || waProvider === 'off'
                ? `${empresa?.name || empresaId || 'Esta empresa'}: WhatsApp apagado o sin config (Configuración → WhatsApp)`
                : waProvider === 'cloud'
                  ? `Cloud API activa · recepción por webhook (en preparación)`
                  : bridgeUrl
                    ? `WA Bridge de ${empresa?.name || empresaId || 'la empresa'}: ${bridgeUrl}`
                    : undefined
            }
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                waProvider === 'sin_config' || waProvider === 'off'
                  ? 'bg-slate-300'
                  : waProvider === 'cloud'
                    ? 'bg-indigo-500'
                    : wa.status === 'connected'
                      ? 'bg-emerald-500 animate-pulse'
                      : wa.status === 'error'
                        ? 'bg-red-500'
                        : 'bg-amber-400'
              }`}
            />
            {waProvider === 'sin_config'
              ? 'sin WhatsApp'
              : waProvider === 'off'
                ? 'WA apagado'
                : waProvider === 'cloud'
                  ? 'Cloud API'
                  : wa.status === 'connected'
                    ? 'conectado'
                    : wa.status === 'error'
                      ? 'sin respuesta'
                      : 'conectando…'}
          </div>

          <div className="ml-3 relative flex-1 max-w-xs hidden sm:block">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              data-mr-search="1"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar guardia, objetivo o puesto…"
              className="w-full pl-7 pr-2 py-1.5 text-[11px] border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-1 focus:ring-emerald-400"
            />
          </div>

          <RelojCabecera />

          <div className="ml-auto flex items-center gap-2">
            <span className="text-[10px] text-slate-400">
              {loading ? 'cargando…' : `${Object.keys(turnos).length} guardias hoy`}
            </span>
            <button
              type="button"
              onClick={() => {
                setPdfYmd(arYmd(Date.now()));
                setPdfModalOpen(true);
              }}
              title="Parte diario PDF"
              aria-label="Generar parte diario PDF"
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-slate-600"
            >
              <FileText size={13} />
              PDF
            </button>
            <button
              type="button"
              onClick={() => void togglePantalla()}
              title={pantallaCompleta ? 'Salir de pantalla completa (Esc)' : 'Pantalla completa'}
              aria-label={pantallaCompleta ? 'Salir de pantalla completa' : 'Pantalla completa'}
              aria-pressed={pantallaCompleta}
              className="flex items-center justify-center w-8 h-8 rounded-lg bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 text-slate-600"
            >
              {pantallaCompleta ? <Minimize2 size={15} /> : <Maximize size={15} />}
            </button>
            <button
              type="button"
              onClick={() => setSidebar(!sidebarCollapsed)}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-600"
            >
              <MessageSquare size={12} />
              {sidebarCollapsed ? 'Check-ins' : 'Ocultar'}
              {sidebarCollapsed && wa.badge > 0 && (
                <span className="w-4 h-4 bg-red-500 text-white rounded-full text-[8px] flex items-center justify-center">
                  {wa.badge}
                </span>
              )}
            </button>
          </div>
        </header>

        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white border-b border-slate-100 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden flex-shrink-0">
          <ChipIcono
            icon={LayoutList}
            label="Todos"
            count={stats.total}
            active={statsFilter === 'all'}
            accent="bg-slate-800 text-white border-slate-800"
            siempre
            onClick={() => setStatsFilter('all')}
          />
          <ChipIcono
            icon={Siren}
            label="Crítico: no llegó y nadie lo cubre"
            count={stats.critico}
            active={statsFilter === 'critico'}
            accent="bg-red-100 text-red-700 border-red-300"
            tono="text-red-600"
            onClick={() => setStatsFilter('critico')}
          />
          <ChipIcono
            icon={Clock}
            label="Tardanza"
            count={stats.tardanza}
            active={statsFilter === 'tardanza'}
            accent="bg-orange-100 text-orange-700 border-orange-300"
            tono="text-orange-500"
            onClick={() => setStatsFilter('tardanza')}
          />
          <ChipIcono
            icon={HelpCircle}
            label="Sin confirmar: WhatsApp pendiente"
            count={stats.sinConfirmar}
            active={statsFilter === 'sin_confirmar'}
            accent="bg-blue-100 text-blue-700 border-blue-300"
            tono="text-blue-500"
            onClick={() => setStatsFilter('sin_confirmar')}
          />
          <ChipIcono
            icon={CheckCircle2}
            label="OK: presente"
            count={stats.ok}
            active={statsFilter === 'ok'}
            accent="bg-emerald-100 text-emerald-700 border-emerald-300"
            tono="text-emerald-600"
            onClick={() => setStatsFilter('ok')}
          />
          <ChipIcono
            icon={Lock}
            label="Cerrado"
            count={stats.cerrado}
            active={statsFilter === 'cerrado'}
            accent="bg-slate-700 text-white border-slate-700"
            tono="text-slate-500"
            onClick={() => setStatsFilter('cerrado')}
          />
          <ChipIcono
            icon={UserX}
            label="Sin presencia marcada"
            count={stats.sinPresencia}
            active={statsFilter === 'sin_presencia'}
            accent="bg-amber-100 text-amber-800 border-amber-300"
            tono="text-amber-600"
            onClick={() => setStatsFilter('sin_presencia')}
          />
          <ChipIcono
            icon={Radio}
            label="Presencia por radio"
            count={stats.radio}
            active={statsFilter === 'radio'}
            accent="bg-emerald-100 text-emerald-800 border-emerald-300"
            tono="text-emerald-600"
            onClick={() => setStatsFilter('radio')}
          />
          <ChipIcono
            icon={Smartphone}
            label="Presencia por la app del guardia"
            count={stats.app}
            active={statsFilter === 'app'}
            accent="bg-indigo-100 text-indigo-800 border-indigo-300"
            tono="text-indigo-600"
            onClick={() => setStatsFilter('app')}
          />
          <ChipIcono
            icon={ShieldCheck}
            label="Retenes: ver, asignar a un hueco y avisar por la app y WhatsApp"
            count={retenesHoyItems.length}
            active={retenesModalOpen}
            accent="bg-violet-600 text-white border-violet-600"
            tono="text-violet-600"
            siempre
            onClick={() => setRetenesModalOpen(true)}
          />
          <ChipIcono
            icon={Zap}
            label={
              autoWa
                ? `Presente y salida automáticos por WA activados (${AUTO_WA_RADIO_M} m). Clic para desactivar`
                : 'Presente y salida automáticos por WA desactivados. Clic para activar'
            }
            count={autoWaCount}
            active={autoWa}
            accent="bg-emerald-600 text-white border-emerald-600"
            tono="text-slate-400"
            siempre
            onClick={alternarAutoWa}
          />

          <div className="w-px h-5 bg-slate-200 mx-0.5 flex-shrink-0" />

          <div className="flex items-center gap-0.5 flex-shrink-0" role="group" aria-label="Banda horaria">
            {BANDS.map((b) => (
              <button
                key={b}
                type="button"
                title={
                  bandFilter === b
                    ? `Banda ${b}. Clic para ver todas`
                    : b === 'M'
                      ? 'Mañana: turnos que inician 06:00–11:59'
                      : b === 'T'
                        ? 'Tarde: turnos que inician 12:00–20:59'
                        : b === 'N'
                          ? 'Noche: turnos que inician 21:00–05:59'
                          : `Solo ${b}`
                }
                aria-pressed={bandFilter === b}
                onClick={() => setBandFilter(bandFilter === b ? 'all' : b)}
                className={`px-1.5 py-1 rounded-lg text-[10px] font-bold border ${
                  bandFilter === b
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {b}
              </button>
            ))}
          </div>

          <div className="w-px h-5 bg-slate-200 mx-0.5 flex-shrink-0" />

          <div className="flex items-center gap-0.5 flex-shrink-0" role="group" aria-label="Orden de los objetivos">
            <ArrowDownUp size={12} className="text-slate-400 mr-0.5" aria-hidden />
            {ORDEN_OPCIONES.map((o) => {
              const Icono = o.icon;
              return (
                <button
                  key={o.id}
                  type="button"
                  title={`Orden ${o.label}: ${o.title}`}
                  aria-label={`Orden ${o.label}`}
                  aria-pressed={ordenModo === o.id}
                  onClick={() => {
                    if (o.id === 'manual' && ordenManual.length === 0) {
                      guardarOrden('manual', groups.map(([k]) => k));
                      return;
                    }
                    if (o.id === 'horario' && ordenModo === 'horario') {
                      guardarOrden('horario', ordenManual, horarioDir === 'asc' ? 'desc' : 'asc');
                      return;
                    }
                    guardarOrden(o.id, ordenManual, 'asc');
                  }}
                  className={`flex items-center justify-center w-7 h-7 rounded-lg border ${
                    ordenModo === o.id
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <Icono size={13} />
                </button>
              );
            })}
          </div>
        </div>

        <div className="sm:hidden px-3 py-2 border-b border-slate-100 bg-white flex-shrink-0">
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              data-mr-search="1"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar guardia, objetivo o puesto…"
              className="w-full pl-7 pr-2 py-1.5 text-[11px] border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-1 focus:ring-emerald-400"
            />
          </div>
        </div>

        <div className="px-3 py-1.5 bg-slate-900 text-slate-100 text-[11px] flex-shrink-0 flex items-center gap-2 min-h-8">
          {hourEdit && (
            <input
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
              value={hourEdit.value}
              onChange={(e) => setHourEdit({ rowId: hourEdit.rowId, value: e.target.value, campo: hourEdit.campo })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  const row = sheetRows.find((r) => r.turno.rowId === hourEdit.rowId);
                  if (row) void guardarHora(row, hourEdit.value, arm?.kind === 'radio', hourEdit.campo);
                }
              }}
              className="w-16 px-1.5 py-0.5 text-[11px] font-mono text-slate-900 rounded-md border border-slate-500"
            />
          )}
          <span className="truncate">
          {(() => {
            if (!activeRow) return 'Flechas mueven la fila. / busca. P radio, W confirma WA, H hora, A ausencia, U quita presencia, S cierra, R retiro, C cobertura, X cambio anticipado.';
            if (hourEdit && arm?.kind === 'radio' && arm.rowId === activeRow.turno.rowId) {
              return `Radio · ${activeRow.employeeName}. Hora ${hourEdit.value}. Enter guarda, Esc suelta.`;
            }
            if (hourEdit && hourEdit.rowId === activeRow.turno.rowId) {
              const que = hourEdit.campo === 'salida' ? 'Salida' : 'Ingreso';
              const cierre = activeRow.estado === 'CERRADO' ? ' El turno sigue cerrado.' : ' El WhatsApp no se reescribe.';
              return `${que} de ${activeRow.employeeName}. Enter guarda, Esc suelta.${cierre}`;
            }
            if (arm?.kind === 'ausente' && arm.rowId === activeRow.turno.rowId) {
              return `Ausencia AA de ${activeRow.employeeName}. Enter confirma, Esc cancela.`;
            }
            if (arm?.kind === 'quitar' && arm.rowId === activeRow.turno.rowId) {
              return `Quitar presencia de ${activeRow.employeeName}. Enter confirma. WhatsApp no se toca.`;
            }
            if (arm?.kind === 'cerrar' && arm.rowId === activeRow.turno.rowId) {
              return `Cerrar turno de ${activeRow.employeeName}. Egreso previsto ${activeRow.salida || '—'}. Enter confirma el egreso real de ahora.`;
            }
            if (swapFromId) {
              const from = sheetRows.find((r) => r.turno.rowId === swapFromId);
              const anticipado = !!from
                && from.estado !== 'NO_LLEGO' && from.estado !== 'AUSENTE'
                && activeRow.estado !== 'NO_LLEGO' && activeRow.estado !== 'AUSENTE';
              const cortado =
                (!!from && esTramoCortado(from.turno)) || esTramoCortado(activeRow.turno);
              const titulo = `${anticipado ? 'Intercambio anticipado' : 'Intercambio'}${cortado ? ' (turno completo)' : ''}`;
              if (from && docIdDe(from.turno.rowId) !== docIdDe(activeRow.turno.rowId)) {
                return `${titulo} ${from.employeeName} ↔ ${activeRow.employeeName}. Enter aplica y abre WhatsApp. Esc cancela.`;
              }
              return `${titulo} desde ${from?.employeeName || '—'}. Elegí el otro guardia con las flechas.`;
            }
            if (activeRow.estado === 'PENDIENTE_WA') {
              return `WA pendiente · ${activeRow.employeeName} ${activeRow.realDisplay}. W o Enter confirma la hora del mensaje. Supr lo descarta.`;
            }
            if (activeRow.estado === 'CERRADO') {
              return `Cerrado · ${activeRow.employeeName}. Ing. R. ${activeRow.realDisplay}, Egr. R. ${activeRow.salidaReal || '—'}. H corrige el ingreso real. Clic en Egr. R. corrige el egreso real.`;
            }
            const sale = `sale ${activeRow.salida || '—'}`;
            return `${activeRow.employeeName} · ${activeRow.turno.obj} · ${activeRow.turno.positionName || 'puesto'} · ${sale} · fuente ${activeRow.fuente}`;
          })()}
          </span>
        </div>

        <div className="flex flex-1 overflow-hidden">
          <div className="flex-1 overflow-auto min-w-0">
            {loading ? (
              <div className="p-8 text-center text-sm text-slate-400">
                Cargando planificación del día…
              </div>
            ) : Object.keys(turnos).length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-400">
                Sin guardias planificados para hoy
              </div>
            ) : filteredRows.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-400">
                Sin resultados para el filtro actual
              </div>
            ) : (
              <div
                className={colAnchos ? undefined : 'min-w-[1120px]'}
                style={
                  {
                    '--mr-cols': plantillaColumnas(colAnchos),
                    ...(colAnchos ? { minWidth: 3 + colAnchos.reduce((a, b) => a + b, 0) } : {}),
                  } as React.CSSProperties
                }
              >
                <div
                  ref={cabeceraRef}
                  className={`grid ${SHEET_COLS} ${SHEET_ALIGN} ${SHEET_SHADE} sticky top-0 z-10 border-b border-slate-200 text-[9px] font-bold uppercase text-slate-500 [&>*]:py-2 [&>*:not(:first-child)]:border-r [&>*:not(:first-child)]:border-slate-200 [&>*:last-child]:border-r-0`}
                >
                  <span />
                  <CabeceraCol idx={0} onResizeStart={iniciarAjusteColumna} onResizeReset={restablecerColumnas}>Guardia</CabeceraCol>
                  <CabeceraCol idx={1} onResizeStart={iniciarAjusteColumna} onResizeReset={restablecerColumnas}>Puesto</CabeceraCol>
                  <CabeceraCol idx={2} onResizeStart={iniciarAjusteColumna} onResizeReset={restablecerColumnas}>Cód</CabeceraCol>
                  <CabeceraCol idx={3} onResizeStart={iniciarAjusteColumna} onResizeReset={restablecerColumnas}>
                    <button
                      type="button"
                      onClick={alternarOrdenHorario}
                      title="Ingreso planificado. Clic ordena por horario: ascendente, descendente, y vuelve a prioridad"
                      aria-label="Ordenar por horario programado"
                      className={`whitespace-nowrap text-left uppercase font-bold flex items-center gap-0.5 hover:text-indigo-600 ${
                        ordenModo === 'horario' ? 'text-indigo-600' : ''
                      }`}
                    >
                      Ing. P.
                      {ordenModo === 'horario' && (
                        <span aria-hidden className="text-[8px]">{horarioDir === 'asc' ? '▲' : '▼'}</span>
                      )}
                    </button>
                  </CabeceraCol>
                  <CabeceraCol idx={4} onResizeStart={iniciarAjusteColumna} onResizeReset={restablecerColumnas} className="whitespace-nowrap font-black" title="Ingreso real">Ing. R.</CabeceraCol>
                  <CabeceraCol idx={5} onResizeStart={iniciarAjusteColumna} onResizeReset={restablecerColumnas} className="whitespace-nowrap" title="Egreso planificado">Egr. P.</CabeceraCol>
                  <CabeceraCol idx={6} onResizeStart={iniciarAjusteColumna} onResizeReset={restablecerColumnas} className="whitespace-nowrap font-black" title="Egreso real">Egr. R.</CabeceraCol>
                  <CabeceraCol idx={7} onResizeStart={iniciarAjusteColumna} onResizeReset={restablecerColumnas}>Dif</CabeceraCol>
                  <CabeceraCol idx={8} onResizeStart={iniciarAjusteColumna} onResizeReset={restablecerColumnas}>Fuente</CabeceraCol>
                  <CabeceraCol idx={9} onResizeStart={iniciarAjusteColumna} onResizeReset={restablecerColumnas}>Estado</CabeceraCol>
                  <CabeceraCol idx={10} onResizeStart={iniciarAjusteColumna} onResizeReset={restablecerColumnas}>Acción</CabeceraCol>
                </div>
                {nonReteGroups.map(([objName, rows], gi) => {
                  const clienteGrupo = clientePorObj[objName] || SIN_CLIENTE;
                  const clientePrevio = gi > 0 ? (clientePorObj[nonReteGroups[gi - 1][0]] || SIN_CLIENTE) : null;
                  return (
                  <React.Fragment key={objName}>
                  {ordenModo === 'cliente' && clienteGrupo !== clientePrevio && (
                    <div className="px-3 py-1 bg-indigo-50 text-indigo-700 border-b border-slate-200 text-[10px] font-black uppercase tracking-wide">
                      {clienteGrupo}
                    </div>
                  )}
                  <ObjectiveGroup
                    objName={objName}
                    cliente={ordenModo === 'cliente' ? null : (clientePorObj[objName] || null)}
                    arrastrando={dragObj === objName}
                    soltarAca={!!dragObj && dropObj === objName && dragObj !== objName}
                    onDragStartGrupo={(n) => setDragObj(n)}
                    onDragOverGrupo={(n) => setDropObj((prev) => (prev === n ? prev : n))}
                    onDropGrupo={(n) => {
                      if (dragObj) moverObjetivo(dragObj, n);
                      setDragObj(null);
                      setDropObj(null);
                    }}
                    onDragEndGrupo={() => {
                      setDragObj(null);
                      setDropObj(null);
                    }}
                    rows={rows}
                    open={groupOpen[objName] ?? true}
                    onToggle={() =>
                      setGroupOpen((prev) => ({
                        ...prev,
                        [objName]: !(prev[objName] ?? true),
                      }))
                    }
                    busy={busy}
                    activeRowId={activeRowId}
                    hourEdit={hourEdit}
                    onSelect={(r) => {
                      setActiveRowId(r.turno.rowId);
                      setArm((prev) => (prev && prev.rowId === r.turno.rowId ? prev : null));
                      setHourEdit((prev) => (prev && prev.rowId === r.turno.rowId ? prev : null));
                    }}
                    onHourChange={(value) =>
                      setHourEdit((prev) => (prev ? { ...prev, value } : prev))
                    }
                    onHourCommit={(r, value) => void guardarHora(r, value, arm?.kind === 'radio', hourEdit?.campo ?? 'ingreso')}
                    onBeginEdit={(r, campo) => {
                      const value = campo === 'salida'
                        ? (r.salidaReal && r.salidaReal !== '--:--' ? r.salidaReal : nowHHMM())
                        : (r.realDisplay !== '—' ? r.realDisplay : nowHHMM());
                      setArm(null);
                      setActiveRowId(r.turno.rowId);
                      setHourEdit({ rowId: r.turno.rowId, value, campo });
                    }}
                    onCerrar={(r) => pedirCierre(r)}
                    onReabrir={(r) => void reabrirTurno(r)}
                    onMarcarPresente={(r) => void handleMarcarPresente(r)}
                    onConfirmarWA={(r) => void handleConfirmarWA(r)}
                    onCobertura={(r) => void abrirCobertura(r)}
                    onRevertirAusencia={(r) => void revertirAusencia(r)}
                    onIntercambio={(r) => {
                      setHourEdit(null);
                      setArm(null);
                      setActiveRowId(r.turno.rowId);
                      setSwapFromId((prev) =>
                        prev && docIdDe(prev) === docIdDe(r.turno.rowId) ? null : r.turno.rowId,
                      );
                      if (esTramoCortado(r.turno)) {
                        showToast('Cortado: se intercambia el turno completo (todos los tramos)', 'bg-indigo-700');
                      }
                    }}
                    onRetiro={(r) => pedirRetiro(r)}
                    swapFromId={swapFromId}
                    onMore={(r) => setAccionesModal(r)}
                    onComentario={(r) => setComentarioModal(r)}
                  />
                  </React.Fragment>
                  );
                })}
              </div>
            )}
          </div>

          <WASidebar
            wa={wa}
            collapsed={sidebarCollapsed}
            onExpand={() => setSidebar(false)}
            onCollapse={() => setSidebar(true)}
            confirmados={confirmadosHoy}
            logOpen={logOpen}
            setLogOpen={setLogOpen}
            logFilter={logFilter}
            setLogFilter={setLogFilter}
            logPage={logPage}
            setLogPage={setLogPage}
            LOG_PAGE={LOG_PAGE}
            busy={busy}
            onConfirmEntry={(e) => void handleConfirmEntrySidebar(e)}
            onDismissEntry={(e) => descartarCheckIn(e)}
          />
        </div>

        {retiroModal && retiroInfo && (
          <ModalRetiro
            row={retiroModal}
            hoursLeft={retiroInfo.hoursLeft}
            policy={retiroInfo.policy}
            colleagues={retiroInfo.colleagues}
            motivo={retiroMotivo}
            reemplazo={retiroReemplazo}
            busy={busy}
            onMotivo={setRetiroMotivo}
            onReemplazo={setRetiroReemplazo}
            onConfirm={() =>
              void retirarTurno(
                retiroModal,
                retiroMotivo,
                retiroInfo.policy === 'OPERATOR_CHOICE' ? retiroReemplazo : null,
              )
            }
            onClose={() => setRetiroModal(null)}
          />
        )}

        {coberturaModal && (
          <ModalCobertura
            absent={coberturaModal}
            remanente={
              huecoRetiro
                ? {
                    desde: formatHHMM(Timestamp.fromMillis(huecoRetiro.desdeMs)),
                    hasta: formatHHMM(Timestamp.fromMillis(huecoRetiro.hastaMs)),
                  }
                : null
            }
            retCandidates={retCandidatesOrdenados}
            retEval={retEvaluados}
            retEsManana={retUsaManana}
            extCandidates={extCandidates}
            intercambioCandidates={intercambioCandidates}
            francoCandidates={francoCandidates}
            busy={busy}
            onClose={() => setCoberturaModal(null)}
            onAsignarRet={(c) => void handleAsignarRet(c)}
            planD12N12={planD12N12}
            onAplicarDual={(d12, n12) => void handleD12N12(d12, n12)}
            onIntercambiar={(c) => void handleIntercambiarCobertura(c)}
            onConvocarFt={(c) => void handleConvocarFt(c)}
            onAvisarWa={(c, plantilla) => {
              if (!c.turno.phone) {
                showToast(`${c.employeeName} no tiene teléfono`, 'bg-amber-700');
                return;
              }
              const text = plantilla === 'intercambio'
                ? waMensaje.intercambio(c.employeeName, coberturaModal.turno.obj)
                : waMensaje.cobertura(
                    c.employeeName,
                    coberturaModal.turno.obj,
                    huecoRetiro
                      ? formatHHMM(Timestamp.fromMillis(huecoRetiro.desdeMs))
                      : coberturaModal.turno.expected,
                    coberturaModal.salida || '—',
                  );
              abrirWa(c.turno.phone, text);
            }}
          />
        )}

        {revertirChoice && (
          <ModalRevertirAusencia
            row={revertirChoice}
            busy={busy}
            onLiberarCobertura={(r) => {
              setRevertirChoice(null);
              void ejecutarReversionAusencia(r, true);
            }}
            onDejarAusencia={(r) => {
              setRevertirChoice(null);
              showToast(
                `${r.employeeName} permanece ausente (AA)${r.coveredByName ? `; sigue ${r.coveredByName}` : ''}`,
                'bg-slate-700',
              );
            }}
            onClose={() => setRevertirChoice(null)}
          />
        )}

        {retenesModalOpen && (
          <ModalRetenesDia
            hoy={retenesHoyItems}
            manana={retenesMananaItems}
            bridgeConectado={wabConectado}
            onEnviarApp={enviarAppRetenes}
            onEnviarWa={enviarWaRetenes}
            onClose={() => setRetenesModalOpen(false)}
            destinos={destinosRetenes}
            empInfo={empInfo}
            candidatosPara={candidatosModalRetenes}
            onAsignar={asignarRetDesdeModal}
            onMarcarPresente={marcarPresenteDesdeItem}
            onConfirmarWA={confirmarWADesdeItem}
            ocupado={busy}
          />
        )}

        {comentarioModal && (
          <ModalComentario
            key={comentarioModal.turno.rowId}
            row={comentarioModal}
            onGuardar={guardarComentario}
            onClose={() => setComentarioModal(null)}
          />
        )}

        {accionesModal && (
          <ModalAcciones
            row={accionesModal}
            busy={busy}
            onClose={() => setAccionesModal(null)}
            onComentario={(r) => setComentarioModal(r)}
            onMarcarPresente={(r) => void handleMarcarPresente(r)}
            onMarcarAusente={(r) => void handleRegistrarAusencia(r)}
            onIntercambio={(r) => {
              setHourEdit(null);
              setArm(null);
              setActiveRowId(r.turno.rowId);
              setSwapFromId(r.turno.rowId);
              if (esTramoCortado(r.turno)) {
                showToast('Cortado: se intercambia el turno completo (todos los tramos)', 'bg-indigo-700');
              }
            }}
            onRetiro={(r) => pedirRetiro(r)}
            onAvisarWa={(r) => {
              if (!r.turno.phone) {
                showToast(`${r.employeeName} no tiene teléfono`, 'bg-amber-700');
                return;
              }
              const fecha = new Date().toLocaleDateString('es-AR');
              abrirWa(
                r.turno.phone,
                waMensaje.turnoRecordatorio(
                  r.employeeName,
                  r.turno.obj,
                  fecha,
                  r.turno.expected,
                  r.salida || '—',
                ),
              );
            }}
          />
        )}

        {confirmacion && <ModalConfirmar datos={confirmacion} onResolver={resolverConfirmacion} />}

        {pdfModalOpen && (
          <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-900/40 p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="mr-pdf-title"
              className="w-full max-w-sm rounded-2xl bg-white shadow-lg border border-slate-200 p-4"
            >
              <div className="flex items-center gap-2 mb-3">
                <FileText size={16} className="text-indigo-600" />
                <h2 id="mr-pdf-title" className="text-sm font-black text-slate-800">
                  Parte diario PDF
                </h2>
              </div>
              <p className="text-[11px] text-slate-500 mb-3">
                Elegí la fecha y se descarga un PDF con la misma grilla del modo rápido (sin guardarlo en el servidor).
              </p>
              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1" htmlFor="mr-pdf-fecha">
                Fecha
              </label>
              <input
                id="mr-pdf-fecha"
                type="date"
                value={pdfYmd}
                onChange={(e) => setPdfYmd(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-1 focus:ring-indigo-400 mb-4"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={pdfBusy}
                  onClick={() => setPdfModalOpen(false)}
                  className="px-3 py-1.5 rounded-xl text-[11px] font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={pdfBusy || !pdfYmd}
                  onClick={() => void generarPdfDia()}
                  className="px-3 py-1.5 rounded-xl text-[11px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 active:scale-95"
                >
                  {pdfBusy ? 'Generando…' : 'Generar PDF'}
                </button>
              </div>
            </div>
          </div>
        )}

        {toast && (
          <div
            className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-2xl shadow-lg text-white text-sm font-medium ${toast.color}`}
          >
            {toast.msg}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
