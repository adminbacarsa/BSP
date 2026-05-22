
import React, { useState, useEffect } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { employeeService, Employee } from '@/services/employeeService';
import { auditService } from '@/services/auditService';
import { db, auth } from '@/lib/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { sendPasswordResetEmail } from 'firebase/auth';
import { useToast } from '@/context/ToastContext';
import { useEmpresa } from '@/context/EmpresaContext';
import { filterRowsByEmpresa, belongsToEmpresaView, shouldScopeQueriesToEmpresa, stampEmpresaId } from '@/lib/multiempresa';
import {
  Users, Search, Plus, Edit2, Trash2, MapPin,
  FileBadge, UserCheck, UserX, Send, KeyRound,
  CheckSquare, Square, CheckCircle2, Clock, AlertCircle,
  Loader2, Mail, ShieldCheck
} from 'lucide-react';

export default function EmployeesPage() {
  const { addToast } = useToast();
  const { empresaId, empresa } = useEmpresa();
  const migracionCompleta = empresa?.migracionCompleta ?? false;
  const scopeEmpresa = shouldScopeQueriesToEmpresa(empresaId, migracionCompleta);
  const [view, setView] = useState<'list' | 'form'>('list');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [filteredEmployees, setFilteredEmployees] = useState<Employee[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [clients, setClients] = useState<any[]>([]);
  const [allObjectives, setAllObjectives] = useState<any[]>([]);
  const [filteredObjectives, setFilteredObjectives] = useState<any[]>([]);

  // Invitaciones
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sendingIds, setSendingIds] = useState<Set<string>>(new Set());
  const [sendingAll, setSendingAll] = useState(false);

  const initialForm: any = {
    firstName: '', lastName: '', dni: '', fileNumber: '',
    phone: '', email: '', category: 'Vigilador', status: 'active',
    laborAgreement: 'SUVICO',
    preferredClientId: '', preferredObjectiveId: ''
  };
  const [form, setForm] = useState<any>(initialForm);

  useEffect(() => { loadData(); loadClientsAndObjectives(); }, [empresaId, migracionCompleta]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const term = searchTerm.toLowerCase();
    setFilteredEmployees(employees.filter(e =>
      e.lastName.toLowerCase().includes(term) ||
      e.firstName.toLowerCase().includes(term) ||
      e.fileNumber.includes(term) ||
      (e.email || '').toLowerCase().includes(term)
    ));
  }, [searchTerm, employees]);

  useEffect(() => {
    if (form.preferredClientId) {
      const objs = allObjectives.filter(o => o.clientId === form.preferredClientId);
      setFilteredObjectives(objs);
    } else {
      setFilteredObjectives([]);
    }
  }, [form.preferredClientId, allObjectives]);

  const loadData = async () => {
    try {
      const snap = await getDocs(
        scopeEmpresa
          ? query(collection(db, 'empleados'), where('empresaId', '==', empresaId))
          : collection(db, 'empleados'),
      );
      const data = snap.docs.map(d => {
        const raw = d.data();
        const fName = raw.firstName || raw.nombre || '';
        const lName = raw.lastName || raw.apellido || '';
        return {
          id: d.id,
          uid: raw.uid || '',
          firstName: fName || 'Sin Nombre',
          lastName: lName || '',
          dni: raw.dni || raw.document || 'S/D',
          cuil: raw.cuil || '',
          startDate: raw.startDate || raw.fechaIngreso || '',
          cycleStartDay: raw.cycleStartDay || 1,
          fileNumber: raw.fileNumber || raw.legajo || 'S/N',
          phone: raw.phone || raw.telefono || '',
          email: raw.email || '',
          category: raw.category || raw.cargo || 'Vigilador',
          status: raw.status || raw.estado || 'active',
          laborAgreement: raw.laborAgreement || raw.convenio || 'SUVICO',
          preferredClientId: raw.preferredClientId || '',
          preferredObjectiveId: raw.preferredObjectiveId || '',
          portalInvite: raw.portalInvite || null,
          empresaId: raw.empresaId || '',
        } as Employee & { empresaId: string };
      });
      setEmployees(filterRowsByEmpresa(data, empresaId, scopeEmpresa, migracionCompleta) as Employee[]);
    } catch (e) {
      console.error('Error cargando empleados:', e);
    }
  };

  const loadClientsAndObjectives = async () => {
    try {
      const cSnap = await getDocs(
        scopeEmpresa
          ? query(collection(db, 'clients'), where('empresaId', '==', empresaId))
          : collection(db, 'clients'),
      );
      setClients(
        cSnap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(c => belongsToEmpresaView(c as any, empresaId, migracionCompleta)),
      );
      const sSnap = await getDocs(query(collection(db, 'servicios_sla'), where('status', '==', 'active')));
      const oList = filterRowsByEmpresa(
        sSnap.docs.map(d => {
          const data = d.data();
          return { id: data.objectiveId || d.id, name: data.objectiveName || data.name, clientId: data.clientId, empresaId: data.empresaId || '' };
        }),
        empresaId, scopeEmpresa, migracionCompleta,
      );
      setAllObjectives(Array.from(new Map(oList.map(item => [item.id, item])).values()));
    } catch (e) { console.error('Error cargando clientes/objetivos', e); }
  };

  // ── ENVÍO DE INVITACIONES ────────────────────────────────────────────────────
  const sendInvites = async (empIds: string[]) => {
    const validIds = empIds.filter(id => {
      const emp = employees.find(e => e.id === id);
      return emp && emp.email;
    });

    if (!validIds.length) {
      addToast('Los empleados seleccionados no tienen email registrado', 'error');
      return;
    }

    try {
      // 1. Crear usuarios Firebase Auth vía Cloud Function
      const functions = getFunctions();
      const createPortalAccess = httpsCallable(functions, 'createPortalAccess');
      const result: any = await createPortalAccess({ employeeIds: validIds });
      const results: any[] = result.data?.results || [];

      // 2. Enviar email de reseteo de contraseña para cada uno exitoso
      let sent = 0, failed = 0;
      for (const r of results) {
        if (r.success && r.email) {
          try {
            await sendPasswordResetEmail(auth, r.email, {
              url: 'https://comtroldata.web.app/empleado/dashboard',
              handleCodeInApp: false,
            });
            sent++;
          } catch (emailErr: any) {
            console.error(`Error enviando email a ${r.email}:`, emailErr);
            failed++;
          }
        } else {
          failed++;
        }
      }

      if (sent > 0) addToast(`✓ ${sent} invitación${sent > 1 ? 'es' : ''} enviada${sent > 1 ? 's' : ''} correctamente`, 'success');
      if (failed > 0) addToast(`${failed} empleado${failed > 1 ? 's' : ''} sin email o con error`, 'error');

      await loadData();
      setSelected(new Set());
    } catch (err: any) {
      console.error('Error en createPortalAccess:', err);
      addToast('Error al crear accesos: ' + (err?.message || err), 'error');
    }
  };

  const handleSendSelected = async () => {
    if (!selected.size) return;
    const ids = Array.from(selected);
    setSendingIds(new Set(ids));
    await sendInvites(ids);
    setSendingIds(new Set());
  };

  const handleSendOne = async (emp: Employee) => {
    if (!emp.id) return;
    if (!emp.email) { addToast('Este empleado no tiene email registrado', 'error'); return; }
    setSendingIds(new Set([emp.id]));
    await sendInvites([emp.id]);
    setSendingIds(new Set());
  };

  const handleSendAllPending = async () => {
    const pending = employees.filter(e => !e.portalInvite?.sent && e.email).map(e => e.id!);
    if (!pending.length) { addToast('Todos los empleados con email ya tienen acceso enviado', 'info'); return; }
    setSendingAll(true);
    await sendInvites(pending);
    setSendingAll(false);
  };

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === filteredEmployees.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredEmployees.map(e => e.id!)));
    }
  };

  // ── CRUD ─────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!form.lastName || !form.firstName || !form.dni) return addToast('Datos incompletos', 'error');
    try {
      if (isEditing && form.id) {
        await employeeService.update(form.id, form);
        await auditService.log('EDICION_EMPLEADO', 'RRHH', { id: form.id, ...form });
        addToast('Legajo actualizado', 'success');
      } else {
        const id = await employeeService.add(stampEmpresaId({ ...form, createdAt: new Date().toISOString() }, empresaId) as any);
        await auditService.log('ALTA_EMPLEADO', 'RRHH', { ...form, id });
        addToast('Legajo creado', 'success');
      }
      loadData();
      setView('list');
    } catch (e) { addToast('Error al guardar', 'error'); }
  };

  const handleDelete = async (id: string) => {
    if (confirm('¿Eliminar legajo?')) {
      const empToDelete = employees.find(e => e.id === id);
      await auditService.log('BAJA_EMPLEADO', 'RRHH', { ...empToDelete });
      // Si tiene credenciales de portal, borrar usuario de Firebase Auth vía Cloud Function
      if (empToDelete?.uid) {
        try {
          const fn = httpsCallable(getFunctions(), 'manageEmployees');
          await fn({ action: 'DELETE_EMPLOYEE', payload: { uid: empToDelete.uid } });
        } catch (e) {
          console.warn('No se pudo eliminar credencial Auth:', e);
        }
      }
      // Siempre eliminar el documento Firestore por ID de documento
      await employeeService.delete(id);
      loadData();
      addToast('Legajo eliminado', 'info');
    }
  };

  const openNew = () => { setForm(initialForm); setIsEditing(false); setView('form'); };
  const openEdit = (emp: any) => { setForm(emp); setIsEditing(true); setView('form'); };

  // Contadores
  const withInvite = employees.filter(e => e.portalInvite?.sent).length;
  const withEmail  = employees.filter(e => e.email).length;
  const pending    = employees.filter(e => !e.portalInvite?.sent && e.email).length;

  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in">

        {/* HEADER */}
        <header className="flex justify-between items-end">
          <div>
            <h1 className="text-4xl font-black text-slate-900 dark:text-white uppercase tracking-tighter">Personal</h1>
            <p className="text-slate-500 dark:text-slate-400 mt-1 font-medium">Gestión de Legajos y Dotación.</p>
          </div>
          {view === 'list' && (
            <button onClick={openNew} className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-black text-xs uppercase shadow-xl hover:scale-105 transition-all flex gap-2">
              <Plus size={16}/> Nuevo Legajo
            </button>
          )}
        </header>

        {view === 'list' && (
          <>
            {/* BARRA DE BÚSQUEDA */}
            <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border dark:border-slate-700 flex items-center gap-4 shadow-sm">
              <Search className="text-slate-400 shrink-0"/>
              <input
                placeholder="Buscar por nombre, apellido, legajo o email..."
                className="flex-1 bg-transparent outline-none font-bold text-slate-700 dark:text-white uppercase"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
              <div className="text-xs font-black text-slate-300 uppercase px-4 border-l dark:border-slate-700 shrink-0">
                {filteredEmployees.length} Pax
              </div>
            </div>

            {/* PANEL DE ACCESO AL PORTAL */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl border dark:border-slate-700 shadow-sm overflow-hidden">
              <div className="p-4 border-b dark:border-slate-700 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-indigo-100 dark:bg-indigo-900/40 rounded-lg flex items-center justify-center">
                    <ShieldCheck size={16} className="text-indigo-600 dark:text-indigo-400"/>
                  </div>
                  <div>
                    <p className="text-sm font-black text-slate-800 dark:text-white">Acceso Portal Empleados</p>
                    <p className="text-[11px] text-slate-400">
                      {withInvite} con acceso · {pending} pendientes · {withEmail} con email registrado
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {selected.size > 0 && (
                    <button
                      onClick={handleSendSelected}
                      disabled={sendingIds.size > 0}
                      className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-xl text-xs font-black uppercase transition-all"
                    >
                      {sendingIds.size > 0 ? <Loader2 size={14} className="animate-spin"/> : <Send size={14}/>}
                      Enviar a {selected.size} seleccionado{selected.size > 1 ? 's' : ''}
                    </button>
                  )}
                  <button
                    onClick={handleSendAllPending}
                    disabled={sendingAll || pending === 0}
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-black uppercase transition-all"
                  >
                    {sendingAll ? <Loader2 size={14} className="animate-spin"/> : <Mail size={14}/>}
                    Enviar a todos sin acceso ({pending})
                  </button>
                  <button
                    onClick={toggleSelectAll}
                    className="flex items-center gap-2 px-3 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-black uppercase transition-all"
                  >
                    {selected.size === filteredEmployees.length && filteredEmployees.length > 0
                      ? <CheckSquare size={14}/> : <Square size={14}/>}
                    {selected.size === filteredEmployees.length && filteredEmployees.length > 0 ? 'Deseleccionar' : 'Seleccionar todo'}
                  </button>
                </div>
              </div>

              {/* GRILLA DE EMPLEADOS */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
                {filteredEmployees.map(emp => {
                  const hasSent = !!emp.portalInvite?.sent;
                  const hasEmail = !!emp.email;
                  const isSending = sendingIds.has(emp.id!);
                  const isSelected = selected.has(emp.id!);

                  return (
                    <div
                      key={emp.id}
                      onClick={() => emp.id && toggleSelect(emp.id)}
                      className={`bg-white dark:bg-slate-800 p-5 rounded-[2rem] border-2 shadow-sm hover:shadow-md transition-all cursor-pointer group relative overflow-hidden
                        ${isSelected ? 'border-indigo-400 ring-2 ring-indigo-200 dark:ring-indigo-800' : 'border-slate-100 dark:border-slate-700 hover:border-indigo-200'}`}
                    >
                      {/* Checkbox */}
                      <div className="absolute top-4 left-4">
                        {isSelected
                          ? <CheckSquare size={16} className="text-indigo-600"/>
                          : <Square size={16} className="text-slate-300 group-hover:text-slate-400"/>}
                      </div>

                      {/* Estado activo/inactivo */}
                      <div className={`absolute top-4 right-4 ${emp.status === 'active' ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {emp.status === 'active' ? <UserCheck size={16}/> : <UserX size={16}/>}
                      </div>

                      {/* Info */}
                      <div className="flex items-center gap-3 mb-3 mt-1 pl-4">
                        <div className="w-10 h-10 bg-slate-100 dark:bg-slate-700 rounded-full flex items-center justify-center font-black text-slate-500 dark:text-slate-300 text-sm shrink-0">
                          {emp.firstName.charAt(0)}{emp.lastName.charAt(0)}
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-black text-slate-800 dark:text-white uppercase leading-tight truncate">{emp.lastName}</h3>
                          <p className="font-bold text-slate-500 text-xs uppercase truncate">{emp.firstName}</p>
                          <span className="text-[9px] bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 px-1.5 py-0.5 rounded font-black uppercase mt-0.5 inline-block">{emp.category}</span>
                        </div>
                      </div>

                      <div className="space-y-1.5 border-t dark:border-slate-700 pt-3 mb-3">
                        <div className="flex items-center gap-2 text-xs font-bold text-slate-400"><FileBadge size={12}/> Legajo: {emp.fileNumber || 'S/N'}</div>
                        {emp.email
                          ? <div className="flex items-center gap-2 text-xs font-bold text-slate-400 truncate"><Mail size={12}/> {emp.email}</div>
                          : <div className="flex items-center gap-2 text-xs font-bold text-rose-400"><AlertCircle size={12}/> Sin email registrado</div>
                        }
                        <div className="flex items-center gap-2 text-xs font-bold text-slate-400"><MapPin size={12}/> {allObjectives.find(o => o.id === emp.preferredObjectiveId)?.name || 'Sin asignar'}</div>
                      </div>

                      {/* Estado de invitación */}
                      <div className="flex items-center justify-between">
                        {hasSent ? (
                          <span className="flex items-center gap-1.5 text-[10px] font-black text-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 px-2.5 py-1 rounded-full border border-emerald-200 dark:border-emerald-800">
                            <CheckCircle2 size={11}/> Acceso enviado
                          </span>
                        ) : hasEmail ? (
                          <span className="flex items-center gap-1.5 text-[10px] font-black text-amber-700 bg-amber-50 dark:bg-amber-900/20 px-2.5 py-1 rounded-full border border-amber-200">
                            <Clock size={11}/> Pendiente
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5 text-[10px] font-black text-slate-400 bg-slate-50 dark:bg-slate-700 px-2.5 py-1 rounded-full border border-slate-200 dark:border-slate-600">
                            <AlertCircle size={11}/> Sin email
                          </span>
                        )}

                        <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                          {hasEmail && (
                            <button
                              onClick={() => handleSendOne(emp)}
                              disabled={isSending}
                              className="p-1.5 rounded-lg text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors disabled:opacity-50"
                              title={hasSent ? 'Reenviar acceso' : 'Enviar acceso'}
                            >
                              {isSending ? <Loader2 size={13} className="animate-spin"/> : <KeyRound size={13}/>}
                            </button>
                          )}
                          <button onClick={() => openEdit(emp)} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                            <Edit2 size={13}/>
                          </button>
                          <button onClick={() => handleDelete(emp.id!)} className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors">
                            <Trash2 size={13}/>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* FORMULARIO */}
        {view === 'form' && (
          <div className="bg-white dark:bg-slate-800 p-8 rounded-[3rem] border dark:border-slate-700 animate-in slide-in-from-right-4">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-2xl font-black text-slate-900 dark:text-white uppercase">{isEditing ? 'Editar Legajo' : 'Alta de Personal'}</h2>
              <button onClick={() => setView('list')} className="text-slate-400 font-bold uppercase text-xs">Cancelar</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div><label className="text-[10px] font-black uppercase text-slate-400 ml-1">Nombre</label><input className="w-full p-4 border dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-2xl font-bold" value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })}/></div>
              <div><label className="text-[10px] font-black uppercase text-slate-400 ml-1">Apellido</label><input className="w-full p-4 border dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-2xl font-bold" value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })}/></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
              <div><label className="text-[10px] font-black uppercase text-slate-400 ml-1">DNI</label><input className="w-full p-4 border dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-2xl font-bold" value={form.dni} onChange={e => setForm({ ...form, dni: e.target.value })}/></div>
              <div><label className="text-[10px] font-black uppercase text-slate-400 ml-1">Legajo</label><input className="w-full p-4 border dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-2xl font-bold" value={form.fileNumber} onChange={e => setForm({ ...form, fileNumber: e.target.value })}/></div>
              <div>
                <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Categoría</label>
                <select className="w-full p-4 border dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-2xl font-bold" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                  <option value="Vigilador">Vigilador</option>
                  <option value="Supervisor">Supervisor</option>
                  <option value="Monitoreo">Monitoreo</option>
                  <option value="Custodia">Custodia</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div><label className="text-[10px] font-black uppercase text-slate-400 ml-1">Email</label><input type="email" className="w-full p-4 border dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-2xl font-bold" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}/></div>
              <div><label className="text-[10px] font-black uppercase text-slate-400 ml-1">Teléfono</label><input className="w-full p-4 border dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-2xl font-bold" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}/></div>
            </div>

            <div className="bg-slate-50 dark:bg-slate-900/50 p-6 rounded-3xl border dark:border-slate-700 mb-6">
              <h3 className="text-sm font-black uppercase text-indigo-500 mb-4 flex items-center gap-2"><MapPin size={16}/> Dotación Fija (Objetivo Preferido)</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Cliente</label>
                  <select className="w-full p-4 border dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-2xl font-bold" value={form.preferredClientId || ''} onChange={e => setForm({ ...form, preferredClientId: e.target.value, preferredObjectiveId: '' })}>
                    <option value="">- Sin Asignar -</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name || c.razonSocial}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Objetivo</label>
                  <select className="w-full p-4 border dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-2xl font-bold" value={form.preferredObjectiveId || ''} onChange={e => setForm({ ...form, preferredObjectiveId: e.target.value })} disabled={!form.preferredClientId}>
                    <option value="">- Sin Asignar -</option>
                    {filteredObjectives.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-6 border-t dark:border-slate-700">
              <button onClick={handleSave} className="bg-slate-900 dark:bg-white dark:text-slate-900 text-white px-8 py-3 rounded-xl font-black uppercase text-xs shadow-xl hover:scale-105 transition-transform">
                Guardar Legajo
              </button>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
