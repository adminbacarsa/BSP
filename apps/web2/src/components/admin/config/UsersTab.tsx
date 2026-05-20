import React, { useEffect, useState } from 'react';
import { Plus, CheckCircle, XCircle, Shield, RefreshCw, X, Edit3, Trash2, Building2, Eye, EyeOff, LockKeyhole } from 'lucide-react';
import { db, functions } from '@/lib/firebase';
import { collection, getDocs, query, orderBy, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';
import { isSuperAdminRole, superAdminRoleLabel } from '@/lib/roles';

export default function UsersTab() {
    const { isSuperAdmin } = useAuth();
    const { empresaId: myEmpresaId, empresas } = useEmpresa();

    const [users, setUsers]         = useState<any[]>([]);
    const [rolesList, setRolesList] = useState<any[]>([]);
    const [loading, setLoading]     = useState(false);
    const [isModalOpen, setIsModalOpen]   = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [editMode, setEditMode]         = useState(false);

    const initialForm = { id: '', firstName: '', lastName: '', email: '', password: '', role: '', empresaId: '', supervisorPin: '', showPin: false };
    const [formData, setFormData] = useState(initialForm);

    // Empresas disponibles para el dropdown del modal
    // SuperAdmin ve todas; el resto ve solo la suya
    const empresasDropdown = isSuperAdmin
        ? empresas
        : empresas.filter(e => e.id === myEmpresaId);

    useEffect(() => { loadData(); }, [myEmpresaId, isSuperAdmin]);

    const loadData = async () => {
        setLoading(true);
        try {
            const [uSnap, rSnap] = await Promise.all([
                getDocs(query(collection(db, 'system_users'), orderBy('lastName'))),
                getDocs(collection(db, 'roles')),
            ]);

            const allUsers = uSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];

            // SuperAdmin ve todos; el resto ve los de su empresa + los superadmins (siempre visibles en todas)
            const isSA = (u: any) => isSuperAdminRole(u.role);
            const filtered = isSuperAdmin
                ? allUsers
                : allUsers.filter(u => isSA(u) || (u.empresaId || 'bacarsa') === myEmpresaId);

            setUsers(filtered);
            setRolesList(rSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        } catch (e) {
            console.error(e);
            toast.error('Error de conexión al cargar usuarios');
        } finally {
            setLoading(false);
        }
    };

    const handleOpenCreate = () => {
        setEditMode(false);
        // Superadmin puede crear usuarios para cualquier empresa — no pre-seleccionar
        setFormData({ ...initialForm, empresaId: isSuperAdmin ? '' : myEmpresaId });
        setIsModalOpen(true);
    };

    const handleOpenEdit = (user: any) => {
        setEditMode(true);
        setFormData({
            id: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            password: '',
            role: user.role,
            empresaId: user.empresaId || myEmpresaId,
            supervisorPin: user.supervisorPin || '',
            showPin: false,
        });
        setIsModalOpen(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsProcessing(true);

        const promise = new Promise(async (resolve, reject) => {
            try {
                // Superadmin no lleva empresa fija
                const roleIsSuperAdmin = ['SUPERADMIN', 'SUPER_ADMIN', 'SP'].includes((formData.role || '').toUpperCase());
                const efectivaEmpresaId = roleIsSuperAdmin ? '' : (formData.empresaId || myEmpresaId);

                if (editMode) {
                    await updateDoc(doc(db, 'system_users', formData.id), {
                        firstName:     formData.firstName,
                        lastName:      formData.lastName,
                        role:          formData.role,
                        empresaId:     efectivaEmpresaId,
                        supervisorPin: formData.supervisorPin || null,
                    });
                    const syncFn = httpsCallable(functions, 'syncSystemUserClaims');
                    await syncFn({ uid: formData.id });
                    resolve('Usuario actualizado correctamente');
                } else {
                    const createFn = httpsCallable(functions, 'crearUsuarioSistema');
                    await createFn({
                        firstName:     formData.firstName,
                        lastName:      formData.lastName,
                        email:         formData.email,
                        password:      formData.password,
                        role:          formData.role,
                        empresaId:     efectivaEmpresaId,
                        supervisorPin: formData.supervisorPin || null,
                    });
                    resolve('Usuario creado y acceso concedido');
                }
                setIsModalOpen(false);
                loadData();
            } catch (error: any) {
                reject(error.message || 'Error desconocido');
            } finally {
                setIsProcessing(false);
            }
        });

        toast.promise(promise, {
            loading:  editMode ? 'Actualizando datos...' : 'Creando credenciales...',
            success:  (data) => `${data}`,
            error:    (err)  => `Error: ${err}`,
        });
    };

    const handleDelete = async (userId: string) => {
        toast('¿Estás seguro?', {
            action: {
                label: 'Eliminar',
                onClick: async () => {
                    try {
                        await deleteDoc(doc(db, 'system_users', userId));
                        toast.success('Usuario eliminado');
                        loadData();
                    } catch { toast.error('No se pudo eliminar'); }
                }
            },
            cancel: { label: 'Cancelar', onClick: () => {} }
        });
    };

    const getEmpresaName = (id: string) =>
        empresas.find(e => e.id === id)?.name || id || '—';

    // El rol seleccionado en el form es superadmin → no lleva empresa
    const formRoleIsSuperAdmin = ['SUPERADMIN', 'SUPER_ADMIN', 'SP'].includes((formData.role || '').toUpperCase());

    return (
        <div className="space-y-6 animate-in fade-in">
            {/* Header */}
            <div className="flex justify-between items-center bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-indigo-50 dark:bg-indigo-900/30 rounded-xl text-indigo-600 dark:text-indigo-400">
                        <Shield size={24}/>
                    </div>
                    <div>
                        <h3 className="font-black text-lg text-slate-800 dark:text-white uppercase">Usuarios de Plataforma</h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">
                            {isSuperAdmin ? 'Todas las empresas' : getEmpresaName(myEmpresaId)}
                            {' · '}{users.length} usuario{users.length !== 1 ? 's' : ''}
                        </p>
                    </div>
                </div>
                <button
                    onClick={handleOpenCreate}
                    className="bg-slate-900 dark:bg-white dark:text-slate-900 text-white px-6 py-3 rounded-xl font-bold text-xs shadow-lg hover:scale-105 transition-transform flex items-center gap-2"
                >
                    <Plus size={18}/> NUEVO USUARIO
                </button>
            </div>

            {/* Tabla */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
                <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700">
                        <tr>
                            <th className="p-5 font-black text-slate-800 dark:text-slate-200 text-xs uppercase tracking-wider">Usuario</th>
                            <th className="p-5 font-black text-slate-800 dark:text-slate-200 text-xs uppercase tracking-wider">Rol</th>
                            <th className="p-5 font-black text-slate-800 dark:text-slate-200 text-xs uppercase tracking-wider">Empresa</th>
                            <th className="p-5 font-black text-slate-800 dark:text-slate-200 text-xs uppercase tracking-wider text-center">Estado</th>
                            <th className="p-5 font-black text-slate-800 dark:text-slate-200 text-xs uppercase tracking-wider text-right">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                        {users.map(u => (
                            <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                                <td className="p-5">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center font-black text-sm border border-slate-200 dark:border-slate-600 uppercase">
                                            {u.firstName?.[0]}
                                        </div>
                                        <div>
                                            <p className="font-bold text-slate-900 dark:text-white">{u.firstName} {u.lastName}</p>
                                            <p className="text-xs text-slate-500 font-medium">{u.email}</p>
                                        </div>
                                    </div>
                                </td>
                                <td className="p-5">
                                    <span className={`px-3 py-1 rounded-lg text-xs font-bold uppercase ${
                                      isSuperAdminRole(u.role)
                                        ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200'
                                        : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                                    }`}>
                                        {isSuperAdminRole(u.role) ? '⭐ SuperAdmin' : (rolesList.find(r => r.id === u.role)?.name || u.role)}
                                    </span>
                                    {u.supervisorPin && (
                                        <span className="ml-1 text-[9px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded font-black border border-indigo-100">🔒 PIN</span>
                                    )}
                                </td>
                                <td className="p-5">
                                    {isSuperAdminRole(u.role) ? (
                                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-xs font-bold">
                                            <Shield size={12}/> Todas
                                        </span>
                                    ) : u.empresaId ? (
                                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 text-xs font-bold">
                                            <Building2 size={12}/>{getEmpresaName(u.empresaId)}
                                        </span>
                                    ) : (
                                        <span className="text-xs text-slate-400 font-medium">Sin asignar</span>
                                    )}
                                </td>
                                <td className="p-5 text-center">
                                    {u.status === 'ACTIVE'
                                        ? <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-black uppercase"><CheckCircle size={12}/> Activo</span>
                                        : <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 text-slate-500 text-[10px] font-black uppercase"><XCircle size={12}/> Inactivo</span>
                                    }
                                </td>
                                <td className="p-5 text-right">
                                    <div className="flex justify-end gap-2">
                                        <button onClick={() => handleOpenEdit(u)} className="p-2 hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 rounded-lg transition-colors"><Edit3 size={16}/></button>
                                        <button onClick={() => handleDelete(u.id)} className="p-2 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg transition-colors"><Trash2 size={16}/></button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {users.length === 0 && !loading && (
                    <div className="p-10 text-center text-slate-500 font-medium">No hay usuarios registrados.</div>
                )}
            </div>

            {/* Modal crear / editar */}
            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md">
                    <div className="bg-white dark:bg-slate-800 rounded-[2rem] w-full max-w-lg p-8 shadow-2xl animate-in zoom-in-95 border border-slate-100 dark:border-slate-700">
                        <div className="flex justify-between items-center mb-8">
                            <h3 className="font-black text-xl text-slate-900 dark:text-white uppercase">
                                {editMode ? 'Editar Usuario' : 'Nuevo Acceso'}
                            </h3>
                            <button onClick={() => setIsModalOpen(false)} className="p-2 bg-slate-100 dark:bg-slate-700 rounded-full hover:bg-slate-200 transition-colors">
                                <X size={20}/>
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-5">
                            <div className="grid grid-cols-2 gap-5">
                                <div>
                                    <label className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 ml-1 mb-1 block">Nombre</label>
                                    <input required className="w-full p-4 bg-slate-50 dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-700 focus:border-indigo-500 rounded-xl font-bold text-slate-900 dark:text-white outline-none"
                                        value={formData.firstName} onChange={e => setFormData({ ...formData, firstName: e.target.value })}/>
                                </div>
                                <div>
                                    <label className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 ml-1 mb-1 block">Apellido</label>
                                    <input required className="w-full p-4 bg-slate-50 dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-700 focus:border-indigo-500 rounded-xl font-bold text-slate-900 dark:text-white outline-none"
                                        value={formData.lastName} onChange={e => setFormData({ ...formData, lastName: e.target.value })}/>
                                </div>
                            </div>

                            <div>
                                <label className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 ml-1 mb-1 block">Email</label>
                                <input required type="email" disabled={editMode}
                                    className="w-full p-4 bg-slate-50 dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-700 focus:border-indigo-500 rounded-xl font-bold text-slate-900 dark:text-white outline-none disabled:opacity-50"
                                    value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })}/>
                            </div>

                            {!editMode && (
                                <div>
                                    <label className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 ml-1 mb-1 block">Contraseña</label>
                                    <input required type="password" minLength={6}
                                        className="w-full p-4 bg-slate-50 dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-700 focus:border-indigo-500 rounded-xl font-bold text-slate-900 dark:text-white outline-none"
                                        value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })}/>
                                </div>
                            )}

                            <div>
                                <label className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 ml-1 mb-1 block">Rol</label>
                                <select required
                                    className="w-full p-4 bg-slate-50 dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-700 focus:border-indigo-500 rounded-xl font-bold text-indigo-600 outline-none"
                                    value={formData.role} onChange={e => setFormData({ ...formData, role: e.target.value })}>
                                    <option value="">Seleccionar Rol...</option>
                                    {/* Opción SUPERADMIN hardcodeada — solo visible para superadmins */}
                                    {isSuperAdmin && (
                                        <option value="SUPERADMIN">⭐ Superadmin</option>
                                    )}
                                    {rolesList
                                        .filter(r => !['SUPERADMIN','SUPER_ADMIN'].includes(r.id.toUpperCase()))
                                        .map(r => (
                                            <option key={r.id} value={r.id}>{r.name || r.id}</option>
                                        ))
                                    }
                                </select>
                            </div>

                            {/* Empresa — oculto para rol superadmin */}
                            {formRoleIsSuperAdmin ? (
                                <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-200 dark:border-amber-800 rounded-xl text-amber-700 dark:text-amber-300 text-xs font-bold flex items-center gap-2">
                                    <Shield size={14}/> Superadmin — acceso a todas las empresas sin restricción
                                </div>
                            ) : (
                                <div>
                                    <label className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 ml-1 mb-1 block flex items-center gap-1">
                                        <Building2 size={10}/> Empresa
                                        {!isSuperAdmin && <span className="font-normal normal-case text-slate-400">(asignada automáticamente)</span>}
                                    </label>
                                    {isSuperAdmin ? (
                                        <select
                                            className="w-full p-4 bg-slate-50 dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-700 focus:border-indigo-500 rounded-xl font-bold text-slate-700 dark:text-white outline-none"
                                            value={formData.empresaId} onChange={e => setFormData({ ...formData, empresaId: e.target.value })}>
                                            <option value="">— Sin empresa asignada —</option>
                                            {empresasDropdown.map(e => <option key={e.id} value={e.id}>{e.name || e.id}</option>)}
                                        </select>
                                    ) : (
                                        <div className="w-full p-4 bg-slate-100 dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-700 rounded-xl font-bold text-slate-500 flex items-center gap-2">
                                            <Building2 size={14} className="text-indigo-400"/>
                                            {getEmpresaName(myEmpresaId)}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* PIN DE AUTORIZACIÓN SUPERVISOR */}
                            <div className="p-4 bg-indigo-50 dark:bg-indigo-900/20 border-2 border-indigo-100 dark:border-indigo-800 rounded-xl">
                                <div className="flex items-center gap-2 mb-3">
                                    <LockKeyhole size={14} className="text-indigo-600"/>
                                    <label className="text-[10px] font-black text-indigo-700 dark:text-indigo-400 uppercase tracking-wider">PIN de Supervisor</label>
                                    <span className="text-[10px] text-indigo-400">(4 dígitos — opcional)</span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="relative">
                                        <input
                                            type={formData.showPin ? 'text' : 'password'}
                                            maxLength={4}
                                            inputMode="numeric"
                                            placeholder="••••"
                                            value={formData.supervisorPin}
                                            onChange={e => setFormData({ ...formData, supervisorPin: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                                            className="w-32 text-center text-2xl font-black tracking-[0.25em] bg-white dark:bg-slate-700 border-2 border-indigo-200 dark:border-indigo-700 focus:border-indigo-500 outline-none dark:text-white rounded-xl px-4 py-2"
                                        />
                                        <button type="button" onClick={() => setFormData({ ...formData, showPin: !formData.showPin })}
                                            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                                            {formData.showPin ? <EyeOff size={14}/> : <Eye size={14}/>}
                                        </button>
                                    </div>
                                    <div className="flex-1 text-[11px]">
                                        {!formData.supervisorPin && <p className="text-slate-400">Sin PIN — no podrá autorizar excepciones.</p>}
                                        {formData.supervisorPin.length > 0 && formData.supervisorPin.length < 4 && <p className="text-amber-600 font-bold">Faltan {4 - formData.supervisorPin.length} dígitos.</p>}
                                        {formData.supervisorPin.length === 4 && <p className="text-emerald-600 font-black">✓ Puede autorizar operaciones que superen las 200hs.</p>}
                                    </div>
                                </div>
                            </div>

                            <div className="flex gap-3 pt-4">
                                <button type="button" onClick={() => setIsModalOpen(false)}
                                    className="px-6 py-4 rounded-xl font-bold text-slate-500 hover:bg-slate-100 transition-colors">
                                    Cancelar
                                </button>
                                <button type="submit" disabled={isProcessing}
                                    className="flex-1 py-4 bg-indigo-600 text-white rounded-xl font-black uppercase tracking-wide hover:bg-indigo-700 shadow-lg flex justify-center items-center gap-2">
                                    {isProcessing
                                        ? <RefreshCw className="animate-spin" size={20}/>
                                        : editMode ? <Edit3 size={20}/> : <Plus size={20}/>
                                    }
                                    {editMode ? 'GUARDAR' : 'CREAR'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
