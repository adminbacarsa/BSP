import React, { useState, useEffect, useMemo } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { planningService } from '@/services/planningService';
import { agreementService } from '@/services/agreementService';
import { useSettings } from '@/context/SettingsContext'; // <--- IMPORTANTE
import { ChevronLeft, ChevronRight, Sun, Moon, Sunset, Coffee, ShieldAlert, Users, Lock, AlertTriangle, XCircle, Plus, List, LayoutGrid, Calendar } from 'lucide-react';

const SHIFT_TYPES = {
  'M': { label: 'Mañana', icon: <Sun size={14}/>, color: 'bg-amber-100 text-amber-700 border-amber-200', start: '06:00', end: '14:00', hours: 8 },
  'T': { label: 'Tarde', icon: <Sunset size={14}/>, color: 'bg-sky-100 text-sky-700 border-sky-200', start: '14:00', end: '22:00', hours: 8 },
  'N': { label: 'Noche', icon: <Moon size={14}/>, color: 'bg-indigo-100 text-indigo-700 border-indigo-200', start: '22:00', end: '06:00', hours: 8 },
  'F': { label: 'Franco', icon: <Coffee size={14}/>, color: 'bg-emerald-50 text-emerald-600 border-emerald-200', start: null, end: null, hours: 0 }
};

// Helper dinámico que recibe la zona horaria como argumento
const toDateStr = (dateInput, tz) => {
  if (!dateInput) return '';
  const d = dateInput.seconds ? new Date(dateInput.seconds * 1000) : new Date(dateInput);
  return d.toLocaleDateString('en-CA', { timeZone: tz }); 
};

export default function PlanificacionPage() {
  const { timezone, locale } = useSettings(); // <--- USAMOS EL CONTEXTO
  
  const [viewMode, setViewMode] = useState('week');
  const [allServices, setAllServices] = useState([]);
  const [clientsList, setClientsList] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [absences, setAbsences] = useState([]);
  const [agreements, setAgreements] = useState([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedObjectiveId, setSelectedObjectiveId] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [floatingEmployees, setFloatingEmployees] = useState([]);
  const [showFloaterModal, setShowFloaterModal] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [selectedCell, setSelectedCell] = useState(null);
  const [notification, setNotification] = useState(null);
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [pendingAssignment, setPendingAssignment] = useState(null);

  const showNotify = (msg, type = 'success') => { setNotification({ msg, type }); setTimeout(() => setNotification(null), 4000); };

  useEffect(() => { loadResources(); }, []);
  useEffect(() => { loadGridData(); }, [currentDate, viewMode]);
  useEffect(() => { setFloatingEmployees([]); }, [selectedObjectiveId]);

  const loadResources = async () => {
    try {
      const srvs = await planningService.getActiveServices();
      const processed = srvs.map(s => ({ ...s, startDate: s.startDate ? new Date(s.startDate) : null, endDate: s.endDate ? new Date(s.endDate) : null }));
      setAllServices(processed);
      const uniqueMap = new Map();
      processed.forEach(s => { if (s.clientId) uniqueMap.set(s.clientId, s.clientName || 'Cliente sin nombre'); });
      const cList = Array.from(uniqueMap.entries()).map(([id, name]) => ({ id, name }));
      setClientsList(cList.sort((a, b) => a.name.localeCompare(b.name)));
      if (cList.length > 0) setSelectedClientId(cList[0].id);
      setEmployees(await planningService.getActiveEmployees());
      try { setAgreements(await agreementService.getAll()); } catch (e) {}
    } catch (e) { console.error(e); }
  };

  const loadGridData = async () => {
    const { start, end } = getDateRange();
    const [s, a] = await Promise.all([
      planningService.getShiftsByRange(new Date(start + 'T00:00:00'), new Date(end + 'T23:59:59')),
      planningService.getAbsencesByRange(new Date(start + 'T00:00:00'), new Date(end + 'T23:59:59'))
    ]);
    setShifts(s); setAbsences(a);
  };

  const clientObjectives = useMemo(() => {
    if (!selectedClientId) return [];
    const objs = new Map();
    allServices.filter(s => s.clientId === selectedClientId).forEach(s => objs.set(s.objectiveId, s.objectiveName || 'Sede Principal'));
    return Array.from(objs.entries()).map(([id, name]) => ({ id, name }));
  }, [allServices, selectedClientId]);

  const filteredEmployees = useMemo(() => {
    let baseList = employees;
    if (selectedObjectiveId) {
      const activeFloaters = shifts.filter(s => s.objectiveId === selectedObjectiveId).map(s => s.employeeId);
      baseList = employees.filter(e => e.preferredObjectiveId === selectedObjectiveId || floatingEmployees.includes(e.id) || activeFloaters.includes(e.id));
    }
    if (searchTerm) { const lower = searchTerm.toLowerCase(); return baseList.filter(e => e.name.toLowerCase().includes(lower)); }
    return baseList;
  }, [employees, searchTerm, selectedObjectiveId, floatingEmployees, shifts]);

  const getDateRange = () => {
    if (viewMode === 'week') {
      const d = new Date(currentDate); const day = d.getDay(); const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      const start = new Date(d.setDate(diff)); const end = new Date(start); end.setDate(start.getDate() + 6);
      return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] };
    }
    const start = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const end = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
    return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] };
  };

  const getDaysToRender = () => {
    const days = [];
    if (viewMode === 'week') {
      const d = new Date(currentDate); const day = d.getDay(); const diff = d.getDate() - day + (day === 0 ? -6 : 1); const start = new Date(d.setDate(diff));
      for (let i = 0; i < 7; i++) { const current = new Date(start); current.setDate(start.getDate() + i); days.push({ dateStr: current.toISOString().split('T')[0], label: current.toLocaleDateString(locale, { weekday: 'short', day: 'numeric' }), dayObj: current, dayName: ['Do','Lu','Ma','Mi','Ju','Vi','Sá'][current.getDay()], dayNumber: current.getDate() }); }
    } else {
      const year = currentDate.getFullYear(); const month = currentDate.getMonth(); const daysInMonth = new Date(year, month + 1, 0).getDate();
      for (let i = 1; i <= daysInMonth; i++) { const current = new Date(year, month, i); days.push({ dateStr: current.toISOString().split('T')[0], label: i.toString(), dayObj: current, dayName: ['D','L','M','M','J','V','S'][current.getDay()], dayNumber: i }); }
    }
    return days;
  };

  const getShiftCode = (shift) => {
    if (!shift) return null; if (shift.isFranco) return 'F';
    // Usamos la timezone del contexto
    const dateStr = shift.startTime?.seconds 
      ? new Date(shift.startTime.seconds * 1000).toLocaleTimeString('en-US', { hour12: false, timeZone: timezone })
      : new Date(shift.startTime).toLocaleTimeString('en-US', { hour12: false, timeZone: timezone });
    const h = parseInt(dateStr.split(':')[0]);
    if (h >= 5 && h < 13) return 'M'; if (h >= 13 && h < 21) return 'T'; if (h >= 21 || h < 5) return 'N';
    return '?';
  };

  const handleAssignType = async (type) => {
    if (!selectedCell) return;
    const { emp, day } = selectedCell;
    const objectiveId = selectedObjectiveId || clientObjectives[0]?.id;
    const objectiveName = clientObjectives.find(o => o.id === objectiveId)?.name || 'Sede';
    const config = SHIFT_TYPES[type];
    const start = type === 'F' ? new Date(day.dateStr + 'T00:00:00') : new Date(day.dateStr + 'T' + config.start);
    const end = type === 'F' ? new Date(day.dateStr + 'T23:59:59') : new Date(day.dateStr + 'T' + config.end);
    if (type === 'N' && end <= start) end.setDate(end.getDate() + 1);
    await planningService.assignShift({ employeeId: emp.id, employeeName: emp.name, objectiveId, objectiveName: type === 'F' ? 'FRANCO' : objectiveName, startTime: start, endTime: end, status: type === 'F' ? 'Franco' : 'Assigned', isFranco: type === 'F' });
    setShowModal(false); loadGridData();
  };

  const handleCellClick = (emp, day, cellData) => {
    const { localShift, isAbsence } = cellData;
    if (isAbsence) { showNotify('⛔ Licencia Activa', 'error'); return; }
    setSelectedCell({ emp, day, existingShift: localShift }); setShowModal(true);
  };

  const getAbsenceStyle = (type) => {
    const t = (type || '').toLowerCase();
    if (t.includes('vacaci')) return { code: 'V', style: 'bg-emerald-100 text-emerald-700 font-bold' };
    if (t.includes('enfer')) return { code: 'E', style: 'bg-amber-100 text-amber-700 font-bold' };
    return { code: 'L', style: 'bg-slate-200 text-slate-600 font-bold' };
  };

  const addFloater = (empId) => { if (!floatingEmployees.includes(empId)) { setFloatingEmployees([...floatingEmployees, empId]); showNotify('Refuerzo agregado'); } setShowFloaterModal(false); };
  const handleDelete = async () => { if (selectedCell?.existingShift) { await planningService.deleteShift(selectedCell.existingShift.id); showNotify('Turno eliminado'); setShowModal(false); loadGridData(); }};
  const daysToRender = getDaysToRender();
  
  const title = viewMode === 'week' 
    ? `Semana del ${daysToRender[0]?.label || ''}` 
    : currentDate.toLocaleString(locale, { month: 'long', year: 'numeric' }).toUpperCase();

  return (
    <DashboardLayout>
      <div className="max-w-full mx-auto space-y-4 h-[calc(100vh-100px)] flex flex-col p-4">
        {notification && <div className="fixed top-10 left-1/2 -translate-x-1/2 z-[9999] px-6 py-4 rounded-2xl bg-slate-900 text-white font-bold">{notification.msg}</div>}
        <div className="bg-white p-4 rounded-2xl border flex justify-between items-center shrink-0">
          <div className="flex gap-4">
            <select className="border p-2 rounded-xl text-sm font-bold" value={selectedClientId} onChange={(e) => setSelectedClientId(e.target.value)}>{clientsList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <select className="border p-2 rounded-xl text-sm font-bold" value={selectedObjectiveId} onChange={(e) => setSelectedObjectiveId(e.target.value)} disabled={!selectedClientId}><option value="">Ver Todo (General)</option>{clientObjectives.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
          </div>
          <div className="flex bg-slate-100 p-1 rounded-xl border">
            <button onClick={() => setViewMode('week')} className={`px-4 py-2 rounded-lg text-xs font-black uppercase ${viewMode === 'week' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-400'}`}>Semana</button>
            <button onClick={() => setViewMode('month')} className={`px-4 py-2 rounded-lg text-xs font-black uppercase ${viewMode === 'month' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-400'}`}>Mes</button>
          </div>
          <div className="flex items-center gap-4 min-w-[200px] justify-center">
            <button onClick={() => setCurrentDate(new Date(currentDate.setDate(currentDate.getDate()-7)))}><ChevronLeft/></button>
            <span className="font-black uppercase text-sm">{title}</span>
            <button onClick={() => setCurrentDate(new Date(currentDate.setDate(currentDate.getDate()+7)))}><ChevronRight/></button>
          </div>
        </div>
        <div className="flex-1 bg-white rounded-[2rem] border overflow-hidden flex shadow-xl">
          <div className="w-[200px] border-r flex flex-col">
            <div className="h-12 bg-slate-50 border-b flex items-center px-4 font-black text-[10px] uppercase text-slate-400">Dotación</div>
            <div className="flex-1 overflow-y-auto">
              {filteredEmployees.map(emp => <div key={emp.id} className="h-10 border-b px-4 flex items-center text-[10px] font-bold uppercase truncate">{emp.name}</div>)}
              {selectedObjectiveId && <div className="p-3 border-t"><button onClick={() => setShowFloaterModal(true)} className="w-full h-8 bg-slate-900 text-white rounded-lg font-black text-[10px] uppercase">Refuerzo</button></div>}
            </div>
          </div>
          <div className="flex-1 overflow-auto flex flex-col">
            <div className="h-12 bg-slate-50 border-b flex">
              {daysToRender.map(d => <div key={d.dateStr} className="flex-1 min-w-[40px] flex flex-col items-center justify-center border-r text-[9px] font-bold uppercase"><span>{d.dayName}</span><span>{d.dayNumber}</span></div>)}
            </div>
            <div className="flex-1 overflow-y-auto">
              {filteredEmployees.map(emp => (
                <div key={emp.id} className="h-10 flex border-b">
                  {daysToRender.map(day => {
                    const dailyShifts = shifts.filter(s => s.employeeId === emp.id && toDateStr(s.startTime, timezone) === day.dateStr);
                    let displayShift = null; let isExternal = false;
                    if (selectedObjectiveId) {
                        displayShift = dailyShifts.find(s => s.objectiveId === selectedObjectiveId);
                        if (!displayShift && dailyShifts.length > 0 && !dailyShifts[0].isFranco) isExternal = true;
                    } else {
                        displayShift = dailyShifts.find(s => !s.isFranco) || dailyShifts[0];
                    }

                    const currentDayStr = day.dateStr; 
                    const absence = absences.find(a => {
                      if (a.employeeId !== emp.id) return false;
                      const startStr = toDateStr(a.startDate, timezone);
                      const endStr = toDateStr(a.endDate, timezone);
                      return currentDayStr >= startStr && currentDayStr <= endStr;
                    });
                    const isAbsence = !!absence;
                    
                    let content = '+', style = 'text-slate-200';
                    if (isAbsence) { const res = getAbsenceStyle(absence.type); content = res.code; style = res.style; }
                    else if (displayShift) { content = getShiftCode(displayShift); style = SHIFT_TYPES[content]?.color; }
                    else if (isExternal) { content = <Lock size={10}/>; style = 'bg-slate-100 text-slate-400 opacity-50'; }
                    
                    return (
                      <div key={day.dateStr} className="flex-1 border-r p-[2px] min-w-[40px]">
                        <button onClick={() => handleCellClick(emp, day, { localShift: displayShift, isAbsence })} className={`w-full h-full rounded text-[10px] font-black flex items-center justify-center transition-all hover:bg-slate-100 ${style}`}>{content}</button>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
        {showModal && (
          <div className="fixed inset-0 z-[999] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl text-center">
              <h3 className="text-xl font-black uppercase mb-6">{selectedCell?.emp.name}</h3>
              <div className="grid grid-cols-2 gap-4">{Object.entries(SHIFT_TYPES).map(([key, data]) => <button key={key} onClick={() => handleAssignType(key)} className={`p-4 rounded-2xl border-2 flex flex-col items-center gap-2 ${data.color}`}>{data.icon}<span className="font-black text-sm">{data.label}</span></button>)}</div>
              {selectedCell?.existingShift && <button onClick={handleDelete} className="w-full mt-6 py-4 bg-slate-100 text-rose-500 rounded-xl font-black text-xs uppercase">Borrar Turno</button>}
              <button onClick={() => setShowModal(false)} className="w-full mt-2 py-4 text-slate-400 font-bold uppercase">Cancelar</button>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
