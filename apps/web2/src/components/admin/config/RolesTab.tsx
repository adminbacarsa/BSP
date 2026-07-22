import React, { useEffect, useState } from 'react';
import { Plus, Edit3, Trash2, Save, Shield, Check, X } from 'lucide-react';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, setDoc, deleteDoc, updateDoc } from 'firebase/firestore';
import { SYSTEM_MODULES, PERMISSION_ACTIONS } from '@/config/modules';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';

interface IRole { id: string; name: string; permissions: Record<string, string[]>; empresaId?: string; }

const actionBadgeLabel = (action: string) => {
    if (action === 'publish') return 'Pub';
    if (action === 'correct') return 'Cor';
    if (action === 'adjust') return 'Aju';
    return action.charAt(0);
};

const actionBadgeClass = (action: string) => {
    if (action === 'read') return 'bg-blue-100 text-blue-700';
    if (action === 'create') return 'bg-emerald-100 text-emerald-700';
    if (action === 'update') return 'bg-amber-100 text-amber-700';
    if (action === 'delete') return 'bg-rose-100 text-rose-700';
    if (action === 'publish') return 'bg-indigo-100 text-indigo-700';
    if (action === 'correct') return 'bg-violet-100 text-violet-700';
    if (action === 'adjust') return 'bg-teal-100 text-teal-700';
    return 'bg-slate-100 text-slate-700';
};

export default function RolesTab() {
    const { isSuperAdmin } = useAuth();
    const { empresaId, empresa, empresas } = useEmpresa();
    const [roles, setRoles] = useState<IRole[]>([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [roleName, setRoleName] = useState('');
    const [editId, setEditId] = useState<string | null>(null);
    const [matrix, setMatrix] = useState<Record<string, string[]>>({});
    const [roleEmpresaId, setRoleEmpresaId] = useState('');

    useEffect(() => { loadRoles(); }, [empresaId, isSuperAdmin]);

    const loadRoles = async () => {
        const snap = await getDocs(collection(db, 'roles'));
        const all = snap.docs.map(d => ({ id: d.id, ...d.data() })) as IRole[];
        const filtered = isSuperAdmin
          ? all
          : all.filter(r => !r.empresaId || String(r.empresaId).trim() === String(empresaId).trim());
        setRoles(filtered);
    };

    const canEditRole = (role: IRole) => isSuperAdmin || (!!role.empresaId && role.empresaId === empresaId);

    const handleOpenCreate = () => {
        setEditId(null); setRoleName(''); setMatrix({});
        setRoleEmpresaId(empresaId || '');
        setIsModalOpen(true);
    };

    const handleOpenEdit = (role: IRole) => {
        if (!canEditRole(role)) return alert('Rol global: solo lectura');
        setEditId(role.id); setRoleName(role.name); setMatrix(role.permissions || {});
        // Normaliza: si el rol guardó el nombre en vez del ID, buscar el ID real
        const storedVal = role.empresaId || '';
        const matchById = empresas.find(e => e.id === storedVal);
        const matchByName = empresas.find(e => e.name === storedVal);
        setRoleEmpresaId(matchById?.id || matchByName?.id || storedVal);
        setIsModalOpen(true);
    };

    const togglePermission = (moduleKey: string, actionKey: string) => {
        setMatrix(prev => {
            const currentActions = prev[moduleKey] || [];
            let newActions;
            if (currentActions.includes(actionKey)) {
                newActions = currentActions.filter(a => a !== actionKey);
                if (actionKey === 'read') newActions = [];
            } else {
                newActions = [...currentActions, actionKey];
                if (actionKey !== 'read' && !currentActions.includes('read')) newActions.push('read');
            }
            return { ...prev, [moduleKey]: newActions };
        });
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!roleName.trim()) return alert("Nombre requerido");
        const roleData: Record<string, unknown> = { name: roleName, permissions: matrix };
        const emp = String(roleEmpresaId || '').trim();
        if (emp) roleData.empresaId = emp;
        else roleData.empresaId = empresaId;
        try {
            if (editId) await updateDoc(doc(db, 'roles', editId), roleData);
            else await setDoc(doc(db, 'roles', roleName.toUpperCase().replace(/\s+/g, '_')), roleData);
            setIsModalOpen(false); loadRoles();
        } catch (e) { alert("Error guardando"); }
    };

    const handleDelete = async (id: string) => {
        const role = roles.find(r => r.id === id);
        if (role && !canEditRole(role)) return alert('No podés borrar roles globales');
        if (confirm("¿Borrar rol?")) { await deleteDoc(doc(db, 'roles', id)); loadRoles(); }
    };

    return (
        <div className="animate-in fade-in space-y-6">
            <div className="flex justify-end">
                <button onClick={handleOpenCreate} className="bg-slate-900 dark:bg-white dark:text-slate-900 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 hover:scale-105 transition-transform shadow-lg">
                    <Shield size={18}/> CREAR ROL
                </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {roles.map(role => (
                    <div key={role.id} className="bg-white dark:bg-slate-800 p-6 rounded-2xl border dark:border-slate-700 shadow-sm hover:shadow-md transition-all group relative">
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <h3 className="font-black text-xl text-slate-800 dark:text-white uppercase">{role.name}</h3>
                                {role.empresaId && <p className="text-[10px] text-indigo-500 font-bold mt-1">{empresas.find(e => e.id === role.empresaId || e.name === role.empresaId)?.name || role.empresaId}</p>}
                                {!role.empresaId && <p className="text-[10px] text-slate-400 font-bold mt-1">Global</p>}
                            </div>
                            {canEditRole(role) && (
                            <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity absolute top-4 right-4 bg-white dark:bg-slate-800 p-1 rounded-lg shadow-sm border dark:border-slate-600">
                                <button onClick={()=>handleOpenEdit(role)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-indigo-500"><Edit3 size={16}/></button>
                                <button onClick={()=>handleDelete(role.id)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-rose-500"><Trash2 size={16}/></button>
                            </div>
                            )}
                        </div>
                        <div className="space-y-2">
                            {Object.entries(role.permissions || {}).map(([modKey, actions]) => {
                                if (actions.length === 0) return null;
                                const modLabel = SYSTEM_MODULES.find(m => m.key === modKey)?.label || modKey;
                                return (
                                    <div key={modKey} className="text-xs bg-slate-50 dark:bg-slate-900 p-2 rounded-lg flex justify-between items-center border dark:border-slate-700">
                                        <span className="font-bold text-slate-600 dark:text-slate-400 truncate w-1/2">{modLabel}</span>
                                        <div className="flex gap-1 flex-wrap justify-end">{actions.map(a => <span key={a} className={`px-1.5 h-5 flex items-center justify-center rounded text-[9px] font-black uppercase ${actionBadgeClass(a)}`}>{actionBadgeLabel(a)}</span>)}</div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>

            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md">
                    <div className="bg-white dark:bg-slate-800 rounded-3xl w-full max-w-4xl p-8 flex flex-col max-h-[90vh] shadow-2xl animate-in zoom-in-95 border dark:border-slate-700">
                        <div className="flex justify-between items-start mb-6">
                            <div className="flex-1 mr-4">
                                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">Nombre del Rol</label>
                                <input
                                    autoFocus
                                    type="text"
                                    placeholder="Ej: Supervisor"
                                    className="w-1/2 text-2xl font-black bg-transparent border-b-2 border-slate-200 focus:border-indigo-600 outline-none dark:text-white pb-2 dark:border-slate-700"
                                    value={roleName}
                                    onChange={e => setRoleName(e.target.value)}
                                />
                                <div className="mt-4">
                                  <label className="text-xs font-bold text-slate-400 uppercase block mb-1">Empresa</label>
                                  {isSuperAdmin ? (
                                    <select value={roleEmpresaId} onChange={e => setRoleEmpresaId(e.target.value)} className="w-full p-2 border rounded-lg dark:bg-slate-900 dark:border-slate-600 dark:text-white text-sm">
                                        {empresas.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                                    </select>
                                  ) : (
                                    <p className="text-sm font-bold text-slate-700 dark:text-slate-300 p-2 bg-slate-50 dark:bg-slate-900 border rounded-lg border-slate-200 dark:border-slate-600">{empresa?.name || roleEmpresaId}</p>
                                  )}
                                </div>
                            </div>
                            <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full text-slate-400"><X/></button>
                        </div>

                        <div className="flex-1 overflow-auto border rounded-xl dark:border-slate-700 custom-scrollbar">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-slate-100 dark:bg-slate-900 sticky top-0 z-10">
                                    <tr>
                                        <th className="p-4 font-black text-slate-500 uppercase text-xs">Módulo</th>
                                        {PERMISSION_ACTIONS.map(act => <th key={act.key} className="p-4 text-center font-black text-slate-500 uppercase text-xs w-24">{act.label}</th>)}
                                    </tr>
                                </thead>
                                <tbody>
                                    {SYSTEM_MODULES.map(mod => (
                                        <tr key={mod.key} className="border-t dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900/50">
                                            <td className="p-4 font-bold text-slate-700 dark:text-slate-300">{mod.label}</td>
                                            {PERMISSION_ACTIONS.map(act => {
                                                const applies = !act.onlyModules || act.onlyModules.includes(mod.key);
                                                if (!applies) {
                                                    return <td key={act.key} className="p-4 text-center"><span className="block w-8 h-8 mx-auto rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-dashed border-slate-200 dark:border-slate-700"/></td>;
                                                }
                                                const active = (matrix[mod.key] || []).includes(act.key);
                                                return (
                                                    <td key={act.key} className="p-4 text-center">
                                                        <button type="button" onClick={() => togglePermission(mod.key, act.key)} className={`w-8 h-8 rounded-lg flex items-center justify-center mx-auto transition-all ${active ? 'bg-indigo-600 text-white shadow-lg' : 'bg-slate-100 dark:bg-slate-700 text-slate-300'}`}>
                                                            {active && <Check size={16}/>}
                                                        </button>
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div className="mt-6 flex justify-end gap-3">
                            <button onClick={() => setIsModalOpen(false)} className="px-6 py-3 font-bold text-slate-500">Cancelar</button>
                            <button onClick={handleSave} className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-black flex items-center gap-2 hover:bg-indigo-700 shadow-lg"><Save size={18}/> GUARDAR ROL</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
