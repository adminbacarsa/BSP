import React, { useMemo, useState, useEffect } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { slaService, ServiceSLA, ServicePosition, ShiftVariant } from '@/services/slaService'; 
import { useToast } from '@/context/ToastContext';
import { db } from '@/lib/firebase';
import { getAuth, onAuthStateChanged } from 'firebase/auth'; 
import { collection, addDoc, serverTimestamp, onSnapshot, query, orderBy } from 'firebase/firestore'; 
import { 
  Shield, Calendar, Users, Plus, Trash2, Edit2, 
  Search, Save, X, MapPin, Briefcase, Table, Settings, 
  AlertCircle, Info, Sun, Moon, Activity, RotateCw, CheckCircle, FileText
} from 'lucide-react';

// --- 1. MODELO DE DATOS ---

// ✅ PRESETS (SUVICO/CCT 422/05)
const SHIFT_VARIANTS_DB: Record<string, ShiftVariant> = {
    'M': { code: 'M', name: 'Mañana', startTime: '07:00', endTime: '15:00', hours: 8 },
    'T': { code: 'T', name: 'Tarde', startTime: '15:00', endTime: '23:00', hours: 8 }, // Incluye 2h nocturnas (21-23)
    'N': { code: 'N', name: 'Noche', startTime: '23:00', endTime: '07:00', hours: 8 },
    'D12': { code: 'D12', name: 'Diurno 12h', startTime: '07:00', endTime: '19:00', hours: 12 },
    'N12': { code: 'N12', name: 'Nocturno 12h', startTime: '19:00', endTime: '07:00', hours: 12 }, // Incluye 9h nocturnas (21-06)
};

export default function ServiciosSLAPage() {
  const { addToast } = useToast();
  
  // ESTADOS
  const [currentUserName, setCurrentUserName] = useState("Cargando...");
  const [dbStatus, setDbStatus] = useState<'online' | 'offline'>('offline');
  const [loading, setLoading] = useState(false);
  
  const [view, setView] = useState<'list' | 'form'>('list');
  const [services, setServices] = useState<ServiceSLA[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [availableObjectives, setAvailableObjectives] = useState<any[]>([]);
  const [filteredServices, setFilteredServices] = useState<ServiceSLA[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  // Fechas por defecto
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0];

  const [form, setForm] = useState<ServiceSLA>({
    clientId: '', clientName: '', objectiveId: '', objectiveName: '',
    startDate: firstDay, endDate: lastDay,
    positions: [], totalMonthlyHours: 0, status: 'active'
  });

  const [showPositionModal, setShowPositionModal] = useState(false);
  const [positionForm, setPositionForm] = useState<ServicePosition>({
    id: '', name: 'Puesto 1', coverageType: '24hs', quantity: 1, 
    activeDays: ['L','M','X','J','V','S','D'], allowedShiftTypes: []
  });

  const [newCustomShift, setNewCustomShift] = useState<{
      name: string; start: string; end: string; code: string; days: string[]
  }>({ 
      name: '', start: '20:00', end: '05:00', code: '', days: ['V', 'S'] 
  });

  const [isEditing, setIsEditing] = useState(false);

  // --- EFECTOS ---
  
  useEffect(() => {
    const auth = getAuth();
    const unsubscribe = onAuthStateChanged(auth, (user) => {
        if (user) setCurrentUserName(user.displayName || user.email || "Usuario Crono");
        else setCurrentUserName("No Logueado");
    });
    return () => unsubscribe();
  }, []);

  // ✅ CORRECCIÓN ARQUITECTÓNICA: Colección 'servicios_sla'
  useEffect(() => {
      loadClients();
      
      try {
        setLoading(true);
        const q = query(collection(db, 'servicios_sla'), orderBy('clientName'));
        
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const adaptedData = snapshot.docs.map(doc => {
                const data = doc.data();
                return { 
                    id: doc.id, 
                    ...data, 
                    positions: data.positions || [] 
                } as ServiceSLA;
            });
            setServices(adaptedData);
            setDbStatus('online');
            setLoading(false);
        }, (error) => {
            console.error("Error RealTime:", error);
            setDbStatus('offline');
            setLoading(false);
            loadDataFallback();
        });

        return () => unsubscribe();
      } catch (e) {
          console.error("Error socket:", e);
          loadDataFallback();
      }
  }, []);

  const loadDataFallback = async () => {
    const data = await slaService.getAll();
    const adaptedData = data.map((d: any) => ({ ...d, positions: d.positions || [] }));
    setServices(adaptedData);
    setLoading(false);
  };

  const loadClients = async () => {
    try {
      const data = await slaService.getClients();
      setClients(data);
    } catch (e) {
      console.error("Error cargando clientes:", e);
      addToast('Error al cargar clientes', 'error');
    }
  };

  // Buscador
  useEffect(() => {
    const term = searchTerm.toLowerCase().trim();
    if (!term) { setFilteredServices(services); return; }
    const filtered = services.filter(s => {
      const client = (s.clientName || '').toLowerCase();
      const objective = (s.objectiveName || '').toLowerCase();
      return client.includes(term) || objective.includes(term);
    });
    setFilteredServices(filtered);
  }, [searchTerm, services]);

  // Auditoría en 'audit_logs'
  const registrarAuditoria = async (accion: string, detalle: string) => {
      try {
          const auth = getAuth();
          const currentUser = auth.currentUser;
          const actorName = currentUser?.displayName || currentUser?.email || "Sistema";
          const actorUid = currentUser?.uid || "SYSTEM";

          await addDoc(collection(db, 'audit_logs'), { 
              timestamp: serverTimestamp(),
              actorUid: actorUid,
              actorName: actorName,
              action: accion,
              module: 'SERVICIOS_SLA',
              details: detalle,
              metadata: { platform: 'web_admin_crono' }
          });
      } catch (error: any) {
          console.error("Error auditoría:", error);
      }
  };

  // --- MOTOR DE CÁLCULO LEGAL (CCT 422/05) ---
  const analyzeShiftComposition = (start: string, end: string) => {
    const [h1, m1] = start.split(':').map(Number);
    const [h2, m2] = end.split(':').map(Number);
    
    let startMin = h1 * 60 + m1;
    let endMin = h2 * 60 + m2;
    if (endMin < startMin) endMin += 24 * 60; 

    const durationMin = endMin - startMin;
    let nightMinutes = 0;

    // ✅ CORRECCIÓN LEGAL: 21:00 HS
    // Rango Nocturno: 21:00 (1260 min) a 06:00 (360 min)
    const NIGHT_START = 21 * 60; // 1260
    const NIGHT_END = 6 * 60;    // 360

    for (let t = startMin; t < endMin; t++) {
        const modT = t % 1440; 
        // Lógica: Es noche si es < 06:00 O >= 21:00
        if (modT < NIGHT_END || modT >= NIGHT_START) { 
            nightMinutes++;
        }
    }

    return {
        total: parseFloat((durationMin / 60).toFixed(2)),
        night: parseFloat((nightMinutes / 60).toFixed(2)),
        day: parseFloat(((durationMin - nightMinutes) / 60).toFixed(2))
    };
  };

  const calculateShiftHours = (start: string, end: string) => {
    return analyzeShiftComposition(start, end).total;
  };

  const calculateMonthlyBreakdown = (positions: ServicePosition[], startStr: string, endStr: string) => {
    if (!startStr || !endStr || positions.length === 0) return [];
    
    const sParts = startStr.split('-').map(Number);
    const eParts = endStr.split('-').map(Number);
    let current = new Date(sParts[0], sParts[1] - 1, sParts[2]);
    const end = new Date(eParts[0], eParts[1] - 1, eParts[2]);

    const JS_DAY_MAP = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
    const monthAccumulator: Record<string, { 
        name: string, days: number, totalHours: number, nightHours: number, weekendHours: number 
    }> = {};

    while (current <= end) {
        const year = current.getFullYear();
        const month = current.getMonth();
        const monthKey = `${year}-${month}`;
        const monthName = current.toLocaleString('es-ES', { month: 'long', year: 'numeric' });
        const dayIdx = current.getDay();
        const dayCode = JS_DAY_MAP[dayIdx];
        const isWeekend = (dayIdx === 0 || dayIdx === 6); // D y S

        if (!monthAccumulator[monthKey]) {
            monthAccumulator[monthKey] = { 
                name: monthName.charAt(0).toUpperCase() + monthName.slice(1), 
                days: 0, totalHours: 0, nightHours: 0, weekendHours: 0
            };
        }
        
        monthAccumulator[monthKey].days++;

        positions.forEach(pos => {
            let dayTotal = 0, dayNight = 0;
            const addVariant = (v: ShiftVariant) => {
                const comp = analyzeShiftComposition(v.startTime, v.endTime);
                dayTotal += comp.total;
                dayNight += comp.night;
            };

            if (pos.coverageType === '24hs') {
                addVariant(SHIFT_VARIANTS_DB['D12']);
                addVariant(SHIFT_VARIANTS_DB['N12']);
            }
            else if (pos.coverageType === '12hs_diurno') addVariant(SHIFT_VARIANTS_DB['D12']);
            else if (pos.coverageType === '12hs_nocturno') addVariant(SHIFT_VARIANTS_DB['N12']);
            else if (pos.coverageType === 'custom') {
                pos.allowedShiftTypes.forEach(shift => {
                    if (shift.days && shift.days.length > 0) {
                        if (shift.days.includes(dayCode)) addVariant(shift);
                    } else {
                        addVariant(shift); // Standard
                    }
                });
            }
            
            const q = pos.quantity;
            monthAccumulator[monthKey].totalHours += (dayTotal * q);
            monthAccumulator[monthKey].nightHours += (dayNight * q);
            if (isWeekend) monthAccumulator[monthKey].weekendHours += (dayTotal * q);
        });
        current.setDate(current.getDate() + 1);
    }
    return Object.values(monthAccumulator);
  };

  const monthlyBreakdown = useMemo(
    () => calculateMonthlyBreakdown(form.positions, form.startDate, form.endDate),
    [form.positions, form.startDate, form.endDate]
  );
  const totalContractHours = useMemo(
    () => Math.round(monthlyBreakdown.reduce((acc, curr) => acc + curr.totalHours, 0)),
    [monthlyBreakdown]
  );
  const totalNightHours = useMemo(
    () => Math.round(monthlyBreakdown.reduce((acc, curr) => acc + curr.nightHours, 0)),
    [monthlyBreakdown]
  );
  const totalWeekendHours = useMemo(
    () => Math.round(monthlyBreakdown.reduce((acc, curr) => acc + curr.weekendHours, 0)),
    [monthlyBreakdown]
  );

  const serviceTotals = useMemo(() => {
    const map = new Map<string, number>();
    filteredServices.forEach((srv) => {
      const breakdown = calculateMonthlyBreakdown(srv.positions, srv.startDate, srv.endDate);
      const total = Math.round(breakdown.reduce((acc, curr) => acc + curr.totalHours, 0));
      map.set(srv.id || `${srv.clientId}-${srv.objectiveId}-${srv.startDate}`, total);
    });
    return map;
  }, [filteredServices]);

  const parseDate = (dateStr: string) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    if (!y || !m || !d) return null;
    const date = new Date(y, m - 1, d);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const rangesOverlap = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) => {
    return aStart <= bEnd && aEnd >= bStart;
  };

  // --- MODAL Y UTILS ---
  const openAddPositionModal = () => {
      setPositionForm({
        id: '', name: 'Puesto 1', coverageType: '24hs', quantity: 1, 
        activeDays: ['L','M','X','J','V','S','D'], allowedShiftTypes: [] 
      });
      updateVariantsForCoverage('24hs', { ...positionForm, coverageType: '24hs' });
      setNewCustomShift({ name: '', start: '20:00', end: '05:00', code: '', days: ['V', 'S'] });
      setShowPositionModal(true);
  };

  const updateVariantsForCoverage = (type: string, currentFormState: ServicePosition) => {
      let variants: ShiftVariant[] = [];
      if (type === '24hs') variants = [SHIFT_VARIANTS_DB['M'], SHIFT_VARIANTS_DB['T'], SHIFT_VARIANTS_DB['N'], SHIFT_VARIANTS_DB['D12'], SHIFT_VARIANTS_DB['N12']];
      else if (type === '12hs_diurno') variants = [SHIFT_VARIANTS_DB['M'], SHIFT_VARIANTS_DB['D12']];
      else if (type === '12hs_nocturno') variants = [SHIFT_VARIANTS_DB['N'], SHIFT_VARIANTS_DB['N12']];
      
      setPositionForm({ ...currentFormState, allowedShiftTypes: type === 'custom' ? [] : variants, coverageType: type as any });
  };

  const handleCoverageTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
      const type = e.target.value;
      updateVariantsForCoverage(type, positionForm);
  };

  const toggleStandardVariant = (variantKey: string) => {
      const variant = SHIFT_VARIANTS_DB[variantKey];
      const exists = positionForm.allowedShiftTypes.find(v => v.code === variant.code && !v.isCustom);
      let newAllowed = [...positionForm.allowedShiftTypes];
      if (exists) newAllowed = newAllowed.filter(v => v.code !== variant.code || v.isCustom);
      else newAllowed.push(variant);
      setPositionForm({ ...positionForm, allowedShiftTypes: newAllowed });
  };

  const toggleNewShiftDay = (day: string) => {
      setNewCustomShift(prev => {
          const days = prev.days.includes(day) ? prev.days.filter(d => d !== day) : [...prev.days, day];
          return { ...prev, days };
      });
  };

  const addCustomShift = () => {
      if (!newCustomShift.name) return;
      const hours = calculateShiftHours(newCustomShift.start, newCustomShift.end);
      const code = newCustomShift.code || newCustomShift.name.substring(0,2).toUpperCase();
      
      const newVariant: ShiftVariant = {
          code, name: newCustomShift.name, startTime: newCustomShift.start, endTime: newCustomShift.end,
          hours, isCustom: true, days: newCustomShift.days 
      };

      setPositionForm(prev => ({ ...prev, allowedShiftTypes: [...prev.allowedShiftTypes, newVariant] }));
      setNewCustomShift(prev => ({ ...prev, name: '', code: '' })); 
  };

  const removeCustomVariant = (code: string) => {
      setPositionForm(prev => ({ ...prev, allowedShiftTypes: prev.allowedShiftTypes.filter(v => v.code !== code) }));
  };

  const handleSavePosition = () => {
      if (!positionForm.name) return addToast('Nombre requerido', 'error');
      if (positionForm.allowedShiftTypes.length === 0) return addToast('Seleccione al menos un turno', 'error');

      const newPosition = { ...positionForm, id: positionForm.id || Date.now().toString() };
      let updatedPositions = [...form.positions];
      if (positionForm.id) updatedPositions = updatedPositions.map(p => p.id === positionForm.id ? newPosition : p);
      else updatedPositions.push(newPosition);

      setForm({ ...form, positions: updatedPositions });
      setShowPositionModal(false);
  };

  const removePosition = (id: string) => {
      const updatedPositions = form.positions.filter(p => p.id !== id);
      setForm({ ...form, positions: updatedPositions });
  };

  const handleSave = async () => {
    if (!form.clientId) return addToast('Falta Cliente', 'error');
    if (!form.objectiveId) return addToast('Falta Objetivo', 'error');
    if (form.positions.length === 0) return addToast('Agregue al menos un puesto', 'error');

    const startDate = parseDate(form.startDate);
    const endDate = parseDate(form.endDate);
    if (!startDate || !endDate) return addToast('Fechas inválidas', 'error');
    if (startDate > endDate) return addToast('La fecha de inicio no puede ser mayor que la de fin', 'error');

    const objectiveValid = availableObjectives.some(o => o.id === form.objectiveId);
    if (!objectiveValid) return addToast('El objetivo no pertenece al cliente seleccionado', 'error');

    const hasOverlap = services.some(s => {
      if (!s.startDate || !s.endDate) return false;
      if (s.clientId !== form.clientId || s.objectiveId !== form.objectiveId) return false;
      if (isEditing && form.id && s.id === form.id) return false;
      const sStart = parseDate(s.startDate);
      const sEnd = parseDate(s.endDate);
      if (!sStart || !sEnd) return false;
      return rangesOverlap(startDate, endDate, sStart, sEnd);
    });
    if (hasOverlap) return addToast('Ya existe un SLA con fechas superpuestas para ese objetivo', 'error');

    const dataToSave = { ...form, totalMonthlyHours: totalContractHours } as any; 

    try {
      if (isEditing && form.id) {
          await slaService.update(form.id, dataToSave);
          await registrarAuditoria('UPDATE_CONTRACT', `Editó contrato: ${form.clientName} - ${form.objectiveName}`);
      } else {
          await slaService.add(dataToSave);
          await registrarAuditoria('CREATE_CONTRACT', `Creó contrato: ${form.clientName} - ${form.objectiveName}`);
      }
      addToast('Guardado correctamente', 'success');
      setView('list');
    } catch (e) { 
        addToast('Error al guardar', 'error'); 
        console.error(e);
    }
  };

  const handleEdit = (srv: ServiceSLA) => {
    setForm(srv);
    const client = clients.find(c => c.id === srv.clientId);
    if (client) setAvailableObjectives(client.objectives || []);
    setIsEditing(true); setView('form');
  };

  const handleDelete = async (id: string) => {
    const srv = services.find(s => s.id === id);
    if(confirm('¿Confirmar eliminación? Esta acción será auditada.')) { 
        await slaService.delete(id); 
        await registrarAuditoria('DELETE_CONTRACT', `Eliminó contrato: ${srv?.clientName} - ${srv?.objectiveName}`);
    }
  };

  const openNew = () => {
    const t = new Date();
    setForm({ 
        clientId: '', clientName: '', objectiveId: '', objectiveName: '', 
        startDate: new Date(t.getFullYear(), t.getMonth(), 1).toISOString().split('T')[0], 
        endDate: new Date(t.getFullYear(), t.getMonth() + 1, 0).toISOString().split('T')[0], 
        positions: [], totalMonthlyHours: 0, status: 'active' 
    });
    setIsEditing(false); setView('form');
  };

  const handleClientChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const clientId = e.target.value;
    const selectedClient = clients.find(c => c.id === clientId);
    if (selectedClient) {
        setForm(prev => ({ ...prev, clientId: selectedClient.id, clientName: selectedClient.name, objectiveId: '', objectiveName: '' }));
        setAvailableObjectives(selectedClient.objectives || []);
        return;
    }
    setForm(prev => ({ ...prev, clientId: '', clientName: '', objectiveId: '', objectiveName: '' }));
    setAvailableObjectives([]);
  };

  const handleObjectiveChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
      const objId = e.target.value;
      const selectedObj = availableObjectives.find(o => o.id === objId);
      if (selectedObj) {
        setForm(prev => ({ ...prev, objectiveId: selectedObj.id, objectiveName: selectedObj.name }));
        return;
      }
      setForm(prev => ({ ...prev, objectiveId: '', objectiveName: '' }));
  };

  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in">
        <header className="flex justify-between items-end">
          <h1 className="text-4xl font-black text-slate-900 dark:text-white uppercase">Servicios & SLA</h1>
          {view === 'list' && <button onClick={openNew} className="bg-indigo-600 hover:bg-indigo-700 transition-colors text-white px-6 py-3 rounded-xl font-black text-xs uppercase shadow-xl flex gap-2"><Plus size={16}/> Nuevo Contrato</button>}
        </header>

        {view === 'list' && (
          <>
            <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border dark:border-slate-700 flex items-center gap-4 shadow-sm">
              <Search className="text-slate-400"/><input placeholder="BUSCAR CLIENTE U OBJETIVO..." className="w-full bg-transparent outline-none font-bold text-slate-700 dark:text-white uppercase text-sm" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}/>
            </div>
            
            {services.length === 0 && !loading && (
                <div className="text-center py-20 opacity-50">
                    <p className="text-lg font-bold text-slate-400">No se encontraron contratos en 'servicios_sla'.</p>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredServices.map(srv => {
                const total = serviceTotals.get(srv.id || `${srv.clientId}-${srv.objectiveId}-${srv.startDate}`) ?? 0;
                
                return (
                  <div key={srv.id} className="bg-white dark:bg-slate-800 p-6 rounded-[2.5rem] border dark:border-slate-700 shadow-sm hover:shadow-lg transition-all group relative overflow-hidden flex flex-col h-full">
                    <div className={`absolute left-0 top-0 bottom-0 w-2 ${srv.status === 'active' ? 'bg-emerald-500' : 'bg-slate-300'}`}></div>
                    <div className="pl-4 flex-1">
                      <h3 className="font-black text-lg text-slate-800 dark:text-white uppercase truncate">{srv.clientName || 'Sin Cliente'}</h3>
                      <p className="text-sm font-bold text-indigo-500 mt-1 uppercase mb-4 flex items-center gap-1"><MapPin size={12}/> {srv.objectiveName || 'General'}</p>
                      
                      <div className="mb-4">
                        <p className="text-[9px] font-black uppercase text-slate-400 mb-2">Dotación Activa</p>
                        <div className="flex flex-wrap gap-2">{srv.positions.length > 0 ? srv.positions.map((p, idx) => <span key={idx} className="text-[9px] font-bold bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 px-2 py-1 rounded-md uppercase border border-indigo-100 dark:border-indigo-800 flex items-center gap-1"><Users size={10}/> {p.quantity}x {p.name}</span>) : <span className="text-[9px] text-slate-400">Sin definir</span>}</div>
                      </div>

                      <div className="mb-4 pt-4 border-t dark:border-slate-700"><div className="flex justify-between items-end mb-2"><span className="text-[10px] font-black uppercase text-slate-400">Total Mensual</span><span className="text-2xl font-black text-indigo-600 dark:text-indigo-400">{total} <span className="text-xs">hs</span></span></div></div>
                    </div>
                    <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                      <button onClick={() => handleEdit(srv)} className="p-2 bg-white dark:bg-slate-700 rounded-lg shadow text-indigo-600 hover:bg-indigo-50"><Edit2 size={14}/></button>
                      <button onClick={() => handleDelete(srv.id!)} className="p-2 bg-white dark:bg-slate-700 rounded-lg shadow text-rose-600 hover:bg-rose-50"><Trash2 size={14}/></button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {view === 'form' && (
          <div className="bg-white dark:bg-slate-800 p-8 rounded-[3rem] border dark:border-slate-700 shadow-xl">
            <div className="flex justify-between items-start mb-8">
               <div><h2 className="text-2xl font-black text-slate-900 dark:text-white uppercase">{isEditing ? 'Editar' : 'Nuevo'} Contrato</h2><p className="text-slate-400 text-xs mt-1">Definición de SLA y Costos Laborales (SUVICO).</p></div>
               <div className="text-right">
                   <div className="text-4xl font-black text-indigo-600 dark:text-indigo-400">{totalContractHours} <span className="text-sm text-indigo-300 font-bold">hs</span></div>
                   <div className="flex justify-end gap-2 mt-2">
                       <span className="text-[9px] font-bold text-indigo-400 bg-indigo-50 px-2 rounded flex items-center gap-1"><Moon size={10}/> {totalNightHours}h Noc</span>
                       <span className="text-[9px] font-bold text-amber-500 bg-amber-50 px-2 rounded flex items-center gap-1"><Sun size={10}/> {totalWeekendHours}h Finde</span>
                   </div>
                   {/* Mensaje de tranquilidad para el usuario */}
                   <p className="text-[8px] text-slate-400 text-right mt-1">*Cálculo nocturno: 21:00 a 06:00 (CCT 422/05)</p>
               </div>
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
               <div className="space-y-6">
                 <div><label className="text-[10px] font-black uppercase text-slate-400 ml-1">Cliente</label><select className="w-full p-4 bg-slate-50 dark:bg-slate-900 border dark:border-slate-600 rounded-2xl font-bold text-sm dark:text-white" value={form.clientId} onChange={handleClientChange}><option value="">Seleccionar...</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                 <div><label className="text-[10px] font-black uppercase text-slate-400 ml-1">Objetivo</label><select className="w-full p-4 bg-slate-50 dark:bg-slate-900 border dark:border-slate-600 rounded-2xl font-bold text-sm dark:text-white" value={form.objectiveId} onChange={handleObjectiveChange} disabled={!form.clientId}><option value="">Seleccionar...</option>{availableObjectives.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
                 <div className="grid grid-cols-2 gap-4">
                     <div><label className="text-[10px] font-black uppercase text-slate-400 ml-1">Inicio</label><input type="date" className="w-full p-4 bg-slate-50 dark:bg-slate-900 border dark:border-slate-600 rounded-2xl font-bold text-xs dark:text-white" value={form.startDate} onChange={e => setForm({...form, startDate: e.target.value})}/></div>
                     <div><label className="text-[10px] font-black uppercase text-slate-400 ml-1">Fin</label><input type="date" className="w-full p-4 bg-slate-50 dark:bg-slate-900 border dark:border-slate-600 rounded-2xl font-bold text-xs dark:text-white" value={form.endDate} onChange={e => setForm({...form, endDate: e.target.value})}/></div>
                 </div>
                 
                 <div className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-2xl border dark:border-slate-700/50">
                    <h4 className="text-[10px] font-black uppercase text-slate-400 mb-3 flex items-center gap-2"><Table size={12}/> Proyección de Costos</h4>
                    <div className="max-h-60 overflow-y-auto space-y-1 custom-scrollbar">
                        {monthlyBreakdown.map((m, i) => (
                            <div key={i} className="flex justify-between items-center bg-white dark:bg-slate-800 p-2 rounded-xl border dark:border-slate-700">
                                <div><span className="text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase block">{m.name}</span><span className="text-[8px] text-slate-400">{m.days} días hábiles</span></div>
                                <div className="text-right"><span className="block text-xs font-black text-indigo-600 dark:text-indigo-400">{Math.round(m.totalHours)} hs</span><div className="flex gap-2 justify-end"><span className="text-[8px] text-indigo-400 font-bold" title="Horas Nocturnas">{Math.round(m.nightHours)}N</span><span className="text-[8px] text-amber-500 font-bold" title="Horas Fin de Semana">{Math.round(m.weekendHours)}F</span></div></div>
                            </div>
                        ))}
                    </div>
                 </div>
               </div>

               <div className="lg:col-span-2 bg-slate-50 dark:bg-slate-900/30 p-6 rounded-[2.5rem] border dark:border-slate-700/50">
                  <div className="flex justify-between items-center mb-6">
                     <h3 className="text-sm font-black uppercase text-slate-700 dark:text-white flex items-center gap-2"><Briefcase size={18} className="text-indigo-500"/> Estructura Operativa</h3>
                     <button onClick={openAddPositionModal} className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase hover:scale-105 transition-transform flex items-center gap-2 shadow-lg"><Plus size={14}/> Agregar Puesto</button>
                  </div>
                  <div className="space-y-3">
                     {form.positions.map((pos) => (
                        <div key={pos.id} className="bg-white dark:bg-slate-800 p-4 rounded-2xl border dark:border-slate-700 shadow-sm flex flex-col md:flex-row justify-between items-center gap-4">
                           <div className="flex-1 text-left">
                              <div className="flex items-center gap-3"><h4 className="font-bold text-slate-800 dark:text-white text-sm uppercase">{pos.name}</h4><span className="bg-emerald-100 dark:bg-emerald-900 text-emerald-600 dark:text-emerald-300 px-2 py-0.5 rounded text-[9px] font-black uppercase">{pos.quantity} PAX</span></div>
                              <div className="mt-1 flex items-center gap-2"><span className="text-[10px] font-bold text-indigo-500 bg-indigo-50 dark:bg-indigo-900/50 px-2 rounded">{pos.coverageType === '24hs' ? '24 HS' : pos.coverageType.toUpperCase()}</span></div>
                           </div>
                           <div className="flex gap-1 flex-wrap justify-end max-w-xs">{pos.allowedShiftTypes.map(v => (<div key={v.code} className="text-center bg-slate-100 dark:bg-slate-700 px-2 py-1 rounded-lg border dark:border-slate-600"><div className="text-[9px] font-black text-slate-600 dark:text-slate-300">{v.code}</div><div className="text-[7px] text-slate-400">{v.hours}h</div></div>))}</div>
                           <button onClick={() => removePosition(pos.id)} className="p-2 bg-slate-100 dark:bg-slate-700 rounded-lg text-rose-500 hover:bg-rose-100 transition-colors"><X size={14}/></button>
                        </div>
                     ))}
                  </div>
               </div>
            </div>
            <div className="mt-8 flex justify-end gap-4 border-t dark:border-slate-700 pt-6"><button onClick={() => setView('list')} className="text-slate-400 font-bold uppercase text-xs hover:text-slate-600 transition-colors">Cancelar</button><button onClick={handleSave} className="bg-slate-900 dark:bg-white dark:text-slate-900 text-white px-8 py-3 rounded-xl font-black uppercase text-xs shadow-xl transition-transform active:scale-95"><Save size={16} className="mr-2 inline"/> Guardar</button></div>
          </div>
        )}

        {showPositionModal && (
           <div className="fixed inset-0 bg-slate-900/80 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
              <div className="bg-white dark:bg-slate-800 w-full max-w-lg p-8 rounded-[3rem] animate-in zoom-in-95 shadow-2xl border dark:border-slate-600 max-h-[90vh] overflow-y-auto custom-scrollbar">
                 <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase mb-6 flex items-center gap-2"><Settings className="text-indigo-500"/> Definir Puesto</h3>
                 <div className="space-y-5">
                    <div className="grid grid-cols-3 gap-4">
                        <div className="col-span-2"><label className="text-[10px] font-black uppercase text-slate-400 ml-1">Nombre</label><input className="w-full p-3 bg-slate-50 dark:bg-slate-900 border dark:border-slate-600 rounded-xl font-bold dark:text-white" value={positionForm.name} onChange={e => setPositionForm({...positionForm, name: e.target.value})}/></div>
                        <div><label className="text-[10px] font-black uppercase text-slate-400 ml-1">Pax</label><input type="number" min="1" className="w-full p-3 bg-slate-50 dark:bg-slate-900 border dark:border-slate-600 rounded-xl font-bold text-center dark:text-white" value={positionForm.quantity} onChange={e => setPositionForm({...positionForm, quantity: parseInt(e.target.value) || 1})}/></div>
                    </div>
                    <div>
                        <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Tipo de Cobertura</label>
                        <select className="w-full p-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl font-bold text-indigo-700 dark:text-indigo-300" value={positionForm.coverageType} onChange={handleCoverageTypeChange}>
                            <option value="24hs">24 HORAS (Lunes a Lunes)</option>
                            <option value="12hs_diurno">12 HORAS DIURNO</option>
                            <option value="12hs_nocturno">12 HORAS NOCTURNO</option>
                            <option value="custom">PERSONALIZADO / TURNOS ESPECÍFICOS</option>
                        </select>
                    </div>

                    {positionForm.coverageType === 'custom' && (
                        <div className="bg-orange-50 dark:bg-orange-900/20 p-4 rounded-2xl border border-orange-100 dark:border-orange-800">
                             <div className="flex gap-2 items-center mb-4 text-orange-700 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/40 p-2 rounded-lg">
                                <Info size={14}/>
                                <p className="text-[9px] font-bold">El cálculo de horas (Noc/Finde) es automático según los días asignados.</p>
                             </div>
                            
                            <label className="text-[10px] font-black uppercase text-slate-400 mb-2 block">1. Turnos Estándar (Todos los días)</label>
                            <div className="flex flex-wrap gap-2 mb-4">
                                {Object.keys(SHIFT_VARIANTS_DB).map((key) => {
                                    const v = SHIFT_VARIANTS_DB[key];
                                    const sel = positionForm.allowedShiftTypes.some(x => x.code === v.code && !x.isCustom);
                                    return <button key={key} onClick={() => toggleStandardVariant(key)} className={`px-3 py-1 rounded-lg border text-[10px] font-bold transition-all ${sel ? 'bg-orange-100 border-orange-300 text-orange-700' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>{v.name} ({v.hours}h)</button>
                                })}
                            </div>

                            <label className="text-[10px] font-black uppercase text-slate-400 mb-2 block">2. Crear Turno a Medida</label>
                            <div className="space-y-2">
                                <div className="flex gap-2 items-end">
                                    <div className="flex-1"><span className="text-[9px] text-slate-400">Nombre</span><input className="w-full p-2 text-xs font-bold rounded-lg border" placeholder="Ej: Puerta Bar" value={newCustomShift.name} onChange={e => setNewCustomShift({...newCustomShift, name: e.target.value})}/></div>
                                    <div className="w-20"><span className="text-[9px] text-slate-400">Inicio</span><input type="time" className="w-full p-2 text-xs font-bold rounded-lg border text-center" value={newCustomShift.start} onChange={e => setNewCustomShift({...newCustomShift, start: e.target.value})}/></div>
                                    <div className="w-20"><span className="text-[9px] text-slate-400">Fin</span><input type="time" className="w-full p-2 text-xs font-bold rounded-lg border text-center" value={newCustomShift.end} onChange={e => setNewCustomShift({...newCustomShift, end: e.target.value})}/></div>
                                </div>
                                <div>
                                    <span className="text-[9px] text-slate-400 block mb-1">Días Habilitados</span>
                                    <div className="flex gap-1 justify-between items-center">
                                            <div className="flex gap-1">
                                                {['L','M','X','J','V','S','D'].map(day => (
                                                    <button key={day} onClick={() => toggleNewShiftDay(day)} className={`w-7 h-7 rounded text-[9px] font-black transition-colors ${newCustomShift.days.includes(day) ? 'bg-slate-900 text-white' : 'bg-white border text-slate-400'}`}>{day}</button>
                                                ))}
                                            </div>
                                            <button onClick={addCustomShift} className="bg-slate-900 text-white px-4 py-1.5 rounded-lg font-bold text-xs hover:scale-105 flex items-center gap-1"><Plus size={14}/> Agregar</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-2xl border dark:border-slate-700">
                        <label className="text-[10px] font-black uppercase text-slate-400 mb-2 block">Turnos Habilitados</label>
                        <div className="flex flex-wrap gap-2">
                            {positionForm.allowedShiftTypes.length > 0 ? positionForm.allowedShiftTypes.map((v) => (
                                <div key={v.code} className="flex items-center gap-2 bg-white dark:bg-slate-800 px-3 py-2 rounded-lg border dark:border-slate-600 shadow-sm relative group">
                                    <span className={`w-6 h-6 flex items-center justify-center rounded text-[10px] font-black ${v.isCustom ? 'bg-orange-100 text-orange-600' : 'bg-indigo-100 text-indigo-600'}`}>{v.code}</span>
                                    <div>
                                        <p className="text-[9px] font-bold text-slate-700 dark:text-white uppercase leading-none">{v.name}</p>
                                        <div className="flex items-center gap-1">
                                            <p className="text-[8px] text-slate-400">{v.startTime}-{v.endTime} ({v.hours}h)</p>
                                            {v.days && <p className="text-[8px] font-black text-slate-500 bg-slate-100 px-1 rounded">{v.days.join('')}</p>}
                                        </div>
                                    </div>
                                    {positionForm.coverageType === 'custom' && <button onClick={() => removeCustomVariant(v.code)} className="absolute -top-1 -right-1 bg-rose-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100"><X size={10}/></button>}
                                </div>
                            )) : <span className="text-xs text-slate-400 italic">Ningún turno seleccionado.</span>}
                        </div>
                    </div>
                    <div className="pt-4 flex gap-3"><button onClick={() => setShowPositionModal(false)} className="flex-1 py-3 bg-slate-100 dark:bg-slate-700 text-slate-500 font-bold rounded-xl uppercase text-xs hover:bg-slate-200">Cancelar</button><button onClick={handleSavePosition} className="flex-1 py-3 bg-indigo-600 text-white font-black rounded-xl uppercase text-xs shadow-xl hover:bg-indigo-700">Confirmar</button></div>
                 </div>
              </div>
           </div>
        )}
      </div>
    </DashboardLayout>
  );
}