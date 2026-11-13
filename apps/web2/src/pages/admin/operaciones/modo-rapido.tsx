import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  QueryDocumentSnapshot,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  MessageSquare,
  Search,
  Zap,
} from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';
import { db } from '@/lib/firebase';
import { empresaCollectionQuery, shouldScopeQueriesToEmpresa } from '@/lib/multiempresa';
import { isRestFrancoShift } from '@/hooks/useOperacionesMonitor';
import {
  TurnoHoy,
  UseWABridgeReturn,
  WAConfirmedEntry,
  WAEntry,
  useWABridge,
} from '@/hooks/useWABridge';

const DEFAULT_BRIDGE_URL = 'https://autbacar.dnsalias.com/wabridge';
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
  'FT',
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

/** Minutos desde expected (HH:MM del día actual) hasta nowMs. Positivo = tarde. */
function minutesSinceExpected(expected: string, nowMs: number): number | null {
  const expMins = parseHHMMToMins(expected);
  if (expMins === null) return null;
  const d = new Date(nowMs);
  d.setHours(Math.floor(expMins / 60), expMins % 60, 0, 0);
  return Math.floor((nowMs - d.getTime()) / 60000);
}

function extractBand(shift: string): string {
  const code = String(shift || '')
    .trim()
    .split(/\s+/)[0]
    ?.toUpperCase() || '';
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
}): { turnos: Record<string, TurnoHoy>; loading: boolean } {
  const [turnos, setTurnos] = useState<Record<string, TurnoHoy>>({});
  const [loading, setLoading] = useState(true);
  const objMapRef = useRef<Map<string, { name: string; clientName: string }>>(new Map());
  const phoneMapRef = useRef<Map<string, string>>(new Map());
  const lastTurnosSnapRef = useRef<QueryDocumentSnapshot[] | null>(null);

  useEffect(() => {
    if (!empresaId) {
      setTurnos({});
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
      const m = new Map<string, { name: string; clientName: string }>();
      docs.forEach((d) => {
        const data = d.data() as Record<string, unknown>;
        const clientName = String(data.name || '');
        const objs = Array.isArray(data.objetivos)
          ? (data.objetivos as Record<string, unknown>[])
          : [];
        objs.forEach((o) => {
          const key = String(o.id || o.objectiveId || '');
          if (key) m.set(key, { name: String(o.name || ''), clientName });
        });
      });
      return m;
    };

    const applyTurnos = (docs: QueryDocumentSnapshot[]) => {
      const now = Date.now();
      const byName = new Map<string, { turno: TurnoHoy; startMs: number }>();

      for (const d of docs) {
        const shift = d.data() as Record<string, unknown>;
        // Excluir turnos de otra empresa (filtro en memoria para legacy bacarsa sin scope)
        if (
          !scopeEmpresa &&
          shift.empresaId &&
          String(shift.empresaId).trim() !== '' &&
          String(shift.empresaId).trim().toLowerCase() !== (empresaId || '').toLowerCase()
        ) {
          continue;
        }
        if (shift.draft === true) continue;

        const employeeId = String(shift.employeeId ?? '');
        const employeeName = String(shift.employeeName ?? '').trim();
        if (employeeId === 'VACANTE' || !employeeName) continue;

        const code = String(shift.code || '').toUpperCase();
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
          continue;
        }
        if (SKIP_CODES.has(code)) continue;

        const startMs = toStartMs(shift.startTime);
        if (Number.isNaN(startMs)) continue;

        const endTs = shift.endTime as Timestamp | undefined;
        const startTs = shift.startTime as Timestamp;
        const realTs = shift.realStartTime as Timestamp | undefined;

        const mapped: TurnoHoy = {
          shift: `${code || '?'} ${formatHHMM(startTs)}–${formatHHMM(endTs)}`,
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
        };

        const prev = byName.get(employeeName);
        if (!prev) {
          byName.set(employeeName, { turno: mapped, startMs });
        } else {
          const prevDist = Math.abs(prev.startMs - now);
          const nextDist = Math.abs(startMs - now);
          if (nextDist < prevDist) {
            byName.set(employeeName, { turno: mapped, startMs });
          }
        }
      }

      const next: Record<string, TurnoHoy> = {};
      byName.forEach((v, name) => {
        next[name] = v.turno;
      });
      setTurnos(next);
      setLoading(false);
    };

    const clientsQ = empresaCollectionQuery('clients', empresaId, scopeEmpresa);
    const unsubClients = onSnapshot(clientsQ, (snap) => {
      objMapRef.current = buildObjMap(snap.docs);
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

  return { turnos, loading };
}

type GuardEstado =
  | 'PRESENTE_PLAT'
  | 'PRESENTE_WA'
  | 'PENDIENTE_WA'
  | 'AUSENTE'
  | 'ESPERANDO'
  | 'TARDANZA'
  | 'NO_LLEGO';

type StatsFilter = 'all' | 'critico' | 'tardanza' | 'sin_confirmar' | 'ok';

type GuardRowModel = {
  employeeName: string;
  turno: TurnoHoy;
  estado: GuardEstado;
  pendingEntry?: WAEntry;
  realDisplay: string;
  diffLabel: string;
  diffTone: 'late' | 'early' | 'countdown' | 'neutral';
  band: string;
};

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

  const late = minutesSinceExpected(turno.expected, nowMs);
  if (late !== null && late > 30) return { estado: 'NO_LLEGO', pendingEntry };
  if (late !== null && late > 10) return { estado: 'TARDANZA', pendingEntry };
  return { estado: 'ESPERANDO', pendingEntry };
}

function buildDiff(
  expected: string,
  real: string | undefined,
  nowMs: number,
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

  const late = minutesSinceExpected(expected, nowMs);
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
    default:
      return 'bg-slate-200';
  }
}

function estadoPill(estado: GuardEstado): { label: string; className: string } {
  switch (estado) {
    case 'NO_LLEGO':
      return { label: 'NO LLEGÓ', className: 'bg-red-100 text-red-700' };
    case 'TARDANZA':
      return { label: 'TARDANZA', className: 'bg-orange-100 text-orange-700' };
    case 'PENDIENTE_WA':
      return { label: '● WA', className: 'bg-blue-100 text-blue-700 animate-pulse' };
    case 'ESPERANDO':
      return { label: 'ESPERANDO', className: 'bg-amber-100 text-amber-700' };
    case 'PRESENTE_WA':
      return { label: '✓ WA', className: 'bg-emerald-100 text-emerald-700' };
    case 'PRESENTE_PLAT':
      return { label: '✓ PRESENTE', className: 'bg-emerald-200 text-emerald-800' };
    case 'AUSENTE':
      return { label: 'AUSENTE', className: 'bg-red-100 text-red-700' };
    default:
      return { label: estado, className: 'bg-slate-100 text-slate-600' };
  }
}

function GuardRow({
  row,
  busy,
  onMarcarPresente,
  onConfirmarWA,
  onCobertura,
  onMore,
}: {
  row: GuardRowModel;
  busy: boolean;
  onMarcarPresente: (row: GuardRowModel) => void;
  onConfirmarWA: (row: GuardRowModel) => void;
  onCobertura: () => void;
  onMore: () => void;
}) {
  const pill = estadoPill(row.estado);
  const diffClass =
    row.diffTone === 'late'
      ? 'text-red-600'
      : row.diffTone === 'early'
        ? 'text-emerald-600'
        : 'text-slate-500';

  let primary: React.ReactNode = null;
  if (row.estado === 'NO_LLEGO') {
    primary = (
      <button
        type="button"
        disabled={busy}
        onClick={onCobertura}
        className="px-2 py-1 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[10px] font-bold disabled:opacity-50"
      >
        🚨 Cobertura
      </button>
    );
  } else if (row.estado === 'TARDANZA') {
    primary = (
      <button
        type="button"
        disabled={busy}
        onClick={() => onMarcarPresente(row)}
        className="px-2 py-1 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-[10px] font-bold disabled:opacity-50"
      >
        Registrar
      </button>
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
      <button
        type="button"
        disabled={busy}
        onClick={() => onMarcarPresente(row)}
        className="px-2 py-1 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-[10px] font-bold disabled:opacity-50"
      >
        ✓ Llegó
      </button>
    );
  }

  return (
    <div className="grid grid-cols-[3px_minmax(0,1.6fr)_minmax(0,0.9fr)_64px_64px_72px_88px_minmax(96px,auto)] items-center gap-x-2 px-2 py-2 border-b border-slate-100 hover:bg-slate-50/80">
      <div className={`self-stretch rounded-full ${barClass(row.estado)}`} />
      <div className="min-w-0 pl-1">
        <div className="text-sm font-medium text-slate-800 truncate">{row.employeeName}</div>
        <div className="text-[10px] text-slate-500 truncate">{row.turno.obj}</div>
      </div>
      <div className="text-[11px] text-slate-600 font-mono truncate">{row.turno.shift}</div>
      <div className="text-[11px] text-slate-500 font-mono text-center">{row.turno.expected}</div>
      <div className="text-[11px] text-slate-700 font-mono text-center">{row.realDisplay}</div>
      <div className={`text-[10px] font-semibold text-center ${diffClass}`}>{row.diffLabel}</div>
      <div className="flex justify-center">
        <span className={`px-2 py-0.5 text-[9px] font-bold rounded-full whitespace-nowrap ${pill.className}`}>
          {pill.label}
        </span>
      </div>
      <div className="flex items-center justify-end gap-1 pr-1">
        {primary}
        <button
          type="button"
          onClick={onMore}
          className="px-1.5 py-1 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 text-[11px] font-bold"
          title="Más acciones"
        >
          ···
        </button>
      </div>
    </div>
  );
}

function ObjectiveGroup({
  objName,
  rows,
  open,
  onToggle,
  busy,
  onMarcarPresente,
  onConfirmarWA,
  onCobertura,
  onMore,
}: {
  objName: string;
  rows: GuardRowModel[];
  open: boolean;
  onToggle: () => void;
  busy: boolean;
  onMarcarPresente: (row: GuardRowModel) => void;
  onConfirmarWA: (row: GuardRowModel) => void;
  onCobertura: () => void;
  onMore: () => void;
}) {
  const hasNoLlego = rows.some((r) => r.estado === 'NO_LLEGO');
  const hasTardanza = rows.some((r) => r.estado === 'TARDANZA');

  return (
    <div className="border-b border-slate-200">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100 text-left"
      >
        {open ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
        <span className="text-xs font-bold text-slate-800 truncate flex-1">{objName}</span>
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
      </button>
      {open && (
        <div>
          {rows.map((row) => (
            <GuardRow
              key={row.turno.rowId}
              row={row}
              busy={busy}
              onMarcarPresente={onMarcarPresente}
              onConfirmarWA={onConfirmarWA}
              onCobertura={onCobertura}
              onMore={onMore}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function WACard({
  entry,
  onConfirm,
  busy,
}: {
  entry: WAEntry;
  onConfirm: () => void;
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
}: {
  wa: UseWABridgeReturn;
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
}) {
  const filtered = wa.confirmedEntries.filter(
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
            />
          ))
        )}
      </div>

      {wa.confirmedEntries.length > 0 && (
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
                {wa.confirmedEntries.length}
              </span>
            </button>
            <button
              type="button"
              onClick={() => wa.clearAll()}
              className="ml-auto text-[9px] font-bold text-red-500 hover:text-red-700"
            >
              Limpiar
            </button>
          </div>
          {logOpen && (
            <div className="overflow-y-auto flex-1 min-h-0">
              {wa.confirmedEntries.length > pageSize && (
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

  const { turnos, loading } = useTurnosHoy({
    empresaId: empresaId || null,
    scopeEmpresa,
  });
  const wa = useWABridge(turnos, empresaId);

  const [bridgeUrl, setBridgeUrl] = useState(DEFAULT_BRIDGE_URL);
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
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string, color = 'bg-slate-800') => {
    setToast({ msg, color });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }, []);

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
    (async () => {
      try {
        // URL por empresa (Configuración → WA Bridge); fallback al doc global legacy
        const paths = empresaId
          ? [
              doc(db, 'empresas', empresaId, 'config', 'wa-bridge'),
              doc(db, 'config', 'wa-bridge'),
            ]
          : [doc(db, 'config', 'wa-bridge')];
        for (const ref of paths) {
          const snap = await getDoc(ref);
          if (cancelled) return;
          if (snap.exists()) {
            const data = snap.data() as { url?: string };
            if (typeof data.url === 'string' && data.url.trim()) {
              setBridgeUrl(data.url.trim());
              break;
            }
          }
        }
      } catch {
        /* fallback DEFAULT_BRIDGE_URL */
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

  const setSidebar = useCallback((collapsed: boolean) => {
    setSidebarCollapsed(collapsed);
    try {
      localStorage.setItem('wa-mr-sb', collapsed ? '0' : '1');
    } catch {
      /* ignore */
    }
  }, []);

  async function marcarPresente(
    turnoId: string,
    empleado: { name: string; expected: string },
    realTime: string,
    source: 'WA' | 'MANUAL',
  ) {
    const today = new Date();
    const [hh, mm] = realTime.split(':').map(Number);
    today.setHours(hh, mm, 0, 0);
    const realTs = Timestamp.fromDate(today);

    await updateDoc(doc(db, 'turnos', turnoId), {
      status: 'PRESENT',
      realStartTime: realTs,
      checkInSource: source,
      checkInAt: serverTimestamp(),
    });

    await addDoc(collection(db, 'novedades'), {
      type: source === 'WA' ? 'CHECK_IN_WA' : 'CHECK_IN_MANUAL',
      turnoId,
      employeeName: empleado.name,
      expected: empleado.expected,
      realTime,
      source,
      empresaId,
      operatorId: user?.uid ?? 'cc-modo-rapido',
      createdAt: serverTimestamp(),
    });
  }

  async function registrarAusencia(turnoId: string, empleado: { name: string }) {
    await updateDoc(doc(db, 'turnos', turnoId), {
      status: 'ABSENT',
      absenceCode: 'AA',
      absenceRegisteredAt: serverTimestamp(),
    });
    await addDoc(collection(db, 'novedades'), {
      type: 'AUSENCIA_REGISTRADA',
      turnoId,
      employeeName: empleado.name,
      code: 'AA',
      empresaId,
      operatorId: user?.uid ?? 'cc-modo-rapido',
      createdAt: serverTimestamp(),
    });
  }

  const classifiedRows = useMemo((): GuardRowModel[] => {
    return Object.entries(turnos)
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
        const diff = buildDiff(turno.expected, realForDiff, nowMs);

        return {
          employeeName,
          turno,
          estado,
          pendingEntry,
          realDisplay,
          diffLabel: diff.label,
          diffTone: diff.tone,
          band: extractBand(turno.shift),
        };
      })
      .sort((a, b) => String(a.turno.expected).localeCompare(String(b.turno.expected)));
  }, [turnos, wa, nowMs]);

  const stats = useMemo(() => {
    let critico = 0;
    let tardanza = 0;
    let sinConfirmar = 0;
    let ok = 0;
    for (const r of classifiedRows) {
      if (r.estado === 'NO_LLEGO') critico += 1;
      else if (r.estado === 'TARDANZA') tardanza += 1;
      else if (r.estado === 'PENDIENTE_WA') sinConfirmar += 1;
      else if (r.estado === 'PRESENTE_WA' || r.estado === 'PRESENTE_PLAT') ok += 1;
    }
    return { total: classifiedRows.length, critico, tardanza, sinConfirmar, ok };
  }, [classifiedRows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return classifiedRows.filter((r) => {
      if (bandFilter !== 'all' && r.band !== bandFilter) return false;
      if (statsFilter === 'critico' && r.estado !== 'NO_LLEGO') return false;
      if (statsFilter === 'tardanza' && r.estado !== 'TARDANZA') return false;
      if (statsFilter === 'sin_confirmar' && r.estado !== 'PENDIENTE_WA') return false;
      if (
        statsFilter === 'ok' &&
        r.estado !== 'PRESENTE_WA' &&
        r.estado !== 'PRESENTE_PLAT'
      ) {
        return false;
      }
      if (q) {
        const hay =
          r.employeeName.toLowerCase().includes(q) ||
          r.turno.obj.toLowerCase().includes(q);
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
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredRows]);

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
      }
      showToast(`Confirmado WA · ${row.employeeName}`, 'bg-emerald-700');
    } catch (err) {
      console.warn('[modo-rapido] confirmarWA', err);
      showToast('Error al confirmar check-in WA', 'bg-red-600');
    } finally {
      setBusy(false);
    }
  };

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
      }
      showToast(`Confirmado WA · ${entry.name}`, 'bg-emerald-700');
    } catch (err) {
      console.warn('[modo-rapido] confirmEntry sidebar', err);
      showToast('Error al confirmar check-in WA', 'bg-red-600');
    } finally {
      setBusy(false);
    }
  };

  const chipClass = (active: boolean, accent: string) =>
    `flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold whitespace-nowrap border transition-colors ${
      active
        ? accent
        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
    }`;

  return (
    <DashboardLayout>
      <div className="flex flex-col h-[calc(100vh-56px)] relative">
        <header className="flex items-center gap-2 px-4 py-2 bg-white border-b border-slate-200 flex-shrink-0 min-h-11">
          <button
            type="button"
            onClick={() => void router.push('/admin/operaciones')}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
          >
            <ArrowLeft size={15} />
          </button>
          <Zap size={14} className="text-emerald-600 ml-1" />
          <span className="text-sm font-black text-slate-800">CC Modo Rápido</span>
          {wa.badge > 0 && (
            <span className="px-1.5 py-0.5 bg-red-500 text-white text-[9px] font-bold rounded-full">
              {wa.badge}
            </span>
          )}
          <div className="flex items-center gap-1 ml-2 text-[10px] text-slate-500">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                wa.status === 'connected'
                  ? 'bg-emerald-500 animate-pulse'
                  : wa.status === 'error'
                    ? 'bg-red-500'
                    : 'bg-amber-400'
              }`}
            />
            {wa.status === 'connected'
              ? 'conectado'
              : wa.status === 'error'
                ? 'sin respuesta'
                : 'conectando…'}
          </div>

          <div className="ml-3 relative flex-1 max-w-xs hidden sm:block">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar guardia u objetivo…"
              className="w-full pl-7 pr-2 py-1.5 text-[11px] border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-1 focus:ring-emerald-400"
            />
          </div>

          <div className="ml-auto flex items-center gap-2">
            <span className="text-[10px] text-slate-400">
              {loading ? 'cargando…' : `${Object.keys(turnos).length} guardias hoy`}
            </span>
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

        <div className="flex items-center gap-2 px-3 py-2 bg-white border-b border-slate-100 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden flex-shrink-0">
          <button
            type="button"
            onClick={() => setStatsFilter('all')}
            className={chipClass(
              statsFilter === 'all',
              'bg-slate-800 text-white border-slate-800',
            )}
          >
            Todos · {stats.total}
          </button>
          <button
            type="button"
            onClick={() => setStatsFilter('critico')}
            className={chipClass(
              statsFilter === 'critico',
              'bg-red-100 text-red-700 border-red-300',
            )}
          >
            🔴 Crítico · {stats.critico}
          </button>
          <button
            type="button"
            onClick={() => setStatsFilter('tardanza')}
            className={chipClass(
              statsFilter === 'tardanza',
              'bg-orange-100 text-orange-700 border-orange-300',
            )}
          >
            🟠 Tardanza · {stats.tardanza}
          </button>
          <button
            type="button"
            onClick={() => setStatsFilter('sin_confirmar')}
            className={chipClass(
              statsFilter === 'sin_confirmar',
              'bg-blue-100 text-blue-700 border-blue-300',
            )}
          >
            🟡 Sin confirmar · {stats.sinConfirmar}
          </button>
          <button
            type="button"
            onClick={() => setStatsFilter('ok')}
            className={chipClass(
              statsFilter === 'ok',
              'bg-emerald-100 text-emerald-700 border-emerald-300',
            )}
          >
            🟢 OK · {stats.ok}
          </button>

          <div className="w-px h-5 bg-slate-200 mx-1 flex-shrink-0" />

          <button
            type="button"
            onClick={() => setBandFilter('all')}
            className={`px-2 py-1 rounded-lg text-[10px] font-bold border ${
              bandFilter === 'all'
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            Todos
          </button>
          {BANDS.map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => setBandFilter(b)}
              className={`px-2 py-1 rounded-lg text-[10px] font-bold border ${
                bandFilter === b
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {b}
            </button>
          ))}
        </div>

        <div className="sm:hidden px-3 py-2 border-b border-slate-100 bg-white flex-shrink-0">
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar guardia u objetivo…"
              className="w-full pl-7 pr-2 py-1.5 text-[11px] border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-1 focus:ring-emerald-400"
            />
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          <div className="flex-1 overflow-y-auto min-w-0">
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
              <>
                <div className="hidden md:grid grid-cols-[3px_minmax(0,1.6fr)_minmax(0,0.9fr)_64px_64px_72px_88px_minmax(96px,auto)] gap-x-2 px-2 py-1.5 bg-slate-50 border-b border-slate-200 sticky top-0 z-10 text-[9px] font-bold uppercase tracking-wide text-slate-400">
                  <span />
                  <span className="pl-1">Guardia</span>
                  <span>Turno</span>
                  <span className="text-center">Esperado</span>
                  <span className="text-center">Real</span>
                  <span className="text-center">Dif.</span>
                  <span className="text-center">Estado</span>
                  <span className="text-right pr-1">Acción</span>
                </div>
                {groups.map(([objName, rows]) => (
                  <ObjectiveGroup
                    key={objName}
                    objName={objName}
                    rows={rows}
                    open={groupOpen[objName] ?? true}
                    onToggle={() =>
                      setGroupOpen((prev) => ({
                        ...prev,
                        [objName]: !(prev[objName] ?? true),
                      }))
                    }
                    busy={busy}
                    onMarcarPresente={(r) => void handleMarcarPresente(r)}
                    onConfirmarWA={(r) => void handleConfirmarWA(r)}
                    onCobertura={() => showToast('Próximamente', 'bg-slate-800')}
                    onMore={() => showToast('Próximamente', 'bg-slate-800')}
                  />
                ))}
              </>
            )}
          </div>

          <WASidebar
            wa={wa}
            collapsed={sidebarCollapsed}
            onExpand={() => setSidebar(false)}
            onCollapse={() => setSidebar(true)}
            logOpen={logOpen}
            setLogOpen={setLogOpen}
            logFilter={logFilter}
            setLogFilter={setLogFilter}
            logPage={logPage}
            setLogPage={setLogPage}
            LOG_PAGE={LOG_PAGE}
            busy={busy}
            onConfirmEntry={(e) => void handleConfirmEntrySidebar(e)}
          />
        </div>

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
