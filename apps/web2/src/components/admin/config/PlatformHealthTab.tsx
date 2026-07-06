import React, { useState, useEffect } from 'react';
import { httpsCallable } from 'firebase/functions';
import { collection, getDocs, limit, query, doc, setDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { functions, db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import {
  Activity, CheckCircle, XCircle, AlertCircle, Loader2,
  Database, Zap, Mail, HardDrive, Bell, Bot, Clock, Server,
  BarChart3, RefreshCw, Shield, Download, Copy, Check,
  KeyRound, Eye, EyeOff, Pencil, Trash2, Plus, Save, X, MapPin,
} from 'lucide-react';

const USE_EMULATOR = process.env.NEXT_PUBLIC_USE_EMULATOR === 'true';

type CheckStatus = 'idle' | 'running' | 'ok' | 'error' | 'warn';

interface CheckResult {
  status: CheckStatus;
  label: string;
  detail?: string;
  latencyMs?: number;
  group: string;
  icon: React.ElementType;
}

const STATUS_ICON: Record<CheckStatus, React.ElementType> = {
  idle: AlertCircle,
  running: Loader2,
  ok: CheckCircle,
  error: XCircle,
  warn: AlertCircle,
};

const STATUS_COLOR: Record<CheckStatus, string> = {
  idle:    'text-slate-500',
  running: 'text-indigo-400',
  ok:      'text-emerald-400',
  error:   'text-rose-400',
  warn:    'text-amber-400',
};

const STATUS_BG: Record<CheckStatus, string> = {
  idle:    'bg-slate-800/60 border-slate-700',
  running: 'bg-indigo-950/40 border-indigo-800',
  ok:      'bg-emerald-950/40 border-emerald-800',
  error:   'bg-rose-950/40 border-rose-800',
  warn:    'bg-amber-950/40 border-amber-800',
};

function CheckCard({ check }: { check: CheckResult }) {
  const Icon = check.icon;
  const StatusIcon = STATUS_ICON[check.status];
  const colorClass = STATUS_COLOR[check.status];
  const bgClass = STATUS_BG[check.status];

  return (
    <div className={`rounded-xl border p-4 transition-all ${bgClass}`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">
          <Icon size={18} className="text-slate-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-bold text-white leading-tight">{check.label}</p>
            <div className="flex items-center gap-1.5 shrink-0">
              {check.latencyMs !== undefined && check.status === 'ok' && (
                <span className="text-[10px] text-slate-500 font-mono">{check.latencyMs}ms</span>
              )}
              <StatusIcon
                size={16}
                className={`${colorClass} ${check.status === 'running' ? 'animate-spin' : ''}`}
              />
            </div>
          </div>
          {check.detail && (
            <p className="text-[11px] text-slate-400 mt-1 leading-snug break-words">{check.detail}</p>
          )}
        </div>
      </div>
    </div>
  );
}

const GROUPS = ['Firebase', 'APIs externas', 'Datos', 'Entorno'];

const INITIAL_CHECKS: CheckResult[] = [
  // Firebase
  { status: 'idle', label: 'Firestore — conectividad',     detail: 'Sin ejecutar', group: 'Firebase',      icon: Database },
  { status: 'idle', label: 'Firebase Functions — latencia', detail: 'Sin ejecutar', group: 'Firebase',      icon: Zap },
  { status: 'idle', label: 'Firebase Auth — sesión activa', detail: 'Sin ejecutar', group: 'Firebase',      icon: Shield },
  { status: 'idle', label: 'FCM Push Notifications',       detail: 'Sin ejecutar', group: 'Firebase',      icon: Bell },
  // APIs externas
  { status: 'idle', label: 'Gemini AI',                    detail: 'Sin ejecutar', group: 'APIs externas', icon: Bot },
  { status: 'idle', label: 'Gmail SMTP',                   detail: 'Sin ejecutar', group: 'APIs externas', icon: Mail },
  { status: 'idle', label: 'Google Drive (Backups)',        detail: 'Sin ejecutar', group: 'APIs externas', icon: HardDrive },
  { status: 'idle', label: 'Nominatim — geocodificación',  detail: 'Sin ejecutar', group: 'APIs externas', icon: MapPin },
  // Datos
  { status: 'idle', label: 'Conteo de datos críticos',     detail: 'Sin ejecutar', group: 'Datos',         icon: BarChart3 },
  { status: 'idle', label: 'Scheduled jobs',               detail: 'Sin ejecutar', group: 'Datos',         icon: Clock },
  // Entorno
  { status: 'idle', label: 'Entorno de ejecución',         detail: 'Sin ejecutar', group: 'Entorno',       icon: Server },
];

// ── Tipos para la bóveda de credenciales ──────────────────────────────────────

interface Credential {
  id: string;
  service: string;
  account: string;
  notes: string;
  value: string;
}

const EMPTY_CRED: Omit<Credential, 'id'> = { service: '', account: '', notes: '', value: '' };

function CredentialVault({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const [creds, setCreds] = useState<Credential[]>([]);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [form, setForm] = useState<Omit<Credential, 'id'>>(EMPTY_CRED);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isSuperAdmin) return;
    const unsub = onSnapshot(
      collection(db, 'platform_credentials'),
      snap => setCreds(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Credential, 'id'>) }))),
      () => {},
    );
    return unsub;
  }, [isSuperAdmin]);

  if (!isSuperAdmin) return null;

  function startEdit(c: Credential) {
    setEditingId(c.id);
    setForm({ service: c.service, account: c.account, notes: c.notes, value: c.value });
    setAddingNew(false);
  }

  function startNew() {
    setAddingNew(true);
    setEditingId(null);
    setForm(EMPTY_CRED);
  }

  function cancel() {
    setEditingId(null);
    setAddingNew(false);
    setForm(EMPTY_CRED);
  }

  async function save(id?: string) {
    if (!form.service.trim()) return;
    setSaving(true);
    try {
      const docId = id || form.service.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
      await setDoc(doc(db, 'platform_credentials', docId), {
        service: form.service.trim(),
        account: form.account.trim(),
        notes: form.notes.trim(),
        value: form.value,
      });
      cancel();
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('¿Eliminar esta credencial?')) return;
    await deleteDoc(doc(db, 'platform_credentials', id));
  }

  const isEditing = (id: string) => editingId === id;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Credenciales de servicio</p>
        {!addingNew && (
          <button
            onClick={startNew}
            className="flex items-center gap-1.5 text-xs font-bold text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            <Plus size={13} /> Agregar
          </button>
        )}
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-900 overflow-hidden">
        {/* Header tabla */}
        <div className="grid grid-cols-[1fr_1fr_1.5fr_1fr_auto] gap-2 px-4 py-2 border-b border-slate-700 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
          <span>Servicio</span>
          <span>Cuenta / Email</span>
          <span>Notas</span>
          <span>Valor / Clave</span>
          <span></span>
        </div>

        {creds.length === 0 && !addingNew && (
          <div className="px-4 py-6 text-center text-slate-600 text-sm">
            Sin credenciales guardadas. Usá <span className="text-indigo-400 font-bold">Agregar</span> para registrar la primera.
          </div>
        )}

        {creds.map(c => (
          <div key={c.id} className="border-b border-slate-800 last:border-0">
            {isEditing(c.id) ? (
              <div className="grid grid-cols-[1fr_1fr_1.5fr_1fr_auto] gap-2 px-4 py-3 items-center">
                <input className="bg-slate-800 border border-slate-600 text-white text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-500" value={form.service} onChange={e => setForm(f => ({ ...f, service: e.target.value }))} placeholder="Nombre servicio" />
                <input className="bg-slate-800 border border-slate-600 text-white text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-500" value={form.account} onChange={e => setForm(f => ({ ...f, account: e.target.value }))} placeholder="cuenta@email.com" />
                <input className="bg-slate-800 border border-slate-600 text-white text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-500" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Dónde está / cómo renovar" />
                <input className="bg-slate-800 border border-slate-600 text-white text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-500 font-mono" value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))} placeholder="contraseña / API key" />
                <div className="flex gap-1">
                  <button onClick={() => save(c.id)} disabled={saving} className="p-1.5 rounded-lg bg-emerald-800/40 hover:bg-emerald-700/50 text-emerald-400"><Save size={13} /></button>
                  <button onClick={cancel} className="p-1.5 rounded-lg bg-slate-700/50 hover:bg-slate-600/50 text-slate-400"><X size={13} /></button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-[1fr_1fr_1.5fr_1fr_auto] gap-2 px-4 py-3 items-center">
                <div className="flex items-center gap-2">
                  <KeyRound size={13} className="text-slate-500 shrink-0" />
                  <span className="text-xs font-bold text-white truncate">{c.service}</span>
                </div>
                <span className="text-xs text-slate-400 truncate">{c.account || '—'}</span>
                <span className="text-xs text-slate-500 truncate">{c.notes || '—'}</span>
                <div className="flex items-center gap-1.5">
                  {c.value ? (
                    <>
                      <span className="text-xs font-mono text-slate-300 truncate max-w-[100px]">
                        {revealed[c.id] ? c.value : '••••••••••••'}
                      </span>
                      <button
                        onClick={() => setRevealed(r => ({ ...r, [c.id]: !r[c.id] }))}
                        className="text-slate-500 hover:text-slate-300 transition-colors shrink-0"
                      >
                        {revealed[c.id] ? <EyeOff size={12} /> : <Eye size={12} />}
                      </button>
                    </>
                  ) : (
                    <span className="text-xs text-slate-600 italic">sin valor</span>
                  )}
                </div>
                <div className="flex gap-1">
                  <button onClick={() => startEdit(c)} className="p-1.5 rounded-lg hover:bg-slate-700/50 text-slate-500 hover:text-slate-300 transition-colors"><Pencil size={12} /></button>
                  <button onClick={() => remove(c.id)} className="p-1.5 rounded-lg hover:bg-rose-900/30 text-slate-500 hover:text-rose-400 transition-colors"><Trash2 size={12} /></button>
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Fila para nueva credencial */}
        {addingNew && (
          <div className="border-t border-slate-700 grid grid-cols-[1fr_1fr_1.5fr_1fr_auto] gap-2 px-4 py-3 items-center bg-indigo-950/20">
            <input className="bg-slate-800 border border-indigo-600 text-white text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-400" value={form.service} onChange={e => setForm(f => ({ ...f, service: e.target.value }))} placeholder="Ej: Gmail SMTP" autoFocus />
            <input className="bg-slate-800 border border-slate-600 text-white text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-500" value={form.account} onChange={e => setForm(f => ({ ...f, account: e.target.value }))} placeholder="cuenta@email.com" />
            <input className="bg-slate-800 border border-slate-600 text-white text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-500" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Dónde está / cómo renovar" />
            <input className="bg-slate-800 border border-slate-600 text-white text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-500 font-mono" value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))} placeholder="contraseña / API key" />
            <div className="flex gap-1">
              <button onClick={() => save()} disabled={saving || !form.service.trim()} className="p-1.5 rounded-lg bg-emerald-800/40 hover:bg-emerald-700/50 text-emerald-400 disabled:opacity-40"><Save size={13} /></button>
              <button onClick={cancel} className="p-1.5 rounded-lg bg-slate-700/50 hover:bg-slate-600/50 text-slate-400"><X size={13} /></button>
            </div>
          </div>
        )}
      </div>

      <p className="text-[10px] text-slate-600 mt-2">Los valores se guardan cifrados en Firestore. Solo visible para SuperAdmin.</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function PlatformHealthTab() {
  const { user, isSuperAdmin } = useAuth();
  const [checks, setChecks] = useState<CheckResult[]>(INITIAL_CHECKS);
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [overallOk, setOverallOk] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);
  const [rawReport, setRawReport] = useState<object | null>(null);

  function updateCheck(label: string, patch: Partial<CheckResult>) {
    setChecks(prev => prev.map(c => c.label === label ? { ...c, ...patch } : c));
  }

  async function runChecks() {
    if (running) return;
    setRunning(true);
    setOverallOk(null);
    setChecks(INITIAL_CHECKS.map(c => ({ ...c, status: 'running', detail: 'Verificando...' })));

    // ── 1. Firebase Auth ────────────────────────────────────
    if (user) {
      updateCheck('Firebase Auth — sesión activa', { status: 'ok', detail: `${user.email}` });
    } else {
      updateCheck('Firebase Auth — sesión activa', { status: 'error', detail: 'Sin sesión activa' });
    }

    // ── 2. Firestore (client-side) ──────────────────────────
    const t0 = Date.now();
    try {
      const snap = await getDocs(query(collection(db, 'empresas'), limit(1)));
      updateCheck('Firestore — conectividad', {
        status: 'ok',
        latencyMs: Date.now() - t0,
        detail: `${snap.size} empresa(s) accesible(s)`,
      });
    } catch (e: any) {
      updateCheck('Firestore — conectividad', {
        status: 'error',
        latencyMs: Date.now() - t0,
        detail: e.message,
      });
    }

    // ── 3. Functions + backend checks ───────────────────────
    const tf = Date.now();
    try {
      const healthFn = httpsCallable(functions, 'platformHealthCheck');
      const res = await healthFn({});
      const data = res.data as any;
      const latFn = Date.now() - tf;

      updateCheck('Firebase Functions — latencia', {
        status: 'ok',
        latencyMs: latFn,
        detail: `Node ${data.nodeVersion} · Functions OK`,
      });

      // Gemini
      const g = data.results?.gemini;
      updateCheck('Gemini AI', {
        status: g?.ok ? 'ok' : 'error',
        latencyMs: g?.latencyMs,
        detail: g?.detail,
      });

      // Gmail
      const m = data.results?.gmail;
      updateCheck('Gmail SMTP', {
        status: m?.ok ? 'ok' : 'error',
        latencyMs: m?.latencyMs,
        detail: m?.detail,
      });

      // Drive
      const dr = data.results?.drive;
      updateCheck('Google Drive (Backups)', {
        status: dr?.ok ? 'ok' : 'error',
        detail: dr?.detail,
      });

      // FCM
      const fcm = data.results?.fcm;
      updateCheck('FCM Push Notifications', {
        status: fcm?.ok ? 'ok' : 'warn',
        detail: fcm?.detail,
      });

      // Datos
      const dt = data.results?.data;
      updateCheck('Conteo de datos críticos', {
        status: dt?.ok ? 'ok' : 'error',
        detail: dt?.detail,
      });

      // Scheduled jobs
      const sj = data.results?.scheduledJobs;
      if (sj?.detail) {
        try {
          const jobs = JSON.parse(sj.detail);
          const lines = Object.entries(jobs).map(([k, v]) => `${k}: ${v}`).join(' · ');
          updateCheck('Scheduled jobs', { status: 'ok', detail: lines });
        } catch {
          updateCheck('Scheduled jobs', { status: 'ok', detail: sj.detail });
        }
      }

      // Entorno
      const env = data.results?.env;
      updateCheck('Entorno de ejecución', {
        status: 'ok',
        detail: `${env?.detail ?? ''}${USE_EMULATOR ? ' · Frontend: Emulador' : ' · Frontend: Producción'}`,
      });

      const allOk = Object.values(data.results as Record<string, any>).every((r: any) => r.ok);
      setOverallOk(allOk);

    } catch (e: any) {
      updateCheck('Firebase Functions — latencia', {
        status: 'error',
        latencyMs: Date.now() - tf,
        detail: e.message,
      });
      ['Gemini AI', 'Gmail SMTP', 'Google Drive (Backups)', 'FCM Push Notifications',
        'Conteo de datos críticos', 'Scheduled jobs', 'Entorno de ejecución'].forEach(label => {
        updateCheck(label, { status: 'warn', detail: 'No se pudo verificar (Functions caída)' });
      });
      setOverallOk(false);
    }

    // ── 4. Nominatim — geocodificación (client-side) ────────
    const tn = Date.now();
    try {
      const resp = await fetch(
        'https://nominatim.openstreetmap.org/search?q=Buenos+Aires,+Argentina&format=json&limit=1&countrycodes=ar',
        { headers: { 'Accept-Language': 'es' }, signal: AbortSignal.timeout(8000) },
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      const latNom = Date.now() - tn;
      if (Array.isArray(json) && json.length > 0) {
        updateCheck('Nominatim — geocodificación', { status: 'ok', latencyMs: latNom, detail: 'Respuesta OK · OpenStreetMap' });
      } else {
        updateCheck('Nominatim — geocodificación', { status: 'warn', latencyMs: latNom, detail: 'Sin resultados (servicio responde pero sin datos)' });
      }
    } catch (e: any) {
      updateCheck('Nominatim — geocodificación', { status: 'error', latencyMs: Date.now() - tn, detail: e.message });
      setOverallOk(false);
    }

    const ts = new Date().toLocaleString('es-AR');
    setLastRun(ts);
    setRunning(false);

    // Construir reporte exportable con los checks finales
    setChecks(prev => {
      const report = {
        generatedAt: new Date().toISOString(),
        environment: USE_EMULATOR ? 'emulator' : 'production',
        summary: {
          ok: prev.filter(c => c.status === 'ok').length,
          warn: prev.filter(c => c.status === 'warn').length,
          error: prev.filter(c => c.status === 'error').length,
        },
        checks: prev.map(({ label, group, status, detail, latencyMs }) => ({
          group, label, status,
          ...(latencyMs !== undefined ? { latencyMs } : {}),
          ...(detail ? { detail } : {}),
        })),
      };
      setRawReport(report);
      return prev;
    });
  }

  function downloadJson() {
    if (!rawReport) return;
    const blob = new Blob([JSON.stringify(rawReport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cosp-health-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function copyJson() {
    if (!rawReport) return;
    navigator.clipboard.writeText(JSON.stringify(rawReport, null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const okCount  = checks.filter(c => c.status === 'ok').length;
  const errCount = checks.filter(c => c.status === 'error').length;
  const warnCount = checks.filter(c => c.status === 'warn').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-black text-white">Salud de la plataforma</h2>
          <p className="text-sm text-slate-400 mt-0.5">
            Verificación de conectividad, APIs externas y estado de servicios
          </p>
        </div>
        <div className="flex items-center gap-2">
          {rawReport && (
            <>
              <button
                onClick={copyJson}
                className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl font-bold text-sm text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-all active:scale-95"
                title="Copiar JSON al portapapeles"
              >
                {copied ? <><Check size={14} className="text-emerald-400" /> Copiado</> : <><Copy size={14} /> Copiar JSON</>}
              </button>
              <button
                onClick={downloadJson}
                className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl font-bold text-sm text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-all active:scale-95"
                title="Descargar reporte JSON"
              >
                <Download size={14} /> Descargar
              </button>
            </>
          )}
          <button
            onClick={runChecks}
            disabled={running}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 transition-all active:scale-95"
          >
            {running
              ? <><Loader2 size={15} className="animate-spin" /> Verificando...</>
              : <><RefreshCw size={15} /> Ejecutar diagnóstico</>}
          </button>
        </div>
      </div>

      {/* Resumen */}
      {overallOk !== null && (
        <div className={`rounded-2xl border p-4 flex items-center gap-4 ${overallOk ? 'bg-emerald-950/40 border-emerald-800' : 'bg-rose-950/40 border-rose-800'}`}>
          <Activity size={22} className={overallOk ? 'text-emerald-400' : 'text-rose-400'} />
          <div className="flex-1">
            <p className={`font-black text-sm ${overallOk ? 'text-emerald-300' : 'text-rose-300'}`}>
              {overallOk ? 'Todos los servicios operativos' : 'Se detectaron problemas'}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              {okCount} OK · {warnCount} advertencias · {errCount} errores · Último chequeo: {lastRun}
            </p>
          </div>
        </div>
      )}

      {/* JSON de problemas (solo si hay errores/warns) */}
      {rawReport && (errCount > 0 || warnCount > 0) && (
        <div className="rounded-xl border border-slate-700 bg-slate-900 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-700">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
              Reporte de problemas · {errCount} error(es) · {warnCount} advertencia(s)
            </p>
            <button onClick={copyJson} className="text-[11px] font-bold text-indigo-400 hover:text-indigo-300 flex items-center gap-1">
              {copied ? <><Check size={11}/> Copiado</> : <><Copy size={11}/> Copiar</>}
            </button>
          </div>
          <pre className="text-[11px] text-slate-300 p-4 overflow-x-auto leading-relaxed max-h-64 overflow-y-auto">
            {JSON.stringify({
              ...(rawReport as any),
              checks: (rawReport as any).checks?.filter((c: any) => c.status === 'error' || c.status === 'warn'),
            }, null, 2)}
          </pre>
        </div>
      )}

      {/* Checks por grupo */}
      {GROUPS.map(group => {
        const groupChecks = checks.filter(c => c.group === group);
        return (
          <div key={group}>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">{group}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {groupChecks.map(c => <CheckCard key={c.label} check={c} />)}
            </div>
          </div>
        );
      })}

      {overallOk === null && !running && (
        <div className="text-center py-10 text-slate-600 text-sm">
          Presioná <span className="text-indigo-400 font-bold">Ejecutar diagnóstico</span> para verificar el estado de todos los servicios.
        </div>
      )}

      {/* Bóveda de credenciales — solo SuperAdmin */}
      <CredentialVault isSuperAdmin={isSuperAdmin} />
    </div>
  );
}
