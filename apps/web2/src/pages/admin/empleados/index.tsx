
import Link from 'next/link';
import React, { useState, useEffect } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import EmployeeLegajoForm from '@/components/admin/employees/EmployeeLegajoForm';
import { employeeService, Employee } from '@/services/employeeService';
import { agreementService } from '@/services/agreementService';
import { auditService } from '@/services/auditService';
import { db, auth } from '@/lib/firebase';
import { collection, getDocs, getDoc, doc, addDoc, updateDoc, query, where } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { sendPasswordResetEmail } from 'firebase/auth';
import { useToast } from '@/context/ToastContext';
import { useEmpresa } from '@/context/EmpresaContext';
import { filterRowsByEmpresa, belongsToEmpresaView, shouldScopeQueriesToEmpresa, stampEmpresaId } from '@/lib/multiempresa';
import { buildEmployeeSavePayload, initialLegajoForm, mapFirestoreToLegajoForm, normalizeEmployeeStatus } from '@/lib/employees/employeeLegajoDefaults';
import {
  Search, Plus, Edit2, Trash2, MapPin,
  FileBadge, UserCheck, UserX, Send, KeyRound,
  CheckSquare, Square, CheckCircle2, Clock, AlertCircle,
  Loader2, Mail, ShieldCheck, LayoutGrid, List, ExternalLink
} from 'lucide-react';

type ListViewMode = 'cards' | 'table';

const isEmployeeActive = (status: string | undefined) => {
  const s = (status || '').toLowerCase();
  return s === 'active' || s === 'activo';
};

export default function EmployeesPage() {
  const { addToast } = useToast();
  const { empresaId, empresa } = useEmpresa();
  const migracionCompleta = empresa?.migracionCompleta ?? false;
  const scopeEmpresa = shouldScopeQueriesToEmpresa(empresaId, migracionCompleta);
  const [view, setView] = useState<'list' | 'form'>('list');
  const [listViewMode, setListViewMode] = useState<ListViewMode>('cards');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [filteredEmployees, setFilteredEmployees] = useState<Employee[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(false);
  const [clients, setClients] = useState<any[]>([]);
  const [allObjectives, setAllObjectives] = useState<any[]>([]);
  const [agreements, setAgreements] = useState<any[]>([]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sendingIds, setSendingIds] = useState<Set<string>>(new Set());
  const [sendingAll, setSendingAll] = useState(false);

  const [form, setForm] = useState<any>({ ...initialLegajoForm });

  useEffect(() => { loadData(); loadClientsAndObjectives(); loadAgreements(); }, [empresaId, migracionCompleta]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const term = searchTerm.toLowerCase();
    setFilteredEmployees(employees.filter(e =>
      e.lastName.toLowerCase().includes(term) ||
      e.firstName.toLowerCase().includes(term) ||
      e.fileNumber.includes(term) ||
      (e.email || '').toLowerCase().includes(term) ||
      (e.dni || '').includes(term)
    ));
  }, [searchTerm, employees]);

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
          status: normalizeEmployeeStatus(raw.status || raw.estado),
          laborAgreement: raw.laborAgreement || raw.convenio || 'SUVICO',
          preferredClientId: raw.preferredClientId || '',
          preferredObjectiveId: raw.preferredObjectiveId || '',
          genero: raw.genero || '',
          portalInvite: raw.portalInvite || null,
          empresaId: raw.empresaId || '',
        } as Employee & { empresaId: string; genero?: string };
      });
      setEmployees(filterRowsByEmpresa(data, empresaId, scopeEmpresa, migracionCompleta) as Employee[]);
    } catch (e) {
      console.error('Error cargando empleados:', e);
    }
  };

  const loadAgreements = async () => {
    try {
      const data = await agreementService.getAll();
      setAgreements(data.map(a => ({
        ...a,
        categories: Array.isArray(a.categories) ? a.categories : [],
      })));
    } catch (e) {
      console.error('Error cargando convenios', e);
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
      const functions = getFunctions();
      const createPortalAccess = httpsCallable(functions, 'createPortalAccess');
      const result: any = await createPortalAccess({ employeeIds: validIds });
      const results: any[] = result.data?.results || [];

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

  const handleSave = async () => {
    if (!form.lastName || !form.firstName || !form.dni) return addToast('Datos incompletos (nombre, apellido, DNI)', 'error');
    const dataToSave = buildEmployeeSavePayload(form, empresaId);

    try {
      if (isEditing && form.id) {
        if (form.dni && employees.some(e => e.id !== form.id && e.dni === form.dni))
          return addToast('Ya existe un empleado con ese DNI', 'error');
        if (form.fileNumber && employees.some(e => e.id !== form.id && e.fileNumber === form.fileNumber))
          return addToast('Ya existe un empleado con ese número de legajo', 'error');
        await updateDoc(doc(db, 'empleados', form.id), dataToSave);
        await auditService.log('EDICION_EMPLEADO', 'RRHH', { id: form.id, ...dataToSave });
        addToast('Legajo actualizado', 'success');
      } else {
        if (form.dni && employees.some(e => e.dni === form.dni))
          return addToast('Ya existe un empleado con ese DNI', 'error');
        if (form.fileNumber && employees.some(e => e.fileNumber === form.fileNumber))
          return addToast('Ya existe un empleado con ese número de legajo', 'error');
        const id = await addDoc(collection(db, 'empleados'), stampEmpresaId({ ...dataToSave, createdAt: new Date().toISOString() }, empresaId));
        await auditService.log('ALTA_EMPLEADO', 'RRHH', { ...dataToSave, id: id.id });
        addToast('Legajo creado', 'success');
      }
      loadData();
      setView('list');
    } catch (e) {
      console.error(e);
      addToast('Error al guardar', 'error');
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('¿Eliminar legajo?')) {
      const empToDelete = employees.find(e => e.id === id);
      await auditService.log('BAJA_EMPLEADO', 'RRHH', { ...empToDelete });
      if (empToDelete?.uid) {
        try {
          const fn = httpsCallable(getFunctions(), 'manageEmployees');
          await fn({ action: 'DELETE_EMPLOYEE', payload: { uid: empToDelete.uid } });
        } catch (e) {
          console.warn('No se pudo eliminar credencial Auth:', e);
        }
      }
      await employeeService.delete(id);
      loadData();
      addToast('Legajo eliminado', 'info');
    }
  };

  const openNew = () => {
    setForm({ ...initialLegajoForm });
    setIsEditing(false);
    setView('form');
  };

  const openEdit = async (emp: Employee) => {
    if (!emp.id) return;
    setLoadingEdit(true);
    try {
      const snap = await getDoc(doc(db, 'empleados', emp.id));
      if (!snap.exists()) {
        addToast('Legajo no encontrado', 'error');
        return;
      }
      let mapped = mapFirestoreToLegajoForm(snap.id, snap.data() as Record<string, any>);
      if (!mapped.preferredClientId && mapped.preferredObjectiveId) {
        const obj = allObjectives.find(o => o.id === mapped.preferredObjectiveId);
        if (obj?.clientId) mapped = { ...mapped, preferredClientId: obj.clientId };
      }
      setForm(mapped);
      setIsEditing(true);
      setView('form');
    } catch (e) {
      console.error(e);
      addToast('Error cargando legajo', 'error');
    } finally {
      setLoadingEdit(false);
    }
  };

  const withInvite = employees.filter(e => e.portalInvite?.sent).length;
  const withEmail = employees.filter(e => e.email).length;
  const pending = employees.filter(e => !e.portalInvite?.sent && e.email).length;

  const renderPortalBadge = (emp: Employee) => {
    const hasSent = !!emp.portalInvite?.sent;
    const hasEmail = !!emp.email;
    if (hasSent) {
      return (
        <span className="flex items-center gap-1 text-[10px] font-black text-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800 whitespace-nowrap">
          <CheckCircle2 size={10} /> Enviado
        </span>
      );
    }
    if (hasEmail) {
      return (
        <span className="flex items-center gap-1 text-[10px] font-black text-amber-700 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded-full border border-amber-200 whitespace-nowrap">
          <Clock size={10} /> Pendiente
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1 text-[10px] font-black text-slate-400 bg-slate-50 dark:bg-slate-700 px-2 py-0.5 rounded-full border border-slate-200 dark:border-slate-600 whitespace-nowrap">
        <AlertCircle size={10} /> Sin email
      </span>
    );
  };

  const renderActions = (emp: Employee, isSending: boolean) => (
    <div className="flex gap-1" onClick={e => e.stopPropagation()}>
      {emp.email && (
        <button
          onClick={() => handleSendOne(emp)}
          disabled={isSending}
          className="p-1.5 rounded-lg text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors disabled:opacity-50"
          title={emp.portalInvite?.sent ? 'Reenviar acceso' : 'Enviar acceso'}
        >
          {isSending ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />}
        </button>
      )}
      <Link href={`/admin/empleados/${emp.id}`}
        className="p-1.5 rounded-lg text-indigo-500 hover:bg-indigo-50 transition-colors"
        title="Ver perfil completo"
      >
        <ExternalLink size={13} />
      </Link>
      <button
        onClick={() => openEdit(emp)}
        disabled={loadingEdit}
        className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
      >
        <Edit2 size={13} />
      </button>
      <button onClick={() => handleDelete(emp.id!)} className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors">
        <Trash2 size={13} />
      </button>
    </div>
  );

  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in">

        <header className="flex justify-between items-end">
          <div>
            <h1 className="text-4xl font-black text-slate-900 dark:text-white uppercase tracking-tighter">Personal</h1>
            <p className="text-slate-500 dark:text-slate-400 mt-1 font-medium">Gestión de Legajos y Dotación.</p>
          </div>
          {view === 'list' && (
            <button onClick={openNew} className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-black text-xs uppercase shadow-sm hover:scale-105 transition-all flex gap-2">
              <Plus size={16} /> Nuevo Legajo
            </button>
          )}
        </header>

        {view === 'list' && (
          <>
            <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border dark:border-slate-700 flex items-center gap-4 shadow-sm">
              <Search className="text-slate-400 shrink-0" />
              <input
                placeholder="Buscar por nombre, apellido, legajo, DNI o email..."
                className="flex-1 bg-transparent outline-none font-bold text-slate-700 dark:text-white uppercase"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
              <div className="flex items-center gap-1 border-l dark:border-slate-700 pl-3 shrink-0">
                <button
                  type="button"
                  onClick={() => setListViewMode('cards')}
                  title="Vista tarjetas"
                  className={`p-2 rounded-lg transition-colors ${listViewMode === 'cards' ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                >
                  <LayoutGrid size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => setListViewMode('table')}
                  title="Vista tabla"
                  className={`p-2 rounded-lg transition-colors ${listViewMode === 'table' ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                >
                  <List size={16} />
                </button>
              </div>
              <div className="text-xs font-black text-slate-300 uppercase px-2 border-l dark:border-slate-700 shrink-0">
                {filteredEmployees.length} Pax
              </div>
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-xl border dark:border-slate-700 shadow-sm overflow-hidden">
              <div className="p-4 border-b dark:border-slate-700 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-indigo-100 dark:bg-indigo-900/40 rounded-lg flex items-center justify-center">
                    <ShieldCheck size={16} className="text-indigo-600 dark:text-indigo-400" />
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
                      {sendingIds.size > 0 ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                      Enviar a {selected.size} seleccionado{selected.size > 1 ? 's' : ''}
                    </button>
                  )}
                  <button
                    onClick={handleSendAllPending}
                    disabled={sendingAll || pending === 0}
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-black uppercase transition-all"
                  >
                    {sendingAll ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
                    Enviar a todos sin acceso ({pending})
                  </button>
                  <button
                    onClick={toggleSelectAll}
                    className="flex items-center gap-2 px-3 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-black uppercase transition-all"
                  >
                    {selected.size === filteredEmployees.length && filteredEmployees.length > 0
                      ? <CheckSquare size={14} /> : <Square size={14} />}
                    {selected.size === filteredEmployees.length && filteredEmployees.length > 0 ? 'Deseleccionar' : 'Seleccionar todo'}
                  </button>
                </div>
              </div>

              {listViewMode === 'cards' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
                  {filteredEmployees.map(emp => {
                    const isSending = sendingIds.has(emp.id!);
                    const isSelected = selected.has(emp.id!);
                    const genero = (emp as any).genero;

                    return (
                      <div
                        key={emp.id}
                        onClick={() => emp.id && toggleSelect(emp.id)}
                        className={`bg-white dark:bg-slate-800 p-5 rounded-xl border-2 shadow-sm hover:shadow-md transition-all cursor-pointer group relative overflow-hidden
                          ${isSelected ? 'border-indigo-400 ring-2 ring-indigo-200 dark:ring-indigo-800' : 'border-slate-100 dark:border-slate-700 hover:border-indigo-200'}`}
                      >
                        <div className="absolute top-4 left-4">
                          {isSelected
                            ? <CheckSquare size={16} className="text-indigo-600" />
                            : <Square size={16} className="text-slate-300 group-hover:text-slate-400" />}
                        </div>
                        <div className={`absolute top-4 right-4 ${isEmployeeActive(emp.status) ? 'text-emerald-500' : 'text-rose-500'}`}>
                          {isEmployeeActive(emp.status) ? <UserCheck size={16} /> : <UserX size={16} />}
                        </div>
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
                          <div className="flex items-center gap-2 text-xs font-bold text-slate-400"><FileBadge size={12} /> Legajo: {emp.fileNumber || 'S/N'}</div>
                          {emp.email
                            ? <div className="flex items-center gap-2 text-xs font-bold text-slate-400 truncate"><Mail size={12} /> {emp.email}</div>
                            : <div className="flex items-center gap-2 text-xs font-bold text-rose-400"><AlertCircle size={12} /> Sin email registrado</div>
                          }
                          <div className="flex items-center gap-2 text-xs font-bold text-slate-400"><MapPin size={12} /> {allObjectives.find(o => o.id === emp.preferredObjectiveId)?.name || 'Sin asignar'}</div>
                          {genero && <div className="text-xs font-bold text-slate-400">Género: {genero === 'M' ? 'Masculino' : genero === 'F' ? 'Femenino' : genero}</div>}
                        </div>
                        <div className="flex items-center justify-between">
                          {renderPortalBadge(emp)}
                          {renderActions(emp, isSending)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 dark:bg-slate-900 border-b dark:border-slate-700">
                      <tr>
                        <th className="p-3 w-10">
                          <button type="button" onClick={toggleSelectAll} className="text-slate-400 hover:text-indigo-600">
                            {selected.size === filteredEmployees.length && filteredEmployees.length > 0
                              ? <CheckSquare size={16} className="text-indigo-600" />
                              : <Square size={16} />}
                          </button>
                        </th>
                        <th className="p-3 text-[10px] font-black uppercase text-slate-400">Legajo</th>
                        <th className="p-3 text-[10px] font-black uppercase text-slate-400">Apellido</th>
                        <th className="p-3 text-[10px] font-black uppercase text-slate-400">Nombre</th>
                        <th className="p-3 text-[10px] font-black uppercase text-slate-400">DNI</th>
                        <th className="p-3 text-[10px] font-black uppercase text-slate-400">Email</th>
                        <th className="p-3 text-[10px] font-black uppercase text-slate-400">Categoría</th>
                        <th className="p-3 text-[10px] font-black uppercase text-slate-400">Género</th>
                        <th className="p-3 text-[10px] font-black uppercase text-slate-400">Objetivo</th>
                        <th className="p-3 text-[10px] font-black uppercase text-slate-400">Estado</th>
                        <th className="p-3 text-[10px] font-black uppercase text-slate-400">Portal</th>
                        <th className="p-3 text-[10px] font-black uppercase text-slate-400 text-right">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                      {filteredEmployees.map(emp => {
                        const isSending = sendingIds.has(emp.id!);
                        const isSelected = selected.has(emp.id!);
                        const genero = (emp as any).genero;
                        return (
                          <tr
                            key={emp.id}
                            className={`hover:bg-slate-50 dark:hover:bg-slate-700/30 ${isSelected ? 'bg-indigo-50/50 dark:bg-indigo-900/10' : ''}`}
                          >
                            <td className="p-3">
                              <button type="button" onClick={() => emp.id && toggleSelect(emp.id)}>
                                {isSelected ? <CheckSquare size={16} className="text-indigo-600" /> : <Square size={16} className="text-slate-300" />}
                              </button>
                            </td>
                            <td className="p-3 font-mono text-xs font-bold text-slate-600 dark:text-slate-300">{emp.fileNumber}</td>
                            <td className="p-3 font-black uppercase text-slate-800 dark:text-white">{emp.lastName}</td>
                            <td className="p-3 font-bold uppercase text-slate-600 dark:text-slate-300">{emp.firstName}</td>
                            <td className="p-3 font-mono text-xs text-slate-500">{emp.dni}</td>
                            <td className="p-3 text-xs text-slate-500 max-w-[160px] truncate">{emp.email || '—'}</td>
                            <td className="p-3 text-xs font-bold uppercase text-slate-500">{emp.category}</td>
                            <td className="p-3 text-xs font-mono text-slate-500">{genero === 'M' ? 'M' : genero === 'F' ? 'F' : '—'}</td>
                            <td className="p-3 text-xs text-slate-500 max-w-[140px] truncate">{allObjectives.find(o => o.id === emp.preferredObjectiveId)?.name || '—'}</td>
                            <td className="p-3">
                              <span className={`inline-flex items-center gap-1 text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${isEmployeeActive(emp.status) ? 'text-emerald-700 bg-emerald-50 dark:bg-emerald-900/30' : 'text-rose-700 bg-rose-50 dark:bg-rose-900/30'}`}>
                                {isEmployeeActive(emp.status) ? 'Activo' : 'Inactivo'}
                              </span>
                            </td>
                            <td className="p-3">{renderPortalBadge(emp)}</td>
                            <td className="p-3 text-right">{renderActions(emp, isSending)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {filteredEmployees.length === 0 && (
                    <p className="p-8 text-center text-slate-400 text-sm font-bold">No hay empleados que coincidan con la búsqueda.</p>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {view === 'form' && (
          <EmployeeLegajoForm
            form={form}
            setForm={setForm}
            isEditing={isEditing}
            onCancel={() => setView('list')}
            onSave={handleSave}
            agreements={agreements}
            allObjectives={allObjectives}
            clients={clients}
            employees={employees}
            addToast={addToast}
          />
        )}
      </div>
    </DashboardLayout>
  );
}
