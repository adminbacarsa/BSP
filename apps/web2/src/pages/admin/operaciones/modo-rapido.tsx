import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import {
  doc,
  getDoc,
  onSnapshot,
  query,
  QueryDocumentSnapshot,
  Timestamp,
  where,
} from 'firebase/firestore';
import { ArrowLeft, ChevronDown, ChevronUp, MessageSquare, Zap } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
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
  | 'ESPERANDO';

function GuardList({
  turnos,
  wa,
}: {
  turnos: Record<string, TurnoHoy>;
  wa: UseWABridgeReturn;
}) {
  const rows = useMemo(() => {
    return Object.entries(turnos).sort((a, b) =>
      String(a[1].expected).localeCompare(String(b[1].expected)),
    );
  }, [turnos]);

  return (
    <div>
      {rows.map(([employeeName, turno]) => {
        const pendingEntry = wa.pending.find((e) => e.rowId === turno.rowId);
        let estado: GuardEstado = 'ESPERANDO';
        if (turno.turnoStatus === 'PRESENT') estado = 'PRESENTE_PLAT';
        else if (wa.confirmedRowIds.has(turno.rowId)) estado = 'PRESENTE_WA';
        else if (pendingEntry) estado = 'PENDIENTE_WA';
        else if (turno.turnoStatus === 'ABSENT') estado = 'AUSENTE';

        return (
          <div
            key={turno.rowId}
            className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-100 hover:bg-slate-50"
          >
            <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-600 flex-shrink-0">
              {employeeName.split(' ')[0]?.[0]?.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-slate-800 truncate">{employeeName}</div>
              <div className="text-[10px] text-slate-500 truncate">
                {turno.obj} · {turno.shift}
              </div>
            </div>
            <div className="text-[10px] text-slate-400 font-mono flex-shrink-0">{turno.expected}</div>
            {estado === 'PRESENTE_PLAT' && (
              <span className="px-2 py-0.5 bg-emerald-200 text-emerald-800 text-[9px] font-bold rounded-full flex-shrink-0">
                ✓ PRESENTE
              </span>
            )}
            {estado === 'PRESENTE_WA' && (
              <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[9px] font-bold rounded-full flex-shrink-0">
                ✓ WA
              </span>
            )}
            {estado === 'PENDIENTE_WA' && (
              <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-[9px] font-bold rounded-full flex-shrink-0 animate-pulse">
                ● WA
              </span>
            )}
            {estado === 'AUSENTE' && (
              <span className="px-2 py-0.5 bg-red-100 text-red-700 text-[9px] font-bold rounded-full flex-shrink-0">
                AUSENTE
              </span>
            )}
            {estado === 'ESPERANDO' && (
              <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-[9px] font-bold rounded-full flex-shrink-0">
                ESPERANDO
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function WACard({ entry, onConfirm }: { entry: WAEntry; onConfirm: () => void }) {
  return (
    <div className="flex items-start gap-2 p-3 border-b border-slate-100">
      {entry.hasLocation && entry.lat && entry.lng ? (
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
      )}
      <div className="flex-1 min-w-0">
        <div className="text-xs font-bold text-slate-800">{entry.name}</div>
        <div className="text-[10px] text-slate-500">{entry.shift || entry.msgType}</div>
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
          onClick={onConfirm}
          className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[9px] font-bold rounded-lg transition-colors"
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
        <div className="text-[10px] text-slate-500 truncate">{entry.shift || ''}</div>
      </div>
      <span className="text-[10px] text-slate-400 font-mono flex-shrink-0">{entry.arrivedAt}</span>
    </div>
  );
}

function WASidebar({
  wa,
  logOpen,
  setLogOpen,
  logFilter,
  setLogFilter,
  logPage,
  setLogPage,
  LOG_PAGE: pageSize,
}: {
  wa: UseWABridgeReturn;
  logOpen: boolean;
  setLogOpen: (v: boolean) => void;
  logFilter: string;
  setLogFilter: (v: string) => void;
  logPage: number;
  setLogPage: React.Dispatch<React.SetStateAction<number>>;
  LOG_PAGE: number;
}) {
  const filtered = wa.confirmedEntries.filter(
    (e) => !logFilter || e.name.toLowerCase().includes(logFilter.toLowerCase()),
  );
  const visible = filtered.slice(0, logPage * pageSize);
  const remaining = filtered.length - logPage * pageSize;

  return (
    <>
      <div className="px-3 py-2.5 border-b border-slate-200 flex items-center gap-2 flex-shrink-0">
        <span className="text-emerald-600 text-xs font-black">⬡ Check-ins</span>
        <span className="text-[10px] text-slate-500">
          · {wa.badge} pendientes
        </span>
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
              onConfirm={() => wa.confirmEntry(entry)}
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

    </>
  );
}

export default function ModoRapidoPage() {
  const router = useRouter();
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [logOpen, setLogOpen] = useState(false);
  const [logFilter, setLogFilter] = useState('');
  const [logPage, setLogPage] = useState(1);

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
      if (sb === '0') setSidebarOpen(false);
      else if (sb === '1') setSidebarOpen(true);
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

  return (
    <DashboardLayout>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: 'calc(100vh - 56px)',
        }}
      >
        <header className="flex items-center gap-2 px-4 py-2 bg-white border-b border-slate-200 flex-shrink-0 h-11">
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
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[10px] text-slate-400">
              {loading ? 'cargando…' : `${Object.keys(turnos).length} guardias hoy`}
            </span>
            <button
              type="button"
              onClick={() => {
                const v = !sidebarOpen;
                setSidebarOpen(v);
                try {
                  localStorage.setItem('wa-mr-sb', v ? '1' : '0');
                } catch {
                  /* ignore */
                }
              }}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-600"
            >
              <MessageSquare size={12} />
              {sidebarOpen ? 'Ocultar' : 'Check-ins'}
              {!sidebarOpen && wa.badge > 0 && (
                <span className="w-4 h-4 bg-red-500 text-white rounded-full text-[8px] flex items-center justify-center">
                  {wa.badge}
                </span>
              )}
            </button>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-8 text-center text-sm text-slate-400">
                Cargando planificación del día…
              </div>
            ) : Object.keys(turnos).length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-400">
                Sin guardias planificados para hoy
              </div>
            ) : (
              <GuardList turnos={turnos} wa={wa} />
            )}
          </div>

          {sidebarOpen && (
            <aside className="w-72 flex-shrink-0 border-l border-slate-200 bg-white flex flex-col overflow-hidden">
              <WASidebar
                wa={wa}
                logOpen={logOpen}
                setLogOpen={setLogOpen}
                logFilter={logFilter}
                setLogFilter={setLogFilter}
                logPage={logPage}
                setLogPage={setLogPage}
                LOG_PAGE={LOG_PAGE}
              />
            </aside>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
