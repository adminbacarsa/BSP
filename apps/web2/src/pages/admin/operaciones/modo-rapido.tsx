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
  Shield,
  Siren,
  Smartphone,
  UserX,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/lib/firebase';
import { openWhatsApp, waMensaje } from '@/lib/whatsapp';
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
import { isRestFrancoShift } from '@/hooks/useOperacionesMonitor';
import { computeShiftCloseTimes } from '@cosp/ops-core';
import {
  TurnoHoy,
  UseWABridgeReturn,
  WAConfirmedEntry,
  WAEntry,
  useWABridge,
} from '@/hooks/useWABridge';

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
  presenciaSource: string;
  checkInMethod: string;
  isPresent: boolean;
  isCompleted: boolean;
  isRetention: boolean;
  realEndLabel: string;
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
  /** Tramos abiertos de turnos cortados que no entran al dict del puente WA (una fila por tramo). */
  tramosExtra: TurnoHoy[];
} {
  const [retenesManana, setRetenesManana] = useState<TurnoHoy[]>([]);
  const [tramosExtra, setTramosExtra] = useState<TurnoHoy[]>([]);
  const [turnos, setTurnos] = useState<Record<string, TurnoHoy>>({});
  const [cerrados, setCerrados] = useState<Record<string, TurnoHoy>>({});
  const [presenciaMeta, setPresenciaMeta] = useState<Record<string, PresenciaMeta>>({});
  const [loading, setLoading] = useState(true);
  const [phones, setPhones] = useState<string[]>([]);
  const [clientePorObj, setClientePorObj] = useState<Record<string, string>>({});
  const [francos, setFrancos] = useState<TurnoHoy[]>([]);
  const objMapRef = useRef<Map<string, { name: string; clientName: string; lat?: number; lng?: number }>>(new Map());
  const phoneMapRef = useRef<Map<string, string>>(new Map());
  const lastTurnosSnapRef = useRef<QueryDocumentSnapshot[] | null>(null);
  const francosHoyRef = useRef<TurnoHoy[]>([]);

  useEffect(() => {
    if (!empresaId) {
      setTurnos({});
      setRetenesManana([]);
      setTramosExtra([]);
      setPhones([]);
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
      const m = new Map<string, { name: string; clientName: string; lat?: number; lng?: number }>();
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
      const metaTramos: Record<string, PresenciaMeta> = {};
      const manana = new Date(now);
      manana.setDate(manana.getDate() + 1);

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
        const endTs = (
          retiroAnticipado && shift.plannedEndTime ? shift.plannedEndTime : shift.endTime
        ) as Timestamp | undefined;
        const startTs = shift.startTime as Timestamp;
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
          employeeId,
          objectiveId: String(shift.objectiveId || ''),
          positionName: String(shift.positionName || ''),
          code,
          startTimeRaw: startTs,
          endTimeRaw: endTs,
          empresaId: String(shift.empresaId || ''),
          origin: String(shift.origin || '').toUpperCase() || undefined,
          coverageUsed: shift.coverageUsed === true,
          coverageDocId: String(shift.coverageDocId || '').trim() || undefined,
          coverageStatus: String(shift.coverageStatus || '').toUpperCase() || undefined,
          operacionallyCovered: shift.operacionallyCovered === true,
          coveredByName:
            shift.operacionallyCovered === true || String(shift.coverageStatus || '').toUpperCase() === 'COVERED'
              ? String(shift.coveringDisplayName || shift.coveredByEmployeeName || '')
                  .replace(/\s*\([^)]*\)\s*$/, '')
                  .trim() || undefined
              : undefined,
          ...(String(shift.comentarioOps || '').trim()
            ? {
                comentario: String(shift.comentarioOps).trim(),
                comentarioPor: String(shift.comentarioOpsPor || '').trim() || undefined,
              }
            : {}),
        };

        if (esRetManana) {
          retMananaList.push(mapped);
          continue;
        }

        const considerar = (turno: TurnoHoy, turnoStartMs: number) => {
          const prev = byName.get(employeeName);
          if (!prev) {
            byName.set(employeeName, { turno, startMs: turnoStartMs });
          } else {
            // Un guardia que cubre tiene dos turnos: su RET/origen (ya usado) y el de la cobertura.
            // La fila viva es la cobertura; el origen usado queda por detrás.
            const prioridad = (t: TurnoHoy) => (t.origin === 'OPERATIONS_COVERAGE' ? 2 : t.coverageUsed ? 0 : 1);
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
              presenciaSource: i === 0 ? String(shift.presenciaSource || '') : '',
              checkInMethod: i === 0 ? String(shift.checkInMethod || '') : '',
              isPresent: status === 'PRESENT',
              isCompleted: tramoCerrado,
              isRetention: false,
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
          continue;
        }

        if (cerrado) {
          cerradosMap.set(d.id, mapped);
          continue;
        }

        considerar(mapped, startMs);
      }

      const next: Record<string, TurnoHoy> = {};
      const metaNext: Record<string, PresenciaMeta> = {};
      byName.forEach((v, name) => {
        next[name] = v.turno;
      });
      const idsEnDict = new Set(Object.values(next).map((t) => t.rowId));
      const extrasTramos = tramosAbiertos.filter((t) => !idsEnDict.has(t.rowId));
      for (const d of docs) {
        const shift = d.data() as Record<string, unknown>;
        const realEnd = shift.realEndTime as Timestamp | undefined;
        metaNext[d.id] = {
          checkInSource: String(shift.checkInSource || ''),
          presenciaSource: String(shift.presenciaSource || ''),
          checkInMethod: String(shift.checkInMethod || ''),
          isPresent: shift.isPresent === true,
          isCompleted: String(shift.status || '').toUpperCase() === 'COMPLETED' || shift.isCompleted === true,
          isRetention: shift.isRetention === true,
          realEndLabel: realEnd ? formatHHMM(realEnd) : '',
        };
      }
      Object.assign(metaNext, metaTramos);
      const cerradosNext: Record<string, TurnoHoy> = {};
      cerradosMap.forEach((turno, id) => {
        cerradosNext[id] = turno;
      });
      setTurnos(next);
      setTramosExtra(extrasTramos);
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
      snap.docs.forEach((d) => {
        const data = d.data() as Record<string, unknown>;
        const raw = String(data.telefono || data.phone || '').replace(/\D/g, '');
        const norm = raw.replace(/^549/, '');
        if (norm) m.set(d.id, norm);
      });
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

  return { turnos, loading, phones, francos, presenciaMeta, cerrados, clientePorObj, retenesManana, tramosExtra };
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

type FuenteMarca = 'WA' | 'Radio' | 'App' | 'Op' | '—';

function fuenteDe(estado: GuardEstado, meta?: PresenciaMeta): FuenteMarca {
  if (estado === 'PENDIENTE_WA' || estado === 'PRESENTE_WA') return 'WA';
  const src = String(meta?.presenciaSource || meta?.checkInMethod || meta?.checkInSource || '').toUpperCase();
  if (src === 'PORTAL_GPS' || src === 'APP_GEO' || src === 'APP_QR') return 'App';
  if (src === 'MANUAL_RADIO' || src.includes('RADIO')) return 'Radio';
  if (src === 'WA' || src === 'WHATSAPP') return 'WA';
  if (src === 'MANUAL' || src === 'OPERATIONS' || src === 'MANUAL_PHONE') return 'Op';
  if (estado === 'PRESENTE_PLAT' && meta?.isPresent) return 'App';
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
};

const COLS_DEFAULT =
  '3px minmax(270px,2.2fr) minmax(130px,1fr) 96px 52px 5.5rem 5.5rem 5.5rem 5.5rem 6.5rem 4.5rem 6.5rem minmax(11rem,auto)';

const SHEET_COLS = 'grid-cols-[var(--mr-cols)]';

/** Anchos mínimos (px) de las 12 columnas ajustables: Guardia … Acción. */
const COLS_MIN = [150, 90, 60, 40, 60, 60, 60, 60, 50, 50, 80, 140];
const COLS_ANCHOS_KEY = 'mr-col-anchos-v1';

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
  const crudo = String(nombreCompleto || '').trim();
  const pila = (crudo.includes(',') ? crudo.split(',')[1] : crudo).trim().split(/\s+/)[0] || '';
  const nombre = pila ? pila.charAt(0).toUpperCase() + pila.slice(1).toLowerCase() : '';
  const tramo =
    turno && turno.bloquesTotal && turno.bloquesTotal > 1 && turno.bloque
      ? ` (tramo ${turno.bloque} de ${turno.bloquesTotal})`
      : '';
  const donde = turno?.obj && turno.obj !== '—' ? ` en ${turno.obj}` : '';
  return `✅ ${nombre ? `${nombre}, ` : ''}recibimos tu ingreso y se confirmó tu presencia a las ${hora}${tramo}${donde}. ¡Gracias!`;
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
    if (diff > 0) return { label: `+${diff} min`, tone: 'late' };
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

function ModalCobertura({
  absent,
  remanente,
  retCandidates,
  retEsManana,
  extCandidates,
  intercambioCandidates,
  francoCandidates,
  busy,
  onClose,
  onAsignarRet,
  onExtender,
  onIntercambiar,
  onConvocarFt,
  onAvisarWa,
}: {
  absent: GuardRowModel;
  /** Retiro anticipado: se cubre solo el resto del turno (desde/hasta HH:MM). */
  remanente?: { desde: string; hasta: string } | null;
  retCandidates: GuardRowModel[];
  retEsManana: boolean;
  extCandidates: GuardRowModel[];
  intercambioCandidates: GuardRowModel[];
  francoCandidates: GuardRowModel[];
  busy: boolean;
  onClose: () => void;
  onAsignarRet: (c: GuardRowModel) => void;
  onExtender: (c: GuardRowModel, code: 'D12' | 'N12') => void;
  onIntercambiar: (c: GuardRowModel) => void;
  onConvocarFt: (c: GuardRowModel) => void;
  onAvisarWa: (c: GuardRowModel, plantilla: 'cobertura' | 'intercambio') => void;
}) {
  // Puesto 24 h: el turno es exactamente M/T/N/D12/N12 (código del catálogo). Cualquier otro código
  // es un puesto custom (EN, C1, SA…): solo admite RET y franco trabajado.
  const codigoAusente = String(absent.turno.code || '').trim().toUpperCase();
  const esCustom = !BANDS.includes(codigoAusente as (typeof BANDS)[number]);
  const esPuesto24h = !esCustom && ['M', 'T', 'N'].includes(absent.band) && !remanente;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden max-h-[90vh] flex flex-col"
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
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-100 text-slate-400"
          >
            ✕
          </button>
        </div>

        <div className="px-4 py-3 overflow-y-auto">
          {/* 1. RET disponible */}
          <div className="mb-4">
            <div className="text-[11px] font-bold text-violet-700 uppercase tracking-wide mb-2">
              🛡️ 1. RET {retEsManana ? 'de mañana (cubre la noche)' : 'de hoy'} ({retCandidates.length})
            </div>
            {retCandidates.length === 0 ? (
              <div className="text-[11px] text-slate-400 py-2">
                {retEsManana ? 'Sin retenes cargados para mañana' : 'Sin retenes disponibles'}
              </div>
            ) : (
              <div className="space-y-1">
                {retCandidates.map((c) => (
                  <div
                    key={c.turno.rowId}
                    className="flex items-center gap-2 p-2 rounded-xl border border-violet-200 bg-violet-50"
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

          {/* 2. Extender a 12h — solo si el puesto es 24hs */}
          {esPuesto24h && (
            <div className="mb-4">
              <div className="text-[11px] font-bold text-amber-700 uppercase tracking-wide mb-2">
                ⏱ 2. Extender a 12 h ({extCandidates.length})
              </div>
              {extCandidates.length === 0 ? (
                <div className="text-[11px] text-slate-400 py-2">
                  Sin guardias del mismo objetivo para extender
                </div>
              ) : (
                <div className="space-y-1">
                  {extCandidates.map((c) => (
                    <div
                      key={c.turno.rowId}
                      className="flex items-center gap-2 p-2 rounded-xl border border-amber-200 bg-amber-50"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] font-semibold text-slate-800 truncate">
                          {c.employeeName}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {c.band} · {c.turno.expected}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onExtender(c, 'D12')}
                        className="px-2 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-[10px] font-bold disabled:opacity-50"
                      >
                        → D12
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onExtender(c, 'N12')}
                        className="px-2 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold disabled:opacity-50"
                      >
                        → N12
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 3. Intercambio (no aplica al resto de un retiro anticipado ni a puestos custom) */}
          {!remanente && !esCustom && (
          <div className="mb-4">
            <div className="text-[11px] font-bold text-blue-700 uppercase tracking-wide mb-2">
              🔄 3. Intercambio con otro turno ({intercambioCandidates.length})
            </div>
            {intercambioCandidates.length === 0 ? (
              <div className="text-[11px] text-slate-400 py-2">Sin candidatos para intercambiar</div>
            ) : (
              <div className="space-y-1 max-h-32 overflow-y-auto">
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

          {/* 4. FT — último recurso */}
          <div>
            <div className="text-[11px] font-bold text-red-700 uppercase tracking-wide mb-2">
              💰 4. Franco trabajado — último recurso ({francoCandidates.length})
            </div>
            {francoCandidates.length === 0 ? (
              <div className="text-[11px] text-slate-400 py-2">Sin guardias de franco hoy</div>
            ) : (
              <div className="space-y-1 max-h-32 overflow-y-auto">
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
      <button
        type="button"
        disabled={busy}
        onClick={() => onBeginEdit(row, 'ingreso')}
        className="px-2 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold disabled:opacity-50"
      >
        Horario
      </button>
    );
  }

  const fuenteClass =
    row.fuente === 'WA'
      ? 'text-blue-700'
      : row.fuente === 'App'
        ? 'text-indigo-700'
        : row.fuente === 'Radio'
          ? 'text-emerald-700'
          : 'text-slate-500';

  return (
    <div
      data-rowid={row.turno.rowId}
      style={{ scrollMarginTop: 72, scrollMarginBottom: 16 }}
      onClick={() => onSelect(row)}
      className={`mr-row grid ${SHEET_COLS} ${SHEET_ALIGN} items-center px-0 py-0 border-b border-slate-100 cursor-pointer [&>*]:py-1.5 [&>*:not(:first-child)]:border-r [&>*:not(:first-child)]:border-slate-100 [&>*:last-child]:border-r-0 ${
        active ? 'mr-row-active' : swapOrigin ? 'mr-row-swap' : row.turno.retiro ? 'mr-row-retiro' : ''
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
      <div className="truncate text-[11px] text-slate-600" title={row.turno.obj}>{row.turno.obj}</div>
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
          row.salidaReal && row.salidaReal !== '--:--' ? row.salidaReal : '—'
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

function RetenePanel({
  rows,
  busy,
  onMarcarPresente,
  onConfirmarWA,
}: {
  rows: GuardRowModel[];
  busy: boolean;
  onMarcarPresente: (row: GuardRowModel) => void;
  onConfirmarWA: (row: GuardRowModel) => void;
}) {
  const [open, setOpen] = useState(true);
  if (rows.length === 0) return null;
  const disponibles = rows.filter(
    (r) => r.estado !== 'AUSENTE' && r.estado !== 'NO_LLEGO',
  ).length;

  return (
    <div className="mr-retenes border-b-2 border-violet-200">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-violet-100/60 text-left"
      >
        {open ? (
          <ChevronDown size={14} className="text-violet-500" />
        ) : (
          <ChevronRight size={14} className="text-violet-500" />
        )}
        <span className="text-xs font-black text-violet-800 tracking-wide">
          🛡️ RETENES HOY
        </span>
        <span className="ml-1 px-1.5 py-0.5 rounded-full bg-violet-200 text-violet-700 text-[9px] font-bold">
          {disponibles} disp. / {rows.length}
        </span>
      </button>
      {open && (
        <div>
          {rows.map((row) => {
            const pill = estadoPill(row.estado);
            let action: React.ReactNode = null;
            if (row.estado === 'PENDIENTE_WA') {
              action = (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onConfirmarWA(row)}
                  className="px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold disabled:opacity-50"
                >
                  ✓ Confirmar
                </button>
              );
            } else if (row.estado === 'ESPERANDO' || row.estado === 'TARDANZA') {
              action = (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onMarcarPresente(row)}
                  className="px-2 py-1 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-[10px] font-bold disabled:opacity-50"
                >
                  ✓ Disponible
                </button>
              );
            }
            return (
              <div
                key={row.turno.rowId}
                className="flex items-center gap-3 px-4 py-2 border-b border-violet-100 hover:bg-violet-50"
              >
                <span
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    row.estado === 'PRESENTE_WA' || row.estado === 'PRESENTE_PLAT'
                      ? 'bg-emerald-500'
                      : row.estado === 'ESPERANDO' || row.estado === 'PENDIENTE_WA'
                        ? 'bg-violet-400 animate-pulse'
                        : row.estado === 'AUSENTE' || row.estado === 'NO_LLEGO'
                          ? 'bg-red-400'
                          : 'bg-slate-300'
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-800 truncate">
                    {row.employeeName}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {row.turno.expected}
                    {row.turno.phone ? ` · ${row.turno.phone}` : ''}
                  </div>
                </div>
                <span
                  className={`px-2 py-0.5 text-[9px] font-bold rounded-full whitespace-nowrap ${pill.className}`}
                >
                  {pill.label}
                </span>
                {action}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
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
        className="w-full flex items-center gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100 text-left cursor-grab active:cursor-grabbing select-none"
      >
        <GripVertical size={14} className="text-slate-400 flex-shrink-0" />
        {open ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
        <span className="text-xs font-bold text-slate-800 truncate">{objName}</span>
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
              onCobertura={onCobertura}
              onRevertirAusencia={onRevertirAusencia}
              onIntercambio={onIntercambio}
              onRetiro={onRetiro}
              swapOrigin={swapFromId === row.turno.rowId}
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
              entry.tardanzaMins <= 0 ? 'text-emerald-600' : 'text-amber-600'
            }`}
          >
            {entry.tardanzaMins <= 0 ? 'Puntual' : `+${entry.tardanzaMins} min tarde`}
          </div>
        )}
        {entry.lat != null && entry.lng != null && entry.objLat != null && entry.objLng != null && (() => {
          const d = haversineM(entry.lat!, entry.lng!, entry.objLat!, entry.objLng!);
          const ok = d <= 80;
          const warn = d <= 300;
          return (
            <div className={`text-[10px] font-medium ${ok ? 'text-emerald-600' : warn ? 'text-amber-500' : 'text-red-500'}`}>
              {ok ? '✓' : '⚠'} {d < 1000 ? `${d} m` : `${(d / 1000).toFixed(1)} km`} del objetivo
            </div>
          );
        })()}
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

      {confirmados.length > 0 && (
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
              title="Incluye lo confirmado desde todas las pantallas y sesiones"
            >
              <Lock size={10} className="inline -mt-0.5 mr-0.5" aria-hidden />
              Todas las sesiones
            </span>
          </div>
          {logOpen && (
            <div className="overflow-y-auto flex-1 min-h-0">
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
            </div>
          )}
        </div>
      )}

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
  const { turnos, loading, francos, presenciaMeta, cerrados, clientePorObj, retenesManana, tramosExtra } = turnosData;
  const wa = useWABridge(turnos, empresaId);

  const [bridgeUrl, setBridgeUrl] = useState('');
  const [bridgeCfg, setBridgeCfg] = useState<'cargando' | 'ok' | 'sin_config'>('cargando');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
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
  const [revertirChoice, setRevertirChoice] = useState<GuardRowModel | null>(null);
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
    // Cada empresa usa SOLO su bridge (Configuración → WA Bridge). Sin configuración no se
    // conecta a ninguno: antes caía al bridge de Bacar y leía/escribía en el WhatsApp de otra empresa.
    setBridgeUrl('');
    setBridgeCfg('cargando');
    wa.disconnect();
    (async () => {
      if (!empresaId) {
        setBridgeCfg('sin_config');
        return;
      }
      try {
        const snap = await getDoc(doc(db, 'empresas', empresaId, 'config', 'wa-bridge'));
        if (cancelled) return;
        const data = snap.exists() ? (snap.data() as { url?: string }) : null;
        const url = typeof data?.url === 'string' ? data.url.trim() : '';
        if (url) {
          setBridgeUrl(url);
          setBridgeCfg('ok');
        } else {
          setBridgeCfg('sin_config');
        }
      } catch {
        if (!cancelled) setBridgeCfg('sin_config');
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
    if (bridgeUrl) wa.connect(bridgeUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- connect al cambiar URL; wa estable por refs internas
  }, [bridgeUrl]);

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
    const today = new Date();
    const [hh, mm] = realTime.split(':').map(Number);
    today.setHours(hh, mm, 0, 0);
    const realTs = Timestamp.fromDate(today);
    const docId = docIdDe(turnoId);
    const tramo = indiceTramoDe(turnoId) + 1;

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
          checkInAt: serverTimestamp(),
        }),
        'la presencia',
      );
    } else {
      // Tramo 2+ de un turno cortado: la presencia vive en `presenciaBloques.bN`. El turno pasa a
      // PRESENT y su fin planificado se corre al fin de este tramo para que el cierre automático
      // del servidor (que solo conoce el primer tramo) no lo cierre en el corte.
      const snap = await leerTurnoRapido(docId);
      const data = (snap.data() || {}) as Record<string, unknown>;
      const bloques = bloquesDelTurno(data.blocks);
      const baseMs = toStartMs(data.startTime);
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

  /**
   * La ausencia sigue en el turno del titular y la cubre otro turno (extensión, FT): se marca el
   * titular como cubierto para que el Centro de Control clásico no lo muestre «sin cubrir».
   */
  async function marcarTitularCubierto(
    turno: TurnoHoy,
    cubre: { id?: string | null; name: string },
    coverageType: string,
  ) {
    if (turno.turnoStatus !== 'ABSENT') return;
    try {
      await updateDoc(
        doc(db, 'turnos', docIdDe(turno.rowId)),
        absentShiftCoveragePatch({
          coveredByEmployeeId: cubre.id ?? null,
          coveredByEmployeeName: cubre.name,
          coverageType,
          resolvedBy: 'OPERACIONES',
          isAbsence: true,
        }),
      );
    } catch (err) {
      console.warn('[modo-rapido] no se pudo marcar el titular como cubierto', err);
    }
    await marcarAusenciaGestionada(docIdDe(turno.rowId), cubre, coverageType);
  }

  const classifiedRows = useMemo((): GuardRowModel[] => {
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
        const diff = esRet && !realForDiff
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

    // Segunda pasada: un turno NO_LLEGO/AUSENTE puede ya estar cubierto por otro turno
    // real de hoy, mismo objetivo + mismo puesto + mismo horario de inicio, asignado a
    // otro empleado que sí está presente/esperando (no ausente/no-llegó él mismo).
    return base.map((row): GuardRowModel => {
      if (row.estado !== 'NO_LLEGO' && row.estado !== 'AUSENTE') return row;
      // Cobertura del motor oficial: el propio titular ya lo dice (cubre RET, FT o extensión).
      if (row.turno.coveredByName) return { ...row, coveredByName: row.turno.coveredByName };
      const cover = base.find((other) => {
        if (other === row) return false;
        if (other.estado === 'NO_LLEGO' || other.estado === 'AUSENTE') return false;
        // Solo un FT (franco trabajado) es evidencia real de cobertura: un compañero
        // haciendo su M/T/N normal en el mismo horario no está cubriendo a nadie.
        if (other.turno.code !== 'FT') return false;
        if (!other.turno.objectiveId || other.turno.objectiveId !== row.turno.objectiveId) return false;
        if (other.turno.expected !== row.turno.expected) return false;
        if (
          row.turno.positionName &&
          other.turno.positionName &&
          row.turno.positionName !== other.turno.positionName
        ) {
          return false;
        }
        return true;
      });
      return cover ? { ...row, coveredByName: cover.employeeName } : row;
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
  }, [turnos, tramosExtra, wa, nowMs, presenciaMeta, cerrados]);

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

  const reteneRows = useMemo(
    () => filteredRows.filter((r) => r.band === 'RET'),
    [filteredRows],
  );

  const sheetRows = useMemo(() => {
    const list: GuardRowModel[] = [];
    for (const [, rows] of nonReteGroups) list.push(...rows);
    list.push(...reteneRows);
    return list;
  }, [nonReteGroups, reteneRows]);

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
    if (esTramoCortado(c.turno)) return false;
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

  const retCandidates = useMemo((): GuardRowModel[] => {
    if (!coberturaModal) return [];
    if (retUsaManana) {
      return retenesManana
        .filter((t) => esCandidatoValido({ turno: t } as GuardRowModel, coberturaModal))
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
        }));
    }
    return classifiedRows.filter(
      (r) => r.band === 'RET' && esCandidatoValido(r, coberturaModal),
    );
  }, [coberturaModal, classifiedRows, retenesManana, retUsaManana]);

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
  async function abrirCobertura(row: GuardRowModel) {
    if (busy) return;
    if (bloqueaTramo(row)) return;
    if (row.estado !== 'NO_LLEGO' || row.turno.turnoStatus === 'ABSENT') {
      setCoberturaModal(row);
      return;
    }
    const ok = window.confirm(
      `${row.employeeName} no llegó pasados 30 min del inicio.\n\nPara cubrir se declara la ausencia (AA): queda en RRHH y Planificación. Podés revertirla si llega.\n\n¿Declarar la ausencia y cubrir?`,
    );
    if (!ok) return;
    setBusy(true);
    let apilado = false;
    try {
      await recordarTurno(row.turno.rowId);
      apilado = true;
      await registrarAusencia(row.turno.rowId, { name: row.employeeName });
      showToast(`Ausencia declarada · ${row.employeeName}`, 'bg-red-700');
      setCoberturaModal({
        ...row,
        estado: 'AUSENTE',
        turno: { ...row.turno, turnoStatus: 'ABSENT' },
      });
    } catch (err) {
      if (apilado) undoRef.current.pop();
      console.warn('[modo-rapido] abrirCobertura', err);
      showToast('No se pudo declarar la ausencia', 'bg-red-600');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Revertir ausencia: mismo criterio que el CC clásico. Se puede hasta T+60; si ya hay cobertura o
   * convocatorias en curso se pregunta qué hacer (liberar a quien cubre y vuelve el titular, o dejar la AA).
   */
  async function revertirAusencia(row: GuardRowModel) {
    if (busy) return;
    if (bloqueaTramo(row)) return;
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
      if (!window.confirm(`¿Revertir la ausencia de ${row.employeeName}?`)) return;
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

  /** Cobertura, cambio y retiro de un tramo de turno cortado todavía se hacen desde Operaciones. */
  function bloqueaTramo(row: GuardRowModel): boolean {
    if (!esTramoCortado(row.turno)) return false;
    showToast('Turno cortado: cobertura, cambio y retiro se hacen desde Operaciones por ahora', 'bg-slate-700');
    return true;
  }

  function pedirRetiro(row: GuardRowModel) {
    if (bloqueaTramo(row)) return;
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

  /** Datos del retiro que se está pidiendo: horas que faltan, compañeros y política de reemplazo. */
  const retiroInfo = useMemo(() => {
    if (!retiroModal) return null;
    const finMs = toStartMs(retiroModal.turno.endTimeRaw);
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
      const finPlanificadoMs = toStartMs(row.turno.endTimeRaw);
      const retiroMs = Date.now();
      const fn = httpsCallable(functions, 'processEarlyWithdrawalCallable');
      const res = await fn({
        shiftId: row.turno.rowId,
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

  async function cerrarTurno(row: GuardRowModel) {
    if (busy) return;
    if (row.estado !== 'PRESENTE_PLAT' && row.estado !== 'PRESENTE_WA') return;
    setBusy(true);
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
      const close = computeShiftCloseTimes(dataCierre, Date.now());
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
      showToast(`Turno cerrado · ${row.employeeName} ${formatHHMM(realEndTime)}`, 'bg-slate-800');
    } catch (err) {
      console.warn('[modo-rapido] cerrarTurno', err);
      showToast('Error al cerrar el turno', 'bg-red-600');
    } finally {
      setBusy(false);
      setArm(null);
    }
  }

  const handleAsignarRet = async (candidate: GuardRowModel) => {
    if (!coberturaModal || busy) return;
    setBusy(true);
    try {
      if (huecoRetiro) {
        // Retiro anticipado: el turno del que se retira queda cerrado con sus horas trabajadas y el
        // resto lo cubre un turno nuevo del RET (desde el retiro hasta el fin planificado).
        const origenSnap = await leerTurnoRapido(huecoRetiro.docId);
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
        const horasResto = Math.round(((huecoRetiro.hastaMs - huecoRetiro.desdeMs) / 3600000) * 100) / 100;
        const nuevoRef = await addDoc(collection(db, 'turnos'), {
          ...copiar,
          employeeId: candidate.turno.employeeId,
          employeeName: candidate.employeeName,
          startTime: Timestamp.fromMillis(huecoRetiro.desdeMs),
          endTime: Timestamp.fromMillis(huecoRetiro.hastaMs),
          hours: horasResto,
          status: 'PENDING',
          draft: false,
          origin: 'RET_COBERTURA',
          resolvedBy: 'OPERACIONES',
          coberturaDesdeTurnoId: candidate.turno.rowId,
          remanenteDeTurnoId: huecoRetiro.docId,
          createdAt: serverTimestamp(),
        });
        await updateDoc(doc(db, 'turnos', candidate.turno.rowId), {
          coverageAssignedTo: nuevoRef.id,
        });
        await addDoc(collection(db, 'novedades'), {
          type: 'COBERTURA_RET',
          turnoAusenteId: huecoRetiro.docId,
          turnoAusenteEmpleado: coberturaModal.employeeName,
          turnoAusenteObj: coberturaModal.turno.obj,
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
            coberturaModal.turno.obj,
            formatHHMM(Timestamp.fromMillis(huecoRetiro.desdeMs)),
            coberturaModal.salida || '—',
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
      const titularId = docIdDe(coberturaModal.turno.rowId);
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
        objectiveId: coberturaModal.turno.objectiveId ?? null,
        objectiveName: coberturaModal.turno.obj,
        shiftId: coverDocId,
        description: `${candidate.employeeName} (RET) cubre ${coberturaModal.turno.expected}–${coberturaModal.salida || '—'} en ${coberturaModal.turno.obj} (titular: ${coberturaModal.employeeName})`,
        empresaId,
        createdAt: serverTimestamp(),
        reportedBy: 'OPERACIONES',
        operatorId: user?.uid ?? 'cc-modo-rapido',
      });
      const aviso = abrirWa(
        candidate.turno.phone,
        waMensaje.cobertura(
          candidate.employeeName,
          coberturaModal.turno.obj,
          coberturaModal.turno.expected,
          coberturaModal.salida || '—',
        ),
      );
      showToast(
        aviso
          ? `RET asignado · WhatsApp abierto · ${candidate.employeeName}`
          : `RET asignado · ${candidate.employeeName}. Sin teléfono para WhatsApp.`,
        aviso ? 'bg-violet-700' : 'bg-amber-700',
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

  const handleExtender = async (candidate: GuardRowModel, code: 'D12' | 'N12') => {
    if (!coberturaModal || busy) return;
    setBusy(true);
    try {
      const startMs =
        candidate.turno.startTimeRaw &&
        typeof (candidate.turno.startTimeRaw as Timestamp).toMillis === 'function'
          ? (candidate.turno.startTimeRaw as Timestamp).toMillis()
          : Date.now();
      const newEndTime = Timestamp.fromMillis(startMs + 12 * 3600000);
      // Se guardan el código y el fin anteriores del guardia que extiende: si se revierte la ausencia
      // del titular, la extensión se deshace y el guardia vuelve a su turno original.
      const candidatoDocId = docIdDe(candidate.turno.rowId);
      const titularExtId = docIdDe(coberturaModal.turno.rowId);
      const previo = (await leerTurnoRapido(candidatoDocId)).data() || {};
      await updateDoc(doc(db, 'turnos', candidatoDocId), {
        code,
        endTime: newEndTime,
        extensionPrevCode: previo.code ?? null,
        extensionPrevEndTime: previo.endTime ?? null,
        extensionParaTurnoId: titularExtId,
      });
      await marcarTitularCubierto(
        coberturaModal.turno,
        { id: candidate.turno.employeeId, name: candidate.employeeName },
        'EXTEND',
      );
      if (coberturaModal.turno.turnoStatus === 'ABSENT') {
        await updateDoc(doc(db, 'turnos', titularExtId), { extensionCandidateTurnoId: candidatoDocId });
      }
      await addDoc(collection(db, 'novedades'), {
        type: 'EXTENSION_12H',
        code,
        turnoAusenteId: coberturaModal.turno.rowId,
        turnoAusenteEmpleado: coberturaModal.employeeName,
        turnoAusenteObj: coberturaModal.turno.obj,
        extendidoEmpleado: candidate.employeeName,
        empresaId,
        operatorId: user?.uid ?? 'cc-modo-rapido',
        createdAt: serverTimestamp(),
      });
      showToast(`${candidate.employeeName} extendido a ${code}`, 'bg-amber-700');
    } catch {
      showToast('Error al extender turno', 'bg-red-600');
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
      await updateDoc(doc(db, 'turnos', coberturaModal.turno.rowId), {
        ...parcheTurnoReasignadoDeAusente(coberturaModal.turno),
        employeeId: candidate.turno.employeeId,
        employeeName: candidate.employeeName,
        origin: 'INTERCAMBIO',
        intercambioConTurnoId: candidate.turno.rowId,
      });
      await updateDoc(doc(db, 'turnos', candidate.turno.rowId), {
        employeeId: absentEmployeeId,
        employeeName: coberturaModal.employeeName,
        origin: 'INTERCAMBIO',
        intercambioConTurnoId: coberturaModal.turno.rowId,
      });
      if (coberturaModal.turno.turnoStatus === 'ABSENT') {
        await marcarAusenciaGestionada(
          docIdDe(coberturaModal.turno.rowId),
          { id: candidate.turno.employeeId, name: candidate.employeeName },
          'INTERCAMBIO',
        );
      }
      await addDoc(collection(db, 'novedades'), {
        type: 'INTERCAMBIO_TURNO',
        turnoAusenteId: coberturaModal.turno.rowId,
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
    if (bloqueaTramo(origen) || bloqueaTramo(destino)) {
      setSwapFromId(null);
      return;
    }
    setBusy(true);
    try {
      const origenEmployeeId = String(origen.turno.employeeId || '');
      await updateDoc(doc(db, 'turnos', origen.turno.rowId), {
        ...parcheTurnoReasignadoDeAusente(origen.turno),
        employeeId: destino.turno.employeeId,
        employeeName: destino.employeeName,
        origin: 'INTERCAMBIO',
        intercambioConTurnoId: destino.turno.rowId,
      });
      await updateDoc(doc(db, 'turnos', destino.turno.rowId), {
        ...parcheTurnoReasignadoDeAusente(destino.turno),
        employeeId: origenEmployeeId,
        employeeName: origen.employeeName,
        origin: 'INTERCAMBIO',
        intercambioConTurnoId: origen.turno.rowId,
      });
      if (origen.turno.turnoStatus === 'ABSENT') {
        await marcarAusenciaGestionada(
          docIdDe(origen.turno.rowId),
          { id: destino.turno.employeeId, name: destino.employeeName },
          'INTERCAMBIO',
        );
      }
      if (destino.turno.turnoStatus === 'ABSENT') {
        await marcarAusenciaGestionada(
          docIdDe(destino.turno.rowId),
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
        turnoAusenteId: origen.turno.rowId,
        turnoAusenteEmpleado: origen.employeeName,
        turnoAusenteObj: origen.turno.obj,
        intercambioEmpleado: destino.employeeName,
        intercambioObj: destino.turno.obj,
        empresaId,
        operatorId: user?.uid ?? 'cc-modo-rapido',
        createdAt: serverTimestamp(),
      });
      const tituloToast = `${anticipado ? 'Intercambio anticipado' : 'Intercambio'} · ${origen.employeeName} ↔ ${destino.employeeName}`;
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
      if (candidateEmployeeId && empresaId) {
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
    setBusy(true);
    try {
      const entry = row.pendingEntry;
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

  function descartarCheckIn(entry: WAEntry) {
    wa.dismissEntry(entry);
    showToast(`Check-in descartado · ${entry.name}`, 'bg-slate-700');
  }

  const handleConfirmEntrySidebar = async (entry: WAEntry) => {
    if (busy) return;
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
          textoConfirmacionWA(empName, entry.arrivedAt || nowHHMM(), Object.values(turnos).find((t) => t.rowId === entry.rowId)),
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
        if (swapFromId && swapFromId !== row.turno.rowId) {
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
        if (bloqueaTramo(row)) return;
        setArm(null);
        setSwapFromId(row.turno.rowId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheetRows, activeRowId, hourEdit, arm, swapFromId, coberturaModal, accionesModal, comentarioModal, revertirChoice, busy, pantallaCompleta, retiroModal, retiroMotivo, retiroReemplazo, retiroInfo]);

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
              bridgeCfg === 'sin_config'
                ? `${empresa?.name || empresaId || 'Esta empresa'} no tiene WA Bridge configurado (Configuración → WA Bridge)`
                : bridgeUrl
                  ? `WA Bridge de ${empresa?.name || empresaId || 'la empresa'}: ${bridgeUrl}`
                  : undefined
            }
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                bridgeCfg === 'sin_config'
                  ? 'bg-slate-300'
                  : wa.status === 'connected'
                    ? 'bg-emerald-500 animate-pulse'
                    : wa.status === 'error'
                      ? 'bg-red-500'
                      : 'bg-amber-400'
              }`}
            />
            {bridgeCfg === 'sin_config'
              ? 'sin bridge configurado'
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
          {stats.retenes > 0 && (
            <ChipIcono
              icon={Shield}
              label="Retenes (RET)"
              count={stats.retenes}
              active={bandFilter === 'RET'}
              accent="bg-violet-100 text-violet-700 border-violet-300"
              tono="text-violet-600"
              onClick={() => setBandFilter(bandFilter === 'RET' ? 'all' : 'RET')}
            />
          )}

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
              const titulo = anticipado ? 'Intercambio anticipado' : 'Intercambio';
              if (from && from.turno.rowId !== activeRow.turno.rowId) {
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
                className={colAnchos ? undefined : 'min-w-[1280px]'}
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
                  <CabeceraCol idx={1} onResizeStart={iniciarAjusteColumna} onResizeReset={restablecerColumnas}>Objetivo</CabeceraCol>
                  <CabeceraCol idx={2} onResizeStart={iniciarAjusteColumna} onResizeReset={restablecerColumnas}>Puesto</CabeceraCol>
                  <CabeceraCol idx={3} onResizeStart={iniciarAjusteColumna} onResizeReset={restablecerColumnas}>Cód</CabeceraCol>
                  <CabeceraCol idx={4} onResizeStart={iniciarAjusteColumna} onResizeReset={restablecerColumnas}>
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
                  <CabeceraCol idx={5} onResizeStart={iniciarAjusteColumna} onResizeReset={restablecerColumnas} className="whitespace-nowrap font-black" title="Ingreso real">Ing. R.</CabeceraCol>
                  <CabeceraCol idx={6} onResizeStart={iniciarAjusteColumna} onResizeReset={restablecerColumnas} className="whitespace-nowrap" title="Egreso planificado">Egr. P.</CabeceraCol>
                  <CabeceraCol idx={7} onResizeStart={iniciarAjusteColumna} onResizeReset={restablecerColumnas} className="whitespace-nowrap font-black" title="Egreso real">Egr. R.</CabeceraCol>
                  <CabeceraCol idx={8} onResizeStart={iniciarAjusteColumna} onResizeReset={restablecerColumnas}>Dif</CabeceraCol>
                  <CabeceraCol idx={9} onResizeStart={iniciarAjusteColumna} onResizeReset={restablecerColumnas}>Fuente</CabeceraCol>
                  <CabeceraCol idx={10} onResizeStart={iniciarAjusteColumna} onResizeReset={restablecerColumnas}>Estado</CabeceraCol>
                  <CabeceraCol idx={11} onResizeStart={iniciarAjusteColumna} onResizeReset={restablecerColumnas}>Acción</CabeceraCol>
                </div>
                <RetenePanel
                  rows={reteneRows}
                  busy={busy}
                  onMarcarPresente={(r) => void handleMarcarPresente(r)}
                  onConfirmarWA={(r) => void handleConfirmarWA(r)}
                />
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
                    onMarcarPresente={(r) => void handleMarcarPresente(r)}
                    onConfirmarWA={(r) => void handleConfirmarWA(r)}
                    onCobertura={(r) => void abrirCobertura(r)}
                    onRevertirAusencia={(r) => void revertirAusencia(r)}
                    onIntercambio={(r) => {
                      if (bloqueaTramo(r)) return;
                      setHourEdit(null);
                      setArm(null);
                      setActiveRowId(r.turno.rowId);
                      setSwapFromId((prev) => (prev === r.turno.rowId ? null : r.turno.rowId));
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
            retCandidates={retCandidates}
            retEsManana={retUsaManana}
            extCandidates={extCandidates}
            intercambioCandidates={intercambioCandidates}
            francoCandidates={francoCandidates}
            busy={busy}
            onClose={() => setCoberturaModal(null)}
            onAsignarRet={(c) => void handleAsignarRet(c)}
            onExtender={(c, code) => void handleExtender(c, code)}
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
              if (bloqueaTramo(r)) return;
              setHourEdit(null);
              setArm(null);
              setActiveRowId(r.turno.rowId);
              setSwapFromId(r.turno.rowId);
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
