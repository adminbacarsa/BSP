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

  // Credencial — logo + modelo + hue + textos configurables
  const CRED_MODELOS = [
    { id: 'clasico',  label: 'Clásico',  desc: 'Foto circular, QR abajo' },
    { id: 'moderno',  label: 'Moderno',  desc: 'Foto cuadrada lateral' },
    { id: 'compacto', label: 'Compacto', desc: 'Foto mini, datos grandes' },
  ];

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

              {/* ── Orientación ── */}
              <div className="flex items-center gap-3 mb-5">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider shrink-0">Orientación</p>
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
                      {o === 'vertical' ? '↕ Vertical' : '↔ Horizontal'}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── 3 modelos ── */}
              <div className="grid grid-cols-3 gap-3 mb-5">
                {CRED_MODELOS.map(modelo => {
                  const col = colorsFromHue(credHue);
                  const selected = modeloCred === modelo.id;
                  const isH = orientacionCred === 'horizontal';
                  const isCompacto = modelo.id === 'compacto';
                  const isModerno = modelo.id === 'moderno';
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
                      {/* Mini preview */}
                      {/* Mini preview — credencial real */}
                      <div
                        className="w-full flex items-center justify-center overflow-hidden"
                        style={{ height: isH ? 215 : 335, background: '#0d1117' }}
                      >
                        {(() => {
                          const personSVG = (size: number) => (
                            <svg width={size} height={size} viewBox="0 0 60 70" fill="none">
                              <circle cx="30" cy="22" r="13" fill={col.accent} opacity="0.85"/>
                              <ellipse cx="30" cy="60" rx="22" ry="14" fill={col.accent} opacity="0.65"/>
                            </svg>
                          );
                          const qr = (sz: number) => (
                            <div style={{ width: sz, height: sz, borderRadius: 3, border: `1.5px solid ${col.accent}60`, overflow: 'hidden', flexShrink: 0 }}>
                              <div style={{ width: '100%', height: '100%', backgroundImage: `repeating-linear-gradient(0deg,${col.accent}80 0,${col.accent}80 2px,transparent 2px,transparent 4px),repeating-linear-gradient(90deg,${col.accent}80 0,${col.accent}80 2px,transparent 2px,transparent 4px)` }}/>
                            </div>
                          );
                          const barcode = (w: number) => (
                            <div style={{ flex: 1, height: 22, background: `repeating-linear-gradient(90deg,${col.accent}90 0,${col.accent}90 1.5px,transparent 1.5px,transparent 3.5px,${col.accent}70 3.5px,${col.accent}70 5px,transparent 5px,transparent 6px)`, borderRadius: 2 }}/>
                          );
                          const logoEl = (h: number) => logoPreview
                            ? <img src={logoPreview} style={{ height: h, maxWidth: h*3.5, objectFit: 'contain', filter: 'brightness(0) invert(1)', display: 'block' }} alt=""/>
                            : <span style={{ fontSize: h-2, color: col.accent, fontWeight: 900, letterSpacing: 1, lineHeight: 1 }}>BACAR</span>;
                          const campos6 = [['DNI','28.456.789'],['LEGAJO','B-0142'],['ÁREA','Operaciones'],['EMPRESA','Grupo Bacar'],['TURNO','Mañana'],['VIGENCIA','12/2026']];

                          if (isH) return (
                            /* ─── HORIZONTAL ─── */
                            <div style={{ width: 310, height: 196, background: col.h1, borderRadius: 8, overflow: 'hidden', boxShadow: '0 6px 28px rgba(0,0,0,0.7)', display: 'flex' }}>
                              {/* col izq */}
                              <div style={{ width: 82, background: col.h2, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px 8px', borderRight: `2px solid ${col.accent}` }}>
                                {logoEl(14)}
                                <div style={{ width: isCompacto ? 46 : 54, height: isCompacto ? 46 : 54, borderRadius: isCompacto ? 7 : '50%', background: col.h1, border: `2.5px solid ${col.accent}`, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  {personSVG(isCompacto ? 34 : 42)}
                                </div>
                                <div style={{ width: '75%', height: 1, background: `${col.accent}50` }}/>
                                <div style={{ fontSize: 6.5, color: `${col.accent}cc`, fontWeight: 700, textAlign: 'center', letterSpacing: 0.3 }}>GRUPO BACAR</div>
                              </div>
                              {/* col der */}
                              <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                                <div style={{ background: col.h2, padding: '6px 10px', borderBottom: `1.5px solid ${col.accent}` }}>
                                  <div style={{ fontSize: 6.5, color: col.accent, fontWeight: 700, letterSpacing: 1 }}>CREDENCIAL DE ACCESO</div>
                                  <div style={{ fontSize: 8.5, color: '#fff', fontWeight: 800 }}>JUAN A. PÉREZ</div>
                                  <div style={{ fontSize: 7, color: `${col.accent}dd`, fontWeight: 600 }}>Guardia de Seguridad</div>
                                </div>
                                <div style={{ padding: '7px 10px', flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                                  {campos6.map(([l,v], i) => (
                                    <div key={i}>
                                      <div style={{ fontSize: 6, color: `${col.accent}bb`, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 1.5 }}>{l}</div>
                                      <div style={{ fontSize: 8, color: '#ffffffcc', fontWeight: 600 }}>{v}</div>
                                    </div>
                                  ))}
                                </div>
                                <div style={{ padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 6, borderTop: `1px solid ${col.accent}20` }}>
                                  {barcode(100)}
                                  {qr(28)}
                                </div>
                              </div>
                            </div>
                          );

                          if (!isModerno && !isCompacto) return (
                            /* ─── VERTICAL CLÁSICO ─── */
                            <div style={{ width: 195, height: 308, background: col.h1, borderRadius: 10, overflow: 'hidden', boxShadow: '0 6px 28px rgba(0,0,0,0.7)', display: 'flex', flexDirection: 'column' }}>
                              <div style={{ background: col.h2, padding: '8px 11px', display: 'flex', alignItems: 'center', gap: 7, borderBottom: `2px solid ${col.accent}` }}>
                                {logoEl(16)}
                                <div style={{ flex: 1, textAlign: 'right' }}>
                                  <div style={{ fontSize: 6.5, color: col.accent, fontWeight: 700, letterSpacing: 1 }}>CREDENCIAL DE ACCESO</div>
                                  <div style={{ fontSize: 7.5, color: '#ffffffcc', fontWeight: 600 }}>Personal Autorizado</div>
                                </div>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 14, paddingBottom: 8 }}>
                                <div style={{ width: 68, height: 68, borderRadius: '50%', background: col.h2, border: `3px solid ${col.accent}`, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  {personSVG(52)}
                                </div>
                              </div>
                              <div style={{ padding: '0 12px 7px', textAlign: 'center' }}>
                                <div style={{ fontSize: 12, color: '#fff', fontWeight: 800, letterSpacing: 0.3 }}>JUAN A. PÉREZ</div>
                                <div style={{ fontSize: 8.5, color: col.accent, fontWeight: 700, marginTop: 2 }}>GUARDIA DE SEGURIDAD</div>
                              </div>
                              <div style={{ height: 1, background: `${col.accent}30`, margin: '0 12px 8px' }}/>
                              <div style={{ padding: '0 12px', flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '7px 10px' }}>
                                {campos6.map(([l,v], i) => (
                                  <div key={i}>
                                    <div style={{ fontSize: 6, color: `${col.accent}bb`, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 2 }}>{l}</div>
                                    <div style={{ fontSize: 8.5, color: '#ffffffcc', fontWeight: 600 }}>{v}</div>
                                  </div>
                                ))}
                              </div>
                              <div style={{ padding: '6px 12px 5px', display: 'flex', justifyContent: 'flex-end' }}>{qr(30)}</div>
                              <div style={{ height: 8, background: col.accent }}/>
                            </div>
                          );

                          if (isModerno) return (
                            /* ─── VERTICAL MODERNO ─── */
                            <div style={{ width: 195, height: 308, background: col.h1, borderRadius: 10, overflow: 'hidden', boxShadow: '0 6px 28px rgba(0,0,0,0.7)', display: 'flex', flexDirection: 'column' }}>
                              <div style={{ background: `linear-gradient(140deg,${col.h2} 0%,${col.h1} 100%)`, padding: '10px 11px 26px', position: 'relative', borderBottom: `2px solid ${col.accent}` }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  {logoEl(15)}
                                  <div style={{ width: 1, height: 14, background: `${col.accent}50` }}/>
                                  <div>
                                    <div style={{ fontSize: 6.5, color: col.accent, fontWeight: 700, letterSpacing: 0.8 }}>CREDENCIAL</div>
                                    <div style={{ fontSize: 7.5, color: '#fff', fontWeight: 700 }}>Personal Autorizado</div>
                                  </div>
                                </div>
                                <div style={{ position: 'absolute', top: 6, right: 11, width: 58, height: 58, borderRadius: '50%', background: col.h1, border: `3px solid ${col.accent}`, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  {personSVG(46)}
                                </div>
                              </div>
                              <div style={{ padding: '8px 11px 5px' }}>
                                <div style={{ fontSize: 12, color: '#fff', fontWeight: 800 }}>JUAN A. PÉREZ</div>
                                <div style={{ fontSize: 8.5, color: col.accent, fontWeight: 700, marginTop: 2 }}>Guardia de Seguridad</div>
                              </div>
                              <div style={{ padding: '5px 11px', flex: 1, display: 'flex', flexDirection: 'column', gap: 7 }}>
                                {[['ÁREA','Operaciones'],['EMPRESA','Grupo Bacar'],['TURNO','Mañana'],['VIGENCIA','12/2026']].map(([l,v],i) => (
                                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                                    <div style={{ width: 3, height: 16, background: col.accent, borderRadius: 2, flexShrink: 0 }}/>
                                    <div>
                                      <div style={{ fontSize: 6, color: `${col.accent}bb`, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase' }}>{l}</div>
                                      <div style={{ fontSize: 8.5, color: '#ffffffcc', fontWeight: 600 }}>{v}</div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                              <div style={{ padding: '5px 11px 6px', display: 'flex', alignItems: 'center', gap: 6, borderTop: `1px solid ${col.accent}25` }}>
                                {barcode(100)}
                                {qr(26)}
                              </div>
                            </div>
                          );

                          /* ─── VERTICAL COMPACTO ─── */
                          return (
                            <div style={{ width: 195, height: 308, background: col.h1, borderRadius: 10, overflow: 'hidden', boxShadow: '0 6px 28px rgba(0,0,0,0.7)', display: 'flex', flexDirection: 'column' }}>
                              <div style={{ background: col.h2, padding: '7px 11px', display: 'flex', alignItems: 'center', gap: 7, borderBottom: `2px solid ${col.accent}` }}>
                                {logoEl(14)}
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontSize: 6.5, color: col.accent, fontWeight: 700 }}>CREDENCIAL DE ACCESO</div>
                                  <div style={{ fontSize: 7.5, color: '#fff', fontWeight: 700 }}>GRUPO BACAR</div>
                                </div>
                                <div style={{ width: 40, height: 40, borderRadius: 5, background: col.h1, border: `2px solid ${col.accent}`, overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  {personSVG(32)}
                                </div>
                              </div>
                              <div style={{ padding: '7px 11px 4px' }}>
                                <div style={{ fontSize: 11, color: '#fff', fontWeight: 800 }}>JUAN A. PÉREZ</div>
                                <div style={{ fontSize: 8, color: col.accent, fontWeight: 700, marginTop: 2 }}>Guardia de Seguridad · Nivel 2</div>
                              </div>
                              <div style={{ height: 1, background: `${col.accent}25`, margin: '5px 11px' }}/>
                              <div style={{ padding: '0 11px', flex: 1, display: 'flex', flexDirection: 'column', gap: 5.5 }}>
                                {[...campos6, ['ACCESO','Nivel 2']].map(([l,v],i) => (
                                  <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
                                    <div style={{ width: 58, fontSize: 6.5, color: `${col.accent}bb`, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase', flexShrink: 0 }}>{l}</div>
                                    <div style={{ fontSize: 8, color: '#ffffffcc', fontWeight: 600 }}>{v}</div>
                                  </div>
                                ))}
                              </div>
                              <div style={{ padding: '5px 11px 5px', display: 'flex', alignItems: 'center', gap: 6, borderTop: `1px solid ${col.accent}20` }}>
                                {barcode(100)}
                                {qr(24)}
                              </div>
                              <div style={{ height: 7, background: col.accent }}/>
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

              {/* ── Tono de color ── */}
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
                  <span className="text-[11px] font-mono text-slate-500 w-9 shrink-0 text-right">{credHue}°</span>
                </div>
              </div>

              {/* ── Textos de la credencial ── */}
              <div>
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-3">Textos de la credencial</p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-wide block mb-1.5">Título del documento</label>
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
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-wide block mb-1.5">Subtítulo / Tagline</label>
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
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-wide block mb-1.5">Texto pie de página</label>
                    <input
                      type="text"
                      value={credPie}
                      onChange={e => setCredPie(e.target.value)}
                      maxLength={50}
                      placeholder="Portación obligatoria en planta"
                      className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Botón guardar */}
            <button
              onClick={handleGuardarTemplate}
              disabled={guardandoTpl}
              className="flex items-center gap-1.5 px-5 py-2.5 text-white rounded-xl text-xs font-black disabled:opacity-60 transition-colors bg-indigo-600 hover:bg-indigo-700"
            >
              {guardandoTpl ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              Guardar configuración
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
          