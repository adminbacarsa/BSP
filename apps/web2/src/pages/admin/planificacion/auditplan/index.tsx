import React, { useState, useMemo, useEffect } from 'react';
import Head from 'next/head';
import dynamic from 'next/dynamic';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Activity, Save, Database, MonitorPlay, MousePointer2 } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { SHIFT_STYLES, SHIFT_HOURS_LOOKUP } from './constants';
import { getDateKey, isDateLocked } from './utils';
import { usePlanificacionLogic } from './usePlanificacionLogic';
import { ShiftSelectorModal, RRHHModal } from './Modals';

// 🛑 FIX: ASIGNACIÓN SEGURA DEL COMPONENTE LIST
const List: any = dynamic(() => import('react-window').then((mod: any) => {
    // Si mod.FixedSizeList existe, usalo. Si no, busca en default. Si no, usa un componente vacío para no romper.
    return mod.FixedSizeList || mod.default?.FixedSizeList || (() => null);
}), { ssr: false });

const Row = ({ index, style, data }: any) => {
    const { displayedEmployees, daysInMonth, shiftsMap, pendingChanges, absencesMap, selection, onCellInteraction } = data;
    const emp = displayedEmployees[index]; if (!emp) return null;
    return (
        <div style={style} className='flex border-b border-slate-100 hover:bg-slate-50 transition-colors h-[50px]'>
            <div className='w-[240px] shrink-0 sticky left-0 z-20 bg-white border-r flex items-center px-4 font-black text-[10px] uppercase truncate shadow-sm'> {emp.name} </div>
            {daysInMonth.map((day: any, dIdx: number) => {
                const dKey = getDateKey(day); const key = emp.id + '_' + dKey;
                const s = shiftsMap[key]; const p = pendingChanges[key];
                const isSel = selection.start && index >= Math.min(selection.start.r, selection.end.r) && index <= Math.max(selection.start.r, selection.end.r) && dIdx >= Math.min(selection.start.c, selection.end.c) && dIdx <= Math.max(selection.start.c, selection.end.c);
                let content = s?.code || ''; let cls = SHIFT_STYLES[s?.code] || 'bg-white';
                if (p) { if(p.isDeleted) content='X', cls='bg-rose-50'; else content=p.code, cls='bg-amber-100 font-bold ring-1 ring-amber-400'; }
                if (absencesMap[key]) { content='V'; cls=SHIFT_STYLES['V']; }
                return (
                    <div key={key} onMouseDown={() => onCellInteraction('DOWN', index, dIdx)} onMouseEnter={() => onCellInteraction('ENTER', index, dIdx)}
                         className={'w-[45px] shrink-0 border-r flex items-center justify-center cursor-pointer transition-all ' + (isSel ? 'bg-indigo-50' : '')}>
                        <div className={'w-9 h-9 rounded-xl flex items-center justify-center text-[10px] font-black border shadow-sm ' + cls}> {content} </div>
                    </div>
                );
            })}
        </div>
    );
};

export default function AuditPlanPage() {
    const [mounted, setMounted] = useState(false);
    const [currentDate, setCurrentDate] = useState(new Date());
    const [selectedClient, setSelectedClient] = useState('');
    const [selectedObjective, setSelectedObjective] = useState('');
    const [selection, setSelection] = useState<any>({ start: null, end: null });
    const [isDragging, setIsDragging] = useState(false);
    const [selectedCell, setSelectedCell] = useState<any>(null);
    const [activePosition, setActivePosition] = useState('General');
    const [showRRHHModal, setShowRRHHModal] = useState(false);
    const [rrhhData, setRrhhData] = useState({ type: 'Vacaciones', reason: '' });
    useEffect(() => { setMounted(true); }, []);
    const { employees, shiftsMap, absencesMap, clients, pendingChanges, setPendingChanges, isProcessing, positionStructure, handleSaveAll } = usePlanificacionLogic(selectedClient, selectedObjective, 'Supervisor');
    const daysInMonth = useMemo(() => {
        const d = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        const days = []; while (d.getMonth() === currentDate.getMonth()) { days.push(new Date(d)); d.setDate(d.getDate() + 1); }
        return days;
    }, [currentDate]);
    const displayedEmployees = useMemo(() => {
        if(!selectedObjective) return [];
        return [...employees].filter((e:any) => e.preferredObjectiveId === selectedObjective || Object.keys(shiftsMap).some(k => k.startsWith(e.id) && shiftsMap[k].objectiveId === selectedObjective)).sort((a:any, b:any) => a.name.localeCompare(b.name));
    }, [employees, selectedObjective, shiftsMap]);
    const onCellInteraction = (type: string, r: number, c: number) => {
        if (type === 'DOWN') { setIsDragging(true); setSelection({ start: { r, c }, end: { r, c } }); }
        else if (isDragging) { setSelection((prev: any) => ({ ...prev, end: { r, c } })); }
    };
    if (!mounted) return null;
    return (
        <DashboardLayout>
            <Toaster position='top-center' richColors />
            <div className='flex flex-col h-[calc(100vh-80px)] p-4 space-y-4 select-none' onMouseUp={() => { if(!isDragging) return; setIsDragging(false); if(selection.start && selection.start.r === selection.end.r && selection.start.c === selection.end.c) { const emp:any = displayedEmployees[selection.start.r]; setSelectedCell({ empId: emp.id, dateStr: getDateKey(daysInMonth[selection.start.c]) }); } }}>
                <div className='bg-slate-900 text-white p-6 rounded-[2.5rem] shadow-2xl flex items-center justify-between border-b-4 border-indigo-500'>
                    <div className='flex items-center gap-6'><Activity size={32}/><div><h1 className='text-2xl font-black italic'>CMD V8</h1></div></div>
                    <div className='flex gap-4'>
                        <div className='flex gap-2 bg-slate-800 p-2 rounded-2xl'>
                            <select value={selectedClient} onChange={e => { setSelectedClient(e.target.value); setSelectedObjective(''); }} className='bg-transparent text-white text-xs font-bold outline-none'><option value=''>CLIENTE...</option>{clients.map((c:any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                            <select value={selectedObjective} onChange={e => setSelectedObjective(e.target.value)} className='bg-transparent text-white text-xs font-bold outline-none'><option value=''>OBJETIVO...</option>{clients.find((c:any) => c.id === selectedClient)?.objetivos?.map((o:any) => <option key={o.id||o.name} value={o.id||o.name}>{o.name}</option>)}</select>
                        </div>
                        {Object.keys(pendingChanges).length > 0 && <button onClick={handleSaveAll} className='bg-emerald-500 px-8 py-3 rounded-2xl font-black shadow-lg'><Save/></button>}
                    </div>
                </div>
                <div className='flex-1 bg-white rounded-[3rem] border shadow-2xl overflow-hidden flex flex-col'>
                    <div className='flex bg-slate-50 h-14 border-b'><div className='w-[240px] shrink-0 border-r flex items-center px-6 font-black text-xs'>DOTACION ({displayedEmployees.length})</div><div className='flex overflow-hidden'>{daysInMonth.map(d => (<div key={d.toISOString()} className='w-[45px] border-r flex flex-col items-center justify-center'><span className='text-[8px] font-bold'>{['D','L','M','X','J','V','S'][d.getDay()]}</span><span className='text-xs font-black'>{d.getDate()}</span></div>))}</div></div>
                    <div className='flex-1 overflow-x-auto'>
                        <div style={{ width: 240 + (daysInMonth.length * 45) }}>
                            {selectedObjective ? (
                                <List height={550} itemCount={displayedEmployees.length} itemSize={50} width='100%' itemData={{ displayedEmployees, daysInMonth, shiftsMap, pendingChanges, absencesMap, selection, onCellInteraction }}>{Row}</List>
                            ) : <div className='h-[400px] flex items-center justify-center font-black text-slate-300'>SELECCIONE OBJETIVO</div>}
                        </div>
                    </div>
                </div>
                <ShiftSelectorModal selectedCell={selectedCell} employees={employees} positionStructure={positionStructure} activePosition={activePosition} setActivePosition={setActivePosition} onAssign={(code:any) => { setPendingChanges((prev:any) => ({...prev, [selectedCell.empId + '_' + selectedCell.dateStr]: { code, hours: SHIFT_HOURS_LOOKUP[code], positionName: activePosition }})); setSelectedCell(null); }} onDelete={() => { setPendingChanges((prev:any) => ({...prev, [selectedCell.empId + '_' + selectedCell.dateStr]: { isDeleted: true }})); setSelectedCell(null); }} onRRHH={() => setShowRRHHModal(true)} onClose={() => setSelectedCell(null)} />
                {showRRHHModal && <RRHHModal onSubmit={() => { toast.success('OK'); setShowRRHHModal(false); setSelectedCell(null); }} onClose={() => setShowRRHHModal(false)} />}
            </div>
            <style jsx global>{` .custom-scrollbar::-webkit-scrollbar { width: 8px; height: 8px; } .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; } `}</style>
        </DashboardLayout>
    );
}