import React, { useEffect, useRef, useState } from 'react';
import { db, functions, storage, auth } from '@/lib/firebase';
import { ref as storageRef, uploadBytes } from 'firebase/storage';
import { collection, query, orderBy, limit, onSnapshot, Timestamp, writeBatch, doc as fsDoc, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { HardDrive, RefreshCw, CheckCircle, AlertTriangle, ExternalLink, Clock, Database, FileJson, RotateCcw, ShieldAlert, X, Upload, Tag } from 'lucide-react';
import { useEmpresa } from '@/context/EmpresaContext';
import { useAuth } from '@/context/AuthContext';
import { shouldScopeQueriesToEmpresa, filterRowsByEmpresa } from '@/lib/multiempresa';

const STORAGE_KEY = 'emulator_loaded_backup';

interface LoadedVersion {
  fileName: string;
  loadedAt: string;   // ISO string
  totalDocs: number;
  collections: string[];
  sizeBytes: number;
}

const IS_EMULATOR = process.env.NEXT_PUBLIC_USE_EMULATOR === 'true';
const PROJECT_ID  = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'comtroldata';

async function refreshAuthTokenForBackup() {
  await auth.currentUser?.getIdToken(true);
}

interface BackupRecord {
  id: string;
  fileName: string;
  driveLink: string;
  driveFileId: string;
  sizeBytes: number;
  totalDocs: number;
  collections: string[];
  createdAt: any;
  status: 'ok' | 'error';
  error?: string;
  empresaId?: string;
  scopeEmpresa?: boolean;
}

const fmt = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const fmtDate = (val: any) => {
  if (!val) return '—';
  try {
    const d = val instanceof Timestamp ? val.toDate() : (typeof val === 'string' ? new Date(val) : new Date(val));
    return d.toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' });
  } catch { return '—'; }
};

const SCOPED_DETECT_COLS = ['clients', 'empleados', 'turnos', 'servicios_sla', 'ausencias', 'novedades'];

/** Infiera empresa origen desde el contenido del JSON (meta a veces viene mal o vacía). */
function detectDominantEmpresaInPayload(backup: Record<string, unknown>): { empresaId: string; legacyCount: number } {
  const counts = new Map<string, number>();
  let legacyCount = 0;
  for (const col of SCOPED_DETECT_COLS) {
    const rows = backup[col];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const emp = String((row as Record<string, unknown>).empresaId ?? '').trim();
      if (!emp) {
        legacyCount += 1;
        continue;
      }
      counts.set(emp, (counts.get(emp) || 0) + 1);
    }
  }
  let empresaId = '';
  let max = 0;
  counts.forEach((n, id) => {
    if (n > max) {
      max = n;
      empresaId = id;
    }
  });
  return { empresaId, legacyCount };
}

function resolveBackupImportKind(
  meta: Record<string, unknown>,
  empresaId: string,
  scopeEmpresa: boolean,
  backup?: Record<string, unknown>,
) {
  if (!scopeEmpresa || !empresaId) {
    return { platformImport: false, tenantImport: false, sourceEmpresaId: '' };
  }
  const backupEmpresaMeta = String(meta.empresaId ?? '').trim();
  const detected = backup ? detectDominantEmpresaInPayload(backup) : { empresaId: '', legacyCount: 0 };

  let sourceEmpresaId = backupEmpresaMeta || detected.empresaId;
  if (!sourceEmpresaId && detected.legacyCount > 0) {
    sourceEmpresaId = 'bacarsa';
  }

  if (sourceEmpresaId && sourceEmpresaId.toLowerCase() !== empresaId.toLowerCase()) {
    return { platformImport: false, tenantImport: true, sourceEmpresaId };
  }

  if (!backupEmpresaMeta && meta.scopeEmpresa !== true && (detected.legacyCount > 0 || !detected.empresaId)) {
    return { platformImport: true, tenantImport: false, sourceEmpresaId: '' };
  }

  return { platformImport: false, tenantImport: false, sourceEmpresaId: '' };
}

function resolveBackupRecordImportKind(
  b: BackupRecord,
  empresaId: string,
  scopeEmpresa: boolean,
) {
  return resolveBackupImportKind(
    { empresaId: b.empresaId, scopeEmpresa: b.scopeEmpresa },
    empresaId,
    scopeEmpresa,
  );
}

function formatRestoreError(e: unknown): string {
  const err = e as { message?: string; code?: string };
  const msg = String(err?.message ?? '').trim();
  if (/deadline-exceeded|timeout/i.test(`${err?.code ?? ''} ${msg}`)) {
    return 'La restauración tardó demasiado. Revisá si los datos quedaron incompletos y volvé a intentar.';
  }
  if (/no such object/i.test(msg)) {
    return 'El archivo subido ya no está en Storage. Volvé a subir el backup JSON y confirmá de inmediato.';
  }
  return msg || 'Error al restaurar';
}

// Deserializa { _seconds, _nanoseconds } → Firestore Timestamp recursivamente
const deserialize = (obj: any): any => {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(deserialize);
  if (typeof obj === 'object') {
    if ('_seconds' in obj && '_nanoseconds' in obj) return new Timestamp(obj._seconds, obj._nanoseconds);
    const out: any = {};
    for (const [k, v] of Object.entries(obj)) out[k] = deserialize(v);
    return out;
  }
  return obj;
};

export default function BackupTab() {
  const { isSuperAdmin } = useAuth();
  const { empresaId, empresa, empresas } = useEmpresa();
  const migracionCompleta = (empresa as { migracionCompleta?: boolean } | null)?.migracionCompleta === true;
  const scopeEmpresa = shouldScopeQueriesToEmpresa(empresaId, migracionCompleta);

  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [restoreModal, setRestoreModal] = useState<{
    backup: BackupRecord | null;
    storagePath?: string;
    fileName: string;
    mode: 'merge' | 'full';
    platformImport?: boolean;
    tenantImport?: boolean;
    sourceEmpresaId?: string;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; phase: string } | null>(null);
  const [loadedVersion, setLoadedVersion] = useState<LoadedVersion | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Leer versión activa del emulador desde localStorage
  useEffect(() => {
    if (!IS_EMULATOR) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setLoadedVersion(JSON.parse(raw));
    } catch {}
  }, []);

  // Suscripción Firestore (producción: remota / emulador: local localhost:8080)
  useEffect(() => {
    if (!empresaId) return;
    setLoading(true);
    setBackups([]);

    const q = scopeEmpresa
      ? query(collection(db, 'system_backups'), where('empresaId', '==', empresaId), limit(40))
      : query(collection(db, 'system_backups'), orderBy('createdAt', 'desc'), limit(20));

    const unsub = onSnapshot(q, snap => {
      let rows = snap.docs.map(d => ({ id: d.id, ...d.data() } as BackupRecord));
      if (scopeEmpresa) {
        rows = filterRowsByEmpresa(rows, empresaId, true);
        rows.sort((a, b) => {
          const ta = a.createdAt instanceof Timestamp ? a.createdAt.toMillis() : new Date(a.createdAt ?? 0).getTime();
          const tb = b.createdAt instanceof Timestamp ? b.createdAt.toMillis() : new Date(b.createdAt ?? 0).getTime();
          return tb - ta;
        });
      }
      setBackups(rows.slice(0, 20));
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [empresaId, scopeEmpresa]);

  const handleRunBackup = async () => {
    setRunning(true); setLastResult(null);
    try {
      await refreshAuthTokenForBackup();
      const fn = httpsCallable(functions, 'triggerBackup');
      const res: any = await fn({ empresaId: empresaId || '' });
      setLastResult({ ok: true, msg: `Backup creado: ${res.data.fileName} (${fmt(res.data.sizeBytes)}, ${res.data.totalDocs} docs)` });
    } catch (e: any) {
      setLastResult({ ok: false, msg: e?.message || 'Error al crear backup' });
    } finally { setRunning(false); }
  };

  const validateBackupJsonForEmpresa = (backup: Record<string, unknown>) => {
    const meta = (backup._meta ?? {}) as Record<string, unknown>;
    const importKind = resolveBackupImportKind(meta, empresaId, scopeEmpresa, backup);
    if (importKind.tenantImport && !isSuperAdmin) {
      throw new Error(`El archivo pertenece a otra empresa (${importKind.sourceEmpresaId}). Solo superadmin puede importarlo a ${empresaId}.`);
    }
    return importKind;
  };

  const handleSelectUploadFile = async (file: File) => {
    setLastResult(null);
    setUploading(true);
    setProgress({ done: 0, total: 0, phase: 'Validando archivo…' });
    try {
      const text = await file.text();
      const backup = JSON.parse(text) as Record<string, unknown>;
      const importKind = validateBackupJsonForEmpresa(backup);

      setProgress({ done: 0, total: 100, phase: 'Subiendo archivo…' });
      const jobStamp = Date.now();
      const safeName = file.name.replace(/[^\w.\-]+/g, '_').slice(0, 120) || 'backup.json';
      const path = `backup-restore/${empresaId || 'platform'}/${jobStamp}/${safeName}`;
      const payload =
        file.type === 'application/json'
          ? file
          : new Blob([await file.arrayBuffer()], { type: 'application/json' });
      const fileRef = storageRef(storage, path);
      await uploadBytes(fileRef, payload, { contentType: 'application/json' });

      setRestoreModal({
        backup: null,
        storagePath: path,
        fileName: file.name,
        mode: importKind.tenantImport ? 'full' : 'merge',
        ...importKind,
      });
    } catch (e: any) {
      const code = String(e?.code ?? '');
      let msg = e?.message || 'Error al subir el backup';
      if (code.includes('storage/unauthorized') || /unauthorized/i.test(msg)) {
        msg = `Sin permiso para subir el backup a la empresa «${empresaId}». Verificá que tu usuario esté en system_users y que, si no sos superadmin, tu perfil tenga empresaId=${empresaId}.`;
      }
      setLastResult({ ok: false, msg });
    } finally {
      setUploading(false);
      setProgress(null);
    }
  };

  // Carga un backup JSON local directo al emulador desde el browser
  const handleLoadLocalFile = async (file: File) => {
    setLastResult(null);
    setProgress({ done: 0, total: 0, phase: 'Leyendo archivo...' });
    try {
      const text = await file.text();
      const backup = JSON.parse(text);
      validateBackupJsonForEmpresa(backup as Record<string, unknown>);

      const cols = Object.entries(backup).filter(([k]) => !k.startsWith('_')) as [string, any[]][];
      const totalDocs = cols.reduce((acc, [, docs]) => acc + (docs?.length ?? 0), 0);

      setProgress({ done: 0, total: totalDocs, phase: 'Limpiando emulador...' });

      // Borrar todo el Firestore del emulador via REST
      await fetch(`http://localhost:8080/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, {
        method: 'DELETE',
      });

      let written = 0;
      for (const [colName, docs] of cols) {
        if (!Array.isArray(docs) || docs.length === 0) continue;
        for (let i = 0; i < docs.length; i += 400) {
          const chunk = docs.slice(i, i + 400);
          const batch = writeBatch(db);
          chunk.forEach((d: any) => {
            const { _id, ...data } = d;
            if (!_id) return;
            batch.set(fsDoc(db, colName, _id), deserialize(data));
          });
          await batch.commit();
          written += chunk.length;
          setProgress({ done: written, total: totalDocs, phase: `Cargando ${colName}…` });
        }
      }

      // Guardar versión activa en localStorage
      const version: LoadedVersion = {
        fileName: file.name,
        loadedAt: new Date().toISOString(),
        totalDocs: written,
        collections: cols.map(([k]) => k),
        sizeBytes: file.size,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(version));
      setLoadedVersion(version);

      setLastResult({ ok: true, msg: `Emulador actualizado — ${written.toLocaleString()} docs en ${cols.length} colecciones.` });
    } catch (e: any) {
      setLastResult({ ok: false, msg: e?.message || 'Error al cargar el archivo' });
    } finally {
      setProgress(null);
    }
  };

  const handleRestore = async () => {
    if (!restoreModal) return;
    setRestoring(true); setLastResult(null);
    const jobId = `restore_${Date.now()}`;
    const jobRef = fsDoc(db, 'restore_jobs', jobId);
    let unsub: (() => void) | null = null;
    try {
      const payload: Record<string, unknown> = {
        mode: restoreModal.tenantImport ? 'full' : restoreModal.mode,
        jobId,
        empresaId: empresaId || '',
        fileName: restoreModal.fileName,
      };
      if (restoreModal.tenantImport) {
        payload.tenantImport = true;
        payload.sourceEmpresaId = restoreModal.sourceEmpresaId || '';
      }
      if (restoreModal.storagePath) {
        payload.storagePath = restoreModal.storagePath;
      } else if (restoreModal.backup?.driveFileId) {
        payload.driveFileId = restoreModal.backup.driveFileId;
      } else {
        throw new Error('Origen de restauración no definido');
      }

      const donePromise = new Promise<Record<string, unknown>>((resolve, reject) => {
        unsub = onSnapshot(jobRef, (snap) => {
          const d = snap.data();
          if (!d) return;
          setProgress({ done: d.docsRestored ?? 0, total: d.total ?? 0, phase: d.phase ?? '' });
          if (d.status === 'done') resolve(d);
          if (d.status === 'error') reject(new Error(String(d.error ?? 'Error al restaurar')));
        });
      });

      const fn = httpsCallable(functions, 'restoreBackup', { timeout: 120000 });
      await refreshAuthTokenForBackup();
      await fn(payload);

      const d = await donePromise;
      const durationMs = Number(d.durationMs ?? 0);
      setLastResult({
        ok: true,
        msg: `Restauración ${restoreModal.mode === 'full' ? 'completa' : 'merge'} exitosa — ${Number(d.docsRestored ?? 0).toLocaleString()} docs${durationMs ? ` en ${(durationMs / 1000).toFixed(1)}s` : ''}`,
      });
      setRestoreModal(null);
    } catch (e: unknown) {
      setLastResult({ ok: false, msg: formatRestoreError(e) });
    } finally {
      unsub?.();
      setRestoring(false);
      setProgress(null);
    }
  };

  return (
    <div className="animate-in fade-in space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/30 rounded-xl flex items-center justify-center">
            <HardDrive size={20} className="text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h2 className="font-black text-lg text-slate-800 dark:text-white">Backup de Base de Datos</h2>
            <p className="text-xs text-slate-500 font-bold uppercase">Google Drive · Colecciones Firestore</p>
          </div>
        </div>
        {!IS_EMULATOR && (
          <button onClick={handleRunBackup} disabled={running}
            className="flex items-center gap-2 px-5 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-xl font-black text-sm shadow-lg transition-all hover:scale-105 disabled:scale-100">
            <RefreshCw size={16} className={running ? 'animate-spin' : ''} />
            {running ? 'Ejecutando...' : 'Crear backup ahora'}
          </button>
        )}
      </div>

      {/* Resultado */}
      {lastResult && (
        <div className={`flex items-start gap-3 p-4 rounded-xl border font-bold text-sm ${lastResult.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
          {lastResult.ok ? <CheckCircle size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
          {lastResult.msg}
        </div>
      )}

      {/* ── Subir backup descargado (producción) ── */}
      {!IS_EMULATOR && (
        <div className="bg-indigo-50 dark:bg-indigo-950/30 border-2 border-indigo-200 dark:border-indigo-800 rounded-2xl p-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/50 rounded-xl flex items-center justify-center shrink-0">
              <Upload size={18} className="text-indigo-600 dark:text-indigo-400" />
            </div>
            <div className="flex-1">
              <h3 className="font-black text-sm text-indigo-900 dark:text-indigo-100">Restaurar backup descargado</h3>
              <p className="text-xs text-indigo-700 dark:text-indigo-300 mt-0.5 mb-4">
                Si descargaste un <b>.json</b> desde Drive (u otro origen), subilo acá para restaurarlo en la empresa activa.
                Podés copiar datos de <b>otra empresa</b> (superadmin): se etiquetan con el tenant destino.
                Después elegís <b>Merge</b> (seguro) o <b>Full</b> (reemplaza datos de la empresa destino).
              </p>
              {progress && uploading ? (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs font-bold text-indigo-800 dark:text-indigo-200">
                    <span>{progress.phase}</span>
                  </div>
                  <div className="h-2.5 bg-indigo-100 dark:bg-indigo-900 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-500 animate-pulse rounded-full w-1/3" />
                  </div>
                </div>
              ) : (
                <label className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-black text-sm cursor-pointer transition-colors shadow disabled:opacity-60">
                  <Upload size={15} />
                  {uploading ? 'Subiendo…' : 'Seleccionar backup .json'}
                  <input
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    disabled={uploading || restoring}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleSelectUploadFile(f);
                      e.target.value = '';
                    }}
                  />
                </label>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Carga local (solo emulador) ── */}
      {IS_EMULATOR && (
        <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center shrink-0">
              <Upload size={18} className="text-amber-600" />
            </div>
            <div className="flex-1">
              <h3 className="font-black text-sm text-amber-900">Actualizar datos del emulador</h3>
              <p className="text-xs text-amber-700 mt-0.5 mb-4">
                Descargá el backup desde Drive (botón <b>Drive</b> en la lista) y seleccionalo acá.
                Los datos del emulador se reemplazarán completamente.
              </p>

              {progress ? (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs font-bold text-amber-800">
                    <span>{progress.phase}</span>
                    <span>{progress.done.toLocaleString()} / {progress.total.toLocaleString()}</span>
                  </div>
                  <div className="h-2.5 bg-amber-100 rounded-full overflow-hidden">
                    <div className="h-full bg-amber-500 transition-all duration-300 rounded-full"
                      style={{ width: `${progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
                  </div>
                  <p className="text-[10px] text-amber-600">
                    {progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0}% completado
                  </p>
                </div>
              ) : (
                <label className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-black text-sm cursor-pointer transition-colors shadow">
                  <Upload size={15} />
                  Seleccionar backup .json
                  <input ref={fileInputRef} type="file" accept=".json" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleLoadLocalFile(f); e.target.value = ''; }} />
                </label>
              )}

              {/* Versión activa cargada en el emulador */}
              {loadedVersion && !progress && (
                <div className="mt-4 bg-white border border-amber-200 rounded-xl p-3.5 flex items-start gap-3">
                  <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center shrink-0">
                    <Tag size={14} className="text-amber-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-black uppercase text-amber-600 mb-0.5">Versión activa en emulador</p>
                    <p className="font-black text-sm text-amber-900 truncate">{loadedVersion.fileName}</p>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      <span className="text-xs text-amber-700 font-bold flex items-center gap-1">
                        <Clock size={10} /> {fmtDate(loadedVersion.loadedAt)}
                      </span>
                      <span className="text-xs text-amber-700 font-bold">
                        {loadedVersion.totalDocs.toLocaleString()} docs
                      </span>
                      <span className="text-xs text-amber-700 font-bold">
                        {fmt(loadedVersion.sizeBytes)}
                      </span>
                      <span className="text-xs text-amber-700 font-bold">
                        {loadedVersion.collections.length} col.
                      </span>
                    </div>
                    {loadedVersion.collections.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {loadedVersion.collections.map(c => (
                          <span key={c} className="text-[10px] font-bold bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-md">{c}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 grid grid-cols-3 gap-4 text-center">
        <div>
          <p className="text-[10px] font-black uppercase text-slate-400 mb-1">Destino</p>
          <p className="font-bold text-sm text-slate-700 dark:text-slate-200">Google Drive</p>
        </div>
        <div>
          <p className="text-[10px] font-black uppercase text-slate-400 mb-1">Backups guardados</p>
          <p className="font-black text-2xl text-indigo-600">{backups.length}</p>
        </div>
        <div>
          <p className="text-[10px] font-black uppercase text-slate-400 mb-1">Último backup</p>
          <p className="font-bold text-sm text-slate-700 dark:text-slate-200">{backups[0] ? fmtDate(backups[0].createdAt) : '—'}</p>
        </div>
      </div>

      {/* Lista de backups */}
      {loading ? (
        <div className="text-center py-12 text-slate-400 font-bold">Cargando historial...</div>
      ) : backups.length === 0 ? (
        <div className="text-center py-12">
          <Database size={40} className="mx-auto text-slate-300 mb-3" />
          <p className="font-bold text-slate-500">
            {IS_EMULATOR ? 'Cargá un backup para ver el historial.' : 'Sin backups aún. Creá el primero.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {backups.map((b, i) => (
            <div key={b.id} className={`bg-white dark:bg-slate-800 border rounded-2xl p-4 flex items-center gap-4 hover:shadow-md transition-all ${i === 0 ? 'border-indigo-200 dark:border-indigo-700' : 'border-slate-200 dark:border-slate-700'}`}>
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${b.status === 'ok' ? 'bg-emerald-100' : 'bg-rose-100'}`}>
                {b.status === 'ok' ? <FileJson size={18} className="text-emerald-600" /> : <AlertTriangle size={18} className="text-rose-500" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-black text-sm text-slate-800 dark:text-white truncate">{b.fileName}</p>
                  {i === 0 && <span className="text-[9px] font-black uppercase bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full shrink-0">Último</span>}
                </div>
                <div className="flex items-center gap-4 mt-1 flex-wrap">
                  <span className="flex items-center gap-1 text-xs text-slate-500 font-bold"><Clock size={11} /> {fmtDate(b.createdAt)}</span>
                  {b.sizeBytes > 0 && <span className="text-xs text-slate-400 font-bold">{fmt(b.sizeBytes)}</span>}
                  {b.totalDocs > 0 && <span className="text-xs text-slate-400 font-bold">{b.totalDocs?.toLocaleString()} docs</span>}
                  {b.collections?.length > 0 && <span className="text-xs text-slate-400 font-bold">{b.collections.length} col.</span>}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {b.driveLink && (
                  <a href={b.driveLink} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-black text-indigo-600 hover:bg-indigo-50 rounded-lg border border-indigo-200 transition-colors">
                    <ExternalLink size={12} /> Drive
                  </a>
                )}
                {b.status === 'ok' && !IS_EMULATOR && (() => {
                  const importKind = resolveBackupRecordImportKind(b, empresaId, scopeEmpresa);
                  if (importKind.tenantImport && !isSuperAdmin) return null;
                  const openRestore = (mode: 'merge' | 'full') => setRestoreModal({
                    backup: b,
                    fileName: b.fileName,
                    mode,
                    ...importKind,
                  });
                  return (
                  <>
                    <button onClick={() => openRestore('merge')}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-black text-emerald-600 hover:bg-emerald-50 rounded-lg border border-emerald-200 transition-colors">
                      <RotateCcw size={12} /> Merge
                    </button>
                    <button onClick={() => openRestore('full')}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-black text-rose-600 hover:bg-rose-50 rounded-lg border border-rose-200 transition-colors">
                      <ShieldAlert size={12} /> Full
                    </button>
                  </>
                  );
                })()}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal restauración (producción) */}
      {restoreModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-3xl w-full max-w-md p-8 shadow-2xl border dark:border-slate-700 animate-in zoom-in-95">
            <div className="flex items-center gap-3 mb-6">
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${restoreModal.mode === 'full' ? 'bg-rose-100' : 'bg-emerald-100'}`}>
                {restoreModal.mode === 'full' ? <ShieldAlert size={24} className="text-rose-600"/> : <RotateCcw size={24} className="text-emerald-600"/>}
              </div>
              <div>
                <h3 className="font-black text-lg text-slate-900 dark:text-white">
                  {restoreModal.mode === 'full' ? 'Restauración Completa' : 'Restauración Merge'}
                </h3>
                <p className="text-xs text-slate-500 font-bold">{restoreModal.fileName}</p>
              </div>
              <button onClick={() => setRestoreModal(null)} className="ml-auto text-slate-400 hover:text-slate-600"><X size={20}/></button>
            </div>
            <div className={`p-4 rounded-xl mb-4 text-sm font-bold ${restoreModal.mode === 'full' ? 'bg-rose-50 text-rose-800 border border-rose-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200'}`}>
              {restoreModal.tenantImport && scopeEmpresa ? (
                <>
                  <ShieldAlert size={14} className="inline mr-1.5" />
                  <span className="uppercase text-[11px] tracking-wide">Importación cross-tenant</span>
                  <br />
                  Importación desde otra empresa (<b>{empresas.find(e => e.id === restoreModal.sourceEmpresaId)?.name || restoreModal.sourceEmpresaId}</b> → <b>{empresa?.name || empresaId}</b>): se copiarán empleados, clientes, turnos y demás datos con <b>IDs nuevos</b> y <code>empresaId</code> de destino. Usá <b>solo Full</b> (Merge duplica datos). <b>No se importan usuarios del panel</b> (system_users): el SuperAdmin es global y accede a todas las empresas con el selector superior; creá usuarios admin para {empresa?.name || empresaId} manualmente si hace falta.
                </>
              ) : restoreModal.platformImport && scopeEmpresa ? (
                <>
                  <ShieldAlert size={14} className="inline mr-1.5" />
                  Backup de plataforma (Bacarsa): se copiarán empleados, clientes, turnos y demás datos al tenant <b>{empresa?.name || empresaId}</b>, con IDs nuevos y su <code>empresaId</code>. No se modifican los datos legacy de Bacarsa.
                </>
              ) : restoreModal.mode === 'full' ? (
                <><ShieldAlert size={14} className="inline mr-1.5"/>{scopeEmpresa && empresaId ? `ATENCIÓN: reemplazará solo los datos de ${empresa?.name || empresaId} en las colecciones del backup. Las demás empresas no se tocan.` : restoreModal.storagePath ? 'ATENCIÓN: reemplazará los datos de esta empresa en las colecciones del backup.' : 'ATENCIÓN: Esto borrará y reemplazará TODOS los datos actuales. No se puede deshacer.'}</>
              ) : (
                <><RotateCcw size={14} className="inline mr-1.5"/>Modo seguro: escribe los documentos del backup sin borrar datos existentes.</>
              )}
            </div>
            <div className="flex gap-2 mb-6">
              <button
                type="button"
                disabled={restoring || restoreModal.tenantImport}
                onClick={() => setRestoreModal((m) => (m ? { ...m, mode: 'merge' } : m))}
                className={`flex-1 py-2 rounded-lg text-xs font-black border transition-colors ${restoreModal.mode === 'merge' ? 'bg-emerald-600 text-white border-emerald-600' : 'border-slate-200 text-slate-600 hover:bg-slate-50'} ${restoreModal.tenantImport ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                Merge
              </button>
              <button
                type="button"
                disabled={restoring}
                onClick={() => setRestoreModal((m) => (m ? { ...m, mode: 'full' } : m))}
                className={`flex-1 py-2 rounded-lg text-xs font-black border transition-colors ${restoreModal.mode === 'full' ? 'bg-rose-600 text-white border-rose-600' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              >
                Full
              </button>
            </div>
            {restoring && progress && (
              <div className="mb-5 space-y-2">
                <div className="flex justify-between text-xs font-bold text-slate-600 dark:text-slate-300">
                  <span className="truncate pr-2">{progress.phase}</span>
                  <span className="shrink-0">
                    {progress.total > 0 ? `${progress.done.toLocaleString()} / ${progress.total.toLocaleString()}` : '…'}
                  </span>
                </div>
                <div className="h-3 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${restoreModal.mode === 'full' ? 'bg-rose-500' : 'bg-emerald-500'}`}
                    style={{ width: `${progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 5}%` }}
                  />
                </div>
                <p className="text-[11px] text-slate-400 font-bold text-right">
                  {progress.total > 0 ? `${Math.min(100, Math.round((progress.done / progress.total) * 100))}% completado` : 'Procesando…'}
                </p>
              </div>
            )}
            <div className="flex gap-3">
              <button onClick={() => setRestoreModal(null)} disabled={restoring} className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-600 font-black text-sm hover:bg-slate-50 disabled:opacity-40">Cancelar</button>
              <button onClick={handleRestore} disabled={restoring}
                className={`flex-1 py-3 rounded-xl text-white font-black text-sm flex items-center justify-center gap-2 disabled:opacity-60 ${restoreModal.mode === 'full' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
                {restoring ? <RefreshCw size={16} className="animate-spin"/> : <RotateCcw size={16}/>}
                {restoring ? 'Restaurando...' : `Confirmar ${restoreModal.mode === 'full' ? 'Full Restore' : 'Merge'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Instrucciones Drive */}
      <details className="group">
        <summary className="cursor-pointer text-xs font-black uppercase text-slate-400 hover:text-slate-600 flex items-center gap-2 select-none">
          <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
          Configuración inicial de Google Drive
        </summary>
        <div className="mt-3 p-4 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 text-xs font-mono space-y-2 text-slate-600">
          <p className="font-black text-slate-700">Pasos para habilitar la carpeta Drive:</p>
          <ol className="list-decimal list-inside space-y-1.5">
            <li>Crear una carpeta en Google Drive llamada <strong>COSP-Backups</strong></li>
            <li>Compartir con rol Editor:
              <ul className="list-disc list-inside ml-4 mt-1 space-y-1">
                <li><strong className="text-indigo-600">comtroldata@appspot.gserviceaccount.com</strong></li>
              </ul>
            </li>
            <li>Habilitar Drive API en Google Cloud Console</li>
          </ol>
        </div>
      </details>
    </div>
  );
}
