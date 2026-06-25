import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
    Save, Building, FileText, Mail, Phone, AlertTriangle, Trash2,
    ShieldAlert, RefreshCw, Moon, Sun, Monitor, Zap, Hexagon, ArrowRight, X, Loader2,
    UserCircle, BookOpen, ShieldCheck, ExternalLink, Layers, Palette
} from 'lucide-react';
import { functions, db } from '@/lib/firebase';
import { httpsCallable } from 'firebase/functions';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';

const PHRASE_DELETE_ALL_SHIFTS = 'BORRAR TODOS LOS TURNOS';

export default function GeneralTab() {
    const { isSuperAdmin, userRole } = useAuth();
    const { empresaId } = useEmpresa();
    const canRunMassDelete =
        isSuperAdmin ||
        (userRole || '').trim().toUpperCase().replace(/\s+/g, '_') === 'ADMIN';

    const [cleaningTarget, setCleaningTarget] = useState<string | null>(null);
    const [shiftDeleteModalOpen, setShiftDeleteModalOpen] = useState(false);
    const [shiftDeletePhrase, setShiftDeletePhrase] = useState('');
    const [company, setCompany] = useState({ name: '', cuit: '', address: '', website: '', email: '', phone: '' });
    const [loadingCompany, setLoadingCompany] = useState(true);
    const [savingCompany, setSavingCompany] = useState(false);

    const [theme, setTheme] = useState('light');
    const [companyColor, setCompanyColor] = useState('#6366f1');
    const [savingColor, setSavingColor] = useState(false);

    const BRAND_PRESETS = ['#6366f1','#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#0ea5e9'];

    useEffect(() => {
        const saved = (localStorage.getItem('cosp-theme') || localStorage.getItem('theme') || 'light') as any;
        setTheme(saved);
        const savedColor = localStorage.getItem('cosp_last_primary_color');
        if (savedColor) setCompanyColor(savedColor);
    }, []);

    useEffect(() => {
        if (!empresaId) return;
        setLoadingCompany(true);
        getDoc(doc(db, 'empresas', empresaId))
            .then(snap => {
                if (snap.exists()) {
                    const data = snap.data();
                    setCompany({
                        name:    data.name    || '',
                        cuit:    data.cuit    || '',
                        address: data.direccion || data.address || '',
                        website: data.website || '',
                        email:   data.email   || '',
                        phone:   data.phone   || '',
                    });
                    if (data.brandColor) setCompanyColor(data.brandColor);
                } else {
                    setCompany({ name: '', cuit: '', address: '', website: '', email: '', phone: '' });
                }
            })
            .catch(() => {})
            .finally(() => setLoadingCompany(false));
    }, [empresaId]);

    const handleApplyTheme = (newTheme: string) => {
        setTheme(newTheme);
        import('@/lib/themeManager').then(m => m.applyTheme(newTheme as any));
    };

    const handleApplyCompanyColor = async (hex: string) => {
        setCompanyColor(hex);
        import('@/lib/companyTheme').then(m => m.applyCompanyTheme(hex));
        if (!empresaId) return;
        setSavingColor(true);
        try {
            await setDoc(doc(db, 'empresas', empresaId), { brandColor: hex }, { merge: true });
            toast.success('Color de empresa guardado');
        } catch {
            toast.error('No se pudo guardar el color');
        } finally {
            setSavingColor(false);
        }
    };

    const handleChange = (e: any) => setCompany({ ...company, [e.target.name]: e.target.value });

    const handleSaveCompany = async () => {
        if (!empresaId) return;
        setSavingCompany(true);
        try {
            await setDoc(
                doc(db, 'empresas', empresaId),
                { name: company.name, cuit: company.cuit, direccion: company.address, website: company.website, email: company.email, phone: company.phone, updatedAt: new Date().toISOString() },
                { merge: true }
            );
            toast.success('Datos de organización guardados');
        } catch (err: any) {
            toast.error('Error al guardar: ' + (err?.message || err));
        } finally {
            setSavingCompany(false);
        }
    };

    const runLimpiarBaseDeDatos = async (target: 'AUDIT' | 'SHIFTS') => {
        setCleaningTarget(target);
        try {
            const cleanFn = httpsCallable(functions, 'limpiarBaseDeDatos');
            await cleanFn({ target });
            toast.success(
                target === 'SHIFTS'
                    ? 'Colección turnos vaciada. Podés cargar planificación desde cero.'
                    : 'Limpieza completada con éxito'
            );
        } catch (error: any) {
            const msg = error?.message || String(error);
            toast.error(msg.includes('permission-denied') ? 'Sin permiso: solo ADMIN o SUPERADMIN.' : 'Error: ' + msg);
        } finally {
            setCleaningTarget(null);
        }
    };

    const handleSystemClean = async (target: 'AUDIT' | 'SHIFTS') => {
        if (!canRunMassDelete) {
            toast.error('Solo ADMIN o SUPERADMIN pueden ejecutar la limpieza masiva.');
            return;
        }
        toast('⚠️ ¿Borrar historial operativo?', {
            description: 'Irreversible.',
            action: {
                label: 'SÍ, BORRAR',
                onClick: async () => {
                    await runLimpiarBaseDeDatos(target);
                },
            },
            cancel: { label: 'Cancelar', onClick: () => {} },
        });
    };

    const openShiftMassDeleteModal = () => {
        if (!canRunMassDelete) {
            toast.error('Solo ADMIN o SUPERADMIN pueden borrar todos los turnos.');
            return;
        }
        setShiftDeletePhrase('');
        setShiftDeleteModalOpen(true);
    };

    const confirmShiftMassDelete = async () => {
        if (shiftDeletePhrase.trim() !== PHRASE_DELETE_ALL_SHIFTS) {
            toast.error(`Escribí exactamente: ${PHRASE_DELETE_ALL_SHIFTS}`);
            return;
        }
        setShiftDeleteModalOpen(false);
        await runLimpiarBaseDeDatos('SHIFTS');
    };

    return (
        <div className="space-y-8 animate-in fade-in pb-10">
            
            {/* 1. SELECTOR DE TEMAS (5 OPCIONES REALES) */}
            <div className="rounded-xl border p-8" style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}>
                <h3 className="text-xl font-black mb-6 flex items-center gap-2" style={{ color: 'var(--txt)' }}>
                    <Monitor style={{ color: 'var(--company-primary, #6366f1)' }}/> TEMAS Y APARIENCIA
                </h3>
                
                <div className="grid grid-cols-3 md:grid-cols-6 gap-4">
                    {/* LIGHT */}
                    <button onClick={() => handleApplyTheme('light')} aria-pressed={theme === 'light'} aria-label="Tema Claro"
                        className="p-4 rounded-2xl border-2 flex flex-col items-center gap-3 transition-all hover:scale-105"
                        style={theme === 'light' ? { borderColor: 'var(--company-primary,#6366f1)', backgroundColor: 'var(--surf2)' } : { borderColor: 'var(--border)' }}>
                        <div className="w-10 h-10 rounded-full bg-white border border-slate-200 flex items-center justify-center shadow-sm"><Sun size={20} className="text-slate-600" aria-hidden="true"/></div>
                        <span className="text-xs font-black uppercase" style={{ color: 'var(--txt3)' }}>Claro</span>
                    </button>

                    {/* DARK */}
                    <button onClick={() => handleApplyTheme('dark')} aria-pressed={theme === 'dark'} aria-label="Tema Oscuro"
                        className="p-4 rounded-2xl border-2 flex flex-col items-center gap-3 transition-all hover:scale-105"
                        style={theme === 'dark' ? { borderColor: 'var(--company-primary,#6366f1)', backgroundColor: 'var(--surf2)' } : { borderColor: 'var(--border)' }}>
                        <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center shadow-sm"><Moon size={20} className="text-white" aria-hidden="true"/></div>
                        <span className="text-xs font-black uppercase" style={{ color: 'var(--txt3)' }}>Oscuro</span>
                    </button>

                    {/* CONTRASTE */}
                    <button onClick={() => handleApplyTheme('contrast')} aria-pressed={theme === 'contrast'} aria-label="Tema Alto contraste"
                        className="p-4 rounded-2xl border-2 flex flex-col items-center gap-3 transition-all hover:scale-105"
                        style={theme === 'contrast' ? { borderColor: '#FFD700', backgroundColor: '#000' } : { borderColor: 'var(--border)' }}>
                        <div className="w-10 h-10 rounded-full bg-black border border-white flex items-center justify-center shadow-sm"><Zap size={20} className="text-yellow-400" aria-hidden="true"/></div>
                        <span className="text-xs font-black uppercase" style={{ color: 'var(--txt3)' }}>Contraste</span>
                    </button>

                    {/* AZUL / NAVY */}
                    <button onClick={() => handleApplyTheme('blue')} aria-pressed={theme === 'blue'} aria-label="Tema Azul Pro"
                        className="p-4 rounded-2xl border-2 flex flex-col items-center gap-3 transition-all hover:scale-105"
                        style={theme === 'blue' ? { borderColor: '#3b82f6', backgroundColor: '#0f1f4a' } : { borderColor: 'var(--border)' }}>
                        <div className="w-10 h-10 rounded-full bg-blue-900 flex items-center justify-center shadow-sm"><Hexagon size={20} className="text-blue-200" aria-hidden="true"/></div>
                        <span className="text-xs font-black uppercase" style={{ color: 'var(--txt3)' }}>Azul Pro</span>
                    </button>

                    {/* PERSONALIZADO / ZINC */}
                    <button onClick={() => handleApplyTheme('custom')} aria-pressed={theme === 'custom'} aria-label="Tema Personalizado"
                        className="p-4 rounded-2xl border-2 flex flex-col items-center gap-3 transition-all hover:scale-105"
                        style={theme === 'custom' ? { borderColor: '#a1a1aa', backgroundColor: '#18181b' } : { borderColor: 'var(--border)' }}>
                        <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center shadow-sm"><Layers size={20} className="text-zinc-300" aria-hidden="true"/></div>
                        <span className="text-xs font-black uppercase" style={{ color: 'var(--txt3)' }}>Zinc</span>
                    </button>

                    {/* SISTEMA */}
                    <button onClick={() => handleApplyTheme('system')} aria-pressed={theme === 'system'} aria-label="Tema Sistema (automático)"
                        className="p-4 rounded-2xl border-2 flex flex-col items-center gap-3 transition-all hover:scale-105"
                        style={theme === 'system' ? { borderColor: 'var(--company-primary,#6366f1)', backgroundColor: 'var(--surf2)' } : { borderColor: 'var(--border)' }}>
                        <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center shadow-sm"><Monitor size={20} className="text-slate-600" aria-hidden="true"/></div>
                        <span className="text-xs font-black uppercase" style={{ color: 'var(--txt3)' }}>Sistema</span>
                    </button>
                </div>

                {/* COLOR DE EMPRESA */}
                <div className="mt-8 pt-6 border-t" style={{ borderColor: 'var(--border)' }}>
                    <h4 className="text-sm font-black mb-3 flex items-center gap-2" style={{ color: 'var(--txt)' }}>
                        <Palette style={{ color: 'var(--company-primary,#6366f1)' }} size={16}/> COLOR DE EMPRESA
                    </h4>
                    <p className="text-xs text-slate-400 mb-4">Tinta de acento aplicada a botones, badges y elementos de marca. Se guarda por empresa.</p>
                    <div className="flex flex-wrap items-center gap-3">
                        {BRAND_PRESETS.map(hex => (
                            <button
                                key={hex}
                                aria-label={`Color ${hex}`}
                                onClick={() => handleApplyCompanyColor(hex)}
                                style={{ backgroundColor: hex }}
                                className={`w-8 h-8 rounded-full transition-all hover:scale-110 ring-offset-2 ${companyColor === hex ? 'ring-2 ring-slate-700 dark:ring-white scale-110' : ''}`}
                            />
                        ))}
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="color"
                                value={companyColor}
                                onChange={e => setCompanyColor(e.target.value)}
                                onBlur={e => handleApplyCompanyColor(e.target.value)}
                                className="w-8 h-8 rounded-full cursor-pointer border-0 p-0 bg-transparent"
                                aria-label="Color personalizado"
                            />
                            <span className="text-xs text-slate-500 font-mono">{companyColor}</span>
                        </label>
                        {savingColor && <Loader2 size={14} className="animate-spin text-slate-400"/>}
                    </div>
                </div>
            </div>

            {/* 2. DATOS DE LA EMPRESA */}
            <div className="rounded-xl border p-8 relative overflow-hidden" style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}>
                <h3 className="text-xl font-black mb-8 flex items-center gap-3 relative z-10" style={{ color: 'var(--txt)' }}>
                    <div className="p-3 rounded-xl" style={{ backgroundColor: 'var(--surf2)', color: 'var(--company-primary,#6366f1)' }}><Building size={24}/></div>
                    DATOS DE LA ORGANIZACIÓN
                </h3>
                {loadingCompany ? (
                    <div className="flex items-center gap-2 text-slate-400 py-8"><Loader2 size={18} className="animate-spin"/> Cargando datos...</div>
                ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 relative z-10">
                    <div><label htmlFor="cfg-razon-social" className="text-[10px] font-black uppercase tracking-widest mb-2 block" style={{ color: 'var(--txt3)' }}>Razón Social</label><input id="cfg-razon-social" name="name" value={company.name} onChange={handleChange} className="w-full p-4 border-2 rounded-xl font-bold outline-none transition-all" style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)', color: 'var(--txt)' }}/></div>
                    <div><label htmlFor="cfg-cuit" className="text-[10px] font-black uppercase tracking-widest mb-2 block" style={{ color: 'var(--txt3)' }}>CUIT</label><input id="cfg-cuit" name="cuit" value={company.cuit} onChange={handleChange} className="w-full p-4 border-2 rounded-xl font-mono font-medium outline-none transition-all" style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)', color: 'var(--txt)' }}/></div>
                    <div className="md:col-span-2"><label htmlFor="cfg-direccion" className="text-[10px] font-black uppercase tracking-widest mb-2 block" style={{ color: 'var(--txt3)' }}>Dirección</label><div className="relative"><FileText size={20} className="absolute left-4 top-4 text-slate-400" aria-hidden="true"/><input id="cfg-direccion" name="address" value={company.address} onChange={handleChange} className="w-full pl-12 p-4 border-2 rounded-xl font-medium outline-none transition-all" style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)', color: 'var(--txt)' }}/></div></div>
                </div>
                )}
                <div className="mt-8 pt-6 border-t flex justify-end" style={{ borderColor: 'var(--border)' }}>
                    <button onClick={handleSaveCompany} disabled={savingCompany || loadingCompany} className="bg-slate-900 hover:bg-slate-800 dark:bg-white dark:text-slate-900 text-white px-8 py-4 rounded-xl font-black text-xs uppercase flex items-center gap-2 shadow-xl hover:-translate-y-1 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                        {savingCompany ? <Loader2 size={18} className="animate-spin"/> : <Save size={18}/>}
                        {savingCompany ? 'GUARDANDO...' : 'GUARDAR DATOS'}
                    </button>
                </div>
            </div>

            {/* 2b. PORTALES DE ACCESO */}
            <div className="rounded-xl border p-8" style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}>
                <h3 className="text-xl font-black mb-6 flex items-center gap-3" style={{ color: 'var(--txt)' }}>
                    <div className="p-3 rounded-xl" style={{ backgroundColor: 'var(--surf2)', color: 'var(--company-primary,#6366f1)' }}><ExternalLink size={24}/></div>
                    PORTALES DE ACCESO
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Link
                        href="/empleado/dashboard"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group flex flex-col gap-3 p-5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl hover:border-indigo-300 hover:shadow-md transition-all"
                    >
                        <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/60 rounded-xl flex items-center justify-center text-indigo-600 dark:text-indigo-400 group-hover:bg-indigo-200 transition-colors">
                            <UserCircle size={22}/>
                        </div>
                        <div>
                            <p className="font-black text-slate-800 dark:text-white text-sm uppercase">Portal Empleado</p>
                            <p className="text-[11px] text-slate-400 font-medium mt-0.5">Turnos, presencia y novedades del guardia</p>
                        </div>
                        <span className="text-[10px] font-black text-indigo-500 uppercase flex items-center gap-1 mt-auto">
                            Abrir <ArrowRight size={11}/>
                        </span>
                    </Link>

                    <Link
                        href="/objetivo/dashboard"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group flex flex-col gap-3 p-5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl hover:border-emerald-300 hover:shadow-md transition-all"
                    >
                        <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-900/60 rounded-xl flex items-center justify-center text-emerald-600 dark:text-emerald-400 group-hover:bg-emerald-200 transition-colors">
                            <BookOpen size={22}/>
                        </div>
                        <div>
                            <p className="font-black text-slate-800 dark:text-white text-sm uppercase">Libro de Guardia</p>
                            <p className="text-[11px] text-slate-400 font-medium mt-0.5">Portal del objetivo — accesos y novedades</p>
                        </div>
                        <span className="text-[10px] font-black text-emerald-500 uppercase flex items-center gap-1 mt-auto">
                            Abrir <ArrowRight size={11}/>
                        </span>
                    </Link>

                    <Link
                        href={`/cliente/dashboard${empresaId ? `?empresaId=${encodeURIComponent(empresaId)}` : ''}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group flex flex-col gap-3 p-5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl hover:border-violet-300 hover:shadow-md transition-all"
                    >
                        <div className="w-10 h-10 bg-violet-100 dark:bg-violet-900/60 rounded-xl flex items-center justify-center text-violet-600 dark:text-violet-400 group-hover:bg-violet-200 transition-colors">
                            <ShieldCheck size={22}/>
                        </div>
                        <div>
                            <p className="font-black text-slate-800 dark:text-white text-sm uppercase">Portal Cliente</p>
                            <p className="text-[11px] text-slate-400 font-medium mt-0.5">Personal autorizado y accesos del día</p>
                        </div>
                        <span className="text-[10px] font-black text-violet-500 uppercase flex items-center gap-1 mt-auto">
                            Abrir <ArrowRight size={11}/>
                        </span>
                    </Link>
                </div>
            </div>

            {/* 3. ZONA DE MANTENIMIENTO */}
            <div className="bg-rose-50 dark:bg-rose-950/20 p-8 rounded-[2rem] border-2 border-rose-100 dark:border-rose-900/50 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-10"><ShieldAlert size={120} className="text-rose-600"/></div>
                <h3 className="text-xl font-black text-rose-700 dark:text-rose-400 mb-2 flex items-center gap-3"><AlertTriangle size={24}/> ZONA DE MANTENIMIENTO</h3>
                <p className="text-sm text-rose-600/80 mb-2 font-medium">Acciones destructivas e irreversibles. Solo <strong>ADMIN</strong> o <strong>SUPERADMIN</strong> (en Firebase + función desplegada).</p>
                {!canRunMassDelete && (
                    <p className="text-xs text-amber-700 dark:text-amber-400 mb-6 font-bold">Tu sesión no tiene rol ADMIN/SUPERADMIN: los botones están deshabilitados.</p>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative z-10">
                    <button type="button" onClick={() => handleSystemClean('AUDIT')} disabled={!!cleaningTarget || !canRunMassDelete} className="p-4 bg-white dark:bg-slate-900 border border-rose-200 rounded-xl flex items-center justify-between hover:border-rose-400 group transition-all disabled:opacity-50">
                        <span className="font-bold text-rose-700 text-sm text-left">Borrar historial operaciones<br/><span className="font-normal text-[10px] text-rose-500">colección historial_operaciones</span></span>
                        {cleaningTarget === 'AUDIT' ? <RefreshCw className="animate-spin text-rose-500 shrink-0"/> : <Trash2 className="text-rose-300 group-hover:text-rose-600 shrink-0"/>}
                    </button>
                    <button type="button" onClick={openShiftMassDeleteModal} disabled={!!cleaningTarget || !canRunMassDelete} className="p-4 bg-white dark:bg-slate-900 border-2 border-rose-400 rounded-xl flex items-center justify-between hover:bg-rose-50 dark:hover:bg-rose-950/40 group transition-all disabled:opacity-50">
                        <span className="font-bold text-rose-800 text-sm text-left">Borrado total de turnos<br/><span className="font-normal text-[10px] text-rose-600">Elimina toda la colección <code className="bg-rose-100 dark:bg-rose-900 px-1 rounded">turnos</code> (planificación / operaciones)</span></span>
                        {cleaningTarget === 'SHIFTS' ? <RefreshCw className="animate-spin text-rose-500 shrink-0"/> : <Trash2 className="text-rose-400 group-hover:text-rose-700 shrink-0"/>}
                    </button>
                </div>
            </div>

            {shiftDeleteModalOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-rose-200 dark:border-rose-800">
                        <div className="flex justify-between items-start mb-4">
                            <h4 className="text-lg font-black text-rose-700 dark:text-rose-400 flex items-center gap-2"><AlertTriangle size={22}/> Borrado total de turnos</h4>
                            <button type="button" onClick={() => setShiftDeleteModalOpen(false)} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500"><X size={20}/></button>
                        </div>
                        <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
                            Se eliminarán <strong>todos</strong> los documentos de la colección <code className="text-xs bg-slate-100 dark:bg-slate-900 px-1 rounded">turnos</code> en Firestore (incluye vacantes huérfanas, planificación cargada, etc.). No afecta empleados, clientes ni servicios SLA.
                        </p>
                        <p className="text-xs font-bold text-rose-600 mb-2">Para confirmar, escribí exactamente:</p>
                        <p className="text-xs font-mono bg-rose-50 dark:bg-rose-950/50 p-2 rounded border border-rose-200 mb-3">{PHRASE_DELETE_ALL_SHIFTS}</p>
                        <input
                            type="text"
                            autoFocus
                            value={shiftDeletePhrase}
                            onChange={(e) => setShiftDeletePhrase(e.target.value)}
                            className="w-full p-3 border-2 border-slate-200 dark:border-slate-600 rounded-xl font-mono text-sm dark:bg-slate-900 dark:text-white mb-4"
                            placeholder="Escribí la frase aquí"
                        />
                        <div className="flex gap-3 justify-end">
                            <button type="button" onClick={() => setShiftDeleteModalOpen(false)} className="px-4 py-2 rounded-xl font-bold text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700">Cancelar</button>
                            <button
                                type="button"
                                disabled={shiftDeletePhrase.trim() !== PHRASE_DELETE_ALL_SHIFTS || !!cleaningTarget}
                                onClick={confirmShiftMassDelete}
                                className="px-6 py-2 rounded-xl font-black text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                Ejecutar borrado
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}