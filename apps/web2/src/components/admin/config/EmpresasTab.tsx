import React, { useState, useRef } from 'react';
import { Building2, Plus, Save, Play, CheckCircle2, AlertCircle, Loader2, ChevronDown, ChevronUp, Bot, EyeOff, Eye, Trash2, AlertTriangle, Copy, X, Upload, CreditCard, Image as ImageIcon } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';
import { migrarEmpresa, guardarEmpresa, desactivarEmpresa, activarEmpresa, eliminarEmpresaYDatos, type ProgresoMigracion, type ProgresoEliminacion } from '@/lib/multiempresa';
import { toast } from 'sonner';
import { db, functions, auth, storage } from '@/lib/firebase';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { FirebaseError } from 'firebase/app';
import { httpsCallable } from 'firebase/functions';

function empresaWriteErrorMessage(err: unknown, isSuperAdmin: boolean): string {
  const code = err instanceof FirebaseError ? err.code : '';
  if (code === 'permission-denied') {
    return isSuperAdmin
      ? 'Permiso denegado en Firestore. Cerrá sesión y volvé a entrar, o ejecutá sync de claims (Config → Usuarios).'
      : 'Solo SuperAdmin puede crear o modificar empresas. Pedí acceso a un SuperAdmin.';
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

  // Formulario edición empresa activa
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

  // Credencial — logo + modelo + color
  const CRED_MODELOS = [
    { id: 'clasico',    label: 'Clásico',    desc: 'Vertical · foto centrada' },
    { id: 'horizontal', label: 'Horizontal', desc: 'Apaisado · foto lateral' },
    { id: 'compacto',   label: 'Compacto',   desc: 'Vertical · más datos' },
  ];
  const CRED_COLORES = [
    { id: 'marino-oro',    label: 'Marino & Oro',   h1: '#0a1628', h2: '#1e3a5f', accent: '#c8a84b' },
    { id: 'grafito',       label: 'Grafito',         h1: '#111827', h2: '#1f2937', accent: '#e5e7eb' },
    { id: 'corporativo',   label: 'Corporativo',     h1: '#0f172a', h2: '#1e3a5f', accent: '#38bdf8' },
    { id: 'seguridad',     label: 'Seguridad',       h1: '#1a0505', h2: '#7f1d1d', accent: '#fca5a5' },
    { id: 'institucional', label: 'Institucional',   h1: '#052e16', h2: '#14532d', accent: '#4ade80' },
    { id: 'elite',         label: 'Elite',           h1: '#1e0050', h2: '#3b0764', accent: '#e879f9' },
  ];
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [logoPreview, setLogoPreview]   = useState<string | null>((empresa as any)?.logoUrl || null);
  const [subiendoLogo, setSubiendoLogo] = useState(false);
  const [modeloCred, setModeloCred]     = useState<string>((empresa as any)?.credencialModelo || 'clasico');
  const [colorCred, setColorCred]       = useState<string>((empresa as any)?.credencialTemplate || 'marino-oro');
  const [guardandoTpl, setGuardandoTpl] = useState(false);

  React.useEffect(() => {
    setLogoPreview((empresa as any)?.logoUrl || null);
    setModeloCred((empresa as any)?.credencialModelo || 'clasico');
    setColorCred((empresa as any)?.credencialTemplate || 'marino-oro');
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
        credencialTemplate: colorCred,
        credencialModelo: modeloCred,
        credencialOrientacion: modeloCred === 'horizontal' ? 'horizontal' : 'vertical',
      } as any);
      toast.success('Configuración de credencial guardada');
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

  // Modal eliminación
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
      // antes de recibir la notificación de eliminación (evita la auto-recreación).
      if (empresaId === deleteTarget.id) switchEmpresa('bacarsa');
      await eliminarEmpresaYDatos(deleteTarget.id, p => setDeleteProgreso(p));
      toast.success(`Empresa "${deleteTarget.name}" y todos sus datos eliminados`);
      cerrarEliminar();
    } catch (err: any) {
      toast.error(err?.message || 'Error al eliminar');
      cerrarEliminar();
    }
  };

  // Migración
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

  // Mantener origen válido al cambiar empresa destino (evita origen === destino tras switch en topbar)
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
      toast.error('Elegí una empresa origen distinta al destino.');
      return;
    }
    if (copyConfirmInput.trim() !== empresaId) {
      toast.error(`Escribí el ID destino: ${empresaId}`);
      return;
    }
    setCopyRunning(true);
    setCopyProgress({ phase: 'Iniciando…', docsCopied: 0, docsDeleted: 0 });
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
            : `Copiando (${next}/${totalCollections || '?'})…`,
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

  // ── Crear nueva empresa ─────────────────────────────────────────────────────
  const handleCrearEmpresa = async () => {
    if (!form.name.trim()) return toast.error('El nombre es obligatorio');
    const id = form.name.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    if (!id) return toast.error('Nombre inválido');
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

  // ── Migración ───────────────────────────────────────────────────────────────
  const handleMigrar = async () => {
    if (!confirm(`¿Migrar todos los datos existentes a la empresa "${empresa?.name}" (${empresaId})?\n\nEsto agrega el campo empresaId a todos los documentos sin él. Es una operación segura y no elimina datos.`)) return;
    setMigrando(true);
    setProgreso(null);
    try {
      await migrarEmpresa(empresaId, p => setProgreso(p));
    } catch {
      // El error ya está en progreso.error
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

      {/* ── Lista de empresas (solo superadmin) ── */}
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
              <p className="text-sm text-slate-400 font-medium py-4 text-center">Sin empresas registradas aún</p>
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
                  {/* Toggle activo/inactivo — bloqueado si es la empresa activa */}
                  {e.id !== empresaId && (
                    <button onClick={() => handleToggleActivo(e)} disabled={toggling === e.id}
                      title={e.active === false ? 'Reactivar empresa' : 'Desactivar empresa'}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors disabled:opacity-40">
                      {toggling === e.id ? <Loader2 size={14} className="animate-spin" /> : e.active === false ? <Eye size={14} /> : <EyeOff size={14} />}
                    </button>
                  )}
                  {/* Eliminar — bloqueado solo si es la empresa activa */}
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
                  <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">Dirección</label>
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

      {/* ── Datos de empresa activa ── */}
      {empresa && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <Building2 size={18} className="text-indigo-600" />
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-wide">Datos de empresa</h3>
          </div>
          <p className="text-xs text-slate-500 font-medium mb-5">
            {isSuperAdmin
              ? 'Editá el nombre y los datos de la empresa activa.'
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
              <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">Dirección</label>
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

      {/* ── Color de empresa ── */}
      {empresa && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-4 h-4 rounded-full border border-slate-200 shrink-0" style={{ backgroundColor: colorForm }} />
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-wide">Color de empresa</h3>
          </div>
          <p className="text-xs text-slate-500 font-medium mb-5">
            El sidebar y los elementos de navegación adoptarán este color para la empresa activa.
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
              <p className="text-[11px] text-slate-400">Sidebar y navegación en este color</p>
            </div>
            <div className="ml-auto flex gap-1">
              <div className="w-3 h-6 rounded" style={{ backgroundColor: colorForm }} />
              <div className="w-3 h-6 rounded opacity-60" style={{ backgroundColor: colorForm }} />
              <div className="w-3 h-6 rounded opacity-30" style={{ backgroundColor: colorForm }} />
            </div>
          </div>
        </div>
      )}

      {/* ── Credencial de empleado ── */}
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
                  <p className="text-[10px] text-slate-400">PNG o SVG con fondo transparente · Recomendado 200×200px</p>
                </div>
                <input ref={logoInputRef} type="file" accept="image/png,image/svg+xml,image/webp" className="hidden" onChange={handleLogoUpload} />
              </div>
            </div>

            {/* Template selector */}
            <div>
              <p className="text-xs font-black text-slate-600 uppercase tracking-wide mb-4">Template de credencial</p>

              {/* ── 3 modelos grandes ── */}
              <div className="grid grid-cols-3 gap-3 mb-5">
                {CRED_MODELOS.map(modelo => {
                  const col = CRED_COLORES.find(c => c.id === colorCred) || CRED_COLORES[0];
                  const selected = modeloCred === modelo.id;
                  const isH = modelo.id === 'horizontal';
                  const isCompacto = modelo.id === 'compacto';
                  return (
                    <button
                      key={modelo.id}
                      onClick={() => setModeloCred(modelo.id)}
                      className={`flex flex-col rounded-2xl overflow-hidden border-2 transition-all duration-200 ${
                        selected
                          ? 'border-indigo-500 shadow-lg shadow-indigo-100/60 scale-[1.02]'
                          : 'border-slate-200 hover:border-slate-300 hover:shadow-sm'
                      }`}
                    >
                      <div
                        className="w-full relative overflow-hidden bg-slate-50 p-2"
                        style={{ aspectRatio: isH ? '16/10' : '10/16' }}
                      >
                        {isH ? (
                          <div className="absolute inset-2 rounded-xl overflow-hidden flex flex-col"
                               style={{ background: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.18)' }}>
                            <div className="shrink-0 px-2 py-1.5 flex items-center gap-1.5"
                                 style={{ background: `linear-gradient(90deg, ${col.h1}, ${col.h2})` }}>
                              <div className="w-2.5 h-2.5 rounded-sm" style={{ background: col.accent }}/>
                              <div className="flex-1 h-1 rounded-full" style={{ background: `${col.accent}70` }}/>
                            </div>
                            <div className="h-0.5" style={{ background: `linear-gradient(90deg, ${col.h2}, ${col.accent})` }}/>
                            <div className="flex flex-1 min-h-0">
                              <div className="shrink-0 flex items-center justify-center p-1.5" style={{ width: '35%' }}>
                                <div className="w-full rounded-md" style={{
                                  aspectRatio: '3/4',
                                  background: `${col.h1}20`,
                                  border: `1.5px solid ${col.accent}60`
                                }}/>
                              </div>
                              <div className="flex-1 py-1.5 pr-1.5 flex flex-col justify-between">
                                <div className="space-y-1">
                                  <div className="h-1.5 rounded-sm bg-slate-700" style={{ width: '85%' }}/>
                                  <div className="h-1 rounded-sm bg-slate-300" style={{ width: '55%' }}/>
                                  <div className="h-0.5 rounded-sm bg-slate-200 mt-1" style={{ width: '70%' }}/>
                                  <div className="h-0.5 rounded-sm bg-slate-200" style={{ width: '50%' }}/>
                                </div>
                                <div className="flex justify-end">
                                  <div className="w-5 h-5 rounded" style={{ border: `1.5px solid ${col.accent}60`, background: '#f8fafc' }}/>
                                </div>
                              </div>
                            </div>
                            <div className="h-1.5" style={{ background: `linear-gradient(90deg, ${col.h1}, ${col.h2})` }}/>
                          </div>
                        ) : (
                          <div className="absolute inset-2 rounded-xl overflow-hidden flex flex-col"
                               style={{ background: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.18)' }}>
                            <div className="shrink-0 px-2 py-2"
                                 style={{ background: `linear-gradient(135deg, ${col.h1}, ${col.h2})` }}>
                              <div className="flex items-center gap-1.5">
                                <div className="w-2.5 h-2.5 rounded-sm" style={{ background: col.accent }}/>
                                <div className="flex-1 space-y-0.5">
                                  <div className="h-1 rounded-full" style={{ background: `${col.accent}90`, width: '65%' }}/>
                                  <div className="h-0.5 rounded-full opacity-50" style={{ background: col.accent, width: '45%' }}/>
                                </div>
                              </div>
                            </div>
                            <div className="h-0.5" style={{ background: `linear-gradient(90deg, ${col.h2}, ${col.accent})` }}/>
                            <div className="flex justify-center mt-2 mb-1.5">
                              <div className="rounded-md" style={{
                                width: isCompacto ? '32%' : '42%',
                                aspectRatio: '3/4',
                                background: `${col.h1}15`,
                                border: `1.5px solid ${col.accent}55`
                              }}/>
                            </div>
                            <div className="px-2 flex-1 space-y-1">
                              <div className="h-1.5 rounded-sm bg-slate-800" style={{ width: '80%' }}/>
                              <div className="h-1 rounded-sm bg-slate-300" style={{ width: '55%' }}/>
                              <div className="grid grid-cols-2 gap-1 mt-1">
                                <div className="h-0.5 rounded-sm bg-slate-200"/>
                                <div className="h-0.5 rounded-sm bg-slate-200"/>
                                {isCompacto && <>
                                  <div className="h-0.5 rounded-sm bg-slate-200"/>
                                  <div className="h-0.5 rounded-sm bg-slate-200"/>
                                  <div className="h-0.5 rounded-sm bg-slate-200"/>
                                  <div className="h-0.5 rounded-sm bg-slate-200"/>
                                </>}
                              </div>
                            </div>
                            <div className="flex justify-center py-1.5">
                              <div className="w-5 h-5 rounded" style={{ border: `1.5px solid ${col.accent}60`, background: '#f8fafc' }}/>
                            </div>
                            <div className="h-1.5" style={{ background: `linear-gradient(90deg, ${col.h1}, ${col.h2})` }}/>
                          </div>
                        )}
                      </div>
                      <div className={`px-3 py-2.5 flex items-center gap-2 transition-colors ${
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

              {/* ── Combinación de colores ── */}
              <div className="mb-5">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-2.5">
                  Combinación de colores — elegí y los modelos se actualizan
                </p>
                <div className="flex flex-wrap gap-2">
                  {CRED_COLORES.map(col => {
                    const selected = colorCred === col.id;
                    return (
                      <button
                        key={col.id}
                        onClick={() => setColorCred(col.id)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-xl border-2 transition-all ${
                          selected
                            ? 'border-indigo-500 bg-indigo-50 shadow-sm'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <span className="w-5 h-5 rounded-full shrink-0 shadow-sm" style={{
                          background: `linear-gradient(135deg, ${col.h1} 30%, ${col.accent} 100%)`
                        }}/>
                        <span className={`text-[10px] font-black uppercase tracking-wide ${
                          selected ? 'text-indigo-700' : 'text-slate-600'
                        }`}>{col.label}</span>
                        {selected && <CheckCircle2 size={11} className="text-indigo-600 ml-0.5 shrink-0"/>}
                      </button>
                    );
                  })}
                </div>
              </div>

              {isSuperAdmin && (
                <button
                  onClick={handleGuardarTemplate}
                  disabled={guardandoTpl}
                  className="flex items-center gap-1.5 px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-black hover:bg-indigo-700 disabled:opacity-60 transition-colors shadow-sm shadow-indigo-200"
                >
                  {guardandoTpl ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                  Guardar configuración
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Asistente IA ── */}
      {empresa && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <Bot size={18} className="text-indigo-600" />
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-wide">Asistente IA</h3>
          </div>
          <p className="text-xs text-slate-500 font-medium mb-5">
            Habilitá o deshabilitá el globo flotante del asistente COSP para esta empresa.
          </p>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-slate-700">
                {asistentActivo ? 'Asistente activo' : 'Asistente desactivado'}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                {asistentActivo ? 'El globo de chat aparece en todas las pantallas.' : 'El globo no aparece para esta empresa.'}
              </p>
            </div>
            <button
              onClick={handleToggleAsistente}
              disabled={guardandoAsistente || !isSuperAdmin}
              className={`relative inline-flex h-7 w-13 items-center rounded-full transition-colors focus:outline-none disabled:opacity-60 ${asistentActivo ? 'bg-indigo-600' : 'bg-slate-300'}`}
              style={{ width: '3.25rem' }}
              title={!isSuperAdmin ? 'Solo SuperAdmin' : asistentActivo ? 'Desactivar asistente' : 'Activar asistente'}
            >
              {guardandoAsistente
                ? <Loader2 size={12} className="absolute left-1/2 -translate-x-1/2 animate-spin text-white" />
                : <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${asistentActivo ? 'translate-x-[1.625rem]' : 'translate-x-[0.25rem]'}`} />
              }
            </button>
          </div>
        </div>
      )}

      {/* ── Migración de datos ── */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <Play size={18} className={migracionCompleta ? 'text-emerald-500' : 'text-amber-500'} />
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-wide">
            Migración de datos
          </h3>
          {migracionCompleta && (
            <span className="ml-auto text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full flex items-center gap-1">
              <CheckCircle2 size={10} /> Completada el {(empresa as any)?.migracionFecha?.slice(0, 10)}
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 font-medium mb-4">
          Ejecutá esta acción una sola vez para migrar todos los datos existentes al esquema multi-empresa. Es una operación segura y reversible — no elimina ningún dato.
        </p>
        {progreso && (
          <div className="mb-3">
            <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
              <span>Procesando...</span>
              <span>{progPct}%</span>
            </div>
            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-indigo-500 rounded-full transition-all duration-300" style={{ width: `${progPct}%` }}/>
            </div>
          </div>
        )}
        <button
          onClick={() => { /* migrar */ }}
          disabled={migracionCompleta}
          className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-black disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Play size={13} />
          {migracionCompleta ? 'Migración completada' : 'Iniciar migración'}
        </button>
        {progreso?.error && (
          <p className="text-xs text-rose-500 mt-2">{progreso.error}</p>
        )}
      </div>

    </div>
  );
}
