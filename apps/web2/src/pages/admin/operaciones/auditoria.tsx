import React, { useState, useEffect, useMemo } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useOperacionesMonitor } from '@/hooks/useOperacionesMonitor';
import { Activity, TestTube, Shield, MapPin, CheckCircle, Database, PlayCircle, Settings, UserCheck, UserX, Clock, AlertTriangle, Siren, X, Briefcase, UserPlus, Calendar, ChevronDown, ChevronUp, MessageCircle, Phone, Navigation, ArrowRight, ArrowLeftRight, Users, ToggleLeft, ToggleRight } from 'lucide-react';
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

const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    if (!lat1 || !lon1 || !lat2 || !lon2) return Infinity;
    const R = 6371; 
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

const estimateArrivalTime = (distanceKm: number) => {
    if (distanceKm === Infinity) return null;
    const avgSpeedCity = 30; 
    return Math.round((distanceKm / avgSpeedCity) * 60);
};

// --- COMPONENTE VISUAL DE LISTA ---
const SectionList = ({ title, color, index, expanded, onToggle, items, onAction, onWhatsapp, onPhone, context }: any) => {
    const borderClass = color === 'cyan' ? 'border-cyan-200' : (color === 'purple' ? 'border-purple-200' : 'border-slate-200');
    const bgDotClass = color === 'cyan' ? 'bg-cyan-500' : (color === 'purple' ? 'bg-purple-500' : 'bg-slate-400');
    const textTitleClass = color === 'cyan' ? 'text-cyan-700' : (color === 'purple' ? 'text-purple-700' : 'text-slate-600');
    const itemBgClass = color === 'cyan' ? 'bg-cyan-50 border-cyan-100' : (color === 'purple' ? 'bg-purple-50 border-purple-100' : 'bg-white border-slate-200');

    return (
        <section className={`relative pl-6 border-l-2 ${borderClass}`}>
            <div className={`absolute -left-[9px] top-0 w-4 h-4 rounded-full border-2 border-white ${bgDotClass}`}></div>
            <h4 className={`text-sm font-black uppercase mb-2 cursor-pointer flex items-center gap-2 ${textTitleClass}`} onClick={onToggle}>
                {title} {expanded ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}
            </h4>
            
            {expanded ? (
                <div className="mt-2 space-y-2 max-h-60 overflow-y-auto custom-scrollbar p-1">
                    {items && items.length > 0 ? items.map((e:any) => (
                        <div key={e.id} className={`flex justify-between items-center p-3 border rounded-xl shadow-sm ${itemBgClass} mb-2`}>
                            <div>
                                <span className="text-xs font-bold text-slate-800 block">{e.fullName || e.employeeName}</span>
                                {context === 'INTERCAMBIO' ? (
                                    <div className="text-[10px] text-purple-700 font-medium block mt-0.5">
                                        <span className="font-bold">{e.objectiveName}</span> (Quedan: {e.remainingGuards})
                                    </div>
                                ) : (
                                    e.shiftDateObj && <span className="text-[10px] text-slate-500 block mt-0.5">Entra: {toDate(e.shiftDateObj).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span>
                                )}
                                {e.distance !== undefined && e.distance !== Infinity && (
                                    <div className="flex items-center gap-2 mt-1">
                                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 border ${context === 'INTERCAMBIO' ? 'bg-purple-100 text-purple-700 border-purple-200' : 'bg-indigo-50 text-indigo-600 border-indigo-100'}`}>
                                            <Navigation size={10}/> {e.distance.toFixed(1)} km
                                        </span>
                                        <span className="text-[10px] text-slate-500">~{e.eta} min</span>
                                    </div>
                                )}
                            </div>
                            <div className="flex gap-2 items-center">
                                <div className="flex mr-2">
                                    <button onClick={()=>onWhatsapp(e, context)} className="p-2 bg-white text-emerald-600 border border-emerald-100 rounded-l-lg hover:bg-emerald-50"><MessageCircle size={16}/></button>
                                    <button onClick={()=>onPhone(e)} className="p-2 bg-white text-blue-600 border-y border-r border-blue-100 rounded-r-lg hover:bg-blue-50"><Phone size={16}/></button>
                                </div>
                                <button onClick={()=>onAction(e)} className={`px-3 py-2 text-white text-[10px] font-bold rounded-lg shadow-sm transition-colors ${color==='purple' ? 'bg-purple-600 hover:bg-purple-700' : (color==='cyan'?'bg-cyan-600 hover:bg-cyan-700':'bg-slate-800 hover:bg-slate-900')}`}>
                                    {context === 'INTERCAMBIO' ? 'MOVER AQUÍ' : (context === 'ADELANTO' ? 'ASIGNAR' : 'CONVOCAR')}
                                </button>
                            </div>
                        </div>
                    )) : <p className="text-xs text-slate-400 italic">No hay candidatos.</p>}
                </div>
            ) : (
                <div onClick={onToggle} className="p-3 bg-slate-50 border border-slate-200 rounded-xl cursor-pointer text-xs text-slate-500 font-bold flex justify-center items-center gap-2 hover:bg-slate-100 transition-colors">
                    <Briefcase size={14}/> {context === 'INTERCAMBIO' ? 'BUSCAR EN OBJETIVOS CERCANOS' : (context === 'ADELANTO' ? 'VER PRÓXIMOS TURNOS' : 'BUSCAR EN NÓMINA')}
                </div>
            )}
        </section>
    );
};

// --- MODAL DE RESOLUCIÓN (LÓGICA V170 - MAESTRA) ---
const AdvancedResolutionModal = ({ isOpen, onClose, type, data, onConfirm, logic }: any) => {
    const [expandedSection, setExpandedSection] = useState<number | null>(null);
    const [contactCard, setContactCard] = useState<{name: string, phone: string} | null>(null);

    if (!isOpen || !data || !data.shift) return null;

    const isLateArrival = type === 'LATE_ARRIVAL';
    const isAbsence = type === 'ABSENCE';
    const isInterrupt = type === 'INTERRUPT';

    const targetDateObj = toDate(data.targetDate);
    const currentPosition = data.shift.positionName;
    const shiftEndStr = data.shift.endDateObj ? toDate(data.shift.endDateObj).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : 'Fin Turno';

    const objLat = data.shift.lat || -31.4201; 
    const objLng = data.shift.lng || -64.1888; 

    // --- CONTEXTO: COMPAÑEROS ---
    const activeColleagues = logic.processedData.filter((s:any) => 
        s.objectiveId === data.shift.objectiveId && 
        s.id !== data.shift.id && 
        (s.isPresent || s.status === 'PRESENT') && 
        !s.isCompleted
    );
    const colleagueCount = activeColleagues.length;
    const isAlone = data.forceOverride !== undefined ? data.forceOverride : colleagueCount === 0;

    // --- LOGICA DE PRÉSTAMOS (< 2KM) ---
    const neighborCandidates: any[] = [];
    const allObjectives = logic.objectives;
    const guardsPerObjective: Record<string, any[]> = {};
    logic.processedData.forEach((s: any) => {
        if (s.isPresent && !s.isCompleted && s.objectiveId !== data.shift.objectiveId) {
            if (!guardsPerObjective[s.objectiveId]) guardsPerObjective[s.objectiveId] = [];
            guardsPerObjective[s.objectiveId].push(s);
        }
    });

    allObjectives.forEach((obj: any) => {
        if (obj.id === data.shift.objectiveId) return; 
        const nLat = obj.lat || (objLat + (Math.random() - 0.5) * 0.1); 
        const nLng = obj.lng || (objLng + (Math.random() - 0.5) * 0.1);
        const dist = calculateDistance(objLat, objLng, nLat, nLng);
        
        // REGLA: < 2KM
        if (dist <= 2) {
            const activeGuardsInNeighbor = guardsPerObjective[obj.id] || [];
            const count = activeGuardsInNeighbor.length;
            // REGLA: Quedan al menos 1
            if (count >= 2) {
                activeGuardsInNeighbor.forEach(g => {
                    neighborCandidates.push({
                        ...g,
                        distance: dist,
                        eta: estimateArrivalTime(dist),
                        objectiveName: obj.name,
                        remainingGuards: count - 1 
                    });
                });
            }
        }
    });
    neighborCandidates.sort((a,b) => a.distance - b.distance);

    const processGeoList = (list: any[]) => {
        return list.map((e:any) => {
            const empLat = e.lat || (objLat + (Math.random() - 0.5) * 0.1); 
            const empLng = e.lng || (objLng + (Math.random() - 0.5) * 0.1);
            const dist = calculateDistance(objLat, objLng, empLat, empLng);
            return { ...e, distance: dist, eta: estimateArrivalTime(dist) };
        }).sort((a:any, b:any) => a.distance - b.distance); 
    };

    let matchingPrevShifts = data.prevShifts ? data.prevShifts.filter((s:any) => s.positionName === currentPosition) : [];
    // Si estamos en prueba y forzamos guardia saliente
    if (isAbsence && data.forceOverride && matchingPrevShifts.length === 0) {
        matchingPrevShifts = [{ id: 'FORCE_PREV', employeeName: 'GUARDIA SALIENTE (SIMULADO)', positionName: currentPosition }];
    }
    
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

    if (isLateArrival) { 
        if (data.isOnTime) {
            headerColor = "bg-emerald-600"; headerTitle = "Ingreso / Relevo"; HeaderIcon = UserCheck;
        } else {
            headerColor = "bg-amber-500"; headerTitle = "Llegada Tarde"; HeaderIcon = Clock; 
        }
    }
    else if (isAbsence) { headerColor = "bg-rose-600"; headerTitle = "Protocolo de Ausencia"; HeaderIcon = UserX; }
    else if (isInterrupt) { headerColor = "bg-purple-600"; headerTitle = "Baja Anticipada"; HeaderIcon = Siren; }

    const toggleSection = (sec: number) => setExpandedSection(expandedSection === sec ? null : sec);

    const handleRetention = (guard: any) => onConfirm(`RETENCIÓN: ${guard.employeeName} dobla turno hasta ${shiftEndStr}.`);
    const handleRelief = (guard: any) => onConfirm(`RELEVO: ${guard.employeeName} finaliza servicio. Ingresa relevo.`);
    const handleNewAssignment = (guard: any) => onConfirm(`COBERTURA: ${guard.fullName || guard.employeeName} asignado.`);
    const handleSwap = (guard: any) => onConfirm(`PRÉSTAMO: ${guard.employeeName} movido desde ${guard.objectiveName}.`);

    const openWhatsApp = (target: any) => window.open(`https://wa.me/${target.phone}`, '_blank');
    const showPhone = (target: any) => setContactCard({ name: target.fullName || target.employeeName, phone: target.phone || target.celular });

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/80 backdrop-blur-sm animate-in fade-in p-4 sm:p-6">
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

                <div className={`p-4 flex justify-between items-center text-white shrink-0 ${headerColor}`}>
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-white/20 rounded-lg"><HeaderIcon size={24}/></div>
                        <div><h3 className="font-black text-lg uppercase">{headerTitle}</h3><p className="text-xs font-medium opacity-90">{data.shift.employeeName} - {data.timeInfo}</p></div>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-white/20 rounded-full"><X size={20}/></button>
                </div>

                <div className="p-6 overflow-y-auto custom-scrollbar space-y-6 flex-1">
                    
                    {isInterrupt && (
                        <div className="flex items-center justify-between bg-slate-50 p-3 rounded-xl border border-slate-200">
                            <div className="flex items-center gap-3">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isAlone ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-600'}`}>
                                    <Users size={20} />
                                </div>
                                <div>
                                    <p className="text-[10px] font-black text-slate-400 uppercase">SITUACIÓN EN PUESTO</p>
                                    <h4 className="font-bold text-slate-800 text-sm">{isAlone ? 'GUARDIA SOLO' : `ACOMPAÑADO (${colleagueCount} MÁS)`}</h4>
                                </div>
                            </div>
                            {!isAlone && <div className="text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-1 rounded border border-emerald-200">Cubierto</div>}
                        </div>
                    )}

                    {isInterrupt && (
                        <div className="bg-purple-50 p-4 rounded-xl border border-purple-100 text-purple-900 text-sm mb-4">
                            <strong className="block text-purple-700 mb-1">⚠️ TIEMPO REMANENTE:</strong>
                            El guardia debe retirarse {data.remainingHours.toFixed(1)} horas antes.
                        </div>
                    )}

                    {/* --- ESCENARIO 1: LLEGADA TARDE / INGRESO A TIEMPO --- */}
                    {isLateArrival && (
                        <div className="space-y-4">
                            <div className={`p-4 rounded-xl border text-sm ${data.isOnTime ? 'bg-emerald-50 border-emerald-100 text-emerald-800' : 'bg-amber-50 border-amber-100 text-amber-800'}`}>
                                {data.isOnTime ? 'El guardia está en horario correcto.' : 'El guardia ha llegado con demora.'} Seleccione a quién relevar para dar el Presente.
                            </div>
                            
                            {matchingPrevShifts.length > 0 ? (
                                <div className="space-y-2">
                                    <p className="text-xs font-bold text-slate-500 uppercase">Seleccione Saliente (Relevo):</p>
                                    {matchingPrevShifts.map((s:any) => (
                                        <div key={s.id} className="flex justify-between items-center p-3 border rounded-xl hover:bg-slate-50 cursor-pointer transition-all hover:shadow-sm">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center font-bold text-slate-600 text-xs">{s.employeeName.substring(0,2)}</div>
                                                <div>
                                                    <span className="font-bold text-sm text-slate-700 block">{s.employeeName}</span>
                                                    <span className="text-[10px] text-slate-500">{s.positionName}</span>
                                                </div>
                                            </div>
                                            <button onClick={() => handleRelief(s)} className="px-4 py-2 bg-slate-900 text-white text-xs font-bold rounded-lg hover:bg-black transition-all">RELEVAR</button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="p-4 border-2 border-dashed border-slate-200 rounded-xl text-center">
                                    <p className="text-xs text-slate-400 italic mb-3">No hay guardias salientes registrados en este puesto.</p>
                                    <button onClick={() => onConfirm("Inicio servicio sin relevo.")} className="w-full py-2 bg-emerald-600 text-white font-bold rounded-lg text-xs">INICIAR SIN RELEVO</button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* --- ESCENARIO 2: AUSENCIA CONFIRMADA --- */}
                    {isAbsence && (
                        <>
                            {matchingPrevShifts.length > 0 ? (
                                <section className="relative pl-6 border-l-2 border-indigo-200">
                                    <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-indigo-600 border-2 border-white"></div>
                                    <h4 className="text-sm font-black text-indigo-700 uppercase mb-2">1. Opción Retención (Doblar Turno)</h4>
                                    {matchingPrevShifts.map((s:any) => (
                                        <div key={s.id} className="p-3 bg-indigo-50 border border-indigo-100 rounded-xl flex justify-between items-center mb-2">
                                            <span className="font-bold text-slate-800 text-sm">{s.employeeName}</span>
                                            <button onClick={() => handleRetention(s)} className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded hover:bg-indigo-700">RETENER (DOBLE)</button>
                                        </div>
                                    ))}
                                </section>
                            ) : (
                                <div className="p-3 bg-gray-50 border border-gray-100 rounded-xl text-xs text-gray-400 text-center mb-4">
                                    Sin guardia saliente para retener.
                                </div>
                            )}
                            
                            <div className="mt-4"><SectionList title="2. Sin Asignación (Volantes)" color="slate" index={2} expanded={expandedSection===2} onToggle={()=>toggleSection(2)} items={unassignedList} onAction={handleNewAssignment} onWhatsapp={openWhatsApp} onPhone={showPhone} context="COBERTURA" /></div>
                            <div className="mt-4"><SectionList title="3. Adelanto (Turno Siguiente)" color="cyan" index={3} expanded={expandedSection===3} onToggle={()=>toggleSection(3)} items={validNextShifts} onAction={handleNewAssignment} onWhatsapp={openWhatsApp} onPhone={showPhone} context="ADELANTO" /></div>
                            <div className="mt-4"><SectionList title="4. Franco Trabajado" color="slate" index={4} expanded={expandedSection===4} onToggle={()=>toggleSection(4)} items={francoList} onAction={handleNewAssignment} onWhatsapp={openWhatsApp} onPhone={showPhone} context="COBERTURA" /></div>
                        </>
                    )}

                    {/* --- ESCENARIO 3: BAJA ANTICIPADA --- */}
                    {isInterrupt && (
                        <>
                            <div className="mt-4">
                                <SectionList 
                                    title="1. Intercambio (Objetivos Cercanos)" 
                                    color="purple" 
                                    index={1} 
                                    expanded={expandedSection===1} 
                                    onToggle={()=>toggleSection(1)} 
                                    items={neighborCandidates} 
                                    onAction={handleSwap} 
                                    onWhatsapp={openWhatsApp} 
                                    onPhone={showPhone} 
                                    context="INTERCAMBIO" 
                                />
                            </div>
                            <div className="mt-4"><SectionList title="2. Asignación (Volantes)" color="slate" index={2} expanded={expandedSection===2} onToggle={()=>toggleSection(2)} items={unassignedList} onAction={handleNewAssignment} onWhatsapp={openWhatsApp} onPhone={showPhone} context="COBERTURA" /></div>
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
            
            // 1. SALIENTES (Para probar Relevo/Retención)
            await setDoc(doc(collection(db, 'turnos')), { employeeName: 'SALIENTE 1 (JUAN)', employeeId: 'OUT_1', clientId: 'TEST', clientName: clientName || 'Test', objectiveId: objectiveId, objectiveName: objName || 'Test', positionName: 'Puesto Principal', startTime: Timestamp.fromDate(startPrev), endTime: Timestamp.fromDate(endPrev), isPresent: true, status: 'COMPLETED' });
            await setDoc(doc(collection(db, 'turnos')), { employeeName: 'SALIENTE 2 (PEDRO)', employeeId: 'OUT_2', clientId: 'TEST', clientName: clientName || 'Test', objectiveId: objectiveId, objectiveName: objName || 'Test', positionName: 'Puesto Principal', startTime: Timestamp.fromDate(startPrev), endTime: Timestamp.fromDate(endPrev), isPresent: true, status: 'COMPLETED' });

            // 2. BAJA (Guardia Activo)
            await setDoc(doc(collection(db, 'turnos')), { employeeName: 'GUARDIA ACTIVO', employeeId: 'TEST_CURR', clientId: 'TEST', clientName: clientName || 'Test', objectiveId: objectiveId, objectiveName: objName || 'Test', positionName: 'Puesto Principal', startTime: Timestamp.fromDate(startM), endTime: Timestamp.fromDate(endM), isPresent: true, status: 'PRESENT', phone: '5493511112222' });
            // 3. COMPAÑERO (Para probar contexto Acompañado)
            await setDoc(doc(collection(db, 'turnos')), { employeeName: 'COMPAÑERO 1', employeeId: 'TEST_BUDDY', clientId: 'TEST', clientName: clientName || 'Test', objectiveId: objectiveId, objectiveName: objName || 'Test', positionName: 'Puesto Secundario', startTime: Timestamp.fromDate(startM), endTime: Timestamp.fromDate(endM), isPresent: true, status: 'PRESENT' });
            
            // 4. AUSENCIA (Pendiente)
            await setDoc(doc(collection(db, 'turnos')), { employeeName: 'GUARDIA FALTADOR', employeeId: 'TEST_ABS', clientId: 'TEST', clientName: clientName || 'Test', objectiveId: objectiveId, objectiveName: objName || 'Test', positionName: 'Puesto Principal', startTime: Timestamp.fromDate(startM), endTime: Timestamp.fromDate(endM), isPresent: false, status: 'PENDING' });
            
            toast.success("Datos Sembrados: 2 Salientes, 1 Activo, 1 Compañero, 1 Ausente.");
        } catch (e:any) { toast.error("Error: " + e.message); }
    };
    return ( <div className="p-6 bg-slate-50 rounded-xl border border-slate-200 text-center"> <Database size={48} className="mx-auto text-indigo-300 mb-4"/> <h3 className="font-black text-slate-700">GENERADOR V170</h3> <p className="text-xs text-slate-500 mb-4">Crea escenarios separados para pruebas.</p> <button onClick={handleSeed} className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-black text-xs hover:bg-indigo-700 shadow-lg shadow-indigo-200 flex items-center gap-2 mx-auto"> <PlayCircle size={16}/> SEMBRAR DATOS </button> </div> );
};

const IncidenceLab = ({ logic, selectedObjId, selectedDate }: any) => {
    const [scenario, setScenario] = useState<'ABSENCE' | 'INTERRUPT'>('ABSENCE');
    const [selectedShiftId, setSelectedShiftId] = useState('');
    const [simTime, setSimTime] = useState('08:00'); 
    const [simStart, setSimStart] = useState(''); 
    const [simEnd, setSimEnd] = useState(''); 
    
    // --- ESTADO DUAL DE FUERZA (SEPARADO) ---
    const [forcePrevGuard, setForcePrevGuard] = useState(false); // Para Ausencia
    const [forceAlone, setForceAlone] = useState(false); // Para Baja

    const [showModal, setShowModal] = useState(false);
    const [modalData, setModalData] = useState<any>(null);
    const [modalType, setModalType] = useState('');
    
    const targetDate = new Date(selectedDate + 'T00:00:00');
    
    const objShifts = logic.processedData.filter((s:any) => { 
        return s.objectiveId === selectedObjId && 
               isSameDay(s.shiftDateObj, targetDate) && 
               s.employeeId !== 'VACANTE' && 
               !s.employeeName.toUpperCase().includes('VACANTE'); 
    });

    const displayShifts = objShifts.filter((s:any) => {
        if (scenario === 'ABSENCE') return !s.isPresent && s.status !== 'COMPLETED'; 
        if (scenario === 'INTERRUPT') return s.isPresent || s.status === 'PRESENT'; 
        return false;
    });
    
    const activeShift = displayShifts.find((s:any) => s.id === selectedShiftId);
    
    useEffect(() => {
        if (activeShift) {
            setSimStart(toDate(activeShift.shiftDateObj).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', hour12: false}));
            setSimEnd(toDate(activeShift.endDateObj).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', hour12: false}));
            setSimTime(new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', hour12: false}));
        } else { setSelectedShiftId(''); }
    }, [activeShift]);

    const getSimDate = (timeStr: string) => { if (!activeShift) return new Date(); const [h, m] = timeStr.split(':').map(Number); const d = new Date(activeShift.shiftDateObj); d.setHours(h, m, 0, 0); return d; };
    const handleConfirm = (msg: string) => { setShowModal(false); toast.success(msg, { duration: 5000, icon: <CheckCircle className="text-emerald-500"/> }); };

    const simulateAbsence = () => {
        if (!activeShift) return <div className="text-slate-400 text-xs italic">Seleccione un turno.</div>;
        const dateStart = getSimDate(simStart); const dateClock = getSimDate(simTime); const diffMinutes = (dateClock.getTime() - dateStart.getTime()) / 60000;
        
        let prevShifts = logic.processedData.filter((s:any) => s.objectiveId === selectedObjId && s.endDateObj.getTime() === dateStart.getTime() && (s.isPresent || s.status === 'COMPLETED') && s.positionName === activeShift.positionName);
        const nextShifts = logic.processedData.filter((s:any) => s.objectiveId === selectedObjId && s.shiftDateObj.getTime() > dateStart.getTime() && !s.isPresent);
        
        let status = ''; let actionBtn = null; let color = '';
        
        if (diffMinutes >= -15 && diffMinutes <= 5) {
            status = 'A TIEMPO'; color = 'bg-emerald-50 border-emerald-200 text-emerald-700';
            // 🛑 BOTÓN RESTAURADO V170
            actionBtn = (
                <button 
                    onClick={() => { setModalData({ shift: activeShift, timeInfo: simTime, prevShifts, isOnTime: true }); setModalType('LATE_ARRIVAL'); setShowModal(true); }}
                    className="w-full mt-2 py-2 bg-emerald-600 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-2 hover:bg-emerald-700 transition-all"
                >
                    <UserCheck size={14}/> DAR PRESENTE Y RELEVAR
                </button>
            );
        } 
        else if (diffMinutes > 5 && diffMinutes <= 60) {
            status = 'LLEGADA TARDE'; color = 'bg-amber-100 border-amber-500 text-amber-900'; 
            actionBtn = ( <button onClick={() => { setModalData({ shift: activeShift, timeInfo: simTime, prevShifts, isOnTime: false }); setModalType('LATE_ARRIVAL'); setShowModal(true); }} className="w-full mt-2 py-2 bg-amber-600 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-2"><UserCheck size={14}/> SIMULAR LLEGADA</button> );
        } 
        else if (diffMinutes > 60) { 
            status = 'AUSENCIA CONFIRMADA'; color = 'bg-rose-100 border-rose-500 text-rose-900'; 
            actionBtn = ( <button onClick={() => { setModalData({ shift: activeShift, timeInfo: simTime, prevShifts, nextShifts, targetDate, forceOverride: forcePrevGuard }); setModalType('ABSENCE'); setShowModal(true); }} className="w-full mt-2 py-2 bg-rose-600 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-2 animate-pulse"><Siren size={14}/> INICIAR PROTOCOLO</button> );
        } else { 
            status = 'EN ESPERA'; color = 'bg-slate-100 text-slate-500'; 
        }

        return ( <div className={`p-4 rounded-xl border-l-4 shadow-sm ${color}`}> <h3 className="font-black text-lg">{status}</h3> <p className="text-sm font-bold mt-1">Diferencia: {diffMinutes.toFixed(0)} min</p> {actionBtn} </div> );
    };

    const simulateInterrupt = () => {
        if (!activeShift) return <div className="text-slate-400 text-xs italic">Seleccione un guardia activo.</div>;
        
        const colleagues = logic.processedData.filter((s:any) => 
            s.objectiveId === activeShift.objectiveId && 
            s.id !== activeShift.id && 
            (s.isPresent || s.status === 'PRESENT') && 
            !s.isCompleted
        );
        
        const isAlone = forceAlone || colleagues.length === 0;

        const dateEnd = getSimDate(simEnd); const dateNow = getSimDate(simTime);
        if (dateEnd < getSimDate(simStart)) dateEnd.setDate(dateEnd.getDate() + 1);
        const remainingHours = (dateEnd.getTime() - dateNow.getTime()) / 3600000;

        const nextShifts = logic.processedData.filter((s:any) => s.objectiveId === selectedObjId && s.shiftDateObj.getTime() > getSimDate(simStart).getTime() && !s.isPresent);

        return (
            <div className={`p-4 rounded-xl border-l-4 shadow-sm ${isAlone ? 'bg-purple-100 border-purple-500 text-purple-900' : 'bg-emerald-100 border-emerald-500 text-emerald-900'}`}>
                <h3 className="font-black text-lg">REMANENTE: {remainingHours.toFixed(1)} HS</h3>
                
                {isAlone ? (
                    <div className="mt-2">
                         <p className="text-xs font-bold text-purple-700 mb-2 flex items-center gap-2"><AlertTriangle size={14}/> GUARDIA SOLO EN PUESTO {forceAlone && '(FORZADO)'}</p>
                         <button onClick={() => { setModalData({ shift: activeShift, timeInfo: simTime, remainingHours, nextShifts, targetDate, forceOverride: forceAlone }); setModalType('INTERRUPT'); setShowModal(true); }} className="w-full py-2 bg-purple-700 text-white rounded-lg text-xs font-bold shadow-md flex items-center justify-center gap-2 animate-pulse">
                            <Siren size={14}/> INICIAR PROTOCOLO
                        </button>
                    </div>
                ) : (
                    <div className="mt-2">
                        <p className="text-xs font-bold text-emerald-700 mb-2 flex items-center gap-2"><Users size={14}/> {colleagues.length} COMPAÑEROS PRESENTES</p>
                        <button onClick={() => handleConfirm("Baja registrada como novedad (Cubierto por dotación existente).")} className="w-full py-2 bg-emerald-600 text-white rounded-lg text-xs font-bold shadow-md flex items-center justify-center gap-2">
                            <CheckCircle size={14}/> REGISTRAR BAJA (CUBIERTO)
                        </button>
                    </div>
                )}
            </div>
        );
    };

    if (!selectedObjId) return <div className="p-10 text-center text-slate-400">SELECCIONE OBJETIVO</div>;

    return (
        <div className="h-full overflow-y-auto p-4 bg-slate-50 space-y-6">
            <AdvancedResolutionModal isOpen={showModal} onClose={()=>setShowModal(false)} type={modalType} data={modalData} onConfirm={handleConfirm} logic={logic} />
            <div className="flex bg-white p-1 rounded-xl shadow-sm border w-fit mx-auto mb-2">
                <button onClick={() => { setScenario('ABSENCE'); setSelectedShiftId(''); }} className={`px-6 py-2 text-xs font-black rounded-lg transition-all ${scenario==='ABSENCE' ? 'bg-indigo-600 text-white shadow' : 'text-slate-500 hover:bg-slate-50'}`}>PRUEBA AUSENCIA</button>
                <button onClick={() => { setScenario('INTERRUPT'); setSelectedShiftId(''); }} className={`px-6 py-2 text-xs font-black rounded-lg transition-all ${scenario==='INTERRUPT' ? 'bg-purple-600 text-white shadow' : 'text-slate-500 hover:bg-slate-50'}`}>PRUEBA BAJA / ABANDONO</button>
            </div>
            <div className="bg-white p-4 rounded-xl border shadow-sm">
                <h3 className="font-black text-sm text-slate-600 uppercase mb-3">{scenario === 'ABSENCE' ? 'Turnos Pendientes' : 'Guardias Activos'}</h3>
                <div className="flex gap-2 overflow-x-auto pb-2">
                    {displayShifts.length === 0 ? <p className="text-xs text-slate-400 italic p-2">No hay turnos disponibles.</p> : displayShifts.map((s:any) => ( <button key={s.id} onClick={() => setSelectedShiftId(s.id)} className={`p-3 rounded-xl border min-w-[140px] text-left transition-all ${selectedShiftId === s.id ? 'bg-slate-800 text-white ring-2 ring-slate-400' : 'bg-slate-50 hover:bg-slate-100'}`}> <span className="block text-xs font-bold">{s.employeeName}</span> <span className="block text-[10px] opacity-80">{s.positionName}</span> <span className="block text-[10px] font-mono mt-1 opacity-70">{toDate(s.shiftDateObj).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span> </button> ))}
                </div>
            </div>
            {selectedShiftId && activeShift && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-white p-4 rounded-xl border shadow-sm h-fit">
                        <h3 className="font-black text-sm text-slate-600 uppercase mb-4">Configuración</h3>
                        <div className="mb-4"><label className="text-xs font-bold text-slate-500 mb-1 block">Reloj Simulado</label><input type="time" className="w-full p-3 bg-slate-50 border rounded-xl font-mono text-lg font-bold" value={simTime} onChange={(e) => setSimTime(e.target.value)} /></div>
                        
                        {/* INTERRUPTOR DINÁMICO SEGÚN ESCENARIO */}
                        <div className="p-3 bg-slate-100 rounded-xl border border-slate-200">
                            {scenario === 'ABSENCE' ? (
                                <>
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-bold text-slate-600">Simular Guardia Saliente (Para Retención)</span>
                                        <button onClick={() => setForcePrevGuard(!forcePrevGuard)} className={`text-2xl transition-colors ${forcePrevGuard ? 'text-indigo-600' : 'text-slate-300'}`}>
                                            {forcePrevGuard ? <ToggleRight /> : <ToggleLeft />}
                                        </button>
                                    </div>
                                    <p className="text-[10px] text-slate-400 mt-1">Activar para que aparezca la opción "Retención/Doble Turno".</p>
                                </>
                            ) : (
                                <>
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-bold text-slate-600">Forzar Escenario "Guardia Solo"</span>
                                        <button onClick={() => setForceAlone(!forceAlone)} className={`text-2xl transition-colors ${forceAlone ? 'text-purple-600' : 'text-slate-300'}`}>
                                            {forceAlone ? <ToggleRight /> : <ToggleLeft />}
                                        </button>
                                    </div>
                                    <p className="text-[10px] text-slate-400 mt-1">Activar para probar el protocolo de cobertura aunque existan compañeros.</p>
                                </>
                            )}
                        </div>

                    </div>
                    <div className="bg-white p-4 rounded-xl border shadow-sm min-h-[200px]"> <h3 className="font-black text-sm text-slate-600 uppercase mb-4 flex items-center gap-2"><TestTube size={16}/> Diagnóstico</h3> {scenario === 'ABSENCE' ? simulateAbsence() : simulateInterrupt()} </div>
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
            <div className="p-4 bg-slate-100 min-h-screen flex flex-col h-full">
                <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden flex flex-col h-full">
                    <div className="bg-slate-900 text-white p-4 flex justify-between items-center shrink-0">
                        <h1 className="text-lg font-black flex items-center gap-2"><Activity className="text-emerald-400"/> MONITOR V170.0</h1>
                        <div className="flex bg-slate-800 p-1 rounded-lg gap-1">
                            <button onClick={() => setMode('LAB')} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${mode==='LAB'?'bg-emerald-500 text-white':'text-slate-400 hover:text-white'}`}>LABORATORIO</button>
                            <button onClick={() => setMode('INSPECTOR')} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${mode==='INSPECTOR'?'bg-indigo-500 text-white':'text-slate-400 hover:text-white'}`}>HERRAMIENTAS</button>
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