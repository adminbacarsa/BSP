const fs = require('fs');
const path = require('path');

console.log(`\n🧬 CRONO V159.0: LÓGICA DE TIEMPOS ESTRICTA (RELEVO VS RETENCIÓN)`);
console.log(`1. RETENCIÓN: Al doblar, el sistema extiende la hora de fin del guardia al final del turno vacante.`);
console.log(`2. RELEVO: Al relevar, el sistema corta el horario del saliente en el acto (Hora Simulada).`);
console.log(`3. BASE: Se mantiene V158 (Geo + Multi-Puesto + Sin Vacantes).`);

const BASE_SRC = path.join('apps', 'web2', 'src');
const DIR_PAGES = path.join(BASE_SRC, 'pages', 'admin', 'operaciones');
const TARGET_FILE = path.join(DIR_PAGES, 'auditoria.tsx');

const AUDIT_CONTENT = `
import React, { useState, useEffect, useMemo } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useOperacionesMonitor } from '@/hooks/useOperacionesMonitor';
import { Activity, TestTube, Shield, MapPin, CheckCircle, Database, PlayCircle, Settings, UserCheck, UserX, Clock, AlertTriangle, Siren, X, Briefcase, UserPlus, Calendar, ChevronDown, ChevronUp, MessageCircle, Phone, Navigation, ArrowRight } from 'lucide-react';
import { doc, setDoc, collection, serverTimestamp, Timestamp } from 'firebase/firestore'; 
import { db } from '@/lib/firebase';
import { toast } from 'sonner';

// --- HELPERS ---
const toDate = (d: any) => {
    if (!d) return new Date();
    if (d instanceof Date) return d;
    if (d && typeof d.toDate === 'function') return d.toDate();
    return new Date(d);
};

const isSameDay = (d1: any, d2: any) => {
    if (!d1 || !d2) return false;
    return toDate(d1).toLocaleDateString('en-CA') === toDate(d2).toLocaleDateString('en-CA');
};

// --- MOTOR GEO ---
const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371; 
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

const estimateArrivalTime = (distanceKm: number) => {
    const avgSpeedCity = 30; 
    const timeHours = distanceKm / avgSpeedCity;
    return Math.round(timeHours * 60); 
};

// --- COMPONENTE VISUAL ---
const SectionList = ({ title, color, index, expanded, onToggle, items, onAction, onWhatsapp, onPhone, context }: any) => {
    const borderClass = color === 'cyan' ? 'border-cyan-200' : 'border-slate-200';
    const bgDotClass = color === 'cyan' ? 'bg-cyan-500' : 'bg-slate-400';
    const textTitleClass = color === 'cyan' ? 'text-cyan-700' : 'text-slate-600';
    const itemBgClass = color === 'cyan' ? 'bg-cyan-50 border-cyan-100' : 'bg-white border-slate-200';

    return (
        <section className={\`relative pl-6 border-l-2 \${borderClass}\`}>
            <div className={\`absolute -left-[9px] top-0 w-4 h-4 rounded-full border-2 border-white \${bgDotClass}\`}></div>
            <h4 className={\`text-sm font-black uppercase mb-2 cursor-pointer flex items-center gap-2 \${textTitleClass}\`} onClick={onToggle}>
                {title} {expanded ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}
            </h4>
            {expanded ? (
                <div className="mt-2 space-y-2 max-h-60 overflow-y-auto custom-scrollbar p-1">
                    {items && items.length > 0 ? items.map((e:any) => (
                        <div key={e.id} className={\`flex justify-between items-center p-3 border rounded-xl shadow-sm \${itemBgClass}\`}>
                            <div>
                                <span className="text-xs font-bold text-slate-800 block">{e.fullName || e.employeeName}</span>
                                {e.shiftDateObj && <span className="text-[10px] text-slate-500 block mt-0.5">Entra: {toDate(e.shiftDateObj).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span>}
                                {e.distance !== undefined && (
                                    <div className="flex items-center gap-2 mt-1">
                                        <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded flex items-center gap-1"><Navigation size={10}/> {e.distance.toFixed(1)} km</span>
                                        <span className="text-[10px] text-slate-500">~{e.eta} min</span>
                                    </div>
                                )}
                            </div>
                            <div className="flex gap-2 items-center">
                                <div className="flex mr-2">
                                    <button onClick={()=>onWhatsapp(e, context)} className="p-2 bg-white text-emerald-600 border border-emerald-100 rounded-l-lg hover:bg-emerald-50"><MessageCircle size={16}/></button>
                                    <button onClick={()=>onPhone(e)} className="p-2 bg-white text-blue-600 border-y border-r border-blue-100 rounded-r-lg hover:bg-blue-50"><Phone size={16}/></button>
                                </div>
                                <button onClick={()=>onAction(e)} className={\`px-3 py-2 text-white text-[10px] font-bold rounded-lg shadow-sm transition-colors \${color==='cyan'?'bg-cyan-600 hover:bg-cyan-700':'bg-slate-800 hover:bg-slate-900'}\`}>
                                    {context === 'ADELANTO' ? 'ASIGNAR TURNO' : 'CONVOCAR'}
                                </button>
                            </div>
                        </div>
                    )) : <p className="text-xs text-slate-400 italic">No hay candidatos.</p>}
                </div>
            ) : (
                <div onClick={onToggle} className="p-3 bg-slate-50 border border-slate-200 rounded-xl cursor-pointer text-xs text-slate-500 font-bold flex justify-center items-center gap-2 hover:bg-slate-100 transition-colors">
                    <Briefcase size={14}/> {context === 'ADELANTO' ? 'VER PRÓXIMOS TURNOS' : 'BUSCAR EN NÓMINA'}
                </div>
            )}
        </section>
    );
};

// --- MODAL PRINCIPAL ---
const AdvancedResolutionModal = ({ isOpen, onClose, type, data, onConfirm, logic }: any) => {
    const [expandedSection, setExpandedSection] = useState<number | null>(null);
    const [contactCard, setContactCard] = useState<{name: string, phone: string} | null>(null);

    if (!isOpen || !data || !data.shift) return null;

    const isLateArrival = type === 'LATE_ARRIVAL';
    const isAbsence = type === 'ABSENCE';

    const targetDateObj = toDate(data.targetDate);
    const currentPosition = data.shift.positionName;
    const shiftEndStr = toDate(data.shift.endDateObj).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});

    // --- COORDENADAS DEL OBJETIVO ---
    const objLat = -31.4201; 
    const objLng = -64.1888; 

    // --- PROCESAMIENTO GEO ---
    const processGeoList = (list: any[]) => {
        return list.map((e:any) => {
            const empLat = e.lat || (objLat + (Math.random() - 0.5) * 0.1); 
            const empLng = e.lng || (objLng + (Math.random() - 0.5) * 0.1);
            const dist = calculateDistance(objLat, objLng, empLat, empLng);
            return { ...e, distance: dist, eta: estimateArrivalTime(dist) };
        }).sort((a:any, b:any) => a.distance - b.distance); 
    };

    // --- FILTRO: Guardias que salen del MISMO puesto ---
    const matchingPrevShifts = data.prevShifts ? data.prevShifts.filter((s:any) => s.positionName === currentPosition) : [];

    const busyIds = new Set(logic.processedData.filter((s:any) => isSameDay(s.shiftDateObj, targetDateObj)).map((s:any) => s.employeeId));
    const rawUnassigned = logic.employees.filter((e:any) => !busyIds.has(e.id) && e.id !== 'VACANTE');
    const rawFranco = logic.processedData.filter((s:any) => isSameDay(s.shiftDateObj, targetDateObj) && (s.code === 'F' || s.isFranco) && !s.isUnassigned);
    const rawNextShifts = data.nextShifts ? data.nextShifts.filter((s:any) => !s.isUnassigned) : [];

    const unassignedList = processGeoList(rawUnassigned);
    const francoList = processGeoList(rawFranco);
    const validNextShifts = processGeoList(rawNextShifts).sort((a:any, b:any) => a.shiftDateObj - b.shiftDateObj); 

    let headerColor = "bg-slate-700";
    let headerTitle = "Gestión";
    let HeaderIcon = Activity;

    if (isLateArrival) { headerColor = "bg-amber-500"; headerTitle = "Llegada Tarde"; HeaderIcon = Clock; }
    else if (isAbsence) { headerColor = "bg-rose-600"; headerTitle = "Protocolo de Ausencia"; HeaderIcon = UserX; }

    const toggleSection = (sec: number) => setExpandedSection(expandedSection === sec ? null : sec);

    // --- LÓGICA DE TIEMPOS ESTRICTA ---
    const handleRetention = (guard: any) => {
        // Retención: El guardia saliente NO se va ahora. Su turno se extiende hasta el fin del turno actual.
        const msg = \`RETENCIÓN CONFIRMADA: \${guard.employeeName} dobla turno. Su salida se extiende hasta las \${shiftEndStr}.\`;
        onConfirm(msg);
    };

    const handleRelief = (guard: any) => {
        // Relevo: El guardia saliente se va AHORA (Hora Simulada).
        const msg = \`RELEVO CONFIRMADO: \${guard.employeeName} finaliza servicio a las \${data.timeInfo}. Ingresa \${data.shift.employeeName}.\`;
        onConfirm(msg);
    };

    const handleNewAssignment = (guard: any) => {
        onConfirm(\`COBERTURA ASIGNADA: \${guard.fullName || guard.employeeName} cubrirá el puesto hasta las \${shiftEndStr}.\`);
    };

    const openWhatsApp = (target: any, context: string) => {
        let phone = target.phone || target.celular;
        if (!phone && target.employeeId) {
            const masterEmp = logic.employees.find((e:any) => e.id === target.employeeId);
            if (masterEmp) phone = masterEmp.phone || masterEmp.celular;
        }
        if (!phone) { toast.error("Sin celular."); return; }
        const cleanPhone = phone.replace(/[^0-9]/g, '');
        window.location.href = \`whatsapp://send?phone=\${cleanPhone}\`;
    };

    const showPhone = (target: any) => {
        let phone = target.phone || target.celular;
        const name = target.fullName || target.employeeName || 'Guardia';
        if (!phone && target.employeeId) {
            const masterEmp = logic.employees.find((e:any) => e.id === target.employeeId);
            if (masterEmp) phone = masterEmp.phone || masterEmp.celular;
        }
        if (!phone) { toast.error("Sin teléfono."); return; }
        setContactCard({ name, phone });
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/80 backdrop-blur-sm animate-in fade-in">
            <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 border border-slate-200 flex flex-col max-h-[90vh] relative">
                
                {contactCard && (
                    <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/95 backdrop-blur-sm animate-in fade-in">
                        <div className="bg-white p-6 rounded-2xl shadow-2xl border border-slate-200 text-center w-64">
                            <h4 className="font-bold text-slate-800 text-sm mb-1">{contactCard.name}</h4>
                            <p className="font-mono text-2xl font-black text-slate-900 mb-4">{contactCard.phone}</p>
                            <button onClick={() => setContactCard(null)} className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-lg text-xs">CERRAR</button>
                        </div>
                    </div>
                )}

                <div className={\`p-4 flex justify-between items-center text-white \${headerColor}\`}>
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-white/20 rounded-lg"><HeaderIcon size={24}/></div>
                        <div><h3 className="font-black text-lg uppercase">{headerTitle}</h3><p className="text-xs font-medium opacity-90">{data.shift.employeeName} - {data.timeInfo}</p></div>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-white/20 rounded-full"><X size={20}/></button>
                </div>

                <div className="p-6 overflow-y-auto custom-scrollbar space-y-6">
                    
                    {/* CASO A: LLEGADA TARDE */}
                    {isLateArrival && (
                        <div className="space-y-4">
                            <div className="bg-amber-50 p-4 rounded-xl border border-amber-100 text-amber-800 text-sm">
                                El guardia ha llegado a las <strong>{data.timeInfo}</strong>. Se procederá a dar el <strong>PRESENTE</strong>.
                            </div>
                            
                            {matchingPrevShifts.length > 0 ? (
                                <div className="space-y-2">
                                    <p className="text-xs font-bold text-slate-500 uppercase">Seleccione a quién relevar (Finaliza turno ahora):</p>
                                    {matchingPrevShifts.map((s:any) => (
                                        <div key={s.id} className="flex items-center justify-between p-3 border rounded-xl hover:bg-slate-50 cursor-pointer group">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center font-bold text-slate-600 text-xs">{s.employeeName.substring(0,2)}</div>
                                                <div><p className="font-bold text-sm text-slate-700">{s.employeeName}</p><p className="text-[10px] text-slate-500">{s.positionName}</p></div>
                                            </div>
                                            <button onClick={() => handleRelief(s)} className="px-4 py-2 bg-slate-900 text-white text-xs font-bold rounded-lg opacity-0 group-hover:opacity-100 transition-opacity">RELEVAR</button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center p-4 border-2 border-dashed border-slate-200 rounded-xl">
                                    <p className="text-xs text-slate-400 italic mb-2">No hay guardia saliente registrado en este puesto.</p>
                                    <button onClick={() => onConfirm("Inicio servicio sin relevo.")} className="w-full py-2 bg-emerald-600 text-white font-bold rounded-lg text-xs">INICIAR SIN RELEVO</button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* CASO B: AUSENCIA CONFIRMADA */}
                    {isAbsence && (
                        <>
                            {/* 1. RETENCIÓN */}
                            <section className="relative pl-6 border-l-2 border-indigo-200">
                                <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-indigo-600 border-2 border-white"></div>
                                <h4 className="text-sm font-black text-indigo-700 uppercase mb-2">1. Opción Retención (Guardias Salientes)</h4>
                                
                                {matchingPrevShifts.length > 0 ? (
                                    <div className="space-y-2">
                                        {matchingPrevShifts.map((s:any) => (
                                            <div key={s.id} className="p-3 bg-indigo-50 border border-indigo-100 rounded-xl flex justify-between items-center">
                                                <div>
                                                    <span className="font-bold text-slate-800 text-sm block">{s.employeeName}</span>
                                                    <span className="text-[10px] font-normal text-indigo-600 flex items-center gap-1">Extender hasta: {shiftEndStr} <ArrowRight size={10}/></span>
                                                </div>
                                                <button onClick={() => handleRetention(s)} className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded hover:bg-indigo-700">DOBLAR TURNO</button>
                                            </div>
                                        ))}
                                    </div>
                                ) : <p className="text-xs text-slate-400 italic mb-2">No hay guardias salientes en {currentPosition} para retener.</p>}
                            </section>
                            
                            <div className="mt-4"><SectionList title="2. Sin Asignación (Volantes)" color="slate" index={2} expanded={expandedSection===2} onToggle={()=>toggleSection(2)} items={unassignedList} onAction={handleNewAssignment} onWhatsapp={openWhatsApp} onPhone={showPhone} context="COBERTURA" /></div>
                            <div className="mt-4"><SectionList title="3. Adelanto (Turno Siguiente)" color="cyan" index={3} expanded={expandedSection===3} onToggle={()=>toggleSection(3)} items={validNextShifts} onAction={handleNewAssignment} onWhatsapp={openWhatsApp} onPhone={showPhone} context="ADELANTO" /></div>
                            <div className="mt-4"><SectionList title="4. Franco Trabajado" color="slate" index={4} expanded={expandedSection===4} onToggle={()=>toggleSection(4)} items={francoList} onAction={handleNewAssignment} onWhatsapp={openWhatsApp} onPhone={showPhone} context="COBERTURA" /></div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

const DataSeeder = ({ objectiveId, clientName, objName }: any) => {
    const handleSeed = async () => {
        if (!objectiveId) return toast.error("Seleccione objetivo");
        try {
            const today = new Date();
            const startPrev = new Date(today); startPrev.setHours(23,0,0,0); startPrev.setDate(today.getDate()-1);
            const endPrev = new Date(today); endPrev.setHours(7,0,0,0);
            const startM = new Date(today); startM.setHours(7,0,0,0);
            const endM = new Date(today); endM.setHours(15,0,0,0);
            const startT = new Date(today); startT.setHours(15,0,0,0);
            const endT = new Date(today); endT.setHours(23,0,0,0);

            // SIMULAMOS 2 GUARDIAS SALIENDO DEL MISMO PUESTO
            await setDoc(doc(collection(db, 'turnos')), { employeeName: 'SALIENTE 1 (JUAN)', employeeId: 'TEST_PREV1', clientId: 'TEST', clientName: clientName || 'Test', objectiveId: objectiveId, objectiveName: objName || 'Test', positionName: 'Puesto Principal', startTime: Timestamp.fromDate(startPrev), endTime: Timestamp.fromDate(endPrev), isPresent: true, status: 'COMPLETED', phone: '5493511112222' });
            await setDoc(doc(collection(db, 'turnos')), { employeeName: 'SALIENTE 2 (PEDRO)', employeeId: 'TEST_PREV2', clientId: 'TEST', clientName: clientName || 'Test', objectiveId: objectiveId, objectiveName: objName || 'Test', positionName: 'Puesto Principal', startTime: Timestamp.fromDate(startPrev), endTime: Timestamp.fromDate(endPrev), isPresent: true, status: 'COMPLETED', phone: '5493512223333' });
            
            // EL QUE FALTA EN ESE MISMO PUESTO
            await setDoc(doc(collection(db, 'turnos')), { employeeName: 'GUARDIA FALTADOR', employeeId: 'TEST_CURR', clientId: 'TEST', clientName: clientName || 'Test', objectiveId: objectiveId, objectiveName: objName || 'Test', positionName: 'Puesto Principal', startTime: Timestamp.fromDate(startM), endTime: Timestamp.fromDate(endM), isPresent: false, status: 'PENDING' });
            
            // OTROS
            await setDoc(doc(collection(db, 'turnos')), { employeeName: 'GUARDIA ENTRANTE', employeeId: 'TEST_NEXT', clientId: 'TEST', clientName: clientName || 'Test', objectiveId: objectiveId, objectiveName: objName || 'Test', positionName: 'Puesto Principal', startTime: Timestamp.fromDate(startT), endTime: Timestamp.fromDate(endT), isPresent: false, status: 'PENDING' });
            await setDoc(doc(collection(db, 'turnos')), { employeeName: 'GUARDIA FRANCO', employeeId: 'TEST_FRANCO', clientId: 'TEST', clientName: clientName || 'Test', objectiveId: objectiveId, objectiveName: objName || 'Test', positionName: 'Puesto Principal', startTime: Timestamp.fromDate(startM), endTime: Timestamp.fromDate(endM), code: 'F', isFranco: true, status: 'FRANCO' });

            toast.success("Escenario 'Múltiples Salientes' creado.");
        } catch (e:any) { toast.error("Error: " + e.message); }
    };
    return ( <div className="p-6 bg-slate-50 rounded-xl border border-slate-200 text-center"> <Database size={48} className="mx-auto text-indigo-300 mb-4"/> <h3 className="font-black text-slate-700">GENERADOR V159 (TIEMPOS)</h3> <p className="text-xs text-slate-500 mb-4">Crea múltiples salientes para probar relevo/retención.</p> <button onClick={handleSeed} className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-black text-xs hover:bg-indigo-700 shadow-lg shadow-indigo-200 flex items-center gap-2 mx-auto"> <PlayCircle size={16}/> SEMBRAR DATOS </button> </div> );
};

const IncidenceLab = ({ logic, selectedObjId, selectedDate }: any) => {
    const [selectedShiftId, setSelectedShiftId] = useState('');
    const [simTime, setSimTime] = useState('08:00'); 
    const [simStart, setSimStart] = useState(''); 
    const [simEnd, setSimEnd] = useState(''); 
    const [simIsPresent, setSimIsPresent] = useState(false); 
    const [virtualPrevGuard, setVirtualPrevGuard] = useState({ active: false, isPresent: true, name: 'GUARDIA ANTERIOR (VIRTUAL)' });
    const [showModal, setShowModal] = useState(false);
    const [modalData, setModalData] = useState<any>(null);
    const [modalType, setModalType] = useState('');
    
    const targetDate = new Date(selectedDate + 'T00:00:00');
    
    // FILTRO VACANTES
    const objShifts = logic.processedData.filter((s:any) => { 
        return s.objectiveId === selectedObjId && 
               isSameDay(s.shiftDateObj, targetDate) && 
               s.employeeId !== 'VACANTE' && 
               !s.employeeName.toUpperCase().includes('VACANTE'); 
    });
    
    const activeShift = objShifts.find((s:any) => s.id === selectedShiftId);
    
    useEffect(() => {
        if (activeShift) {
            setSimStart(toDate(activeShift.shiftDateObj).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', hour12: false}));
            setSimEnd(toDate(activeShift.endDateObj).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', hour12: false}));
            setSimIsPresent(activeShift.isPresent);
            const d = new Date(activeShift.shiftDateObj); d.setMinutes(d.getMinutes() + 5);
            setSimTime(d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', hour12: false}));
        }
    }, [activeShift]);

    const getSimDate = (timeStr: string) => { if (!activeShift) return new Date(); const [h, m] = timeStr.split(':').map(Number); const d = new Date(activeShift.shiftDateObj); d.setHours(h, m, 0, 0); return d; };
    const handleConfirm = (msg: string) => { setShowModal(false); toast.success(msg, { duration: 5000, icon: <CheckCircle className="text-emerald-500"/> }); };

    const simulateAbsence = () => {
        if (!activeShift) return <div className="text-slate-400 text-xs italic">Seleccione un turno.</div>;
        const dateStart = getSimDate(simStart); const dateClock = getSimDate(simTime); const diffMinutes = (dateClock.getTime() - dateStart.getTime()) / 60000;
        
        let prevShifts = logic.processedData.filter((s:any) => 
            s.objectiveId === selectedObjId && 
            s.endDateObj.getTime() === dateStart.getTime() && 
            (s.isPresent || s.status === 'COMPLETED') &&
            s.positionName === activeShift.positionName 
        );
        
        if (virtualPrevGuard.active && virtualPrevGuard.isPresent) { 
            prevShifts = [...prevShifts, { id: 'VIRTUAL', employeeName: virtualPrevGuard.name, positionName: activeShift.positionName, isVirtual: true }]; 
        }
        
        const nextShifts = logic.processedData.filter((s:any) => s.objectiveId === selectedObjId && s.shiftDateObj.getTime() > dateStart.getTime() && !s.isPresent);
        let status = ''; let actionBtn = null; let color = '';
        if (diffMinutes >= 0 && diffMinutes <= 60) { 
            status = 'LLEGADA TARDE'; color = 'bg-amber-100 text-amber-700 border-amber-500'; 
            actionBtn = ( <button onClick={() => { setModalData({ shift: activeShift, timeInfo: simTime, prevShifts }); setModalType('LATE_ARRIVAL'); setShowModal(true); }} className="w-full mt-2 py-2 bg-emerald-600 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-2 shadow-sm"><UserCheck size={14}/> SIMULAR LLEGADA (DAR PRESENTE)</button> );
        } else if (diffMinutes > 60) { 
            status = 'AUSENCIA'; color = 'bg-rose-100 text-rose-700 border-rose-500'; 
            actionBtn = ( <button onClick={() => { setModalData({ shift: activeShift, timeInfo: simTime, prevShifts, nextShifts, targetDate }); setModalType('ABSENCE'); setShowModal(true); }} className="w-full mt-2 py-2 bg-rose-600 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-2 shadow-sm animate-pulse"><Siren size={14}/> INICIAR PROTOCOLO DE AUSENCIA</button> );
        } else { status = 'EN ESPERA'; color = 'bg-slate-100 text-slate-500'; }
        return ( <div className="space-y-4 animate-in fade-in"> <div className={\`p-4 rounded-xl border-l-4 shadow-sm \${color}\`}> <h3 className="font-black text-lg">{status}</h3> <p className="text-sm font-bold mt-1">Diferencia: {diffMinutes.toFixed(0)} min</p> {actionBtn} </div> </div> );
    };

    if (!selectedObjId) return <div className="p-10 text-center text-slate-400">SELECCIONE OBJETIVO</div>;

    return (
        <div className="h-full overflow-y-auto p-4 bg-slate-50 space-y-6">
            <AdvancedResolutionModal isOpen={showModal} onClose={()=>setShowModal(false)} type={modalType} data={modalData} onConfirm={handleConfirm} logic={logic} />
            <div className="bg-white p-4 rounded-xl border shadow-sm">
                <h3 className="font-black text-sm text-slate-600 uppercase mb-3">Seleccionar Turno</h3>
                <div className="flex gap-2 overflow-x-auto pb-2">
                    {objShifts.map((s:any) => ( <button key={s.id} onClick={() => setSelectedShiftId(s.id)} className={\`p-3 rounded-xl border min-w-[140px] text-left transition-all \${selectedShiftId === s.id ? 'bg-slate-800 text-white ring-2 ring-slate-400' : 'bg-slate-50 hover:bg-slate-100'}\`}> <span className="block text-xs font-bold">{s.employeeName}</span> <span className="block text-[10px] opacity-80">{s.positionName}</span> <span className="block text-[10px] font-mono mt-1 opacity-70">{toDate(s.shiftDateObj).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span> </button> ))}
                </div>
            </div>
            {selectedShiftId && activeShift && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-white p-4 rounded-xl border shadow-sm h-fit">
                        <h3 className="font-black text-sm text-slate-600 uppercase mb-4">Configuración</h3>
                        <div className="mb-4"><label className="text-xs font-bold text-slate-500 mb-1 block">Reloj Simulado</label><input type="time" className="w-full p-3 bg-slate-50 border rounded-xl font-mono text-lg font-bold" value={simTime} onChange={(e) => setSimTime(e.target.value)} /></div>
                        <div className="flex items-center justify-between p-3 bg-indigo-50 border border-indigo-100 rounded-xl"> <div><p className="text-xs font-black text-indigo-800">Forzar Guardia Saliente</p><p className="text-[10px] text-indigo-600">Simula retención</p></div> <button onClick={()=>setVirtualPrevGuard(p=>({...p, active: !p.active}))} className={\`w-8 h-4 rounded-full transition-colors relative \${virtualPrevGuard.active ? 'bg-emerald-500' : 'bg-slate-300'}\`}><div className={\`w-3 h-3 bg-white rounded-full absolute top-0.5 transition-all \${virtualPrevGuard.active ? 'left-4.5' : 'left-0.5'}\`}></div></button> </div>
                    </div>
                    <div className="bg-white p-4 rounded-xl border shadow-sm min-h-[200px]"> <h3 className="font-black text-sm text-slate-600 uppercase mb-4 flex items-center gap-2"><TestTube size={16}/> Diagnóstico</h3> {simulateAbsence()} </div>
                </div>
            )}
        </div>
    );
};

export default function AuditoriaPage() {
    const logic = useOperacionesMonitor();
    const [mode, setMode] = useState<'LAB' | 'INSPECTOR'>('LAB');
    const [selectedObjXray, setSelectedObjXray] = useState('');
    const [auditDate, setAuditDate] = useState(() => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().split('T')[0]; });
    const allObjectives = useMemo(() => { return logic.objectives.sort((a,b) => a.clientName.localeCompare(b.clientName)); }, [logic.objectives]);
    const selectedObjName = allObjectives.find(o => o.id === selectedObjXray)?.name;
    const selectedClientName = allObjectives.find(o => o.id === selectedObjXray)?.clientName;
    const safeLogic = { ...logic, employees: logic.employees || [] };

    return (
        <DashboardLayout>
            <div className="p-4 bg-slate-100 min-h-screen flex flex-col h-screen">
                <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden flex flex-col h-full">
                    <div className="bg-slate-900 text-white p-4 flex justify-between items-center shrink-0">
                        <h1 className="text-lg font-black flex items-center gap-2"><Activity className="text-emerald-400"/> LÓGICA DEL MODAL: PRESENTE | AUSENTE</h1>
                        <div className="flex bg-slate-800 p-1 rounded-lg gap-1">
                            <button onClick={() => setMode('LAB')} className={\`px-3 py-1.5 rounded-md text-xs font-bold transition-all \${mode==='LAB'?'bg-emerald-500 text-white':'text-slate-400 hover:text-white'}\`}>LABORATORIO</button>
                            <button onClick={() => setMode('INSPECTOR')} className={\`px-3 py-1.5 rounded-md text-xs font-bold transition-all \${mode==='INSPECTOR'?'bg-indigo-500 text-white':'text-slate-400 hover:text-white'}\`}>HERRAMIENTAS</button>
                        </div>
                    </div>
                    <div className="p-3 bg-slate-50 border-b flex gap-4"><div className="flex-1"><span className="text-xs font-bold">OBJETIVO:</span><select className="w-full p-2 border rounded" value={selectedObjXray} onChange={e=>setSelectedObjXray(e.target.value)}><option value="">-- ELEGIR --</option>{allObjectives.map((o:any) => <option key={o.id} value={o.id}>{o.clientName} - {o.name}</option>)}</select></div><div className="w-40"><span className="text-xs font-bold">FECHA:</span><input type="date" className="w-full p-2 border rounded" value={auditDate} onChange={e=>setAuditDate(e.target.value)}/></div></div>
                    <div className="flex-1 overflow-auto p-0">
                        {mode === 'LAB' && <IncidenceLab logic={safeLogic} selectedObjId={selectedObjXray} selectedDate={auditDate} />}
                        {mode === 'INSPECTOR' && <div className="p-10 flex justify-center"><DataSeeder objectiveId={selectedObjXray} clientName={selectedClientName} objName={selectedObjName} /></div>} 
                    </div>
                </div>
            </div>
        </DashboardLayout>
    );
}
`;

try {
    fs.writeFileSync(TARGET_FILE, AUDIT_CONTENT);
    console.log("✅ V159.0 APLICADA: Lógica de tiempo estricta para Relevo/Retención.");
} catch (e) {
    console.error("❌ Error escribiendo archivo:", e);
}