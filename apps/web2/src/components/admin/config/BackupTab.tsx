import React, { useEffect, useRef, useState } from 'react';
import { db, functions, storage, auth, getEmulatorHost } from '@/lib/firebase';
import { toast } from 'sonner';
import { ref as storageRef, uploadBytes } from 'firebase/storage';
import { collection, query, orderBy, limit, onSnapshot, Timestamp, doc as fsDoc, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { HardDrive, RefreshCw, CheckCircle, AlertTriangle, ExternalLink, Clock, Database, FileJson, RotateCcw, ShieldAlert, X, Upload, Tag, Trash2, RefreshCcw } from 'lucide-react';
import { useEmpresa } from '@/context/EmpresaContext';
import { useAuth } from '@/context/AuthContext';
import { shouldScopeQueriesToEmpresa } from '@/lib/multiempresa';

const STORAGE_KEY = 'emulator_loaded_backup';

function emulatorBaseUrl(): string {
  return `http://${getEmulatorHost()}:8080`;
}

async function assertEmulatorReachable(): Promise<void> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(`${emulatorBaseUrl()}/`, { method: 'GET', signal: ctrl.signal });
    if (!res.ok && res.status !== 404) {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch {
    throw new Error(
      'No se pudo conectar al emulador Firestore (:8080). Ejecutá npm run emulators y recargá la página.',
    );
  } finally {
    clearTimeout(tid);
  }
}

async function checkBridgeReachable(): Promise<boolean> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(`${BRIDGE_URL}/health`, { method: 'GET', signal: ctrl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(tid);
  }
}

async function assertBridgeReachable(): Promise<void> {
  const ok = await checkBridgeReachable();
  if (ok) return;
  throw new Error(
    'Puente de importación (:3010) no responde. Ejecutá npm run emulator-bridge en otra terminal, o reiniciá npm run emulators (inicia el puente automáticamente).',
  );
}

interface LoadedVersion {
  fileName: string;
  loadedAt: string;   // ISO string
  totalDocs: number;
  collections: string[];
  sizeBytes: number;
}

const IS_EMULATOR = process.env.NEXT_PUBLIC_USE_EMULATOR === 'true';
const BRIDGE_URL = 'http://127.0.0.1:3010';
const PROJECT_ID  = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'comtroldata';
const FUNCTIONS_LOGS_URL = `https://console.cloud.google.com/functions/list?project=${PROJECT_ID}`;

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
  source?: string;
  backupScope?: 'platform' | 'empresa';
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
  const err = e as { message?: string; code?: string; details?: unknown };
  const code = String(err?.code ?? '').trim();
  const msg = String(err?.message ?? '').trim();
  const codeHint = code ? ` (${code})` : '';
  if (/deadline-exceeded|timeout/i.test(`${code} ${msg}`)) {
    return `La restauración tardó demasiado${codeHint}. Revisá si los datos quedaron incompletos y volvé a intentar. Logs: ${FUNCTIONS_LOGS_URL}`;
  }
  if (/no such object/i.test(msg)) {
    return 'El archivo subido ya no está en Storage. Volvé a subir el backup JSON y confirmá de inmediato.';
  }
  if (/permission-denied|unauthenticated/i.test(`${code} ${msg}`)) {
    return `${msg || 'Sin permiso'}${codeHint}. Verificá rol de panel y firestore.rules (restore_jobs).`;
  }
  return (msg || 'Error al restaurar') + codeHint;
}

function backupVisibleInTab(
  b: BackupRecord,
  empresaId: string,
  scopeEmpresa: boolean,
  isSuperAdmin: boolean,
): boolean {
  if (!scopeEmpresa) return true;
  if (b.backupScope === 'platform' || b.source === 'scheduledBackup') return true;
  if (!b.empresaId) return true;
  if (isSuperAdmin) return true;
  return String(b.empresaId ?? '').trim().toLowerCase() === String(empresaId ?? '').trim().toLowerCase();
}

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
  const [syncing, setSyncing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [loadingLocal, setLoadingLocal] = useState(false);
  const [loadingLocalSecs, setLoadingLocalSecs] = useState(0);
  const [restoring, setRestoring] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; phase: string } | null>(null);
  const [loadedVersion, setLoadedVersion] = useState<LoadedVersion | null>(null);
  const [bridgeOnline, setBridgeOnline] = useState<boolean | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Leer versión activa del emulador desde localStorage
  useEffect(() => {
    if (!IS_EMULATOR) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setLoadedVersion(JSON.parse(raw));
    } catch {}
  }, []);

  useEffect(() => {
    if (!IS_EMULATOR) return;
    let cancelled = false;
    const poll = async () => {
      const ok = await checkBridgeReachable();
      if (!cancelled) setBridgeOnline(ok);
    };
    poll();
    const id = window.setInterval(poll, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!loadingLocal) { setLoadingLocalSecs(0); return; }
    const id = window.setInterval(() => setLoadingLocalSecs(s => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [loadingLocal]);

  // Suscripción a configuración de horario y último run automático
  useEffect(() => {
    if (!isSuperAdmin) { setScheduleLoading(false); return; }
    const unsubCfg = onSnapshot(fsDoc(db, 'system_config', 'backup_schedule'), snap => {
      if (snap.exists()) {
        const d = snap.data() as { hour?: number; enabled?: boolean };
        if (typeof d.hour === 'number') setScheduleHour(d.hour);
        if (typeof d.enabled === 'boolean') setScheduleEnabled(d.enabled);
      }
      setScheduleLoading(false);
    }, () => setScheduleLoading(false));
    const unsubLog = onSnapshot(fsDoc(db, 'scheduled_job_logs', 'scheduledBackup'), snap => {
      if (snap.exists()) {
        const d = snap.data() as { lastRunAt?: any; lastStatus?: string; lastFileName?: string };
        setLastAutoRun({ at: d.lastRunAt, status: d.lastStatus || '', fileName: d.lastFileName });
      }
    }, () => {});
    return () => { unsubCfg(); unsubLog(); };
  }, [isSuperAdmin]);

  // Suscripción Firestore (producción: remota / emulador: local localhost:8080)
  useEffect(() => {
    if (!empresaId) return;
    setLoading(true);
    setBackups([]);

    const q = scopeEmpresa && !isSuperAdmin
      ? query(collection(db, 'system_backups'), where('empresaId', '==', empresaId), limit(40))
      : query(collection(db, 'system_backups'), orderBy('createdAt', 'desc'), limit(40));

    const unsub = onSnapshot(q, snap => {
      let rows = snap.docs.map(d => ({ id: d.id, ...d.data() } as BackupRecord));
      if (scopeEmpresa) {
        rows = rows.filter(b => backupVisibleInTab(b, empresaId, scopeEmpresa, isSuperAdmin));
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
  }, [empresaId, scopeEmpresa, isSuperAdmin]);

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

  const handleSyncDrive = async () => {
    setSyncing(true); setLastResult(null);
    try {
      await refreshAuthTokenForBackup();
      const fn = httpsCallable(functions, 'syncBackups');
      const res: any = await fn({ empresaId: empresaId || '' });
      const removed = Number(res?.data?.removed ?? 0);
      const checked = Number(res?.data?.checked ?? 0);
      setLastResult({
        ok: true,
        msg: removed > 0
          ? `Sincronizado: se quitaron ${removed} backup(s) que ya no están en Drive (de ${checked} verificados).`
          : `Sincronizado: el historial ya coincide con Drive (${checked} verificados).`,
      });
    } catch (e: any) {
      setLastResult({ ok: false, msg: e?.message || 'Error al sincronizar con Drive' });
    } finally { setSyncing(false); }
  };

  const handleDeleteBackup = async (b: BackupRecord) => {
    if (!confirm(`¿Eliminar "${b.fileName}"? Se borrará el archivo en Drive y el registro del historial. Esta acción no se puede deshacer.`)) return;
    setDeletingId(b.id); setLastResult(null);
    try {
      await refreshAuthTokenForBackup();
      const fn = httpsCallable(functions, 'deleteBackup');
      await fn({ docId: b.id, empresaId: empresaId || '' });
      setLastResult({ ok: true, msg: `Backup "${b.fileName}" eliminado.` });
    } catch (e: any) {
      setLastResult({ ok: false, msg: e?.message || 'Error al eliminar backup' });
    } finally { setDeletingId(null); }
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

  const [localRestoreMode, setLocalRestoreMode] = useState<'empresa' | 'full'>('empresa');
  const [localDevMode, setLocalDevMode] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [scheduleHour, setScheduleHour] = useState(3);
  const [scheduleEnabled, setScheduleEnabled] = useState(true);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [lastAutoRun, setLastAutoRun] = useState<{ at: any; status: string; fileName?: string } | null>(null);

  // Carga backup JSON al emulador vía API local (evita parsear JSON grande en el browser)
  const handleLoadLocalFile = async (file: File) => {
    if (loadingLocal) return;
    setLastResult(null);
    setLoadingLocal(true);
    let isEmpresaMode = localRestoreMode === 'empresa' && !!empresaId;
    setProgress({ done: 0, total: 0, phase: `Validando backup…` });
    await new Promise<void>(r => requestAnimationFrame(() => r()));
    try {
      if (isEmpresaMode && !empresaId) {
        throw new Error('Seleccioná una empresa en el selector superior antes de importar.');
      }

      // Pre-validación: si el archivo es manejable, detectar empresa del backup
      if (isEmpresaMode && file.size < 30 * 1024 * 1024) {
        try {
          const text = await file.text();
          const backup = JSON.parse(text) as Record<string, unknown>;
          const meta = (backup._meta ?? {}) as Record<string, unknown>;
          const backupEmpId = String(meta.empresaId ?? '').trim();
          const detected = detectDominantEmpresaInPayload(backup);
          const sourceEmp = backupEmpId || detected.empresaId;
          if (sourceEmp && sourceEmp.toLowerCase() !== (empresaId || '').toLowerCase()) {
            // Backup de otra empresa: cambiar automáticamente a modo completo
            isEmpresaMode = false;
            toast.info(`Backup de empresa «${sourceEmp}» importado en modo plataforma completa.`);
          }
        } catch { /* si no se puede parsear, continuar normalmente */ }
      }

      await assertBridgeReachable();

      const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
      setProgress({
        done: 0,
        total: 0,
        phase: `Importando en servidor (${sizeMb} MB — puede tardar varios minutos)…`,
      });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 13 * 60 * 1000); // 13 min
      let res: Response;
      try {
        res = await fetch(`${BRIDGE_URL}/import-backup-file`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Empresa-Id': empresaId || 'bacarsa',
            'X-Import-Mode': isEmpresaMode ? 'empresa' : 'full',
            'X-Import-Dev-Mode': localDevMode ? '1' : '0',
            'X-File-Name': encodeURIComponent(file.name),
          },
          body: file,
          signal: controller.signal,
        });
      } catch (fetchErr: any) {
        if (fetchErr?.name === 'AbortError') {
          throw new Error(
            `Tiempo de espera agotado (13 min). Para archivos grandes usá la terminal:\n` +
            `node scripts/seed-from-backup-file.js <ruta-backup.json> --empresa ${empresaId || 'bacarsa'}`,
          );
        }
        throw new Error(
          `No se pudo conectar al puente de importación (:3010). En otra terminal ejecutá: node scripts/emulator-bridge.js`,
        );
      } finally {
        clearTimeout(timeoutId);
      }

      let data: { ok?: boolean; error?: string; written?: number; output?: string } = {};
      try {
        data = await res.json();
      } catch {
        throw new Error(
          `No se pudo conectar al puente de importación (:3010). En otra terminal ejecutá: node scripts/emulator-bridge.js`,
        );
      }
      if (!res.ok) {
        throw new Error(data.error || `Error HTTP ${res.status}`);
      }

      let written = Number(data.written ?? 0);

      // Auto-retry en modo completo si empresa mode no encontró docs
      if (written === 0 && isEmpresaMode) {
        toast.info('Modo empresa sin documentos — reintentando en modo plataforma completa…');
        setProgress({ done: 0, total: 0, phase: 'Reintentando en modo plataforma completa…' });
        const controller2 = new AbortController();
        const timeoutId2 = setTimeout(() => controller2.abort(), 13 * 60 * 1000);
        try {
          const res2 = await fetch(`${BRIDGE_URL}/import-backup-file`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Empresa-Id': empresaId || 'bacarsa',
              'X-Import-Mode': 'full',
              'X-Import-Dev-Mode': localDevMode ? '1' : '0',
              'X-File-Name': encodeURIComponent(file.name),
            },
            body: file,
            signal: controller2.signal,
          });
          const data2 = await res2.json().catch(() => ({})) as typeof data;
          if (res2.ok) written = Number(data2.written ?? 0);
        } finally {
          clearTimeout(timeoutId2);
        }
        isEmpresaMode = false;
      }

      if (written === 0) {
        throw new Error('Importación terminó sin documentos. Verificá que el backup tenga documentos válidos.');
      }

      const version: LoadedVersion = {
        fileName: file.name,
        loadedAt: new Date().toISOString(),
        totalDocs: written,
        collections: [],
        sizeBytes: file.size,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(version));
      setLoadedVersion(version);

      const scope = isEmpresaMode ? ` (solo ${empresaId})` : ' (plataforma completa)';
      const okMsg = `Emulador actualizado${scope} — ${written.toLocaleString()} docs. Recargá la página (F5) para ver los datos.`;
      setLastResult({ ok: true, msg: okMsg });
      toast.success(okMsg);
    } catch (e: any) {
      const msg = e?.message || 'Error al cargar el archivo';
      setLastResult({ ok: false, msg });
      toast.error(msg);
    } finally {
      setLoadingLocal(false);
      setProgress(null);
    }
  };

  const handleSaveSchedule = async () => {
    setSavingSchedule(true);
    try {
      await refreshAuthTokenForBackup();
      const fn = httpsCallable(functions, 'updateBackupSchedule');
      await fn({ hour: scheduleHour, enabled: scheduleEnabled });
      toast.success(`Horario guardado: backup automático a las ${String(scheduleHour).padStart(2, '0')}:00 AR${scheduleEnabled ? '' : ' (deshabilitado)'}`);
    } catch (e: any) {
      toast.error(e?.message || 'Error al guardar configuración');
    } finally {
      setSavingSchedule(false);
    }
  };

  const handleExportLocal = async () => {
    if (exporting) return;
    setExporting(true);
    setLastResult(null);
    try {
      await assertBridgeReachable();
      const scope = localRestoreMode === 'full' ? 'full' : 'empresa';
      const url = `${BRIDGE_URL}/export-backup?empresaId=${encodeURIComponent(empresaId || 'bacarsa')}&scope=${scope}`;
      const res = await fetch(url);
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const fileNameHeader = res.headers.get('X-File-Name');
      const fileName = fileNameHeader ? decodeURIComponent(fileNameHeader) : 'backup.json';
      const totalDocs = res.headers.get('X-Total-Docs') || '?';
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
      setLastResult({ ok: true, msg: `Backup exportado: ${fileName} (${totalDocs} docs). Guardado en tu carpeta de descargas.` });
      toast.success(`Backup exportado: ${fileName}`);
    } catch (e: any) {
      const msg = e?.message || 'Error al exportar backup';
      setLastResult({ ok: false, msg });
      toast.error(msg);
    } finally {
      setExporting(false);
    }
  };

  const handleRestore = async () => {
    if (!restoreModal) return;
    setRestoring(true); setLastResult(null);
    setProgress({ done: 0, total: 0, phase: 'Encolando restauración…' });
    const jobId = `restore_${Date.now()}`;
    const jobRef = fsDoc(db, 'restore_jobs', jobId);
    let unsub: (() => void) | null = null;
    let stagnationTimeoutId: ReturnType<typeof window.setTimeout> | null = null;
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

      const RESTORE_POLL_MS = 45 * 60 * 1000;
      const RESTORE_STAGNATION_MS = 2 * 60 * 1000;
      const RESTORE_QUEUED_STAGNATION_MS = 30 * 1000;
      let lastDone = 0;
      let lastStatus = '';
      const donePromise = new Promise<Record<string, unknown>>((resolve, reject) => {
        const fail = (msg: string) => {
          if (stagnationTimeoutId) window.clearTimeout(stagnationTimeoutId);
          window.clearTimeout(timeoutId);
          reject(new Error(msg));
        };
        const resetStagnationTimeout = (d?: Record<string, unknown>) => {
          if (stagnationTimeoutId) window.clearTimeout(stagnationTimeoutId);
          const status = String(d?.status ?? '');
          const done = Number(d?.docsRestored ?? 0);
          const total = Number(d?.total ?? 0);
          const ms =
            status === 'queued' && total === 0 && done === 0
              ? RESTORE_QUEUED_STAGNATION_MS
              : RESTORE_STAGNATION_MS;
          stagnationTimeoutId = window.setTimeout(() => {
            const hint =
              status === 'queued'
                ? `El job no arrancó en ${RESTORE_QUEUED_STAGNATION_MS / 1000}s. Desplegá functions:restoreBackup y functions:processRestoreJob (4GB). Logs: ${FUNCTIONS_LOGS_URL}`
                : `La restauración no avanzó. Si quedó en «${d?.phase ?? status}», revisá processRestoreJob. Logs: ${FUNCTIONS_LOGS_URL}`;
            fail(hint);
          }, ms);
        };
        const timeoutId = window.setTimeout(() => {
          fail(
            `La restauración no terminó en 45 minutos. Logs processRestoreJob: ${FUNCTIONS_LOGS_URL}`,
          );
        }, RESTORE_POLL_MS);
        resetStagnationTimeout();
        unsub = onSnapshot(
          jobRef,
          (snap) => {
            const d = snap.data();
            if (!d) return;
            const done = Number(d.docsRestored ?? 0);
            const status = String(d.status ?? '');
            setProgress({ done, total: d.total ?? 0, phase: d.phase ?? status });
            if (done > lastDone || status !== lastStatus) {
              lastDone = done;
              lastStatus = status;
              resetStagnationTimeout(d);
            }
            if (d.status === 'done') {
              if (stagnationTimeoutId) window.clearTimeout(stagnationTimeoutId);
              window.clearTimeout(timeoutId);
              resolve(d);
            }
            if (d.status === 'error') {
              fail(String(d.error ?? 'Error al restaurar'));
            }
          },
          (err) => {
            fail(err?.message || 'Sin permiso para leer el progreso de restauración (restore_jobs). Desplegá firestore.rules.');
          },
        );
      });

      const fn = httpsCallable(functions, 'restoreBackup', { timeout: 120000 });
      await refreshAuthTokenForBackup();
      try {
        await fn(payload);
      } catch (callableErr: unknown) {
        const msg = formatRestoreError(callableErr);
        toast.error(msg);
        throw callableErr;
      }

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
      if (stagnationTimeoutId) window.clearTimeout(stagnationTimeoutId);
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
            {!IS_EMULATOR && (
              <p className="text-[11px] text-slate-400 font-bold mt-1">
                Backup automático diario a las 03:00 (AR) — plataforma completa en Drive
              </p>
            )}
          </div>
        </div>
        {!IS_EMULATOR && (
          <div className="flex items-center gap-2">
            <button onClick={handleSyncDrive} disabled={syncing || running}
              className="flex items-center gap-2 px-4 py-3 bg-white hover:bg-slate-50 disabled:opacity-60 text-slate-700 border border-slate-200 rounded-xl font-black text-sm shadow-sm transition-all disabled:scale-100"
              title="Quita del historial los backups que ya borraste en Drive">
              <RefreshCcw size={16} className={syncing ? 'animate-spin' : ''} />
              {syncing ? 'Sincronizando...' : 'Sincronizar con Drive'}
            </button>
            <button onClick={handleRunBackup} disabled={running || syncing}
              className="flex items-center gap-2 px-5 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-xl font-black text-sm shadow-lg transition-all hover:scale-105 disabled:scale-100">
              <RefreshCw size={16} className={running ? 'animate-spin' : ''} />
              {running ? 'Ejecutando...' : 'Crear backup ahora'}
            </button>
          </div>
        )}
      </div>

      {/* Resultado */}
      {lastResult && (
        <div className={`flex items-start gap-3 p-4 rounded-xl border font-bold text-sm ${lastResult.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
          {lastResult.ok ? <CheckCircle size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
          {lastResult.msg}
        </div>
      )}

      {/* ── Horario de backup automático (solo SuperAdmin) ── */}
      {isSuperAdmin && !scheduleLoading && (
        <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-violet-100 dark:bg-violet-900/30 rounded-xl flex items-center justify-center shrink-0">
                <Clock size={18} className="text-violet-600 dark:text-violet-400" />
              </div>
              <div>
                <h3 className="font-black text-sm text-slate-800 dark:text-white">Backup automático</h3>
                <p className="text-xs text-slate-500 font-bold">
                  {lastAutoRun
                    ? `Último: ${fmtDate(lastAutoRun.at)} — ${lastAutoRun.status === 'ok' ? '✓ OK' : '✗ Error'}${lastAutoRun.fileName ? ` (${lastAutoRun.fileName})` : ''}`
                    : 'Sin ejecuciones registradas'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {/* Habilitado / deshabilitado */}
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <div
                  onClick={() => setScheduleEnabled(v => !v)}
                  className={`relative w-10 h-6 rounded-full transition-colors cursor-pointer ${scheduleEnabled ? 'bg-violet-500' : 'bg-slate-300 dark:bg-slate-600'}`}
                >
                  <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${scheduleEnabled ? 'translate-x-4' : ''}`} />
                </div>
                <span className="text-xs font-black text-slate-600 dark:text-slate-300">
                  {scheduleEnabled ? 'Habilitado' : 'Deshabilitado'}
                </span>
              </label>
              {/* Selector de hora */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-black text-slate-500 uppercase">Hora AR</span>
                <select
                  value={scheduleHour}
                  onChange={e => setScheduleHour(Number(e.target.value))}
                  disabled={!scheduleEnabled}
                  className="text-sm font-black border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-1.5 bg-white dark:bg-slate-800 text-slate-800 dark:text-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-violet-400"
                >
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                  ))}
                </select>
              </div>
              <button
                onClick={handleSaveSchedule}
                disabled={savingSchedule}
                className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white rounded-xl font-black text-sm transition-colors shadow"
              >
                {savingSchedule ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                {savingSchedule ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
          {scheduleEnabled && (
            <p className="text-[11px] text-slate-400 font-bold mt-3 ml-13">
              El backup corre automáticamente a las <span className="text-violet-600">{String(scheduleHour).padStart(2, '0')}:00 (AR)</span> todos los días — plataforma completa a Google Drive.
            </p>
          )}
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
              <p className="text-xs text-amber-700 mt-0.5 mb-2">
                Descargá el backup desde Drive y seleccionalo acá. El puente en <code className="bg-amber-100 px-1 rounded">:3010</code> se inicia con <code className="bg-amber-100 px-1 rounded">npm run emulators</code>. Importación ~2-4 min para backups grandes.
              </p>
              <div className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-lg mb-3 ${
                bridgeOnline === null
                  ? 'bg-amber-100 text-amber-700'
                  : bridgeOnline
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-rose-100 text-rose-800'
              }`}>
                <span className={`w-2 h-2 rounded-full ${
                  bridgeOnline === null ? 'bg-amber-400 animate-pulse' : bridgeOnline ? 'bg-emerald-500' : 'bg-rose-500'
                }`} />
                {bridgeOnline === null
                  ? 'Verificando puente :3010…'
                  : bridgeOnline
                    ? 'Puente listo — podés importar'
                    : 'Puente apagado — ejecutá npm run emulator-bridge'}
              </div>
              <div className="flex gap-2 mb-4">
                <button
                  type="button"
                  onClick={() => setLocalRestoreMode('empresa')}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-black border transition-colors ${localRestoreMode === 'empresa' ? 'bg-amber-500 text-white border-amber-500' : 'border-amber-300 text-amber-700 hover:bg-amber-50'}`}
                >
                  Solo {empresaId || 'empresa actual'}
                </button>
                {isSuperAdmin && (
                  <button
                    type="button"
                    onClick={() => setLocalRestoreMode('full')}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-black border transition-colors ${localRestoreMode === 'full' ? 'bg-rose-500 text-white border-rose-500' : 'border-rose-300 text-rose-700 hover:bg-rose-50'}`}
                  >
                    Plataforma completa
                  </button>
                )}
              </div>

              {/* Modo dev: omite audit_logs y user_notifications (~13k docs) */}
              <label className="flex items-center gap-2 cursor-pointer mb-3 select-none">
                <input
                  type="checkbox"
                  checked={localDevMode}
                  onChange={e => setLocalDevMode(e.target.checked)}
                  className="w-3.5 h-3.5 rounded accent-amber-500"
                />
                <span className="text-xs font-bold text-amber-800">
                  Modo dev — omitir audit_logs y notificaciones
                  <span className="font-normal text-amber-600 ml-1">(~13k docs menos, emulador más liviano)</span>
                </span>
              </label>

              {progress || loadingLocal ? (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs font-bold text-amber-800">
                    <span>{progress?.phase ?? 'Preparando…'}</span>
                    <span>{(progress?.done ?? 0).toLocaleString()} / {(progress?.total ?? 0).toLocaleString()}</span>
                  </div>
                  <div className="h-2.5 bg-amber-100 rounded-full overflow-hidden">
                    <div className="h-full bg-amber-500 transition-all duration-300 rounded-full"
                      style={{ width: `${(progress?.total ?? 0) > 0 ? Math.round(((progress?.done ?? 0) / (progress?.total ?? 1)) * 100) : 8}%` }} />
                  </div>
                  <p className="text-[10px] text-amber-600">
                    {(progress?.total ?? 0) > 0
                      ? `${Math.round(((progress?.done ?? 0) / (progress?.total ?? 1)) * 100)}% completado`
                      : loadingLocalSecs > 0
                        ? `Procesando en servidor… ${loadingLocalSecs}s${loadingLocalSecs >= 30 ? ' (puede tardar 2-4 min, no cierres la página)' : ''}`
                        : 'Preparando…'}
                  </p>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <label className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-black text-sm transition-colors shadow ${
                    bridgeOnline === false
                      ? 'bg-amber-300 text-amber-900 cursor-not-allowed opacity-80'
                      : 'bg-amber-500 hover:bg-amber-600 text-white cursor-pointer'
                  }`}>
                    <Upload size={15} />
                    Seleccionar backup .json
                    <input ref={fileInputRef} type="file" accept=".json,application/json" className="hidden"
                      disabled={loadingLocal || bridgeOnline === false}
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleLoadLocalFile(f); e.target.value = ''; }} />
                  </label>
                  <button
                    type="button"
                    onClick={handleExportLocal}
                    disabled={exporting || bridgeOnline === false}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-black text-sm bg-white border-2 border-amber-400 text-amber-700 hover:bg-amber-50 disabled:opacity-60 transition-colors shadow"
                    title="Exporta los datos del emulador como backup .json"
                  >
                    {exporting ? <RefreshCw size={15} className="animate-spin" /> : <Database size={15} />}
                    {exporting ? 'Exportando…' : 'Crear backup local'}
                  </button>
                </div>
              )}

              {/* Versión activa cargada en el emulador */}
              {loadedVersion && !progress && !loadingLocal && (
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
                  {(b.source === 'scheduledBackup' || b.backupScope === 'platform') && (
                    <span className="text-[9px] font-black uppercase bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full shrink-0">Auto 3am</span>
                  )}
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
                {!IS_EMULATOR && (
                  <button onClick={() => handleDeleteBackup(b)} disabled={deletingId === b.id}
                    title="Eliminar backup (Drive + historial)"
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-black text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg border border-slate-200 hover:border-rose-200 transition-colors disabled:opacity-50">
                    {deletingId === b.id ? <RefreshCw size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  </button>
                )}
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
