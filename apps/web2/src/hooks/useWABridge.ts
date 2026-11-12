import { useCallback, useEffect, useRef, useState } from 'react';

export interface WAEntry {
  id: string;
  rowId?: string;
  name: string;
  phone: string;
  arrivedAt: string;
  shift?: string;
  expected?: string;
  tardanzaMins?: number;
  hasLocation: boolean;
  lat?: number;
  lng?: number;
  msgType: string;
}

export interface WAConfirmedEntry {
  rowId?: string;
  name: string;
  arrivedAt: string;
  shift?: string;
  lat?: number;
  lng?: number;
}

export interface TurnoHoy {
  shift: string;
  obj: string;
  rowId: string;
  expected: string;
  /** Estado del turno en plataforma (PRESENT = ya marcó en CC/app). */
  turnoStatus?: 'PENDING' | 'PRESENT' | 'ABSENT' | 'COMPLETED' | 'CANCELED' | string;
  /** Hora real de entrada ya registrada en plataforma (HH:MM). */
  realStartTime?: string;
}

export type WABridgeStatus = 'idle' | 'connecting' | 'connected' | 'error';

export interface UseWABridgeReturn {
  status: WABridgeStatus;
  badge: number;
  pending: WAEntry[];
  confirmedEntries: WAConfirmedEntry[];
  confirmedRowIds: ReadonlySet<string>;
  confirmEntry: (entry: WAEntry) => void;
  clearAll: () => void;
  connect: (url: string) => void;
  /** Solo pruebas / demo sin bridge. */
  addFakePending: (partial?: Partial<WAEntry>) => void;
}

interface BridgeMsg {
  id: string;
  name: string;
  phone: string;
  time: string;
  type: 'location' | 'image' | 'text' | 'protocol' | string;
  location?: { latitude: number; longitude: number };
  hasPhoto?: boolean;
}

interface BridgeMessagesResponse {
  ts?: number;
  startedAt?: number;
  messages?: BridgeMsg[];
}

function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

let _lsEmpresaId: string | null = null;
function lsKey(prefix: string): string {
  const scope = _lsEmpresaId ? `-${_lsEmpresaId}` : '';
  return `${prefix}${scope}-${todayKey()}`;
}

function nowHHMM(): string {
  return new Date().toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function calcTardanzaMins(arrivedAt: string, expected?: string): number | undefined {
  if (!expected || !arrivedAt) return undefined;
  try {
    const [eh, em] = expected.split(':').map(Number);
    const [ah, am] = arrivedAt.split(':').map(Number);
    if ([eh, em, ah, am].some((n) => Number.isNaN(n))) return undefined;
    return ah * 60 + am - (eh * 60 + em);
  } catch {
    return undefined;
  }
}

function findTurno(turnos: Record<string, TurnoHoy>, name: string): TurnoHoy | undefined {
  const pushName = (name || '').toLowerCase();
  if (!pushName) return undefined;
  const key = Object.keys(turnos).find((k) => {
    const kk = k.toLowerCase();
    return pushName.includes(kk) || kk.includes(pushName);
  });
  return key ? turnos[key] : undefined;
}

export function useWABridge(turnos: Record<string, TurnoHoy>, empresaId?: string | null): UseWABridgeReturn {
  _lsEmpresaId = empresaId ?? null;
  const [status, setStatus] = useState<WABridgeStatus>('idle');
  const [badge, setBadge] = useState(0);
  const [pending, setPending] = useState<WAEntry[]>([]);
  const [confirmedEntries, setConfirmedEntries] = useState<WAConfirmedEntry[]>([]);
  const [confirmedRowIds, setConfirmedRowIds] = useState<Set<string>>(() => new Set());

  const bridgeUrlRef = useRef('');
  const lastTsRef = useRef(0);
  const bridgeStartRef = useRef(0);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const pendingRowIdsRef = useRef<Set<string>>(new Set());
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const turnosRef = useRef(turnos);
  const confirmedRowIdsRef = useRef(confirmedRowIds);

  useEffect(() => {
    turnosRef.current = turnos;
  }, [turnos]);

  useEffect(() => {
    confirmedRowIdsRef.current = confirmedRowIds;
  }, [confirmedRowIds]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(lsKey('wa-lastts'));
      if (raw) {
        const n = parseInt(raw, 10);
        if (!Number.isNaN(n)) lastTsRef.current = n;
      }
    } catch {
      /* ignore */
    }

    try {
      const raw = localStorage.getItem(lsKey('wa-confirmed'));
      const ids = JSON.parse(raw || '[]') as unknown;
      if (Array.isArray(ids)) {
        setConfirmedRowIds(new Set(ids.filter((x): x is string => typeof x === 'string')));
      }
    } catch {
      /* ignore */
    }

    try {
      const raw = localStorage.getItem(lsKey('wa-confirmed-log'));
      const log = JSON.parse(raw || '[]') as unknown;
      if (Array.isArray(log)) {
        setConfirmedEntries(log as WAConfirmedEntry[]);
      }
    } catch {
      /* ignore */
    }

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, []);

  const poll = useCallback(async () => {
    const bridgeUrl = bridgeUrlRef.current;
    if (!bridgeUrl) return;

    try {
      const r = await fetch(`${bridgeUrl}/messages?since=${lastTsRef.current}`, {
        signal: AbortSignal.timeout(4000),
      });
      if (!r.ok) {
        setStatus('error');
        return;
      }
      setStatus('connected');
      const data = (await r.json()) as BridgeMessagesResponse;

      if (data.startedAt && data.startedAt !== bridgeStartRef.current) {
        if (bridgeStartRef.current > 0) {
          seenIdsRef.current.clear();
          lastTsRef.current = 0;
          try {
            localStorage.removeItem(lsKey('wa-lastts'));
          } catch {
            /* ignore */
          }
          bridgeStartRef.current = data.startedAt;
          return;
        }
        bridgeStartRef.current = data.startedAt;
      }

      if (data.ts) {
        lastTsRef.current = data.ts;
        try {
          localStorage.setItem(lsKey('wa-lastts'), String(data.ts));
        } catch {
          /* ignore */
        }
      }

      const msgs = (data.messages || []).filter((m) => !seenIdsRef.current.has(m.id));
      if (!msgs.length) return;

      const newEntries: WAEntry[] = [];
      let added = 0;

      for (const m of msgs) {
        seenIdsRef.current.add(m.id);

        if (m.type === 'protocol') continue;

        const turno = findTurno(turnosRef.current, m.name);
        if (
          turno?.rowId &&
          (pendingRowIdsRef.current.has(turno.rowId) ||
            confirmedRowIdsRef.current.has(turno.rowId))
        ) {
          continue;
        }

        const arrivedAt = m.time || nowHHMM();
        const entry: WAEntry = {
          id: m.id,
          rowId: turno?.rowId,
          name: m.name,
          phone: m.phone,
          arrivedAt,
          shift: turno?.shift,
          expected: turno?.expected,
          tardanzaMins: calcTardanzaMins(arrivedAt, turno?.expected),
          hasLocation: !!m.location,
          lat: m.location?.latitude,
          lng: m.location?.longitude,
          msgType: m.type,
        };

        if (entry.rowId) pendingRowIdsRef.current.add(entry.rowId);
        newEntries.push(entry);
        added += 1;
      }

      if (!newEntries.length) return;

      // Prepend: más nuevo primero (msgs llega cronológico → reverse al prependear en lote)
      const ordered = [...newEntries].reverse();
      setPending((prev) => [...ordered, ...prev]);
      setBadge((b) => b + added);
    } catch {
      setStatus('error');
    }
  }, []);

  const connect = useCallback(
    (url: string) => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      bridgeUrlRef.current = url;
      setStatus('connecting');
      void poll();
      pollTimerRef.current = setInterval(() => {
        void poll();
      }, 3000);
    },
    [poll],
  );

  const confirmEntry = useCallback((entry: WAEntry) => {
    setPending((prev) => prev.filter((e) => e.id !== entry.id));
    setBadge((b) => Math.max(0, b - 1));

    if (entry.rowId) {
      pendingRowIdsRef.current.delete(entry.rowId);
      setConfirmedRowIds((prev) => {
        const next = new Set(prev);
        next.add(entry.rowId!);
        try {
          localStorage.setItem(lsKey('wa-confirmed'), JSON.stringify([...next]));
        } catch {
          /* ignore */
        }
        return next;
      });
    }

    const confirmed: WAConfirmedEntry = {
      rowId: entry.rowId,
      name: entry.name,
      arrivedAt: entry.arrivedAt,
      shift: entry.shift,
      lat: entry.lat,
      lng: entry.lng,
    };

    setConfirmedEntries((prev) => {
      const next = [confirmed, ...prev];
      try {
        localStorage.setItem(lsKey('wa-confirmed-log'), JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setPending([]);
    setBadge(0);
    setConfirmedEntries([]);
    setConfirmedRowIds(new Set());
    pendingRowIdsRef.current.clear();
    seenIdsRef.current.clear();
    lastTsRef.current = 0;
    try {
      localStorage.removeItem(lsKey('wa-lastts'));
      localStorage.removeItem(lsKey('wa-confirmed'));
      localStorage.removeItem(lsKey('wa-confirmed-log'));
    } catch {
      /* ignore */
    }
  }, []);

  const addFakePending = useCallback((partial?: Partial<WAEntry>) => {
    const names = Object.keys(turnosRef.current);
    const name =
      partial?.name ||
      (names.length > 0 ? names[Math.floor(Math.random() * names.length)] : 'Demo Guardia');
    const turno = findTurno(turnosRef.current, name);
    const arrivedAt = partial?.arrivedAt || nowHHMM();
    const expected = partial?.expected || turno?.expected;
    const entry: WAEntry = {
      id: partial?.id || `demo-${Date.now()}`,
      rowId: partial?.rowId || turno?.rowId,
      name,
      phone: partial?.phone || '',
      arrivedAt,
      shift: partial?.shift || turno?.shift,
      expected,
      tardanzaMins:
        partial?.tardanzaMins !== undefined
          ? partial.tardanzaMins
          : calcTardanzaMins(arrivedAt, expected),
      hasLocation: partial?.hasLocation ?? false,
      lat: partial?.lat,
      lng: partial?.lng,
      msgType: partial?.msgType || 'text',
    };
    if (entry.rowId) pendingRowIdsRef.current.add(entry.rowId);
    setPending((prev) => [entry, ...prev]);
    setBadge((b) => b + 1);
  }, []);

  return {
    status,
    badge,
    pending,
    confirmedEntries,
    confirmedRowIds,
    confirmEntry,
    clearAll,
    connect,
    addFakePending,
  };
}
