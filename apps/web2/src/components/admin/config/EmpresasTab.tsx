import React, { useState, useRef } from 'react';
import { Building2, Plus, Save, Play, CheckCircle2, AlertCircle, Loader2, ChevronDown, ChevronUp, Bot, EyeOff, Eye, Trash2, AlertTriangle, Copy, X, Upload, CreditCard, Image as ImageIcon, Radio } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';
import { migrarEmpresa, guardarEmpresa, desactivarEmpresa, activarEmpresa, eliminarEmpresaYDatos, type ProgresoMigracion, type ProgresoEliminacion } from '@/lib/multiempresa';
import { toast } from 'sonner';
import { db, functions, auth, storage } from '@/lib/firebase';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { FirebaseError } from 'firebase/app';
import { httpsCallable } from 'firebase/functions';
import EmpresaAfipSection from '@/components/admin/config/EmpresaAfipSection';

function empresaWriteErrorMessage(err: unknown, isSuperAdmin: boolean): string {
  const code = err instanceof FirebaseError ? err.code : '';
  if (code === 'permission-denied') {
    return isSuperAdmin
      ? 'Permiso denegado en Firestore. CerrÃ¡ sesiÃ³n y volvÃ© a entrar, o ejecutÃ¡ sync de claims (Config â†’ Usuarios).'
      : 'Solo SuperAdmin puede crear o modificar empresas. PedÃ­ acceso a un SuperAdmin.';
  }
  return err instanceof Error ? err.message : 'Error al guardar';
}

export default function EmpresasTab() {
  const { isSuperAdmin } = useAuth();
  const { empresa, empresas, empresaId, switchEmpresa } = useEmpresa();

  // Formulario nueva empresa
  const [form, setForm] = useState({ name: '', cuit: '', direccion: '', plan: 'standard' });
  const [showNueva, setShowNueva] = useState(false);
  const [guardando, setGuardando] = useState(false);

  // Formulario ediciÃ³n empresa activa
  const [editForm, setEditForm] = useState({ name: '', cuit: '', direccion: '' });
  const [guardandoEdit, setGuardandoEdit] = useState(false);

  React.useEffect(() => {
    setEditForm({
      name: empresa?.name || '',
      cuit: (empresa as any)?.cuit || '',
      direccion: (empresa as any)?.direccion || '',
    });
  }, [empresa?.id, empresa?.name, (empresa as any)?.cuit, (empresa as any)?.direccion]);

  const handleGuardarActual = async () => {
    if (!empresa) return;
    if (!editForm.name.trim()) return toast.error('El nombre es obligatorio');
    setGuardandoEdit(true);
    try {
      await guardarEmpresa(empresa.id, {
        name: editForm.name.trim(),
        cuit: editForm.cuit.trim(),
        direccion: editForm.direccion.trim(),
      });
      toast.success('Empresa actualizada');
    } catch (err) {
      toast.error(empresaWriteErrorMessage(err, isSuperAdmin));
    } finally {
      setGuardandoEdit(false);
    }
  };

  // Color de empresa
  const DEFAULT_COLOR = '#6366f1';
  const COLOR_PRESETS = ['#6366f1','#e53e3e','#0ea5e9','#10b981','#f59e0b','#8b5cf6','#ec4899','#14b8a6','#f97316','#64748b'];
  const [colorForm, setColorForm] = useState(empresa?.primaryColor || DEFAULT_COLOR);
  const [guardandoColor, setGuardandoColor] = useState(false);

  React.useEffect(() => {
    setColorForm(empresa?.primaryColor || DEFAULT_COLOR);
  }, [empresa?.id, empresa?.primaryColor]);

  const handleGuardarColor = async () => {
    if (!empresa) return;
    setGuardandoColor(true);
    try {
      await guardarEmpresa(empresa.id, { primaryColor: colorForm } as any);
      toast.success('Color actualizado');
    } catch {
      toast.error('Error al guardar');
    } finally {
      setGuardandoColor(false);
    }
  };

  // Credencial â€” logo + hue + textos configurables (template Ãºnico)
  const CRED_MODELOS: never[] = [];

  // Derivar paleta desde hue HSL
  const hslToHex = (h: number, s: number, l: number): string => {
    s /= 100; l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * c).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  };
  const colorsFromHue = (h: number) => ({
    h1: hslToHex(h, 65, 10),
    h2: hslToHex(h, 55, 20),
    accent: hslToHex(h, 80, 62),
  });

  const logoInputRef = useRef<HTMLInputElement>(null);
  const [logoPreview, setLogoPreview]         = useState<string | null>((empresa as any)?.logoUrl || null);
  const [subiendoLogo, setSubiendoLogo]       = useState(false);
  const [modeloCred, setModeloCred]           = useState<string>((empresa as any)?.credencialModelo || 'clasico');
  const [credHue, setCredHue]                 = useState<number>((empresa as any)?.credencialHue ?? 215);
  const [orientacionCred, setOrientacionCred] = useState<'vertical' | 'horizontal'>((empresa as any)?.credencialOrientacion || 'vertical');
  const [credTitulo, setCredTitulo]           = useState<string>((empresa as any)?.credencialTitulo || 'CREDENCIAL DE ACCESO');
  const [credSubtitulo, setCredSubtitulo]     = useState<string>((empresa as any)?.credencialSubtitulo || 'Personal Autorizado');
  const [credPie, setCredPie]                 = useState<string>((empresa as any)?.credencialPie || '');
  const [guardandoTpl, setGuardandoTpl]       = useState(false);

  React.useEffect(() => {
    setLogoPreview((empresa as any)?.logoUrl || null);
    setModeloCred((empresa as any)?.credencialModelo || 'clasico');
    setCredHue((empresa as any)?.credencialHue ?? 215);
    setOrientacionCred((empresa as any)?.credencialOrientacion || 'vertical');
    setCredTitulo((empresa as any)?.credencialTitulo || 'CREDENCIAL DE ACCESO');
    setCredSubtitulo((empresa as any)?.credencialSubtitulo || 'Personal Autorizado');
    setCredPie((empresa as any)?.credencialPie || '');
  }, [empresa?.id]);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !empresa) return;
    setSubiendoLogo(true);
    try {
      const path = `empresas/${empresa.id}/logo`;
      const sRef = storageRef(storage, path);
      await uploadBytes(sRef, file);
      const url = await getDownloadURL(sRef);
      await guardarEmpresa(empresa.id, { logoUrl: url } as any);
      setLogoPreview(url);
      toast.success('Logo guardado');
    } catch { toast.error('Error al subir el logo'); }
    finally { setSubiendoLogo(false); e.target.value = ''; }
  };

  const handleGuardarTemplate = async () => {
    if (!empresa) return;
    setGuardandoTpl(true);
    try {
      await guardarEmpresa(empresa.id, {
        credencialModelo: modeloCred,
        credencialHue: credHue,
        credencialOrientacion: orientacionCred,
        credencialTitulo: credTitulo.trim(),
        credencialSubtitulo: credSubtitulo.trim(),
        credencialPie: credPie.trim(),
      } as any);
      toast.success('ConfiguraciÃ³n de credencial guardada');
    } catch { toast.error('Error al guardar'); }
    finally { setGuardandoTpl(false); }
  };

  // Asistente IA
  const [guardandoAsistente, setGuardandoAsistente] = useState(false);
  const asistentActivo = empresa?.assistantEnabled !== false;

  const handleToggleAsistente = async () => {
    if (!empresa) return;
    setGuardandoAsistente(true);
    try {
      await guardarEmpresa(empresa.id, { assistantEnabled: !asistentActivo } as any);
      toast.success(asistentActivo ? 'Asistente desactivado' : 'Asistente activado');
    } catch {
      toast.error('Error al guardar');
    } finally {
      setGuardandoAsistente(false);
    }
  };

  const [guardandoCc, setGuardandoCc] = useState(false);
  const ccActivo = empresa?.centroControlEnabled !== false;

  const handleToggleCentroControl = async () => {
    if (!empresa) return;
    setGuardandoCc(true);
    try {
      await guardarEmpresa(empresa.id, { centroControlEnabled: !ccActivo } as any);
      toast.success(ccActivo
        ? 'Centro de Control desactivado: no genera ausencias automáticas ni alertas'
        : 'Centro de Control activado');
    } catch {
      toast.error('Error al guardar');
    } finally {
      setGuardandoCc(false);
    }
  };

  // Mostrar inactivas
  const [mostrarInactivas, setMostrarInactivas] = useState(false);

  // Toggle activo/inactivo por empresa
  const [toggling, setToggling] = useState<string | null>(null);
  const handleToggleActivo = async (e: typeof empresas[0]) => {
    setToggling(e.id);
    try {
      if (e.active === false) { await activarEmpresa(e.id); toast.success(`"${e.name}" reactivada`); }
      else { await desactivarEmpresa(e.id); toast.success(`"${e.name}" desactivada`); }
    } catch { toast.error('Error al cambiar estado'); }
    finally { setToggling(null); }
  };

  // Modal eliminaciÃ³n
  type DeleteStep = 'idle' | 'confirm1' | 'confirm2' | 'deleting';
  const [deleteTarget, setDeleteTarget] = useState<typeof empresas[0] | null>(null);
  const [deleteStep, setDeleteStep] = useState<DeleteStep>('idle');
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('');
  const [deleteProgreso, setDeleteProgreso] = useState<ProgresoEliminacion | null>(null);

  const abrirEliminar = (e: typeof empresas[0]) => {
    setDeleteTarget(e);
    setDeleteConfirmInput('');
    setDeleteProgreso(null);
    setDeleteStep('confirm1');
  };
  const cerrarEliminar = () => { setDeleteStep('idle'); setDeleteTarget(null); setDeleteConfirmInput(''); setDeleteProgreso(null); };

  const handleEliminar = async () => {
    if (!deleteTarget) return;
    setDeleteStep('deleting');
    try {
      // Cambiar empresa activa ANTES de borrar para que el listener se desuscriba
      // antes de recibir la notificaciÃ³n de eliminaciÃ³n (evita la auto-recreaciÃ³n).
      if (empresaId === deleteTarget.id) switchEmpresa('bacarsa');
      await eliminarEmpresaYDatos(deleteTarget.id, p => setDeleteProgreso(p));
      toast.success(`Empresa "${deleteTarget.name}" y todos sus datos eliminados`);
      cerrarEliminar();
    } catch (err: any) {
      toast.error(err?.message || 'Error al eliminar');
      cerrarEliminar();
    }
  };

  // MigraciÃ³n
  const [progreso, setProgreso] = useState<ProgresoMigracion | null>(null);
  const [migrando, setMigrando] = useState(false);

  // Copiar datos entre empresas (superadmin)
  const [copySourceId, setCopySourceId] = useState('');
  const [copyModalOpen, setCopyModalOpen] = useState(false);
  const [copyConfirmInput, setCopyConfirmInput] = useState('');
  const [copyRunning, setCopyRunning] = useState(false);
  const [copyProgress, setCopyProgress] = useState<{ phase: string; docsCopied: number; docsDeleted: number } | null>(null);

  const sourceOptions = empresas.filter((e) => e.id !== empresaId && e.active !== false);
  const copySourceEmpresa = empresas.find((e) => e.id === copySourceId);

  // Mantener origen vÃ¡lido al cambiar empresa destino (evita origen === destino tras switch en topbar)
  React.useEffect(() => {
    if (sourceOptions.length === 0) {
      if (copySourceId) setCopySourceId('');
      return;
    }
    const origenValido =
      copySourceId &&
      copySourceId !== empresaId &&
      sourceOptions.some((e) => e.id === copySourceId);
    if (!origenValido) {
      const preferBacarsa = sourceOptions.find((e) => e.id.toLowerCase() === 'bacarsa');
      setCopySourceId(preferBacarsa?.id ?? sourceOptions[0].id);
    }
  }, [empresaId, sourceOptions, copySourceId]);

  const handleCopyEmpresaData = async () => {
    if (!empresaId || !copySourceId) return;
    if (copySourceId.toLowerCase() === empresaId.toLowerCase()) {
      toast.error('ElegÃ­ una empresa origen distinta al destino.');
      return;
    }
    if (copyConfirmInput.trim() !== empresaId) {
      toast.error(`EscribÃ­ el ID destino: ${empresaId}`);
      return;
    }
    setCopyRunning(true);
    setCopyProgress({ phase: 'Iniciandoâ€¦', docsCopied: 0, docsDeleted: 0 });
    const jobId = `migrate_${Date.now()}`;
    try {
      await auth.currentUser?.getIdToken(true);
      const fn = httpsCallable(functions, 'migrateEmpresaData', { timeout: 110000 });

      let startColIndex = 0;
      let idMaps: Record<string, Record<string, string>> | null = null;
      let docsCopied = 0;
      let docsDeleted = 0;
      let totalCollections = 0;

      for (let guard = 0; guard < 40; guard++) {
        const res = await fn({ sourceEmpresaId: copySourceId, targetEmpresaId: empresaId, jobId, startColIndex, idMaps, docsCopied, docsDeleted }) as { data: any };
        const d = res.data;
        docsCopied = Number(d.docsCopied ?? docsCopied);
        docsDeleted = Number(d.docsDeleted ?? docsDeleted);
        totalCollections = Number(d.totalCollections ?? totalCollections);
        idMaps = d.idMaps ?? idMaps;
        const next = Number(d.nextColIndex ?? startColIndex + 1);
        setCopyProgress({
          phase: d.isComplete
            ? 'Completado'
            : `Copiando (${next}/${totalCollections || '?'})â€¦`,
          docsCopied,
          docsDeleted,
        });
        if (d.isComplete) break;
        startColIndex = next;
      }

      toast.success(`Datos copiados a ${empresa?.name || empresaId}`);
      setCopyModalOpen(false);
      setCopyConfirmInput('');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error al copiar datos');
    } finally {
      setCopyRunning(false);
      setCopyProgress(null);
    }
  };

  // â”€â”€ Crear nueva empresa â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleCrearEmpresa = async () => {
    if (!form.name.trim()) return toast.error('El nombre es obligatorio');
    const id = form.name.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    if (!id) return toast.error('Nombre invÃ¡lido');
    setGuardando(true);
    try {
      await guardarEmpresa(id, { name: form.name.trim(), cuit: form.cuit, direccion: form.direccion, plan: form.plan });
      toast.success(`Empresa "${form.name}" creada (ID: ${id})`);
      setForm({ name: '', cuit: '', direccion: '', plan: 'standard' });
      setShowNueva(false);
    } catch (err) {
      toast.error(empresaWriteErrorMessage(err, isSuperAdmin));
    } finally {
      setGuardando(false);
    }
  };

  // â”€â”€ MigraciÃ³n â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleMigrar = async () => {
    if (!confirm(`Â¿Migrar todos los datos existentes a la empresa "${empresa?.name}" (${empresaId})?\n\nEsto agrega el campo empresaId a todos los documentos sin Ã©l. Es una operaciÃ³n segura y no elimina datos.`)) return;
    setMigrando(true);
    setProgreso(null);
    try {
      await migrarEmpresa(empresaId, p => setProgreso(p));
    } catch {
      // El error ya estÃ¡ en progreso.error
    } finally {
      setMigrando(false);
    }
  };

  const migracionCompleta = (empresa as any)?.migracionCompleta === true;
  const porcentaje = progreso && progreso.total > 0
    ? Math.round((progreso.procesados / progreso.total) * 100)
    : progreso?.completa ? 100 : 0;

  return (
    <div className="space-y-6">

      {/* â”€â”€ Lista de empresas (solo superadmin) â”€â”€ */}
      {isSuperAdmin && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Building2 size={18} className="text-indigo-600" />
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-wide">Empresas registradas</h3>
            </div>
            <button
              onClick={() => setShowNueva(s => !s)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-black hover:bg-indigo-700 transition-colors"
            >
              <Plus size={13} /> Nueva empresa
              {showNueva ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
          </div>

          {/* Filtro inactivas */}
          <div className="flex items-center gap-2 mb-3">
            <button onClick={() => setMostrarInactivas(v => !v)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-black border transition-colors ${mostrarInactivas ? 'bg-slate-700 text-white border-slate-600' : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'}`}>
              {mostrarInactivas ? <Eye size={11} /> : <EyeOff size={11} />}
              {mostrarInactivas ? 'Ocultar inactivas' : 'Mostrar inactivas'}
            </button>
          </div>

          {/* Lista */}
          <div className="space-y-2 mb-4">
            {empresas.length === 0 && (
              <p className="text-sm text-slate-400 font-medium py-4 text-center">Sin empresas registradas aÃºn</p>
            )}
            {empresas
              .filter(e => mostrarInactivas || e.active !== false)
              .map(e => (
              <div key={e.id}
                className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                  e.active === false ? 'opacity-50 bg-slate-50 border-slate-200' :
                  e.id === empresaId ? 'bg-indigo-50 border-indigo-300 shadow-sm' : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div className="flex items-center gap-3 cursor-pointer flex-1 min-w-0" onClick={() => e.active !== false && switchEmpresa(e.id)}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center font-black text-sm text-white shrink-0"
                    style={{ backgroundColor: (e as any).primaryColor || '#94a3b8' }}>
                    {(e.name || e.id || '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-black text-slate-800 truncate">{e.name || e.id}</p>
                    <p className="text-[10px] text-slate-400 font-mono">{e.id}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  {(e as any).migracionCompleta && (
                    <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full hidden sm:flex items-center gap-1">
                      <CheckCircle2 size={10} /> Migrada
                    </span>
                  )}
                  {e.id === empresaId && e.active !== false && (
                    <span className="text-[10px] font-bold text-indigo-600 bg-indigo-100 px-2 py-0.5 rounded-full">Activa</span>
                  )}
                  {e.active === false && (
                    <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">Inactiva</span>
                  )}
                  {/* Toggle activo/inactivo â€” bloqueado si es la empresa activa */}
                  {e.id !== empresaId && (
                    <button onClick={() => handleToggleActivo(e)} disabled={toggling === e.id}
                      title={e.active === false ? 'Reactivar empresa' : 'Desactivar empresa'}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors disabled:opacity-40">
                      {toggling === e.id ? <Loader2 size={14} className="animate-spin" /> : e.active === false ? <Eye size={14} /> : <EyeOff size={14} />}
                    </button>
                  )}
                  {/* Eliminar â€” bloqueado solo si es la empresa activa */}
                  {e.id !== empresaId && (
                    <button onClick={() => abrirEliminar(e)}
                      title="Eliminar empresa y todos sus datos"
                      className="p-1.5 rounded-lg text-rose-400 hover:text-rose-600 hover:bg-rose-50 transition-colors">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Formulario nueva empresa */}
          {showNueva && (
            <div className="border-t border-slate-200 pt-4 mt-4 space-y-3">
              <p className="text-xs font-black text-slate-500 uppercase tracking-wide">Nueva empresa</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">Nombre *</label>
                  <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    placeholder="Ej: Empresa X SA" />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">CUIT</label>
                  <input value={form.cuit} onChange={e => setForm(f => ({ ...f, cuit: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    placeholder="30-00000000-0" />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">DirecciÃ³n</label>
                  <input value={form.direccion} onChange={e => setForm(f => ({ ...f, direccion: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    placeholder="Calle 123, Ciudad" />
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowNueva(false)} className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-700 transition-colors">Cancelar</button>
                <button onClick={handleCrearEmpresa} disabled={guardando}
                  className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-black hover:bg-indigo-700 disabled:opacity-60 transition-colors">
                  {guardando ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Crear empresa
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* â”€â”€ Datos de empresa activa â”€â”€ */}
      {empresa && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <Building2 size={18} className="text-indigo-600" />
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-wide">Datos de empresa</h3>
          </div>
          <p className="text-xs text-slate-500 font-medium mb-5">
            {isSuperAdmin
              ? 'EditÃ¡ el nombre y los datos de la empresa activa.'
              : 'Solo lectura: los cambios de empresa las hace un SuperAdmin.'}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div className="md:col-span-2">
              <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">Nombre *</label>
              <input
                value={editForm.name}
                onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400"
                placeholder="Ej: Bacar SA"
              />
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">CUIT</label>
              <input
                value={editForm.cuit}
                onChange={e => setEditForm(f => ({ ...f, cuit: e.target.value }))}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400"
                placeholder="30-00000000-0"
              />
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">DirecciÃ³n</label>
              <input
                value={editForm.direccion}
                onChange={e => setEditForm(f => ({ ...f, direccion: e.target.value }))}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400"
                placeholder="Calle 123, Ciudad"
              />
            </div>
          </div>
          <div className="flex justify-end">
            {isSuperAdmin && (
              <button
                onClick={handleGuardarActual}
                disabled={guardandoEdit}
                className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-black hover:bg-indigo-700 disabled:opacity-60 transition-colors"
              >
                {guardandoEdit ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Guardar cambios
              </button>
            )}
          </div>
        </div>
      )}

      {empresa && (
        <div className={`rounded-2xl border p-6 shadow-sm ${ccActivo ? 'bg-white border-slate-200' : 'bg-slate-50 border-amber-200'}`}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${ccActivo ? 'bg-cyan-500/15' : 'bg-slate-200'}`}>
                <Radio size={18} className={ccActivo ? 'text-cyan-600' : 'text-slate-400'} />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-black text-slate-800 uppercase tracking-wide">Centro de Control</h3>
                <p className="text-xs text-slate-500 font-medium mt-1 leading-relaxed">
                  Motor de Operaciones: ausencias automáticas (T+30), vacantes, retención y avisos de llegada tarde.
                  Si no usás el módulo, desactivalo para que no genere novedades ni consuma lecturas cada 5 minutos.
                </p>
                <p className={`text-[10px] font-black uppercase tracking-wider mt-2 ${ccActivo ? 'text-emerald-600' : 'text-amber-700'}`}>
                  {ccActivo ? 'Activo — genera alertas y cierra turnos' : 'Pausado — sin alertas automáticas'}
                </p>
              </div>
            </div>
            {isSuperAdmin && (
              <button
                type="button"
                onClick={handleToggleCentroControl}
                disabled={guardandoCc}
                role="switch"
                aria-checked={ccActivo}
                aria-label="Activar o pausar Centro de Control"
                className={`relative h-8 w-14 rounded-full shrink-0 transition-colors disabled:opacity-60 ${ccActivo ? 'bg-cyan-600' : 'bg-slate-300'}`}
              >
                <span className={`absolute top-1 left-1 h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${ccActivo ? 'translate-x-6' : 'translate-x-0'}`} />
                {guardandoCc && <Loader2 size={12} className="absolute inset-0 m-auto animate-spin text-white" />}
              </button>
            )}
          </div>
        </div>
      )}

      {empresa && isSuperAdmin && (
        <EmpresaAfipSection
          empresaId={empresa.id}
          empresaName={empresa.name}
          empresaCuit={(empresa as { cuit?: string }).cuit}
        />
      )}

      {/* â”€â”€ Color de empresa â”€â”€ */}
      {empresa && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-4 h-4 rounded-full border border-slate-200 shrink-0" style={{ backgroundColor: colorForm }} />
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-wide">Color de empresa</h3>
          </div>
          <p className="text-xs text-slate-500 font-medium mb-5">
            El sidebar y los elementos de navegaciÃ³n adoptarÃ¡n este color para la empresa activa.
          </p>

          <div className="flex flex-wrap items-center gap-3 mb-5">
            {/* Picker nativo */}
            <input
              type="color"
              value={colorForm}
              onChange={e => setColorForm(e.target.value)}
              className="w-10 h-10 rounded-xl cursor-pointer border border-slate-200 p-0.5 shrink-0"
              title="Elegir color personalizado"
            />
            {/* Presets */}
            <div className="flex flex-wrap gap-2">
              {COLOR_PRESETS.map(c => (
                <button
                  key={c}
                  onClick={() => setColorForm(c)}
                  className="w-8 h-8 rounded-lg transition-all border-2"
                  style={{ backgroundColor: c, borderColor: colorForm === c ? '#0f172a' : 'transparent' }}
                  title={c}
                />
              ))}
            </div>
            {isSuperAdmin && (
              <button
                onClick={handleGuardarColor}
                disabled={guardandoColor}
                className="ml-auto flex items-center gap-1.5 px-4 py-2 text-white rounded-xl text-xs font-black disabled:opacity-60 transition-colors"
                style={{ backgroundColor: colorForm }}
              >
                {guardandoColor ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                Guardar
              </button>
            )}
          </div>

          {/* Preview */}
          <div className="flex items-center gap-3 p-3 rounded-xl border" style={{ backgroundColor: colorForm + '18', borderColor: colorForm + '40' }}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-black text-base shrink-0" style={{ backgroundColor: colorForm }}>
              {(empresa.name || empresa.id || '?').charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-black" style={{ color: colorForm }}>{empresa.name || empresa.id}</p>
              <p className="text-[11px] text-slate-400">Sidebar y navegaciÃ³n en este color</p>
            </div>
            <div className="ml-auto flex gap-1">
              <div className="w-3 h-6 rounded" style={{ backgroundColor: colorForm }} />
              <div className="w-3 h-6 rounded opacity-60" style={{ backgroundColor: colorForm }} />
              <div className="w-3 h-6 rounded opacity-30" style={{ backgroundColor: colorForm }} />
            </div>
          </div>
        </div>
      )}

      {/* â”€â”€ Credencial de empleado â”€â”€ */}
      {empresa && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <CreditCard size={18} className="text-indigo-600" />
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-wide">Credencial de empleado</h3>
          </div>
          <p className="text-xs text-slate-500 font-medium mb-5">
            Logo e identidad visual que aparecen en las credenciales digitales de los empleados.
          </p>

          <div className="flex flex-col gap-6">
            {/* Logo */}
            <div>
              <p className="text-xs font-black text-slate-600 uppercase tracking-wide mb-3">Logo de empresa</p>
              <div className="flex items-center gap-4">
                <div
                  className="w-20 h-20 rounded-2xl border-2 border-dashed border-slate-200 flex items-center justify-center overflow-hidden shrink-0 cursor-pointer hover:border-indigo-400 transition-colors bg-slate-50"
                  onClick={() => logoInputRef.current?.click()}
                  title="Subir logo"
                >
                  {logoPreview ? (
                    <img src={logoPreview} alt="Logo" className="w-full h-full object-contain p-2" />
                  ) : (
                    <div className="flex flex-col items-center gap-1 text-slate-300">
                      <ImageIcon size={24} />
                      <span className="text-[9px] font-bold uppercase">Logo</span>
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => logoInputRef.current?.click()}
                    disabled={subiendoLogo || !isSuperAdmin}
                    className="flex items-center gap-1.5 px-4 py-2 border border-slate-200 bg-white hover:bg-slate-50 rounded-xl text-xs font-black text-slate-600 disabled:opacity-60 transition-colors"
                  >
                    {subiendoLogo ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                    {logoPreview ? 'Reemplazar logo' : 'Subir logo'}
                  </button>
                  <p className="text-[10px] text-slate-400">PNG o SVG con fondo transparente Â· Recomendado 200Ã—200px</p>
                </div>
                <input ref={logoInputRef} type="file" accept="image/png,image/svg+xml,image/webp" className="hidden" onChange={handleLogoUpload} />
              </div>
            </div>

            {/* Template selector */}
            <div>
              <p className="text-xs font-black text-slate-600 uppercase tracking-wide mb-4">Template de credencial</p>

              {/* â”€â”€ OrientaciÃ³n â”€â”€ */}
              <div className="flex items-center gap-3 mb-5">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider shrink-0">OrientaciÃ³n</p>
                <div className="flex border border-slate-200 rounded-xl overflow-hidden">
                  {(['vertical', 'horizontal'] as const).map(o => (
                    <button
                      key={o}
                      onClick={() => setOrientacionCred(o)}
                      className={`px-4 py-1.5 text-[11px] font-black uppercase tracking-wide transition-colors ${
                        orientacionCred === o
                          ? 'bg-indigo-600 text-white'
                          : 'bg-white text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      {o === 'vertical' ? 'â†• Vertical' : 'â†” Horizontal'}
                    </button>
                  ))}
                </div>
              </div>

              {/* â”€â”€ Vista previa del template â”€â”€ */}
              <div className="flex justify-center mb-5">
                {(() => {
                  const col = colorsFromHue(credHue);
                  const isH = orientacionCred === 'horizontal';
                  const bg = '#0b1120';
                  const person = (sz: number) => (
                    <svg width={sz} height={sz} viewBox="0 0 60 80" fill="none">
                      <circle cx="30" cy="22" r="14" fill={col.accent} opacity="0.3"/>
                      <path d="M 4 80 Q 4 52 30 48 Q 56 52 56 80 Z" fill={col.accent} opacity="0.2"/>
                    </svg>
                  );
                  const logoEl = (h: number) => logoPreview
                    ? <img src={logoPreview} style={{ height:h, maxWidth:h*3.5, objectFit:'contain', filter:'brightness(0) invert(1)', opacity:0.9, display:'block' }} alt=""/>
                    : <div style={{ width:h, height:h, borderRadius:3, background:`${col.accent}25`, border:`1px solid ${col.accent}50`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                        <svg width={h*0.6} height={h*0.6} viewBox="0 0 24 24" fill="none" stroke={col.accent} strokeWidth="1.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                      </div>;
                  if (isH) return (
                    <div style={{ width:310, height:196, background:bg, borderRadius:8, boxShadow:'0 6px 28px rgba(0,0,0,0.7)', display:'flex', overflow:'hidden', position:'relative' }}>
                      <div style={{ width:'40%', position:'relative', background:col.h2, flexShrink:0, overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center' }}>
                        {person(70)}
                        <div style={{ position:'absolute', inset:0, background:'linear-gradient(90deg, transparent 55%, #0b1120 100%)' }}/>
                        <div style={{ position:'absolute', bottom:0, left:0, right:0, height:'45%', background:'linear-gradient(0deg, rgba(11,17,32,0.92) 0%, transparent 100%)' }}/>
                        <div style={{ position:'absolute', bottom:8, left:0, right:0, display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
                          {logoEl(12)}
                          <span style={{ color:'rgba(255,255,255,0.5)', fontSize:4.5, fontWeight:700, letterSpacing:'0.06em' }}>EMPRESA</span>
                        </div>
                      </div>
                      <div style={{ flex:1, display:'flex', flexDirection:'column', padding:'10px 10px 8px' }}>
                        <p style={{ color:col.accent, fontSize:5, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:3 }}>Credencial de acceso</p>
                        <p style={{ color:'#fff', fontSize:11, fontWeight:800, lineHeight:1.2, marginBottom:1 }}>GARCÃA, Juan</p>
                        <p style={{ color:`${col.accent}cc`, fontSize:5, fontWeight:700, textTransform:'uppercase', marginBottom:6 }}>Vigilador</p>
                        <div style={{ height:0.5, background:`${col.accent}22`, marginBottom:6 }}/>
                        <div style={{ display:'flex', gap:8 }}>
                          <div><p style={{ color:'rgba(255,255,255,0.35)', fontSize:3.5, textTransform:'uppercase' }}>Legajo</p><p style={{ color:'rgba(255,255,255,0.85)', fontSize:6, fontWeight:700, fontFamily:'monospace' }}>#4521</p></div>
                          <div><p style={{ color:'rgba(255,255,255,0.35)', fontSize:3.5, textTransform:'uppercase' }}>DNI</p><p style={{ color:'rgba(255,255,255,0.85)', fontSize:6, fontWeight:700, fontFamily:'monospace' }}>28.456.789</p></div>
                        </div>
                        <div style={{ height:0.5, background:`${col.accent}22`, margin:'6px 0' }}/>
                        <p style={{ fontSize:3.5, color:'rgba(255,255,255,0.38)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:2 }}>CÃ³digo de verificaciÃ³n</p>
                        <p style={{ color:'#fff', fontSize:11, fontWeight:800, letterSpacing:'0.2em', fontFamily:'monospace' }}>482 071</p>
                        <div style={{ marginTop:'auto', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                          <div style={{ display:'flex', alignItems:'center', gap:4, padding:'3px 7px', borderRadius:12, background:'rgba(255,255,255,0.07)', border:'0.5px solid rgba(255,255,255,0.15)' }}>
                            <span style={{ color:'rgba(255,255,255,0.55)', fontSize:4.5, fontWeight:700, textTransform:'uppercase' }}>Ver QR</span>
                          </div>
                          <p style={{ color:'rgba(255,255,255,0.2)', fontSize:4 }}>VÃ¡lida 12/2026</p>
                        </div>
                      </div>
                      <div style={{ position:'absolute', top:0, left:0, right:0, height:2.5, background:`linear-gradient(90deg,${col.h2},${col.accent},${col.h2})` }}/>
                    </div>
                  );
                  return (
                    <div style={{ width:195, height:308, background:bg, borderRadius:10, boxShadow:'0 6px 28px rgba(0,0,0,0.7)', display:'flex', flexDirection:'column', overflow:'hidden', position:'relative' }}>
                      <div style={{ padding:'6px 9px', display:'flex', alignItems:'center', gap:5, borderBottom:`0.5px solid ${col.accent}20` }}>
                        {logoEl(13)}
                        <div style={{ flex:1 }}>
                          <p style={{ color:'#fff', fontSize:5.5, fontWeight:800, lineHeight:1 }}>EMPRESA</p>
                          <p style={{ color:`${col.accent}bb`, fontSize:3.8, fontWeight:700, textTransform:'uppercase' }}>Credencial de acceso</p>
                        </div>
                      </div>
                      <div style={{ flex:'0 0 44%', position:'relative', background:col.h2, display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden' }}>
                        {person(80)}
                        <div style={{ position:'absolute', bottom:0, left:0, right:0, height:'50%', background:'linear-gradient(0deg, #0b1120 0%, transparent 100%)' }}/>
                        <div style={{ position:'absolute', bottom:8, left:10, right:10 }}>
                          <p style={{ color:'#fff', fontSize:11, fontWeight:800, lineHeight:1.2 }}>GARCÃA, J.</p>
                          <p style={{ color:col.accent, fontSize:5, fontWeight:700, textTransform:'uppercase', marginTop:1 }}>Vigilador</p>
                        </div>
                      </div>
                      <div style={{ flex:1, padding:'8px 10px', display:'flex', flexDirection:'column', gap:4 }}>
                        <div style={{ display:'flex', gap:9 }}>
                          <div><p style={{ color:'rgba(255,255,255,0.35)', fontSize:3.5, textTransform:'uppercase' }}>Legajo</p><p style={{ color:'rgba(255,255,255,0.85)', fontSize:6, fontWeight:700, fontFamily:'monospace' }}>#4521</p></div>
                          <div><p style={{ color:'rgba(255,255,255,0.35)', fontSize:3.5, textTransform:'uppercase' }}>DNI</p><p style={{ color:'rgba(255,255,255,0.85)', fontSize:6, fontWeight:700, fontFamily:'monospace' }}>28.456.789</p></div>
                        </div>
                        <div style={{ height:0.5, background:`${col.accent}22` }}/>
                        <p style={{ fontSize:3.5, color:'rgba(255,255,255,0.38)', textTransform:'uppercase', letterSpacing:'0.06em' }}>VerificaciÃ³n</p>
                        <p style={{ color:'#fff', fontSize:11, fontWeight:800, letterSpacing:'0.2em', fontFamily:'monospace' }}>482 071</p>
                        <div style={{ marginTop:'auto', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                          <div style={{ display:'flex', alignItems:'center', gap:4, padding:'3px 7px', borderRadius:12, background:'rgba(255,255,255,0.07)', border:'0.5px solid rgba(255,255,255,0.15)' }}>
                            <span style={{ color:'rgba(255,255,255,0.55)', fontSize:4.5, fontWeight:700, textTransform:'uppercase' }}>Ver QR</span>
                          </div>
                          <p style={{ color:'rgba(255,255,255,0.2)', fontSize:4 }}>12/2026</p>
                        </div>
                      </div>
                      <div style={{ position:'absolute', top:0, left:0, right:0, height:2.5, background:`linear-gradient(90deg,${col.h2},${col.accent},${col.h2})` }}/>
                      <div style={{ position:'absolute', bottom:0, left:0, right:0, height:3, background:`linear-gradient(90deg,${col.h2},${col.accent}80,${col.h2})` }}/>
                    </div>
                  );
                })()}
              </div>
              {/* (mapa vacÃ­o - mantenido para compatibilidad) */}
              <div style={{ display: 'none' }}>
                {CRED_MODELOS.map(modelo => {
                  const col = colorsFromHue(credHue);
                  const selected = modeloCred === modelo.id;
                  const isH = orientacionCred === 'horizontal';
                  return (
                    <button
                      key={modelo.id}
                      onClick={() => setModeloCred(modelo.id)}
                      className={`flex flex-col rounded-2xl overflow-hidden border-2 transition-all duration-200 ${
                        selected
                          ? 'border-slate-300 shadow-xl scale-[1.01]'
                          : 'border-slate-200 hover:border-slate-300 hover:shadow-sm'
                      }`}
                    >
                      <div
                        className="w-full flex items-center justify-center overflow-hidden"
                        style={{ height: isH ? 215 : 335, background: '#0d1117' }}
                      >
                        {(() => {
                          const person = (sz: number) => (
                            <svg width={sz} height={sz} viewBox="0 0 60 70" fill="none">
                              <circle cx="30" cy="22" r="13" fill={col.accent} opacity="0.85"/>
                              <ellipse cx="30" cy="60" rx="22" ry="14" fill={col.accent} opacity="0.65"/>
                            </svg>
                          );
                          const photoSq = (w: number, h: number, r = 4) => (
                            <div style={{ width:w, height:h, borderRadius:r, background:col.h2, border:`1.5px solid ${col.accent}55`, overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                              {person(Math.round(Math.min(w,h)*0.75))}
                            </div>
                          );
                          const logoEl = (h: number) => logoPreview
                            ? <img src={logoPreview} style={{ height:h, maxWidth:h*3.5, objectFit:'contain', filter:'brightness(0) invert(1)', display:'block' }} alt=""/>
                            : <span style={{ fontSize:h-2, color:col.accent, fontWeight:900, letterSpacing:1, lineHeight:1 }}>BACAR</span>;
                          const verSec = (fs = 13) => (
                            <div>
                              <div style={{ fontSize:3.5, color:'rgba(255,255,255,0.38)', marginBottom:2, letterSpacing:0.5 }}>CÃ“DIGO DE VERIFICACIÃ“N</div>
                              <div style={{ fontSize:fs, fontWeight:900, color:'#fff', fontFamily:'monospace', letterSpacing:'0.18em' }}>482 071</div>
                              <div style={{ marginTop:2, height:1.5, width:30, background:'rgba(255,255,255,0.14)', borderRadius:1, overflow:'hidden' }}>
                                <div style={{ height:'100%', width:'65%', background:'rgba(255,255,255,0.45)' }}/>
                              </div>
                            </div>
                          );
                          const qrEl = (sz: number) => (
                            <div style={{ width:sz, height:sz, borderRadius:3, border:`1.5px solid ${col.accent}60`, overflow:'hidden', flexShrink:0 }}>
                              <div style={{ width:'100%', height:'100%', backgroundImage:`repeating-linear-gradient(0deg,${col.accent}80 0,${col.accent}80 2px,transparent 2px,transparent 4px),repeating-linear-gradient(90deg,${col.accent}80 0,${col.accent}80 2px,transparent 2px,transparent 4px)` }}/>
                            </div>
                          );
                          const chip = () => <div style={{ width:16, height:11, borderRadius:2, background:'linear-gradient(135deg,#c6901c,#efc848,#a67010)', border:'0.5px solid #9a6a08' }}/>;

                          /* â”€â”€â”€â”€â”€â”€â”€ GRADIENTE â”€â”€â”€â”€â”€â”€â”€ */
                          if (modelo.id === 'gradiente') {
                            const bg = `linear-gradient(160deg,${col.h1} 0%,${col.h2} 55%,${hslToHex(credHue,50,28)} 100%)`;
                            if (isH) return (
                              <div style={{ width:310, height:196, background:bg, borderRadius:8, boxShadow:'0 6px 28px rgba(0,0,0,0.7)', display:'flex', overflow:'hidden', position:'relative' }}>
                                <div style={{ width:88, background:col.h2, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:7, padding:'10px 8px', borderRight:`1px solid ${col.accent}35` }}>
                                  {logoEl(13)}{photoSq(58, 78, 5)}
                                </div>
                                <div style={{ flex:1, display:'flex', flexDirection:'column', padding:'8px 10px', gap:5 }}>
                                  <div>
                                    <div style={{ fontSize:9, color:'#fff', fontWeight:900 }}>GARCÃA, Juan</div>
                                    <div style={{ fontSize:5, color:'rgba(255,255,255,0.45)', fontWeight:700, marginBottom:3 }}>VIGILADOR</div>
                                  </div>
                                  <div style={{ height:0.5, background:'rgba(255,255,255,0.15)' }}/>
                                  <div style={{ display:'flex', gap:10 }}>
                                    <div><div style={{ fontSize:3.5, color:'rgba(255,255,255,0.35)' }}>LEGAJO</div><div style={{ fontSize:6, fontWeight:700, color:'rgba(255,255,255,0.85)', fontFamily:'monospace' }}>#4521</div></div>
                                    <div><div style={{ fontSize:3.5, color:'rgba(255,255,255,0.35)' }}>DNI</div><div style={{ fontSize:6, fontWeight:700, color:'rgba(255,255,255,0.85)', fontFamily:'monospace' }}>28.456.789</div></div>
                                  </div>
                                  <div style={{ height:0.5, background:'rgba(255,255,255,0.15)' }}/>
                                  {verSec(12)}
                                  <div style={{ marginTop:'auto', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                                    {chip()}
                                    <div style={{ fontSize:3.5, color:'rgba(255,255,255,0.28)' }}>VÃ¡lida 12/2026</div>
                                  </div>
                                </div>
                                <div style={{ position:'absolute', bottom:0, left:0, right:0, height:3, background:`linear-gradient(90deg,${col.accent}70,rgba(255,255,255,0.35),${col.accent}70)` }}/>
                              </div>
                            );
                            return (
                              <div style={{ width:195, height:308, background:bg, borderRadius:10, boxShadow:'0 6px 28px rgba(0,0,0,0.7)', display:'flex', flexDirection:'column', position:'relative', overflow:'hidden' }}>
                                <div style={{ padding:'7px 9px 6px', paddingRight:54, borderBottom:'0.5px solid rgba(255,255,255,0.18)', display:'flex', alignItems:'center', gap:5 }}>
                                  {logoEl(13)}<div style={{ fontSize:5.5, color:'#fff', fontWeight:900 }}>SECURITY CORP</div>
                                </div>
                                <div style={{ padding:'5px 9px', paddingRight:54, borderBottom:'0.5px solid rgba(255,255,255,0.13)' }}>
                                  <div style={{ fontSize:9, color:'#fff', fontWeight:900 }}>GARCÃA, Juan</div>
                                  <div style={{ fontSize:5, color:'rgba(255,255,255,0.45)', fontWeight:700, marginBottom:5 }}>VIGILADOR</div>
                                  <div style={{ display:'flex', gap:9 }}>
                                    <div><div style={{ fontSize:3.5, color:'rgba(255,255,255,0.33)' }}>LEGAJO</div><div style={{ fontSize:5.5, fontWeight:700, color:'rgba(255,255,255,0.82)', fontFamily:'monospace' }}>#4521</div></div>
                                    <div><div style={{ fontSize:3.5, color:'rgba(255,255,255,0.33)' }}>DNI</div><div style={{ fontSize:5.5, fontWeight:700, color:'rgba(255,255,255,0.82)', fontFamily:'monospace' }}>28.456.789</div></div>
                                  </div>
                                </div>
                                <div style={{ padding:'5px 9px', paddingRight:54, borderBottom:'0.5px solid rgba(255,255,255,0.13)' }}>
                                  {verSec(13)}
                                </div>
                                <div style={{ position:'absolute', top:0, right:0, width:50, bottom:16, display:'flex', alignItems:'center', justifyContent:'center' }}>
                                  {photoSq(42, 62, 4)}
                                </div>
                                <div style={{ marginTop:'auto', padding:'4px 9px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                                  {chip()}<div style={{ fontSize:3.5, color:'rgba(255,255,255,0.28)' }}>VÃ¡lida 12/2026</div>
                                </div>
                                <div style={{ height:3, background:`linear-gradient(90deg,${col.accent}70,rgba(255,255,255,0.35),${col.accent}70)` }}/>
                              </div>
                            );
                          }

                          /* â”€â”€â”€â”€â”€â”€â”€ CORPORATIVO â”€â”€â”€â”€â”€â”€â”€ */
                          if (modelo.id === 'corporativo') {
                            const hdrBg = `linear-gradient(90deg,#111827,#1e3a5f)`;
                            if (isH) return (
                              <div style={{ width:310, height:196, borderRadius:8, boxShadow:'0 6px 28px rgba(0,0,0,0.7)', overflow:'hidden', display:'flex', flexDirection:'column' }}>
                                <div style={{ background:hdrBg, padding:'5px 10px', display:'flex', alignItems:'center', gap:6 }}>
                                  {logoEl(12)}<div style={{ flex:1 }}><div style={{ fontSize:6.5, color:'#fff', fontWeight:900 }}>SECURITY CORP</div><div style={{ fontSize:4, color:col.accent }}>CREDENCIAL DE EMPLEADO</div></div>
                                </div>
                                <div style={{ height:3, background:`linear-gradient(90deg,${col.accent},${col.h2})` }}/>
                                <div style={{ flex:1, background:'#f8fafc', display:'flex' }}>
                                  <div style={{ width:75, display:'flex', alignItems:'center', justifyContent:'center', padding:'8px 8px' }}>{photoSq(56, 75, 5)}</div>
                                  <div style={{ flex:1, padding:'7px 8px 6px', display:'flex', flexDirection:'column', gap:4 }}>
                                    <div>
                                      <div style={{ fontSize:8.5, color:'#111827', fontWeight:900 }}>GARCÃA, Juan</div>
                                      <div style={{ fontSize:5, color:col.accent, fontWeight:700 }}>VIGILADOR</div>
                                    </div>
                                    <div style={{ display:'flex', gap:9 }}>
                                      <div><div style={{ fontSize:3.5, color:'#94a3b8' }}>LEGAJO</div><div style={{ fontSize:6, fontWeight:700, color:'#1e293b', fontFamily:'monospace' }}>#4521</div></div>
                                      <div><div style={{ fontSize:3.5, color:'#94a3b8' }}>DNI</div><div style={{ fontSize:6, fontWeight:700, color:'#1e293b', fontFamily:'monospace' }}>28.456.789</div></div>
                                    </div>
                                    <div style={{ background:hdrBg, borderRadius:4, padding:'4px 6px' }}>
                                      <div style={{ fontSize:3.5, color:'rgba(255,255,255,0.45)', marginBottom:1.5 }}>VERIFICACIÃ“N</div>
                                      <div style={{ fontSize:10, fontWeight:900, color:'#fff', fontFamily:'monospace', letterSpacing:'0.15em' }}>482 071</div>
                                      <div style={{ marginTop:2, height:1.5, width:26, background:'rgba(255,255,255,0.15)', borderRadius:1, overflow:'hidden' }}><div style={{ height:'100%', width:'65%', background:'rgba(255,255,255,0.45)' }}/></div>
                                    </div>
                                  </div>
                                  <div style={{ padding:'7px 8px 6px', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'flex-end', gap:2 }}>
                                    {qrEl(30)}<div style={{ fontSize:3.5, color:'#94a3b8' }}>12/2026</div>
                                  </div>
                                </div>
                                <div style={{ background:hdrBg, height:8, display:'flex', alignItems:'center', justifyContent:'center' }}>
                                  <div style={{ fontSize:4, color:'rgba(255,255,255,0.3)' }}>SISTEMA COSP</div>
                                </div>
                              </div>
                            );
                            return (
                              <div style={{ width:195, height:308, borderRadius:10, boxShadow:'0 6px 28px rgba(0,0,0,0.7)', overflow:'hidden', display:'flex', flexDirection:'column' }}>
                                <div style={{ background:hdrBg, padding:'7px 10px', display:'flex', alignItems:'center', gap:7 }}>
                                  {logoEl(14)}<div><div style={{ fontSize:7, color:'#fff', fontWeight:900 }}>SECURITY CORP</div><div style={{ fontSize:4, color:col.accent }}>IDENTIFICACIÃ“N PERSONAL</div></div>
                                </div>
                                <div style={{ height:3, background:`linear-gradient(90deg,${col.accent},${col.h2})` }}/>
                                <div style={{ flex:1, background:'#f8fafc', padding:'8px 10px', display:'flex', flexDirection:'column', gap:6 }}>
                                  <div style={{ display:'flex', alignItems:'flex-start', gap:8 }}>
                                    <div style={{ flex:1 }}>
                                      <div style={{ fontSize:9.5, color:'#111827', fontWeight:900, lineHeight:1.2 }}>GARCÃA</div>
                                      <div style={{ fontSize:9.5, color:'#111827', fontWeight:900, lineHeight:1.2 }}>Juan Carlos</div>
                                      <div style={{ fontSize:5, color:col.accent, fontWeight:700, marginTop:3 }}>VIGILADOR</div>
                                    </div>
                                    {photoSq(52, 66, 5)}
                                  </div>
                                  <div style={{ height:0.5, background:'#e2e8f0' }}/>
                                  <div style={{ display:'flex', gap:10 }}>
                                    <div><div style={{ fontSize:3.5, color:'#94a3b8' }}>LEGAJO</div><div style={{ fontSize:7, fontWeight:700, color:'#1e293b', fontFamily:'monospace' }}>#4521</div></div>
                                    <div><div style={{ fontSize:3.5, color:'#94a3b8' }}>DNI</div><div style={{ fontSize:7, fontWeight:700, color:'#1e293b', fontFamily:'monospace' }}>28.456.789</div></div>
                                  </div>
                                  <div style={{ background:hdrBg, borderRadius:5, padding:'5px 7px' }}>
                                    <div style={{ fontSize:3.5, color:'rgba(255,255,255,0.45)', marginBottom:2 }}>CÃ“DIGO DE VERIFICACIÃ“N</div>
                                    <div style={{ fontSize:13, fontWeight:900, color:'#fff', fontFamily:'monospace', letterSpacing:'0.2em' }}>482 071</div>
                                    <div style={{ marginTop:2, height:1.5, width:30, background:'rgba(255,255,255,0.15)', borderRadius:1, overflow:'hidden' }}><div style={{ height:'100%', width:'65%', background:'rgba(255,255,255,0.45)' }}/></div>
                                  </div>
                                  <div style={{ marginTop:'auto', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                                    {qrEl(32)}<div><div style={{ fontSize:4, color:'#94a3b8' }}>VÃ¡lida hasta</div><div style={{ fontSize:6.5, fontWeight:700, color:'#1e293b' }}>12/2026</div></div>
                                  </div>
                                </div>
                                <div style={{ background:hdrBg, height:10, display:'flex', alignItems:'center', justifyContent:'center' }}>
                                  <div style={{ fontSize:4, color:'rgba(255,255,255,0.3)' }}>SECURITY CORP Â· Sistema COSP</div>
                                </div>
                              </div>
                            );
                          }

                          /* â”€â”€â”€â”€â”€â”€â”€ PHOTO FULL â”€â”€â”€â”€â”€â”€â”€ */
                          if (modelo.id === 'photo_full') {
                            const overGrad = 'linear-gradient(to bottom,rgba(0,0,0,0) 25%,rgba(0,0,0,0.65) 58%,rgba(0,0,0,0.92) 100%)';
                            if (isH) return (
                              <div style={{ width:310, height:196, background:'#0f0f14', borderRadius:8, boxShadow:'0 6px 28px rgba(0,0,0,0.9)', display:'flex', overflow:'hidden' }}>
                                <div style={{ width:128, position:'relative', overflow:'hidden', background:'#1a1f2e', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                                  {person(80)}
                                  <div style={{ position:'absolute', inset:0, background:'linear-gradient(to right,rgba(0,0,0,0) 50%,rgba(0,0,0,0.8))' }}/>
                                  <div style={{ position:'absolute', top:8, left:8, display:'flex', alignItems:'center', gap:4 }}>{logoEl(11)}</div>
                                  <div style={{ position:'absolute', bottom:10, left:10 }}>
                                    <div style={{ fontSize:9, color:'#fff', fontWeight:900 }}>GARCÃA, Juan</div>
                                    <div style={{ fontSize:5, color:col.accent, fontWeight:700 }}>VIGILADOR</div>
                                  </div>
                                </div>
                                <div style={{ flex:1, padding:'8px 10px', display:'flex', flexDirection:'column', gap:5 }}>
                                  <div style={{ display:'flex', gap:8 }}>
                                    <div><div style={{ fontSize:3.5, color:'rgba(255,255,255,0.35)' }}>LEGAJO</div><div style={{ fontSize:6, fontWeight:700, color:'rgba(255,255,255,0.85)', fontFamily:'monospace' }}>#4521</div></div>
                                    <div><div style={{ fontSize:3.5, color:'rgba(255,255,255,0.35)' }}>DNI</div><div style={{ fontSize:6, fontWeight:700, color:'rgba(255,255,255,0.85)', fontFamily:'monospace' }}>28.456.789</div></div>
                                  </div>
                                  <div style={{ height:0.5, background:'rgba(255,255,255,0.1)' }}/>
                                  {verSec(11)}
                                  <div style={{ marginTop:'auto', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                                    <div style={{ fontSize:3.5, color:'rgba(255,255,255,0.3)' }}>VÃ¡lida 12/2026</div>
                                    {qrEl(20)}
                                  </div>
                                </div>
                              </div>
                            );
                            return (
                              <div style={{ width:195, height:308, background:'#0f0f14', borderRadius:10, boxShadow:'0 6px 28px rgba(0,0,0,0.9)', overflow:'hidden', display:'flex', flexDirection:'column' }}>
                                <div style={{ height:180, position:'relative', background:'#1a1f2e', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                                  {person(100)}
                                  <div style={{ position:'absolute', inset:0, background:overGrad }}/>
                                  <div style={{ position:'absolute', top:0, left:0, right:0, height:3, background:`linear-gradient(90deg,${col.accent},${col.h2})` }}/>
                                  <div style={{ position:'absolute', top:8, left:10 }}>{logoEl(12)}</div>
                                  <div style={{ position:'absolute', bottom:10, left:10 }}>
                                    <div style={{ fontSize:11, color:'#fff', fontWeight:900, lineHeight:1.2 }}>GARCÃA</div>
                                    <div style={{ fontSize:11, color:'#fff', fontWeight:900, lineHeight:1.2 }}>Juan C.</div>
                                    <div style={{ fontSize:5, color:col.accent, fontWeight:700, marginTop:2 }}>VIGILADOR</div>
                                  </div>
                                </div>
                                <div style={{ flex:1, padding:'8px 10px', display:'flex', flexDirection:'column', gap:5 }}>
                                  <div style={{ display:'flex', gap:9 }}>
                                    <div><div style={{ fontSize:3.5, color:'rgba(255,255,255,0.35)' }}>LEGAJO</div><div style={{ fontSize:6.5, fontWeight:700, color:'rgba(255,255,255,0.85)', fontFamily:'monospace' }}>#4521</div></div>
                                    <div><div style={{ fontSize:3.5, color:'rgba(255,255,255,0.35)' }}>DNI</div><div style={{ fontSize:6.5, fontWeight:700, color:'rgba(255,255,255,0.85)', fontFamily:'monospace' }}>28.456.789</div></div>
                                  </div>
                                  <div style={{ height:0.5, background:'rgba(255,255,255,0.1)' }}/>
                                  {verSec(11)}
                                  <div style={{ marginTop:'auto', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                                    <div style={{ fontSize:3.5, color:'rgba(255,255,255,0.3)' }}>VÃ¡lida 12/2026</div>
                                    {qrEl(20)}
                                  </div>
                                </div>
                              </div>
                            );
                          }

                          /* â”€â”€â”€â”€â”€â”€â”€ SPLIT CLEAN â”€â”€â”€â”€â”€â”€â”€ */
                          if (modelo.id === 'split_clean') {
                            const leftBg = `linear-gradient(180deg,#111827,#1e3a5f)`;
                            if (isH) return (
                              <div style={{ width:310, height:196, borderRadius:8, boxShadow:'0 6px 28px rgba(0,0,0,0.7)', overflow:'hidden', display:'flex' }}>
                                <div style={{ width:104, background:leftBg, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:6, padding:'8px', borderRight:`2px solid ${col.accent}` }}>
                                  {logoEl(12)}{photoSq(56, 78, 4)}
                                  <div style={{ fontSize:3.5, color:'rgba(255,255,255,0.4)', textAlign:'center' }}>SECURITY CORP</div>
                                </div>
                                <div style={{ flex:1, background:'#f8fafc', display:'flex', flexDirection:'column' }}>
                                  <div style={{ height:3, background:`linear-gradient(90deg,${col.accent},${col.h2})` }}/>
                                  <div style={{ flex:1, padding:'8px 10px', display:'flex', flexDirection:'column', gap:4 }}>
                                    <div>
                                      <div style={{ fontSize:9, color:'#0f172a', fontWeight:900 }}>GARCÃA, Juan</div>
                                      <div style={{ fontSize:5, color:col.accent, fontWeight:700 }}>VIGILADOR</div>
                                    </div>
                                    <div style={{ display:'flex', gap:9 }}>
                                      <div><div style={{ fontSize:3.5, color:'#94a3b8' }}>LEGAJO</div><div style={{ fontSize:6, fontWeight:700, color:'#1e293b', fontFamily:'monospace' }}>#4521</div></div>
                                      <div><div style={{ fontSize:3.5, color:'#94a3b8' }}>DNI</div><div style={{ fontSize:6, fontWeight:700, color:'#1e293b', fontFamily:'monospace' }}>28.456.789</div></div>
                                    </div>
                                    <div style={{ background:'#0f172a', borderRadius:4, padding:'4px 6px' }}>
                                      <div style={{ fontSize:3.5, color:'rgba(255,255,255,0.4)', marginBottom:1.5 }}>VERIFICACIÃ“N</div>
                                      <div style={{ fontSize:11, fontWeight:900, color:'#fff', fontFamily:'monospace', letterSpacing:'0.15em' }}>482 071</div>
                                      <div style={{ marginTop:2, height:1.5, width:26, background:'rgba(255,255,255,0.15)', borderRadius:1, overflow:'hidden' }}><div style={{ height:'100%', width:'65%', background:col.accent }}/></div>
                                    </div>
                                    <div style={{ marginTop:'auto', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                                      <div style={{ fontSize:3.5, color:'#94a3b8' }}>12/2026</div>{qrEl(22)}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                            return (
                              <div style={{ width:195, height:308, borderRadius:10, boxShadow:'0 6px 28px rgba(0,0,0,0.7)', overflow:'hidden', display:'flex' }}>
                                <div style={{ width:62, background:leftBg, display:'flex', flexDirection:'column', alignItems:'center', gap:6, padding:'10px 8px', borderRight:`2px solid ${col.accent}` }}>
                                  {logoEl(12)}{photoSq(42, 62, 4)}
                                  <div style={{ height:0.5, background:'rgba(255,255,255,0.2)', width:'100%' }}/>
                                  <div style={{ textAlign:'center' }}><div style={{ fontSize:3.2, color:'rgba(255,255,255,0.4)' }}>LEGAJO</div><div style={{ fontSize:7, fontWeight:900, color:'#fff', fontFamily:'monospace' }}>#4521</div></div>
                                  <div style={{ textAlign:'center' }}><div style={{ fontSize:3.2, color:'rgba(255,255,255,0.4)' }}>DNI</div><div style={{ fontSize:5, fontWeight:700, color:'rgba(255,255,255,0.8)', fontFamily:'monospace' }}>28.456.789</div></div>
                                </div>
                                <div style={{ flex:1, background:'#f8fafc', display:'flex', flexDirection:'column' }}>
                                  <div style={{ height:4, background:`linear-gradient(90deg,${col.accent},${col.h2})` }}/>
                                  <div style={{ flex:1, padding:'8px 10px', display:'flex', flexDirection:'column', gap:5 }}>
                                    <div>
                                      <div style={{ fontSize:9.5, color:'#0f172a', fontWeight:900, lineHeight:1.2 }}>GARCÃA</div>
                                      <div style={{ fontSize:9.5, color:'#0f172a', fontWeight:900, lineHeight:1.2 }}>Juan C.</div>
                                      <div style={{ fontSize:5, color:col.accent, fontWeight:700, marginTop:2 }}>VIGILADOR</div>
                                    </div>
                                    <div style={{ height:0.5, background:'#e2e8f0' }}/>
                                    <div><div style={{ fontSize:3.5, color:'#94a3b8' }}>CUIL</div><div style={{ fontSize:5.5, fontWeight:700, color:'#1e293b', fontFamily:'monospace' }}>20-28456789-6</div></div>
                                    <div style={{ background:'#0f172a', borderRadius:5, padding:'5px 7px' }}>
                                      <div style={{ fontSize:3.5, color:'rgba(255,255,255,0.4)', marginBottom:1.5 }}>VERIFICACIÃ“N</div>
                                      <div style={{ fontSize:11, fontWeight:900, color:'#fff', fontFamily:'monospace', letterSpacing:'0.18em' }}>482 071</div>
                                      <div style={{ marginTop:2, height:1.5, width:26, background:'rgba(255,255,255,0.15)', borderRadius:1, overflow:'hidden' }}><div style={{ height:'100%', width:'65%', background:col.accent }}/></div>
                                    </div>
                                    <div style={{ marginTop:'auto', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                                      <div style={{ fontSize:3.5, color:'#94a3b8' }}>VÃ¡lida 12/2026</div>{qrEl(22)}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          }

                          /* â”€â”€â”€â”€â”€â”€â”€ ID OFICIAL â”€â”€â”€â”€â”€â”€â”€ */
                          if (modelo.id === 'id_oficial') {
                            const hdrBg2 = `linear-gradient(90deg,#0f172a,#1e293b)`;
                            const goldBg = 'linear-gradient(90deg,#92400e,#f59e0b,#92400e)';
                            if (isH) return (
                              <div style={{ width:310, height:196, borderRadius:8, boxShadow:'0 6px 28px rgba(0,0,0,0.7)', overflow:'hidden', display:'flex', flexDirection:'column' }}>
                                <div style={{ background:hdrBg2, padding:'5px 10px', display:'flex', alignItems:'center', gap:6 }}>
                                  {logoEl(12)}<div style={{ flex:1 }}><div style={{ fontSize:6.5, color:'#fff', fontWeight:900 }}>SECURITY CORP</div><div style={{ fontSize:4, color:'rgba(255,255,255,0.5)' }}>CREDENCIAL OFICIAL</div></div>
                                  <div style={{ fontSize:4.5, color:'rgba(255,255,255,0.35)', fontFamily:'monospace' }}>BSP-4521</div>
                                </div>
                                <div style={{ height:2.5, background:goldBg }}/>
                                <div style={{ flex:1, background:'#fafaf8', display:'flex' }}>
                                  <div style={{ width:74, display:'flex', alignItems:'center', justifyContent:'center', padding:8 }}>{photoSq(56, 74, 4)}</div>
                                  <div style={{ flex:1, padding:'7px 8px', display:'flex', flexDirection:'column', gap:4 }}>
                                    <div><div style={{ fontSize:9, color:'#0f172a', fontWeight:900 }}>GARCÃA, Juan</div><div style={{ display:'inline-flex', background:'#0f172a18', borderRadius:3, padding:'1px 4px' }}><div style={{ fontSize:4.5, color:'#0f172a', fontWeight:700 }}>VIGILADOR</div></div></div>
                                    <div style={{ display:'flex', gap:9 }}>
                                      <div><div style={{ fontSize:3.5, color:'#94a3b8' }}>LEGAJO</div><div style={{ fontSize:6, fontWeight:700, color:'#0f172a', fontFamily:'monospace' }}>#4521</div></div>
                                      <div><div style={{ fontSize:3.5, color:'#94a3b8' }}>DNI</div><div style={{ fontSize:6, fontWeight:700, color:'#0f172a', fontFamily:'monospace' }}>28.456.789</div></div>
                                    </div>
                                    <div style={{ background:'#0f172a', borderRadius:4, padding:'4px 6px', border:'0.5px solid rgba(245,158,11,0.35)' }}>
                                      <div style={{ fontSize:3.5, color:'rgba(255,255,255,0.4)', marginBottom:1.5 }}>CÃ“DIGO DE VERIFICACIÃ“N</div>
                                      <div style={{ fontSize:11, fontWeight:900, color:'#fff', fontFamily:'monospace', letterSpacing:'0.15em' }}>482 071</div>
                                      <div style={{ marginTop:2, height:1.5, width:26, background:'rgba(255,255,255,0.15)', borderRadius:1, overflow:'hidden' }}><div style={{ height:'100%', width:'65%', background:'#f59e0b' }}/></div>
                                    </div>
                                  </div>
                                  <div style={{ padding:'7px 8px', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'flex-end', gap:2 }}>
                                    {qrEl(28)}<div style={{ fontSize:3.5, color:'#94a3b8' }}>12/2026</div>
                                  </div>
                                </div>
                                <div style={{ background:hdrBg2, height:8, display:'flex', alignItems:'center', justifyContent:'center' }}>
                                  <div style={{ fontSize:4, color:'rgba(255,255,255,0.3)' }}>SISTEMA COSP</div>
                                </div>
                              </div>
                            );
                            return (
                              <div style={{ width:195, height:308, borderRadius:10, boxShadow:'0 6px 28px rgba(0,0,0,0.7)', overflow:'hidden', display:'flex', flexDirection:'column' }}>
                                <div style={{ background:hdrBg2, padding:'7px 10px', display:'flex', alignItems:'center', gap:6 }}>
                                  {logoEl(14)}<div><div style={{ fontSize:7, color:'#fff', fontWeight:900 }}>SECURITY CORP</div><div style={{ fontSize:4, color:'rgba(255,255,255,0.5)' }}>CREDENCIAL OFICIAL</div></div>
                                  <div style={{ marginLeft:'auto', fontSize:5, color:'rgba(255,255,255,0.3)', fontFamily:'monospace' }}>BSP-4521</div>
                                </div>
                                <div style={{ height:2.5, background:goldBg }}/>
                                <div style={{ flex:1, background:'#fafaf8', padding:'8px 10px', position:'relative', display:'flex', flexDirection:'column', gap:5 }}>
                                  <div style={{ display:'flex', gap:8, alignItems:'flex-start' }}>
                                    <div style={{ flex:1 }}>
                                      <div style={{ fontSize:10, color:'#0f172a', fontWeight:900, lineHeight:1.2 }}>GARCÃA</div>
                                      <div style={{ fontSize:10, color:'#0f172a', fontWeight:900, lineHeight:1.2 }}>Juan C.</div>
                                      <div style={{ marginTop:3, display:'inline-flex', background:'#0f172a18', borderRadius:3, padding:'2px 5px' }}><div style={{ fontSize:5, color:'#0f172a', fontWeight:700 }}>VIGILADOR</div></div>
                                    </div>
                                    {photoSq(52, 68, 4)}
                                  </div>
                                  <div style={{ height:0.5, background:'#e2e8f0' }}/>
                                  <div style={{ display:'flex', gap:10 }}>
                                    <div><div style={{ fontSize:3.5, color:'#94a3b8' }}>LEGAJO</div><div style={{ fontSize:7, fontWeight:700, color:'#0f172a', fontFamily:'monospace' }}>#4521</div></div>
                                    <div><div style={{ fontSize:3.5, color:'#94a3b8' }}>DNI</div><div style={{ fontSize:7, fontWeight:700, color:'#0f172a', fontFamily:'monospace' }}>28.456.789</div></div>
                                  </div>
                                  <div style={{ background:'#0f172a', borderRadius:5, padding:'5px 8px', border:'0.5px solid rgba(245,158,11,0.3)' }}>
                                    <div style={{ fontSize:3.5, color:'rgba(255,255,255,0.4)', marginBottom:2 }}>CÃ“DIGO DE VERIFICACIÃ“N</div>
                                    <div style={{ fontSize:13, fontWeight:900, color:'#fff', fontFamily:'monospace', letterSpacing:'0.2em' }}>482 071</div>
                                    <div style={{ marginTop:2, height:1.5, width:30, background:'rgba(255,255,255,0.15)', borderRadius:1, overflow:'hidden' }}><div style={{ height:'100%', width:'65%', background:'#f59e0b' }}/></div>
                                  </div>
                                  <div style={{ marginTop:'auto', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                                    {qrEl(26)}<div style={{ fontSize:3.5, color:'#94a3b8' }}>VÃ¡lida 12/2026</div>
                                  </div>
                                </div>
                                <div style={{ background:hdrBg2, height:10, display:'flex', alignItems:'center', justifyContent:'center' }}>
                                  <div style={{ fontSize:4, color:'rgba(255,255,255,0.3)' }}>SECURITY CORP Â· Sistema COSP</div>
                                </div>
                              </div>
                            );
                          }

                          /* â”€â”€â”€â”€â”€â”€â”€ PREMIUM DARK â”€â”€â”€â”€â”€â”€â”€ */
                          const darkBg = '#0d1117', purp = '#6366f1';
                          if (isH) return (
                            <div style={{ width:310, height:196, background:darkBg, borderRadius:8, boxShadow:'0 6px 28px rgba(0,0,0,0.9)', overflow:'hidden', display:'flex', position:'relative' }}>
                              <div style={{ position:'absolute', top:0, left:0, right:0, height:3, background:`linear-gradient(90deg,${purp},${col.accent})` }}/>
                              <div style={{ width:86, paddingTop:8, display:'flex', flexDirection:'column', alignItems:'center', gap:7, borderRight:`0.5px solid ${purp}30` }}>
                                {logoEl(13)}
                                <div style={{ width:56, height:70, border:`1.5px solid ${purp}70`, borderRadius:5, overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center', background:'#1a1f2e' }}>{person(46)}</div>
                                <div style={{ fontSize:4, color:'rgba(255,255,255,0.25)', textAlign:'center' }}>SECURITY CORP</div>
                              </div>
                              <div style={{ flex:1, paddingTop:8, padding:'8px 10px', display:'flex', flexDirection:'column', gap:5 }}>
                                <div><div style={{ fontSize:9, color:'#fff', fontWeight:900 }}>GARCÃA, Juan</div><div style={{ fontSize:5, color:purp, fontWeight:700 }}>VIGILADOR SENIOR</div></div>
                                <div style={{ background:'rgba(255,255,255,0.05)', borderRadius:4, padding:'4px 6px', border:`0.5px solid ${purp}25` }}>
                                  <div style={{ display:'flex', gap:9, marginBottom:3 }}>
                                    <div><div style={{ fontSize:3.5, color:'rgba(255,255,255,0.3)' }}>LEGAJO</div><div style={{ fontSize:5.5, fontWeight:700, color:'rgba(255,255,255,0.85)', fontFamily:'monospace' }}>#4521</div></div>
                                    <div><div style={{ fontSize:3.5, color:'rgba(255,255,255,0.3)' }}>DNI</div><div style={{ fontSize:5.5, fontWeight:700, color:'rgba(255,255,255,0.85)', fontFamily:'monospace' }}>28.456.789</div></div>
                                  </div>
                                  <div style={{ height:0.5, background:`${purp}25`, margin:'2px 0' }}/>
                                  <div style={{ fontSize:3.5, color:'rgba(255,255,255,0.35)', marginBottom:2 }}>CÃ“DIGO DE VERIFICACIÃ“N</div>
                                  <div style={{ fontSize:13, fontWeight:900, color:'#fff', fontFamily:'monospace', letterSpacing:'0.18em' }}>482 071</div>
                                  <div style={{ marginTop:2, height:1.5, width:28, background:'rgba(255,255,255,0.12)', borderRadius:1, overflow:'hidden' }}><div style={{ height:'100%', width:'65%', background:`${purp}80` }}/></div>
                                </div>
                                <div style={{ marginTop:'auto', fontSize:4, color:'rgba(255,255,255,0.25)' }}>VÃ¡lida 12/2026</div>
                              </div>
                            </div>
                          );
                          return (
                            <div style={{ width:195, height:308, background:darkBg, borderRadius:10, boxShadow:'0 6px 28px rgba(0,0,0,0.9)', overflow:'hidden', display:'flex', flexDirection:'column', position:'relative' }}>
                              <div style={{ position:'absolute', top:0, left:0, bottom:0, width:4, background:`linear-gradient(180deg,${purp},${col.accent})`, zIndex:1 }}/>
                              <div style={{ padding:'7px 9px 7px 12px', display:'flex', alignItems:'center', gap:6 }}>
                                {logoEl(12)}<div><div style={{ fontSize:5.5, color:purp, fontWeight:900 }}>SECURITY CORP</div><div style={{ fontSize:3.8, color:'rgba(255,255,255,0.3)' }}>PERSONAL DE SEGURIDAD</div></div>
                                <div style={{ marginLeft:'auto', width:5, height:5, borderRadius:'50%', background:'#22c55e', boxShadow:'0 0 5px #22c55e' }}/>
                              </div>
                              <div style={{ display:'flex', justifyContent:'center', padding:'5px 0 6px' }}>
                                <div style={{ position:'relative', width:60, height:74, display:'flex', alignItems:'center', justifyContent:'center' }}>
                                  <div style={{ position:'absolute', inset:0, border:`0.8px solid ${purp}35`, borderRadius:5, transform:'rotate(4deg)' }}/>
                                  <div style={{ width:52, height:66, border:`1.5px solid ${purp}70`, borderRadius:4, overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center', background:'#1a1f2e' }}>{person(44)}</div>
                                </div>
                              </div>
                              <div style={{ margin:'0 9px 0 12px', background:'rgba(255,255,255,0.05)', borderRadius:6, padding:'6px 8px', border:`0.5px solid ${purp}25`, flex:1 }}>
                                <div style={{ fontSize:9, color:'#fff', fontWeight:900, marginBottom:1 }}>GARCÃA, Juan</div>
                                <div style={{ fontSize:5, color:purp, fontWeight:700, marginBottom:5 }}>VIGILADOR SENIOR</div>
                                <div style={{ display:'flex', gap:10, marginBottom:4 }}>
                                  <div><div style={{ fontSize:3.5, color:'rgba(255,255,255,0.3)' }}>LEGAJO</div><div style={{ fontSize:6, fontWeight:700, color:'rgba(255,255,255,0.85)', fontFamily:'monospace' }}>#4521</div></div>
                                  <div><div style={{ fontSize:3.5, color:'rgba(255,255,255,0.3)' }}>DNI</div><div style={{ fontSize:6, fontWeight:700, color:'rgba(255,255,255,0.85)', fontFamily:'monospace' }}>28.456.789</div></div>
                                </div>
                                <div style={{ height:0.5, background:`${purp}25`, marginBottom:4 }}/>
                                <div style={{ fontSize:3.5, color:'rgba(255,255,255,0.35)', marginBottom:2 }}>CÃ“DIGO DE VERIFICACIÃ“N</div>
                                <div style={{ fontSize:13, fontWeight:900, color:'#fff', fontFamily:'monospace', letterSpacing:'0.18em' }}>482 071</div>
                                <div style={{ marginTop:2, height:1.5, width:30, background:'rgba(255,255,255,0.12)', borderRadius:1, overflow:'hidden' }}><div style={{ height:'100%', width:'65%', background:`${purp}80` }}/></div>
                                <div style={{ marginTop:'auto', paddingTop:6, fontSize:3.5, color:'rgba(255,255,255,0.22)' }}>VÃ¡lida 12/2026</div>
                              </div>
                              <div style={{ height:10 }}/>
                            </div>
                          );
                        })()}
                      </div>
                      <div className={`px-3 py-2 flex items-center gap-2 transition-colors ${
                        selected ? 'bg-indigo-600' : 'bg-white'
                      }`}>
                        <div className="flex-1 text-left">
                          <p className={`text-[11px] font-black uppercase tracking-wide leading-tight ${selected ? 'text-white' : 'text-slate-700'}`}>
                            {modelo.label}
                          </p>
                          <p className={`text-[9px] leading-tight mt-0.5 ${selected ? 'text-indigo-200' : 'text-slate-400'}`}>
                            {modelo.desc}
                          </p>
                        </div>
                        {selected && <CheckCircle2 size={14} className="text-white shrink-0"/>}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* â”€â”€ Tono de color â”€â”€ */}
              <div className="mb-5">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-3">
                  Tono de color
                </p>
                <div className="flex items-center gap-3">
                  {/* Swatch preview */}
                  <div className="flex gap-1 shrink-0">
                    {[colorsFromHue(credHue).h1, colorsFromHue(credHue).h2, colorsFromHue(credHue).accent].map((c, i) => (
                      <div key={i} className="w-6 h-6 rounded-lg border border-white/20 shadow-sm" style={{ background: c }}/>
                    ))}
                  </div>
                  {/* Slider espectro */}
                  <input
                    type="range"
                    min={0}
                    max={359}
                    value={credHue}
                    onChange={e => setCredHue(Number(e.target.value))}
                    className="flex-1 h-3 rounded-full cursor-pointer appearance-none border-none outline-none"
                    style={{
                      background: 'linear-gradient(to right, hsl(0,70%,50%), hsl(30,70%,50%), hsl(60,70%,50%), hsl(120,70%,40%), hsl(180,70%,40%), hsl(210,70%,50%), hsl(240,70%,55%), hsl(270,70%,55%), hsl(300,70%,50%), hsl(330,70%,50%), hsl(360,70%,50%))',
                    }}
                  />
                  <span className="text-[11px] font-mono text-slate-500 w-9 shrink-0 text-right">{credHue}Â°</span>
                </div>
              </div>

              {/* â”€â”€ Textos de la credencial â”€â”€ */}
              <div>
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-3">Textos de la credencial</p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-wide block mb-1.5">TÃ­tulo del documento</label>
                    <input
                      type="text"
                      value={credTitulo}
                      onChange={e => setCredTitulo(e.target.value)}
                      maxLength={30}
                      placeholder="CREDENCIAL DE ACCESO"
                      className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-wide block mb-1.5">SubtÃ­tulo / Tagline</label>
                    <input
                      type="text"
                      value={credSubtitulo}
                      onChange={e => setCredSubtitulo(e.target.value)}
                      maxLength={30}
                      placeholder="Personal Autorizado"
                      className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-wide block mb-1.5">Texto pie de pÃ¡gina</label>
                    <input
                      type="text"
                      value={credPie}
                      onChange={e => setCredPie(e.target.value)}
                      maxLength={50}
                      placeholder="PortaciÃ³n obligatoria en planta"
                      className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* BotÃ³n guardar */}
            <button
              onClick={handleGuardarTemplate}
              disabled={guardandoTpl}
              className="flex items-center gap-1.5 px-5 py-2.5 text-white rounded-xl text-xs font-black disabled:opacity-60 transition-colors bg-indigo-600 hover:bg-indigo-700"
            >
              {guardandoTpl ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              Guardar configuraciÃ³n
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
