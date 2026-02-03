import React, { useState, useEffect, useRef } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { db } from '@/lib/firebase';
import { 
    collection, getDocs, updateDoc, doc, 
    query, orderBy, where, arrayUnion, Timestamp, serverTimestamp 
} from 'firebase/firestore';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { Toaster, toast } from 'sonner';
import { 
    Users, Building2, MapPin, Search, Plus, Trash2, Edit2, Save, X, ExternalLink,
    BarChart3, ChevronUp, ChevronDown, TrendingUp, Navigation, Calendar, Clock,
    Briefcase, Receipt, Printer, Send, Ban, Loader2, Calculator, FileText, Globe
} from 'lucide-react';

const formatMoney = (val) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(val || 0);

// --- MOTOR DE CÁLCULO DINÁMICO (CCT 422/05) ---
const analyzeShiftComposition = (start, end) => {
    const [h1, m1] = start.split(':').map(Number);
    const [h2, m2] = end.split(':').map(Number);
    let startMin = h1 * 60 + m1;
    let endMin = h2 * 60 + m2;
    if (endMin < startMin) endMin += 1440; 
    return (endMin - startMin) / 60;
};

const calculateMonthlySLA = (positions, startStr, endStr) => {
    if (!positions || positions.length === 0 || !startStr || !endStr) return 0;
    const sParts = startStr.split('-').map(Number);
    const eParts = endStr.split('-').map(Number);
    let current = new Date(sParts[0], sParts[1] - 1, sParts[2]);
    const end = new Date(eParts[0], eParts[1] - 1, eParts[2]);
    let totalAccumulator = 0;
    while (current <= end) {
        positions.forEach(pos => {
            let dayTotal = 0;
            if (pos.coverageType === '24hs') dayTotal = 24;
            else if (pos.coverageType === '12hs_diurno' || pos.coverageType === '12hs_nocturno') dayTotal = 12;
            else if (pos.coverageType === 'custom' && pos.allowedShiftTypes) {
                pos.allowedShiftTypes.forEach(shift => { dayTotal += analyzeShiftComposition(shift.startTime, shift.endTime); });
            }
            totalAccumulator += (dayTotal * (pos.quantity || 1));
        });
        current.setDate(current.getDate() + 1);
    }
    return Math.round(totalAccumulator);
};

export default function CRMPage() {
    const router = useRouter();
    const [view, setView] = useState('list');
    const [activeTab, setActiveTab] = useState('INFO');
    const [currentUserName, setCurrentUserName] = useState("Cargando...");
    const [showGlobalDashboard, setShowGlobalDashboard] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    
    const [clients, setClients] = useState([]);
    const [filteredClients, setFilteredClients] = useState([]);
    const [selectedClient, setSelectedClient] = useState(null);
    const [clientServices, setClientServices] = useState([]);
    const [clientContracts, setClientContracts] = useState([]);
    const [clientQuotes, setClientQuotes] = useState([]);
    
    const [globalMetrics, setGlobalMetrics] = useState({ totalSold: 0, totalExecuted: 0, criticalClients: [] });
    const [clientMetricsMap, setClientMetricsMap] = useState({});
    
    // Estados de Formulario y Modales
    const [isEditingInfo, setIsEditingInfo] = useState(false);
    const [infoForm, setInfoForm] = useState({});
    const [editingServiceId, setEditingServiceId] = useState(null);
    const [tempService, setTempService] = useState({});
    const [billingModalOpen, setBillingModalOpen] = useState(false);
    const [billingData, setBillingData] = useState(null);
    const [isBillingLoading, setIsBillingLoading] = useState(false);
    const [historyNote, setHistoryNote] = useState('');

    useEffect(() => {
        onAuthStateChanged(getAuth(), (u) => setCurrentUserName(u?.displayName || u?.email || "Operador"));
        fetchClients();
    }, []);

    const fetchClients = async () => {
        const s = await getDocs(query(collection(db, 'clients'), orderBy('name')));
        const d = s.docs.map(x => ({ id: x.id, ...x.data() }));
        setClients(d); setFilteredClients(d);
    };

    const loadClientFullData = async (id) => {
        const [srv, cont, quo] = await Promise.all([
            getDocs(query(collection(db, 'servicios_sla'), where('clientId', '==', id))),
            getDocs(query(collection(db, 'contracts'), where('clientId', '==', id))),
            getDocs(query(collection(db, 'quotes'), where('clientId', '==', id)))
        ]);
        setClientServices(srv.docs.map(x => ({ id: x.id, ...x.data() })));
        setClientContracts(cont.docs.map(x => ({ id: x.id, ...x.data() })));
        setClientQuotes(quo.docs.map(x => ({ id: x.id, ...x.data() })));
    };

    const calculateDashboardMetrics = async () => {
        try {
            const [sSla, sTurnos] = await Promise.all([
                getDocs(collection(db, 'servicios_sla')),
                getDocs(query(collection(db, 'turnos'), where('status', '==', 'COMPLETED')))
            ]);
            const slaMap = {}; const realMap = {};
            sSla.forEach(doc => {
                const d = doc.data();
                if (d.clientId) {
                    const cid = d.clientId.trim();
                    slaMap[cid] = (slaMap[cid] || 0) + calculateMonthlySLA(d.positions, d.startDate, d.endDate);
                }
            });
            sTurnos.forEach(doc => {
                const t = doc.data();
                if (t.clientId && t.realStartTime && t.realEndTime) {
                    const dur = (t.realEndTime.toDate() - t.realStartTime.toDate()) / 3600000;
                    realMap[t.clientId.trim()] = (realMap[t.clientId.trim()] || 0) + dur;
                }
            });
            const results = {}; let totalSold = 0, totalExecuted = 0;
            clients.forEach(c => {
                const sla = Math.round(slaMap[c.id] || 0);
                const real = Math.round(realMap[c.id] || 0);
                const p = sla > 0 ? (real / sla) * 100 : 0;
                totalSold += sla; totalExecuted += real;
                results[c.id] = { sla, real, percent: p, hasActivity: (sla > 0 || real > 0) };
            });
            setClientMetricsMap(results);
            setGlobalMetrics({ totalSold, totalExecuted, criticalClients: [] });
        } catch (e) { console.error(e); }
    };

    const handleSaveInfo = async () => {
        if(!infoForm.name) return;
        await updateDoc(doc(db, 'clients', selectedClient.id), infoForm);
        setSelectedClient({...selectedClient, ...infoForm});
        setIsEditingInfo(false); toast.success('Actualizado');
    };

    const handleSaveService = async () => {
        await updateDoc(doc(db, 'servicios_sla', editingServiceId), tempService);
        setEditingServiceId(null); loadClientFullData(selectedClient.id); toast.success('SLA Actualizado');
    };

    const handleAddHistory = async () => {
        const note = { date: new Date().toISOString(), note: historyNote, user: currentUserName };
        await updateDoc(doc(db, 'clients', selectedClient.id), { historial: arrayUnion(note) });
        setSelectedClient({...selectedClient, historial: [...(selectedClient.historial || []), note]});
        setHistoryNote(''); toast.success('Nota guardada');
    };

    useEffect(() => { if (clients.length > 0) calculateDashboardMetrics(); }, [clients]);
    useEffect(() => { setFilteredClients(clients.filter(c => (c.name || '').toLowerCase().includes(searchTerm.toLowerCase()))); }, [searchTerm, clients]);

    return (
        <DashboardLayout>
            <Toaster position="top-center" richColors />
            <div className="max-w-7xl mx-auto p-6 space-y-8 animate-in fade-in">
                <div className="flex justify-between items-end">
                    <div>
                        <h1 className="text-4xl font-black text-slate-900 uppercase">Centro de Comando</h1>
                        <p className="text-sm font-bold text-indigo-600">Operador: {currentUserName}</p>
                    </div>
                    {view === 'detail' && <button onClick={() => setView('list')} className="bg-white border px-6 py-3 rounded-2xl text-[10px] font-black uppercase text-slate-500">Volver al Listado</button>}
                </div>

                {view === 'list' && (
                    <div className="space-y-6">
                        {/* DASHBOARD */}
                        <div className="bg-white border-2 border-slate-50 rounded-[2.5rem] shadow-xl overflow-hidden">
                            <div className="p-6 bg-slate-50/50 border-b flex justify-between cursor-pointer" onClick={()=>setShowGlobalDashboard(!showGlobalDashboard)}>
                                <h3 className="font-black text-xs text-slate-400 uppercase flex items-center gap-3"><BarChart3 size={18}/> Dashboard de Rentabilidad</h3>
                                {showGlobalDashboard ? <ChevronUp/> : <ChevronDown/>}
                            </div>
                            {showGlobalDashboard && (
                                <div className="p-8 grid grid-cols-1 md:grid-cols-3 gap-8">
                                    <div className="p-6 bg-indigo-50 rounded-3xl border border-indigo-100"><p className="text-[10px] font-black text-indigo-400 uppercase">SLA Vendido</p><p className="text-4xl font-black text-indigo-900">{globalMetrics.totalSold} hs</p></div>
                                    <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100"><p className="text-[10px] font-black text-slate-400 uppercase">Real Ejecutado</p><p className="text-4xl font-black text-slate-800">{globalMetrics.totalExecuted} hs</p></div>
                                    <div className="p-6 bg-white rounded-3xl border flex items-center gap-4"><TrendingUp className="text-emerald-500"/><p className="text-3xl font-black">{globalMetrics.totalSold > 0 ? Math.round((globalMetrics.totalExecuted/globalMetrics.totalSold)*100) : 0}%</p></div>
                                </div>
                            )}
                        </div>

                        <div className="bg-white p-4 rounded-3xl border flex gap-3 shadow-sm"><Search className="text-slate-300"/><input className="w-full outline-none font-bold" placeholder="Buscar..." value={searchTerm} onChange={e=>setSearchTerm(e.target.value)}/></div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            {filteredClients.map(c => (
                                <div key={c.id} onClick={()=>{setSelectedClient(c); loadClientFullData(c.id); setView('detail');}} className="bg-white p-8 rounded-[2.5rem] border hover:border-indigo-100 shadow-xl cursor-pointer group">
                                    <div className="flex justify-between mb-6"><div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-400 group-hover:bg-indigo-600 group-hover:text-white transition-all"><Building2/></div><span className="text-[10px] font-black px-3 py-1 rounded-full border bg-emerald-50 text-emerald-600">{c.status || 'ACTIVO'}</span></div>
                                    <h3 className="text-xl font-black text-slate-800 truncate">{c.name}</h3><p className="text-[10px] font-bold text-slate-400 uppercase mt-1">{c.taxId || 'S/C'}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {view === 'detail' && selectedClient && (
                    <div className="flex flex-col lg:flex-row gap-8">
                        <div className="w-full lg:w-1/4 space-y-6">
                            <div className="bg-white p-8 rounded-[2.5rem] border text-center shadow-sm sticky top-6">
                                <div className="w-24 h-24 bg-indigo-50 rounded-[2rem] flex items-center justify-center text-indigo-600 mx-auto mb-6 shadow-lg"><Building2 size={40}/></div>
                                <h2 className="text-2xl font-black text-slate-800 leading-tight">{selectedClient.name}</h2>
                                <p className="text-[10px] font-black text-slate-300 uppercase mt-2">{selectedClient.taxId}</p>
                            </div>
                        </div>

                        <div className="flex-1 bg-white rounded-[2.5rem] border shadow-sm overflow-hidden flex flex-col min-h-[600px]">
                            <div className="flex border-b">
                                {['INFO', 'CONTRATOS', 'SERVICIOS', 'SEDES', 'COTIZACIONES', 'HISTORIAL'].map(t => (
                                    <button key={t} onClick={() => setActiveTab(t)} className={`px-8 py-6 text-[10px] font-black uppercase tracking-widest border-b-[4px] transition-all ${activeTab === t ? 'border-indigo-600 text-indigo-600 bg-indigo-50/30' : 'border-transparent text-slate-400'}`}>{t}</button>
                                ))}
                            </div>

                            <div className="p-10 flex-1">
                                {activeTab === 'INFO' && (
                                    <div className="space-y-8">
                                        <div className="flex justify-between items-center"><h3 className="text-xl font-black text-slate-800 uppercase">Ficha Técnica</h3><button onClick={() => { setInfoForm(selectedClient); setIsEditingInfo(!isEditingInfo); }} className="text-indigo-600 font-black text-[10px] uppercase border px-4 py-2 rounded-xl">Editar</button></div>
                                        {isEditingInfo ? (
                                            <div className="space-y-4"><input className="w-full p-4 border rounded-2xl font-bold" value={infoForm.name} onChange={e=>setInfoForm({...infoForm, name:e.target.value})}/><button onClick={handleSaveInfo} className="bg-emerald-500 text-white px-8 py-3 rounded-2xl font-black uppercase text-xs">Guardar</button></div>
                                        ) : (
                                            <div className="p-6 bg-slate-50 rounded-3xl"><p className="text-[10px] font-black text-slate-400 uppercase">Nombre Comercial</p><p className="font-black text-lg text-slate-700">{selectedClient.name}</p></div>
                                        )}
                                    </div>
                                )}

                                {activeTab === 'CONTRATOS' && (
                                    <div className="space-y-4">
                                        <div className="flex justify-between items-center"><h3 className="text-xl font-black text-slate-800 uppercase">Acuerdos Administrativos</h3><button onClick={()=>setBillingModalOpen(true)} className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase flex gap-2"><Receipt size={14}/> Proforma</button></div>
                                        {clientContracts.map(c => (
                                            <div key={c.id} className="p-6 border rounded-3xl flex justify-between items-center shadow-sm">
                                                <div><p className="font-black text-slate-700 uppercase">{c.name}</p><p className="text-[10px] font-bold text-slate-400 uppercase">{c.startDate} - {c.endDate}</p></div>
                                                <p className="text-2xl font-black text-indigo-600">{c.totalHours} hs</p>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {activeTab === 'SERVICIOS' && (
                                    <div className="space-y-4">
                                        <h3 className="text-xl font-black text-slate-800 uppercase mb-6">Configuración SLA</h3>
                                        {editingServiceId && (
                                            <div className="p-6 bg-indigo-50 rounded-2xl mb-4 space-y-4">
                                                <input className="w-full p-3 rounded-xl border" value={tempService.objectiveName} onChange={e=>setTempService({...tempService, objectiveName:e.target.value})}/>
                                                <button onClick={handleSaveService} className="bg-indigo-600 text-white px-6 py-2 rounded-xl font-black uppercase text-xs">Confirmar</button>
                                            </div>
                                        )}
                                        {clientServices.map(s => (
                                            <div key={s.id} className="p-6 border rounded-3xl flex justify-between items-center">
                                                <div><p className="font-black text-slate-700 uppercase">{s.objectiveName}</p><p className="text-[10px] font-bold text-slate-400">Bolsa: {calculateMonthlySLA(s.positions, s.startDate, s.endDate)} hs</p></div>
                                                <button onClick={()=>{setEditingServiceId(s.id); setTempService(s);}} className="p-2 hover:bg-slate-100 rounded-lg"><Edit2 size={16}/></button>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {activeTab === 'SEDES' && (
                                    <div className="space-y-4">
                                        <h3 className="text-xl font-black text-slate-800 uppercase mb-6">Ubicaciones GPS</h3>
                                        {selectedClient.objetivos?.map((o, idx) => (
                                            <div key={idx} className="p-6 border rounded-3xl flex justify-between items-center">
                                                <div><p className="font-black text-slate-700 uppercase">{o.name}</p><p className="text-[10px] font-bold text-slate-400">{o.address}</p></div>
                                                <div className="flex gap-2">
                                                    {o.lat && <a href={`https://www.google.com/maps?q=${o.lat},${o.lng}`} target="_blank" className="p-3 bg-emerald-50 text-emerald-600 rounded-xl"><Globe size={18}/></a>}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {activeTab === 'COTIZACIONES' && (
                                    <div className="space-y-6">
                                        <div className="flex justify-between items-center"><h3 className="text-xl font-black text-slate-800 uppercase">Propuestas</h3><button onClick={()=>router.push('/admin/cotizador')} className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase">+ Nueva</button></div>
                                        <div className="border rounded-2xl overflow-hidden">
                                            <table className="w-full text-left">
                                                <thead className="bg-slate-50 text-[10px] font-black uppercase"><tr><th className="p-4">Fecha</th><th className="p-4">Monto</th><th className="p-4"></th></tr></thead>
                                                <tbody className="divide-y">
                                                    {clientQuotes.map(q => (
                                                        <tr key={q.id} className="text-xs font-bold">
                                                            <td className="p-4">{q.createdAt?.toDate().toLocaleDateString()}</td>
                                                            <td className="p-4">{formatMoney(q.results?.valorTotalContrato)}</td>
                                                            <td className="p-4 text-right"><Printer size={16} className="cursor-pointer hover:text-indigo-600"/></td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'HISTORIAL' && (
                                    <div className="space-y-6">
                                        <div className="flex gap-2"><input className="flex-1 p-3 border rounded-xl" placeholder="Agregar nota..." value={historyNote} onChange={e=>setHistoryNote(e.target.value)}/><button onClick={handleAddHistory} className="bg-indigo-600 text-white px-4 rounded-xl"><Send size={18}/></button></div>
                                        <div className="space-y-3">
                                            {selectedClient.historial?.map((h, i) => (
                                                <div key={i} className="p-4 bg-slate-50 rounded-2xl border"><p className="text-[10px] font-black text-slate-400 uppercase">{h.user} - {new Date(h.date).toLocaleString()}</p><p className="text-sm font-bold text-slate-700">{h.note}</p></div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </DashboardLayout>
    );
}
