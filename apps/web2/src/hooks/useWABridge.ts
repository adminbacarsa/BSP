import { useCallback, useEffect, useRef, useState } from 'react';
import { clasificarIngresoWa } from '@/lib/operaciones/respuestasWaGuardia';

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
  /** Base64 data-URL de foto de check-in (si el bridge la envía). */
  photo?: string;
  /** Grupo de WhatsApp de origen (para responderle al guardia). */
  groupId?: string;
  /** Nombre del objetivo/puesto donde trabaja el guardia. */
  obj?: string;
  /** Coordenadas del objetivo (para badge de distancia). */
  objLat?: number;
  objLng?: number;
  /** Epoch ms real del mensaje (para registrar la salida a la hora en que el guardia la avisó). */
  msgTs?: number;
}

export interface WAConfirmedEntry {
  rowId?: string;
  name: string;
  arrivedAt: string;
  shift?: string;
  lat?: number;
  lng?: number;
  obj?: string;
  phone?: string;
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
  /** Teléfono normalizado del empleado (sin +549), para match WA. */
  phone?: string;
  /** Nombre canónico del empleado en la plataforma (para mostrar en lugar del pushName WA). */
  name?: string;
  /** Coordenadas del objetivo para calcular distancia al check-in. */
  objLat?: number;
  objLng?: number;
  /** Datos crudos del turno, necesarios para escrituras de cobertura (RET/D12-N12/Intercambio/FT). */
  employeeId?: string;
  objectiveId?: string;
  positionName?: string;
  code?: string;
  startTimeRaw?: unknown;
  endTimeRaw?: unknown;
  empresaId?: string;
  /** Turno cortado: los dos horarios del mismo turno (HH:MM). startTimeRaw/endTimeRaw son los del primer tramo. */
  blocks?: Array<{ startTime: string; endTime: string }>;
  /** Turno cortado en CC: cada tramo es una fila. `rowId` del tramo 2+ es `<idTurno>#b<N>`. */
  docId?: string;
  bloque?: number;
  bloquesTotal?: number;
  /** Retiro anticipado ya registrado: motivo y hora real del retiro (HH:MM). */
  retiro?: { motivo: string; hora: string };
  /** Comentario del operador sobre el turno (`comentarioOps` del turno). */
  comentario?: string;
  /** Quién lo escribió. */
  comentarioPor?: string;
  /** Cobertura (motor oficial): origen del turno y vínculos con la ausencia que cubre/que lo cubre. */
  origin?: string;
  /** Turno RET/REF origen ya usado para cubrir a otro. */
  coverageUsed?: boolean;
  coverageDocId?: string;
  /** Si el titular ausente ya está cubierto: quién lo cubre y en qué estado. */
  coveredByName?: string;
  coverageStatus?: string;
  operacionallyCovered?: boolean;
}

export type WABridgeStatus = 'idle' | 'connecting' | 'connected' | 'error';

export interface UseWABridgeReturn {
  status: WABridgeStatus;
  badge: number;
  pending: WAEntry[];
  confirmedEntries: WAConfirmedEntry[];
  confirmedRowIds: ReadonlySet<string>;
  confirmEntry: (entry: WAEntry) => void;
  /**
   * Avisos de salida: ubicación enviada por un guardia que ya está presente, una vez finalizado su turno.
   * No son check-ins: la planilla decide si cierra el turno o lo deja para el operador.
   */
  salidas: WAEntry[];
  /** Da por atendido un aviso de salida (el turno se cerró o se descartó). */
  consumirSalida: (entry: WAEntry) => void;
  /** Descarta un check-in pendiente sin marcar presencia (duplicado, error, mensaje equivocado). */
  dismissEntry: (entry: WAEntry) => void;
  /** Le escribe al guardia por mensaje privado, no al grupo (el bridge decide si está habilitado). */
  responder: (entry: WAEntry, texto: string) => void;
  /** Mensaje privado a un teléfono por el bridge de la empresa (aviso informativo). `true` si salió. */
  enviar: (phone: string, texto: string) => Promise<boolean>;
  clearAll: () => void;
  connect: (url: string) => void;
  /** Corta la conexión con el bridge actual (cambio de empresa o sin configuración). */
  disconnect: () => void;
  /** Solo pruebas / demo sin bridge. */
  addFakePending: (partial?: Partial<WAEntry>) => void;
  groups: { id: string; name: string; participants: number }[];
  monitoredGroupIds: ReadonlySet<string>;
  toggleGroup: (groupId: string, enable: boolean) => Promise<void>;
  /** Envía lista de teléfonos al bridge para resolver LIDs automáticamente. */
  syncPhones: (phones: string[]) => Promise<void>;
}

interface BridgeMsg {
  id: string;
  /** Epoch ms real del mensaje en WhatsApp. */
  ts?: number;
  name: string;
  phone: string;
  time: string;
  type: 'location' | 'image' | 'text' | 'protocol' | string;
  location?: { latitude: number; longitude: number };
  hasPhoto?: boolean;
  groupId?: string;
  photo?: string | null;
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

function msDeRaw(raw: unknown): number {
  if (!raw) return 0;
  const r = raw as { toMillis?: () => number; seconds?: number };
  if (typeof r.toMillis === 'function') return r.toMillis();
  if (typeof r.seconds === 'number') return r.seconds * 1000;
  return 0;
}

function inicioDeHoyMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
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

/** Una fila por rowId: el dict «vigente» más los tramos extra del mismo día. */
function listaTurnosWa(turnos: Record<string, TurnoHoy>, extras: readonly TurnoHoy[]): TurnoHoy[] {
  const byId = new Map<string, TurnoHoy>();
  for (const t of Object.values(turnos)) {
    if (t?.rowId) byId.set(t.rowId, t);
  }
  for (const t of extras) {
    if (t?.rowId) byId.set(t.rowId, t);
  }
  return [...byId.values()];
}

export function useWABridge(
  turnos: Record<string, TurnoHoy>,
  empresaId?: string | null,
  /** Tramos abiertos que no quedaron en el dict por nombre (p. ej. tramo 1 de un cortado). */
  extras: readonly TurnoHoy[] = [],
): UseWABridgeReturn {
  _lsEmpresaId = empresaId ?? null;
  const [status, setStatus] = useState<WABridgeStatus>('idle');
  const [badge, setBadge] = useState(0);
  const [pending, setPending] = useState<WAEntry[]>([]);
  const [salidas, setSalidas] = useState<WAEntry[]>([]);
  const salidaRowIdsRef = useRef<Set<string>>(new Set());
  const [confirmedEntries, setConfirmedEntries] = useState<WAConfirmedEntry[]>([]);
  const [confirmedRowIds, setConfirmedRowIds] = useState<Set<string>>(() => new Set());
  const [groups, setGroups] = useState<{ id: string; name: string; participants: number }[]>([]);
  const [monitoredGroupIds, setMonitoredGroupIds] = useState<Set<string>>(new Set());

  const bridgeUrlRef = useRef('');
  const lastTsRef = useRef(0);
  const bridgeStartRef = useRef(0);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const pendingRowIdsRef = useRef<Set<string>>(new Set());
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const turnosRef = useRef(turnos);
  const extrasRef = useRef(extras);
  const confirmedRowIdsRef = useRef(confirmedRowIds);

  useEffect(() => {
    turnosRef.current = turnos;
  }, [turnos]);

  useEffect(() => {
    extrasRef.current = extras;
  }, [extras]);

  useEffect(() => {
    confirmedRowIdsRef.current = confirmedRowIds;
  }, [confirmedRowIds]);

  // Un check-in pendiente de una fila que ya quedó presente (confirmada acá, en otra pantalla o
  // por otro medio) es un duplicado: se descarta para no volver a marcar la misma presencia.
  useEffect(() => {
    if (pending.length === 0) return;
    const resueltos = new Set(
      listaTurnosWa(turnos, extras)
        .filter((t) => t.turnoStatus === 'PRESENT' || t.turnoStatus === 'COMPLETED')
        .map((t) => t.rowId),
    );
    if (resueltos.size === 0) return;
    const obsoletos = pending.filter((e) => e.rowId && resueltos.has(e.rowId));
    if (obsoletos.length === 0) return;
    obsoletos.forEach((e) => {
      if (e.rowId) pendingRowIdsRef.current.delete(e.rowId);
    });
    const ids = new Set(obsoletos.map((e) => e.id));
    setPending((prev) => prev.filter((e) => !ids.has(e.id)));
    setBadge((b) => Math.max(0, b - obsoletos.length));
  }, [turnos, extras, pending]);

  // Un aviso de salida de un turno que ya se cerró (acá o en otra pantalla) no tiene nada más que hacer.
  useEffect(() => {
    if (salidas.length === 0) return;
    const cerrados = new Set(
      listaTurnosWa(turnos, extras)
        .filter((t) => t.turnoStatus === 'COMPLETED')
        .map((t) => t.rowId),
    );
    if (cerrados.size === 0) return;
    setSalidas((prev) => {
      const sigue = prev.filter((e) => !(e.rowId && cerrados.has(e.rowId)));
      return sigue.length === prev.length ? prev : sigue;
    });
  }, [turnos, extras, salidas]);

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

    try {
      const raw = localStorage.getItem(lsKey('wa-seen'));
      const ids = JSON.parse(raw || '[]') as unknown;
      if (Array.isArray(ids)) {
        ids.filter((x): x is string => typeof x === 'string').forEach((id) => seenIdsRef.current.add(id));
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

  const avisosRef = useRef<Set<string>>(new Set());
  /** Una sola vez por mensaje y texto. El ingreso muy anticipado lo manda el sondeo y también el automático. */
  const avisarGuardia = useCallback((id: string, phone: string | undefined, texto: string) => {
    const url = bridgeUrlRef.current;
    const tel = String(phone || '').trim();
    if (!url || !id || !tel || !texto) return;
    const key = `${id}\n${texto}`;
    if (avisosRef.current.has(key)) return;
    avisosRef.current.add(key);
    fetch(`${url}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quotedId: id, phone: tel, text: texto.slice(0, 500) }),
      signal: AbortSignal.timeout(8000),
    }).catch(() => {
      /* la respuesta al guardia no bloquea la planilla */
    });
  }, []);

  const fetchStatus = useCallback(async () => {
    const url = bridgeUrlRef.current;
    if (!url) return;
    try {
      const r = await fetch(`${url}/status`, { signal: AbortSignal.timeout(4000) });
      if (!r.ok) return;
      const d = (await r.json()) as {
        groups?: { id: string; name: string; participants: number }[];
        monitored?: string[];
      };
      if (Array.isArray(d.groups)) setGroups(d.groups);
      if (Array.isArray(d.monitored)) setMonitoredGroupIds(new Set(d.monitored));
    } catch {
      /* ignore */
    }
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
      void fetchStatus();
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
      const salidasNuevas: WAEntry[] = [];
      let added = 0;

      for (const m of msgs) {
        seenIdsRef.current.add(m.id);

        if (m.type === 'protocol') continue;

        // Mensajes de días anteriores (el bridge guarda los últimos y al cambiar de día
        // el puntero se reinicia): nunca son una llegada de hoy.
        if (typeof m.ts === 'number' && m.ts > 0 && m.ts < inicioDeHoyMs()) continue;

        const msgMs = typeof m.ts === 'number' && m.ts > 0 ? m.ts : Date.now();
        const clasif = clasificarIngresoWa({
          turnos: listaTurnosWa(turnosRef.current, extrasRef.current),
          name: m.name,
          phone: m.phone,
          msgMs,
          yaMarcado: (rowId) =>
            pendingRowIdsRef.current.has(rowId) || confirmedRowIdsRef.current.has(rowId),
        });
        // Solo lo que acaba de llegar: al abrir la planilla no se le escribe a todo el buffer del bridge.
        if (clasif.texto && Date.now() - msgMs <= 3 * 60 * 1000) {
          avisarGuardia(m.id, clasif.turno?.phone || m.phone, clasif.texto);
        }
        if (clasif.cortar || !clasif.turno) continue;
        const turno = clasif.turno as TurnoHoy;
        // Regla 2: ya presente en plataforma → no es un check-in. Si el turno ya terminó y el guardia
        // manda su ubicación, es el aviso de salida; si no, se descarta.
        if (turno.turnoStatus === 'PRESENT') {
          const finMs = msDeRaw(turno.endTimeRaw);
          if (
            m.location &&
            turno.rowId &&
            finMs > 0 &&
            msgMs >= finMs &&
            !salidaRowIdsRef.current.has(turno.rowId)
          ) {
            salidaRowIdsRef.current.add(turno.rowId);
            salidasNuevas.push({
              id: m.id,
              rowId: turno.rowId,
              name: turno.name || m.name,
              phone: turno.phone || m.phone,
              arrivedAt: m.time || nowHHMM(),
              shift: turno.shift,
              expected: turno.expected,
              hasLocation: true,
              lat: (m.location as { lat?: number; latitude?: number }).lat ?? m.location.latitude,
              lng: (m.location as { lng?: number; longitude?: number }).lng ?? m.location.longitude,
              msgType: m.type,
              groupId: m.groupId,
              obj: turno.obj,
              objLat: turno.objLat,
              objLng: turno.objLng,
              msgTs: msgMs,
            });
          }
          continue;
        }
        if (turno.turnoStatus === 'COMPLETED') continue;
        // Regla 3: ya pendiente o confirmado en esta sesión → descartar (primer mensaje gana)
        if (
          turno.rowId &&
          (pendingRowIdsRef.current.has(turno.rowId) ||
            confirmedRowIdsRef.current.has(turno.rowId))
        ) {
          continue;
        }

        const arrivedAt = m.time || nowHHMM();
        const entry: WAEntry = {
          id: m.id,
          rowId: turno?.rowId,
          name: turno?.name || m.name,
          phone: turno?.phone || m.phone,
          arrivedAt,
          shift: turno?.shift,
          expected: turno?.expected,
          tardanzaMins: calcTardanzaMins(arrivedAt, turno?.expected),
          hasLocation: !!m.location,
          lat: (m.location as { lat?: number; latitude?: number } | undefined)?.lat ?? m.location?.latitude,
          lng: (m.location as { lng?: number; longitude?: number } | undefined)?.lng ?? m.location?.longitude,
          msgType: m.type,
          groupId: m.groupId,
          photo: typeof m.photo === 'string' && m.photo ? m.photo : undefined,
          obj: turno?.obj,
          objLat: turno?.objLat,
          objLng: turno?.objLng,
          msgTs: msgMs,
        };

        if (entry.rowId) pendingRowIdsRef.current.add(entry.rowId);
        newEntries.push(entry);
        added += 1;
      }

      if (salidasNuevas.length) {
        setSalidas((prev) => [...salidasNuevas.reverse(), ...prev]);
      }

      if (!newEntries.length) return;

      // Prepend: más nuevo primero (msgs llega cronológico → reverse al prependear en lote)
      const ordered = [...newEntries].reverse();
      setPending((prev) => [...ordered, ...prev]);
      setBadge((b) => b + added);
    } catch {
      setStatus('error');
    }
  }, [avisarGuardia, fetchStatus]);

  const connect = useCallback(
    (url: string) => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      bridgeUrlRef.current = url;
      setStatus('connecting');
      // Restaurar grupos seleccionados desde localStorage y re-aplicarlos al bridge
      try {
        const raw = localStorage.getItem(lsKey('wa-groups'));
        const saved = JSON.parse(raw || '[]') as unknown;
        if (Array.isArray(saved) && saved.length > 0) {
          const groupIds = saved.filter((x): x is string => typeof x === 'string');
          setMonitoredGroupIds(new Set(groupIds));
          // Re-aplicar al bridge (puede haberse reiniciado)
          groupIds.forEach((gid) => {
            fetch(`${url}/monitor`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ groupId: gid, enable: true }),
              signal: AbortSignal.timeout(4000),
            }).catch(() => { /* ignore */ });
          });
        }
      } catch {
        /* ignore */
      }
      void poll();
      void fetchStatus();
      pollTimerRef.current = setInterval(() => {
        void poll();
      }, 3000);
    },
    [poll, fetchStatus],
  );

  const toggleGroup = useCallback(async (groupId: string, enable: boolean) => {
    const url = bridgeUrlRef.current;
    if (!url) return;
    try {
      await fetch(`${url}/monitor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, enable }),
        signal: AbortSignal.timeout(4000),
      });
      setMonitoredGroupIds((prev) => {
        const next = new Set(prev);
        enable ? next.add(groupId) : next.delete(groupId);
        // Persistir en localStorage para sobrevivir recarga y reinicio del bridge
        try {
          localStorage.setItem(lsKey('wa-groups'), JSON.stringify([...next]));
        } catch {
          /* ignore */
        }
        return next;
      });
    } catch {
      /* ignore */
    }
  }, []);

  const syncPhones = useCallback(async (phones: string[]) => {
    const url = bridgeUrlRef.current;
    if (!url || phones.length === 0) return;
    try {
      await fetch(`${url}/sync-phones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phones }),
        signal: AbortSignal.timeout(30000), // puede tardar si son muchos
      });
    } catch {
      /* ignore — no crítico */
    }
  }, []);

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
      obj: entry.obj,
      phone: entry.phone,
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

    // Persistir el id del mensaje como ya visto para sobrevivir recarga de página
    try {
      const key = lsKey('wa-seen');
      const existing = JSON.parse(localStorage.getItem(key) || '[]') as string[];
      const next = Array.from(new Set([...existing, entry.id])).slice(-500);
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const responder = useCallback((entry: WAEntry, texto: string) => {
    avisarGuardia(entry.id, entry.phone, texto);
  }, [avisarGuardia]);

  /** Corta el sondeo y olvida la URL (cambio de empresa o empresa sin bridge). */
  const disconnect = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    bridgeUrlRef.current = '';
    setStatus('idle');
    setGroups([]);
  }, []);

  /** Envía un mensaje privado por el bridge. `true` solo si el bridge confirmó el envío. */
  const enviar = useCallback(async (phone: string, texto: string): Promise<boolean> => {
    const url = bridgeUrlRef.current;
    if (!url || !phone || !texto) return false;
    try {
      const r = await fetch(`${url}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, message: texto }),
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) return false;
      const d = (await r.json().catch(() => ({}))) as { ok?: boolean };
      return d.ok === true;
    } catch {
      return false;
    }
  }, []);

  const dismissEntry = useCallback((entry: WAEntry) => {
    setPending((prev) => prev.filter((e) => e.id !== entry.id));
    setBadge((b) => Math.max(0, b - 1));
    if (entry.rowId) pendingRowIdsRef.current.delete(entry.rowId);
    seenIdsRef.current.add(entry.id);
    // El mensaje descartado no vuelve a aparecer aunque se recargue la página.
    try {
      const key = lsKey('wa-seen');
      const existing = JSON.parse(localStorage.getItem(key) || '[]') as string[];
      const next = Array.from(new Set([...existing, entry.id])).slice(-500);
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const consumirSalida = useCallback((entry: WAEntry) => {
    setSalidas((prev) => prev.filter((e) => e.id !== entry.id));
    seenIdsRef.current.add(entry.id);
    try {
      const key = lsKey('wa-seen');
      const existing = JSON.parse(localStorage.getItem(key) || '[]') as string[];
      const next = Array.from(new Set([...existing, entry.id])).slice(-500);
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const clearAll = useCallback(() => {
    setPending([]);
    setSalidas([]);
    salidaRowIdsRef.current.clear();
    setBadge(0);
    setConfirmedEntries([]);
    setConfirmedRowIds(new Set());
    pendingRowIdsRef.current.clear();
    seenIdsRef.current.clear();
    setMonitoredGroupIds(new Set());
    lastTsRef.current = 0;
    try {
      localStorage.removeItem(lsKey('wa-lastts'));
      localStorage.removeItem(lsKey('wa-confirmed'));
      localStorage.removeItem(lsKey('wa-confirmed-log'));
      localStorage.removeItem(lsKey('wa-seen'));
      localStorage.removeItem(lsKey('wa-groups'));
    } catch {
      /* ignore */
    }
  }, []);

  const addFakePending = useCallback((partial?: Partial<WAEntry>) => {
    const names = Object.keys(turnosRef.current);
    const name =
      partial?.name ||
      (names.length > 0 ? names[Math.floor(Math.random() * names.length)] : 'Demo Guardia');
    const turno = findTurno(turnosRef.current, name, partial?.phone);
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
      photo: partial?.photo,
      obj: partial?.obj || turno?.obj,
      objLat: partial?.objLat ?? turno?.objLat,
      objLng: partial?.objLng ?? turno?.objLng,
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
    salidas,
    consumirSalida,
    dismissEntry,
    responder,
    enviar,
    clearAll,
    connect,
    disconnect,
    addFakePending,
    groups,
    monitoredGroupIds,
    toggleGroup,
    syncPhones,
  };
}
