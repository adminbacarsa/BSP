import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { db } from '@/lib/firebase';
import { collection, addDoc, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'; 
import { getAuth } from 'firebase/auth';
import { Toaster, toast } from 'sonner';
import { 
    Calculator, Settings, Users, Package, Clock, Trash2, Save, AlertTriangle, 
    X, CheckCircle, ArrowLeft, Shield, RefreshCw, Database,
    Car, Zap, Wifi, Radio, Plus, Briefcase, DollarSign, Building, BarChart3, TrendingUp,
    ChevronRight, CalendarRange, CalendarDays, Check, LayoutList, MapPin, Grid, Percent,
    Eye, FileSearch, Scale, AlertCircle, HardDrive, HelpCircle, BookOpen
} from 'lucide-react';

export default function SmartCostingPage() {
    const router = useRouter();
    const { clientId } = router.query;
    const [step, setStep] = useState(1);

    // --- 1. DATOS MAESTROS Y CATÁLOGOS ---
    const [categoriasDb, setCategoriasDb] = useState<any[]>([
        { id: 'vig_gral', nombre: 'Vigilador General', basico: 980000, viatico: 250000 },
        { id: 'monitoreo', nombre: 'Operador de Monitoreo', basico: 1150000, viatico: 250000 }
    ]);

    const [catalogoOperativo, setCatalogoOperativo] = useState<any[]>([
        { nombre: 'Móvil Patrulla', costo: 550000, tipo: 'mensual', porPuesto: false, icon: 'Car' },
        { nombre: 'Combustible', costo: 280000, tipo: 'mensual', porPuesto: false, icon: 'Zap' },
        { nombre: 'Moto 150cc', costo: 220000, tipo: 'mensual', porPuesto: false, icon: 'Zap' },
        { nombre: 'Tablet + App', costo: 35000, tipo: 'mensual', porPuesto: true, icon: 'Wifi' },
        { nombre: 'Equipo de Radio', costo: 25000, tipo: 'mensual', porPuesto: true, icon: 'Radio' },
        { nombre: 'Garita Química', costo: 85000, tipo: 'mensual', porPuesto: true, icon: 'Package' },
        { nombre: 'Kit Cámaras', costo: 450000, tipo: 'fijo', porPuesto: false, icon: 'Package' }, 
    ]);

    const ZONAS = [
        { id: 'cba', nombre: 'Córdoba Capital', flag: '🇦🇷' },
        { id: 'interior_cba', nombre: 'Interior Cba', flag: '⛰️' },
        { id: 'bue', nombre: 'Buenos Aires', flag: '🏙️' },
    ];

    const DIAS_SEMANA = [
        { id: 1, label: 'Lu' }, { id: 2, label: 'Ma' }, { id: 3, label: 'Mi' },
        { id: 4, label: 'Ju' }, { id: 5, label: 'Vi' }, { id: 6, label: 'Sa' }, { id: 0, label: 'Do' },
    ];

    // --- 2. ESTADO PRINCIPAL ---
    const [q, setQ] = useState({
        cliente: 'Nuevo Prospecto',
        zona: 'cba',
        modalidad: 'mensual', 
        mesesContrato: 24, 
        fechaInicio: new Date().toISOString().split('T')[0],
        fechaFin: '',
        diasEvento: 1,
        
        // Servicios
        servicios: [
            { id: 1, nombre: 'Puesto Principal', cantidad: 1, horas: 24, dias: [1, 2, 3, 4, 5, 6, 0] }
        ],
        
        // Oferta Mix
        teamMix: [
            { id: 1, categoria: 'Vigilador General', cantidad: 4, basico: 980000, viatico: 250000 } 
        ],
        
        // RRHH
        presentismo: 180000,
        cargasPatronales: 29.0, art: 7.5, seguroVida: 0.65, sindicato: 2.0, 
        provisionSAC: 8.33, provisionVacaciones: 4.5, previsionDespido: 2.0, ausentismo: 5.0,        
        capacidadHoraHombre: 200, 
        
        // Operativo
        uniformeMensual: 45000, equipamiento: 15000, supervision: 8.0,       
        
        // Financiero
        gastosEstructura: 12.0, iibb: 4.75, impuestoDebCred: 1.2,   
        diasPago: 30, inflacionMensual: 4.0, margenDeseado: 18.0     
    });

    // --- 3. ESTADOS AUXILIARES ---
    const [newService, setNewService] = useState({ nombre: '', cantidad: 1, horas: 12, dias: [1, 2, 3, 4, 5] });
    const [newRole, setNewRole] = useState({ categoria: '', cantidad: 1, basico: 0, viatico: 0 });
    const [itemsOperativos, setItemsOperativos] = useState<any[]>([]); 
    const [newItem, setNewItem] = useState({ nombre: '', costo: 0, tipo: 'mensual', porPuesto: false });

    // Modales
    const [mostrarCalculadoraSueldo, setMostrarCalculadoraSueldo] = useState(false);
    const [mostrarCalculadoraEstructura, setMostrarCalculadoraEstructura] = useState(false);
    const [mostrarDesglose, setMostrarDesglose] = useState(false);
    const [mostrarTutorial, setMostrarTutorial] = useState(false);
    const [loadingEscalas, setLoadingEscalas] = useState(false);

    // Estructura
    const [estructuraData, setEstructuraData] = useState({
        alquileres: 350000, sueldosAdmin: 2500000, sueldosSupervision: 1200000, 
        movilidadGeneral: 450000, impuestosFijos: 150000, otrosGastos: 200000,      
        totalLegajosEmpresa: 600, promedioSueldo: 1300000   
    });

    const [kpi, setKpi] = useState<any>({});
    const [proyeccionMensual, setProyeccionMensual] = useState<any[]>([]);

    // --- 4. CARGA INICIAL ---
    useEffect(() => {
        const fetchEscalas = async () => {
            setLoadingEscalas(true);
            try {
                const pointerRef = doc(db, 'settings_laborales', 'current_cba');
                const pointerSnap = await getDoc(pointerRef);
                if (pointerSnap.exists()) {
                    const activeId = pointerSnap.data().ref;
                    const escalaSnap = await getDoc(doc(db, 'settings_laborales', activeId));
                    if (escalaSnap.exists()) {
                        const data = escalaSnap.data();
                        if(data.categories) setCategoriasDb(data.categories);
                        if(data.globals) setQ(prev => ({...prev, ...data.globals}));
                    }
                }
            } catch (error) { console.error(error); } 
            finally { setLoadingEscalas(false); }
        };

        const fetchDefaults = async () => {
            try {
                const defaultsRef = doc(db, 'settings_cotizador', 'defaults');
                const defaultsSnap = await getDoc(defaultsRef);
                if (defaultsSnap.exists()) {
                    const data = defaultsSnap.data();
                    if (data.estructuraData) setEstructuraData(data.estructuraData);
                    if (data.globales) {
                        setQ(prev => ({
                            ...prev,
                            uniformeMensual: data.globales.uniformeMensual,
                            equipamiento: data.globales.equipamiento,
                            supervision: data.globales.supervision,
                            gastosEstructura: data.globales.gastosEstructura,
                            iibb: data.globales.iibb,
                            impuestoDebCred: data.globales.impuestoDebCred,
                            margenDeseado: data.globales.margenDeseado
                        }));
                    }
                }
            } catch (error) { console.error(error); }
        };

        fetchEscalas();
        fetchDefaults();
    }, []);

    useEffect(() => {
        if (clientId) {
            const loadClient = async () => {
                try {
                    const snap = await getDoc(doc(db, 'clients', clientId as string));
                    if (snap.exists()) setQ(prev => ({ ...prev, cliente: snap.data().name || '' }));
                } catch (e) { console.error(e); }
            };
            loadClient();
        }
    }, [clientId]);

    useEffect(() => { calculateMetrics(); }, [q, itemsOperativos]);

    // --- 5. MOTOR DE CÁLCULO ---
    const calculateMetrics = () => {
        let horasTotalesA_Cubrir = 0;
        
        q.servicios.forEach(s => {
            if (q.modalidad === 'evento') {
                horasTotalesA_Cubrir += (s.horas * s.cantidad) * q.diasEvento;
            } else {
                const weeklyHours = s.horas * s.cantidad * s.dias.length;
                horasTotalesA_Cubrir += weeklyHours * 4.33;
            }
        });

        let costoMasaSalarialTotalMix = 0;
        let personasEnMix = 0;
        
        q.teamMix.forEach(role => {
            const bruto = role.basico + q.presentismo;
            const cargas = bruto * ((q.cargasPatronales + q.art + q.seguroVida + q.sindicato) / 100);
            const provisiones = (bruto + cargas) * ((q.provisionSAC + q.provisionVacaciones + q.previsionDespido + q.ausentismo) / 100);
            const totalRol = bruto + cargas + role.viatico + provisiones;
            costoMasaSalarialTotalMix += (totalRol * role.cantidad);
            personasEnMix += role.cantidad;
        });

        const costoUniformesBase = q.uniformeMensual * personasEnMix;
        const costoEquipamientoBase = q.equipamiento * personasEnMix;
        let costoAdicionalesBase = 0;
        const totalPuestosSimultaneos = q.servicios.reduce((acc, s) => acc + s.cantidad, 0);

        itemsOperativos.forEach(item => {
            let valor = item.costo;
            if (item.porPuesto) valor = valor * totalPuestosSimultaneos;
            if (item.tipo === 'mensual') costoAdicionalesBase += valor;
            if (item.tipo === 'fijo' && q.modalidad === 'mensual') costoAdicionalesBase += (valor / (q.mesesContrato || 12));
        });

        // Proyección Cash Flow
        let totalHorasContrato = 0;
        let totalValorContrato = 0;
        let proyeccion = [];
        
        let currentDate = new Date();
        if (q.fechaInicio) {
            const [y, m, d] = q.fechaInicio.split('-');
            currentDate = new Date(parseInt(y), parseInt(m)-1, parseInt(d));
        }

        const duracion = q.modalidad === 'evento' ? 1 : (q.mesesContrato || 12);
        
        for (let i = 0; i < duracion; i++) {
            let horasMes = 0;
            if (q.modalidad === 'evento') {
                q.servicios.forEach(s => { horasMes += (s.horas * s.cantidad) * q.diasEvento; });
            } else {
                const year = currentDate.getFullYear();
                const month = currentDate.getMonth(); 
                const daysInMonth = new Date(year, month + 1, 0).getDate(); 
                
                q.servicios.forEach(s => {
                    let diasOperativosEnMes = 0;
                    for(let d=1; d<=daysInMonth; d++) {
                        const dayOfWeek = new Date(year, month, d).getDay(); 
                        if (s.dias.includes(dayOfWeek)) diasOperativosEnMes++;
                    }
                    horasMes += s.horas * s.cantidad * diasOperativosEnMes;
                });
            }

            const factorInflacion = Math.pow(1 + (q.inflacionMensual / 100), i);
            
            const costoLaboralMes = costoMasaSalarialTotalMix * factorInflacion;
            const costoOperativoMes = (costoUniformesBase + costoEquipamientoBase + costoAdicionalesBase) * factorInflacion;
            const costoSupervisionMes = (costoLaboralMes + costoOperativoMes) * (q.supervision / 100);
            const costoDirectoMes = costoLaboralMes + costoOperativoMes + costoSupervisionMes;

            const costoEstructuraMes = costoDirectoMes * (q.gastosEstructura / 100);
            const subtotalMes = costoDirectoMes + costoEstructuraMes;
            
            const factorFinancieroPago = (q.inflacionMensual / 100 / 30) * q.diasPago;
            const costoFinancieroMes = subtotalMes * factorFinancieroPago;
            const costoTotalMes = subtotalMes + costoFinancieroMes;

            const denominator = 1 - ((q.iibb + q.impuestoDebCred + q.margenDeseado) / 100);
            let precioVentaMes = 0;
            if (denominator > 0) precioVentaMes = costoTotalMes / denominator;

            totalHorasContrato += horasMes;
            totalValorContrato += precioVentaMes;

            proyeccion.push({
                periodo: i + 1,
                mes: currentDate.toLocaleDateString('es-AR', { month: 'short', year: '2-digit' }),
                horas: horasMes,
                costo: costoTotalMes,
                venta: precioVentaMes,
                inflacionAcum: (factorInflacion - 1) * 100,
                precioHora: horasMes > 0 ? precioVentaMes / horasMes : 0
            });

            currentDate.setMonth(currentDate.getMonth() + 1);
        }

        setProyeccionMensual(proyeccion);

        const mes1 = proyeccion[0] || {};
        const dotacionTeorica = (totalHorasContrato / (q.mesesContrato||1)) / 200;

        setKpi({
            costoLaboralTotal: mes1.costo ? costoMasaSalarialTotalMix : 0, 
            costoOperativoTotal: mes1.costo ? (costoUniformesBase + costoEquipamientoBase + costoAdicionalesBase) : 0,
            precioVentaMes1: mes1.venta || 0,
            costoFinancieroMes1: (mes1.costo || 0) * ((q.inflacionMensual / 100 / 30) * q.diasPago),
            horasTotales: Math.round(totalHorasContrato),
            valorTotalContrato: totalValorContrato,
            precioHoraPromedio: totalHorasContrato > 0 ? totalValorContrato / totalHorasContrato : 0,
            precioHoraMes1: mes1.precioHora || 0,
            dotacionTeorica: dotacionTeorica,
            dotacionReal: personasEnMix,
            
            // Valores Mes 1 para desglose
            costoDirectoTotal: mes1.costo ? (costoMasaSalarialTotalMix + costoUniformesBase + costoEquipamientoBase + costoAdicionalesBase + (costoMasaSalarialTotalMix + costoUniformesBase + costoEquipamientoBase + costoAdicionalesBase) * (q.supervision/100)) : 0,
            costoEstructura: mes1.costo ? (costoMasaSalarialTotalMix + costoUniformesBase + costoEquipamientoBase + costoAdicionalesBase + (costoMasaSalarialTotalMix + costoUniformesBase + costoEquipamientoBase + costoAdicionalesBase) * (q.supervision/100)) * (q.gastosEstructura/100) : 0,
            costoFinanciero: mes1.costo ? ((costoMasaSalarialTotalMix + costoUniformesBase + costoEquipamientoBase + costoAdicionalesBase + (costoMasaSalarialTotalMix + costoUniformesBase + costoEquipamientoBase + costoAdicionalesBase) * (q.supervision/100)) * (1 + q.gastosEstructura/100)) * ((q.inflacionMensual / 100 / 30) * q.diasPago) : 0,
            precioVentaTotal: mes1.venta || 0,
            costoTotalCompleto: mes1.costo || 0 
        });
    };

    // --- 6. HANDLERS UI ---
    const handleInputChange = (field: string, value: any) => setQ(prev => ({ ...prev, [field]: parseFloat(value) || value }));
    const addServiceLine = () => {
        if (!newService.nombre) return toast.error("Ingrese nombre");
        let diasFinales = newService.dias;
        if (newService.horas === 24 && q.modalidad === 'mensual') diasFinales = [1, 2, 3, 4, 5, 6, 0];
        setQ(prev => ({ ...prev, servicios: [...prev.servicios, { ...newService, dias: diasFinales, id: Date.now() }] }));
    };
    const removeServiceLine = (id: number) => setQ(prev => ({ ...prev, servicios: prev.servicios.filter(s => s.id !== id) }));
    const toggleNewServiceDay = (dayId: number) => {
        if (newService.horas === 24) return toast.info("24hs es semana completa");
        setNewService(prev => ({ ...prev, dias: prev.dias.includes(dayId) ? prev.dias.filter(d => d !== dayId) : [...prev.dias, dayId] }));
    };
    const handleDateChange = (type: 'start' | 'end', value: string) => {
        setQ(prev => ({ ...prev, [type === 'start' ? 'fechaInicio' : 'fechaFin']: value }));
    };
    
    const seleccionarCategoria = (e: any) => { const cat = categoriasDb.find(c => c.id === e.target.value); if (cat) setNewRole({ ...newRole, categoria: cat.nombre, basico: cat.basico, viatico: cat.viatico }); };
    const agregarRolAlMix = () => { if (newRole.categoria) setQ(prev => ({ ...prev, teamMix: [...prev.teamMix, { ...newRole, id: Date.now() }] })); };
    const eliminarRolMix = (id: number) => setQ(prev => ({ ...prev, teamMix: prev.teamMix.filter(r => r.id !== id) }));
    const agregarItemOperativo = () => { if (newItem.nombre && newItem.costo > 0) { setItemsOperativos([...itemsOperativos, { ...newItem, id: Date.now() }]); setNewItem({ ...newItem, nombre: '', costo: 0 }); } };
    const eliminarItem = (id: number) => setItemsOperativos(itemsOperativos.filter(i => i.id !== id));

    const guardarConfiguracionGlobal = async () => {
        try {
            await setDoc(doc(db, 'settings_cotizador', 'defaults'), {
                estructuraData: estructuraData,
                globales: {
                    uniformeMensual: q.uniformeMensual,
                    equipamiento: q.equipamiento,
                    supervision: q.supervision,
                    gastosEstructura: q.gastosEstructura,
                    iibb: q.iibb,
                    impuestoDebCred: q.impuestoDebCred,
                    margenDeseado: q.margenDeseado
                },
                updatedAt: serverTimestamp()
            });
            toast.success("Configuración guardada.");
        } catch (e) { toast.error("Error al guardar config."); }
    };

    const calcularPorcentajeEstructura = async () => {
        const { alquileres, sueldosAdmin, sueldosSupervision, movilidadGeneral, impuestosFijos, otrosGastos, totalLegajosEmpresa, promedioSueldo } = estructuraData;
        const total = alquileres + sueldosAdmin + sueldosSupervision + movilidadGeneral + impuestosFijos + otrosGastos;
        const directo = totalLegajosEmpresa * (promedioSueldo * 1.45); 
        if (directo > 0) {
            const pct = (total / directo) * 100;
            setQ(prev => ({ ...prev, gastosEstructura: parseFloat(pct.toFixed(2)) }));
            await guardarConfiguracionGlobal();
            setMostrarCalculadoraEstructura(false);
            toast.success(`Estructura: ${pct.toFixed(2)}%`);
        } else toast.error("Revise cantidad legajos");
    };

    const guardarCotizacion = async () => {
        try {
            const auth = getAuth();
            const data = {
                createdAt: serverTimestamp(), createdBy: auth.currentUser?.email || 'unknown',
                clientId: clientId || null, client: q.cliente, params: q, 
                items: itemsOperativos, team: q.teamMix, results: kpi, 
                proyeccion: proyeccionMensual, 
                status: 'BORRADOR'
            };
            await addDoc(collection(db, 'quotes'), data);
            toast.success("Cotización Guardada");
            setTimeout(() => { if (clientId) router.push(`/admin/crm?clientId=${clientId}`); else router.push('/admin/crm'); }, 1500);
        } catch (e) { toast.error("Error al guardar"); }
    };

    const formatMoney = (val: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(val || 0);

    return (
        <DashboardLayout>
            <Head><title>Smart Costing</title></Head>
            <Toaster position="top-center" />
            
            <div className="max-w-7xl mx-auto p-4 md:p-6 bg-slate-50 min-h-screen relative pb-32 animate-in fade-in">
                
                {/* HEADER */}
                <div className="mb-8 flex justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                    <div className="flex items-center gap-4">
                        <div className="bg-indigo-600 p-3 rounded-lg text-white shadow"><Calculator size={24} /></div>
                        <div><h1 className="text-xl font-black text-slate-800">Cotizador Enterprise</h1><p className="text-xs text-slate-400">Ingeniería de Costos V.18</p></div>
                    </div>
                    <div className="flex gap-2">
                        <button onClick={guardarConfiguracionGlobal} className="px-4 py-2 border rounded-lg text-xs font-bold text-indigo-600 border-indigo-200 hover:bg-indigo-50 flex items-center gap-2"><HardDrive size={14}/> Guardar Config</button>
                        <button onClick={() => setMostrarTutorial(true)} className="px-4 py-2 bg-slate-800 text-white rounded-lg text-xs font-bold flex items-center gap-2 hover:bg-slate-700 shadow-md"><HelpCircle size={14}/> Auditoría de Cálculo</button>
                        {clientId && <button onClick={() => router.push('/admin/crm')} className="px-4 py-2 border rounded-lg text-xs font-bold text-slate-500 hover:bg-slate-50">Volver</button>}
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    <div className="lg:col-span-8 space-y-6">
                        {/* TABS */}
                        <div className="flex justify-between bg-white p-1 rounded-xl shadow-sm border border-slate-200">
                            {[{ id: 1, label: '1. Servicios' }, { id: 2, label: '2. Recursos' }, { id: 3, label: '3. Operativo' }, { id: 4, label: '4. Financiero' }].map((s) => (
                                <button key={s.id} onClick={() => setStep(s.id)} className={`flex-1 py-3 rounded-lg text-xs font-bold transition-all ${step === s.id ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:bg-slate-50'}`}>{s.label}</button>
                            ))}
                        </div>

                        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 min-h-[500px]">
                            
                            {/* PASO 1 */}
                            {step === 1 && (
                                <div className="space-y-6 animate-in fade-in">
                                    <div className="flex justify-between border-b pb-4 mb-4"><h3 className="text-lg font-black text-slate-800">Configuración</h3><div className="flex bg-slate-100 p-1 rounded-lg"><button onClick={() => setQ({...q, modalidad: 'mensual'})} className={`px-4 py-1 text-xs font-bold rounded ${q.modalidad === 'mensual' ? 'bg-white shadow text-indigo-600' : 'text-slate-400'}`}>Mensual</button><button onClick={() => setQ({...q, modalidad: 'evento'})} className={`px-4 py-1 text-xs font-bold rounded ${q.modalidad === 'evento' ? 'bg-white shadow text-emerald-600' : 'text-slate-400'}`}>Evento</button></div></div>
                                    <div className="grid grid-cols-2 gap-6">
                                        <div className="input-box bg-white border border-slate-300 rounded-lg p-3 shadow-sm"><label className="block text-[10px] font-bold text-slate-400 uppercase mb-1 tracking-wider">Cliente</label><input type="text" value={q.cliente} onChange={e => handleInputChange('cliente', e.target.value)} className="w-full text-lg font-black text-slate-800 outline-none"/></div>
                                        <div className="input-box bg-white border border-slate-300 rounded-lg p-3 shadow-sm"><label className="block text-[10px] font-bold text-slate-400 uppercase mb-1 tracking-wider">Zona</label><select value={q.zona} onChange={e => setQ({...q, zona: e.target.value})} className="w-full text-lg font-black text-slate-800 outline-none bg-transparent">{ZONAS.map(z => <option key={z.id} value={z.id}>{z.nombre}</option>)}</select></div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-6">
                                        {q.modalidad === 'mensual' ? (
                                            <div className="input-box bg-white border border-slate-300 rounded-lg p-3 shadow-sm relative"><label className="block text-[10px] font-bold text-slate-400 uppercase mb-1 tracking-wider">Contrato (Meses)</label><input type="number" value={q.mesesContrato} onChange={e => handleInputChange('mesesContrato', e.target.value)} className="w-full text-lg font-black text-slate-800 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"/><span className="absolute right-4 bottom-3 font-bold text-xs text-slate-400">MESES</span></div>
                                        ) : (
                                            <div className="input-box bg-white border border-slate-300 rounded-lg p-3 shadow-sm"><label className="block text-[10px] font-bold text-slate-400 uppercase mb-1 tracking-wider">Fin de Evento</label><input type="date" value={q.fechaFin} onChange={e => handleDateChange('end', e.target.value)} className="w-full text-lg font-black text-slate-800 outline-none"/></div>
                                        )}
                                        <div className="input-box bg-white border border-slate-300 rounded-lg p-3 shadow-sm">
                                            <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1 tracking-wider">Inicio de Servicio</label>
                                            <input type="date" value={q.fechaInicio} onChange={e => handleDateChange('start', e.target.value)} className="w-full text-lg font-black text-slate-800 outline-none"/>
                                        </div>
                                    </div>
                                    <div className="bg-slate-50 border border-slate-200 p-5 rounded-xl"><h4 className="text-xs font-bold text-slate-500 uppercase mb-4">Agregar Línea</h4><div className="grid grid-cols-12 gap-4 items-center"><div className="col-span-5 bg-white border rounded-lg p-2 shadow-sm"><label className="block text-[9px] font-bold text-slate-400 uppercase">Puesto</label><input value={newService.nombre} onChange={e => setNewService({...newService, nombre: e.target.value})} className="w-full font-bold text-sm outline-none"/></div><div className="col-span-2 bg-white border rounded-lg p-2 shadow-sm"><label className="block text-[9px] font-bold text-slate-400 uppercase">Cant.</label><input type="number" min="1" value={newService.cantidad} onChange={e => setNewService({...newService, cantidad: parseInt(e.target.value)})} className="w-full font-bold text-sm outline-none text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"/></div><div className="col-span-3 bg-white border rounded-lg p-2 shadow-sm"><label className="block text-[9px] font-bold text-slate-400 uppercase">Horas</label><select value={newService.horas} onChange={e => setNewService({...newService, horas: parseInt(e.target.value)})} className="w-full font-bold text-sm outline-none bg-transparent"><option value="24">24 Hs</option><option value="12">12 Hs</option><option value="8">8 Hs</option><option value="4">4 Hs</option></select></div><div className="col-span-2"><button onClick={addServiceLine} className="w-full bg-indigo-600 text-white font-bold py-2 rounded-lg shadow hover:bg-indigo-700 text-xs">AGREGAR</button></div></div>{q.modalidad === 'mensual' && <div className="flex gap-2 mt-4 pt-3 border-t">{DIAS_SEMANA.map((day) => (<button key={day.id} onClick={() => toggleNewServiceDay(day.id)} disabled={newService.horas == 24} className={`h-8 flex-1 rounded border text-[10px] font-bold ${newService.dias.includes(day.id) ? 'bg-indigo-600 text-white' : 'bg-white text-slate-400'}`}>{day.label}</button>))}</div>}</div>
                                    <div className="space-y-2">{q.servicios.map(s => (<div key={s.id} className="flex justify-between items-center p-4 bg-white border border-slate-200 rounded-lg shadow-sm"><div><p className="font-bold text-slate-800">{s.nombre}</p><p className="text-xs text-slate-500">{s.cantidad} Puestos x {s.horas}hs</p></div><button onClick={() => removeServiceLine(s.id)} className="text-slate-300 hover:text-red-500"><Trash2/></button></div>))}</div>
                                </div>
                            )}

                            {/* PASO 2 */}
                            {step === 2 && (
                                <div className="space-y-6">
                                    <div className="flex justify-between items-center mb-4 border-b pb-4"><h3 className="text-lg font-black text-slate-800">Mix de Recursos (Oferta)</h3><div className="text-right"><span className="text-[10px] font-bold text-slate-400 uppercase block">Demanda vs Oferta</span><span className={`text-lg font-black ${kpi.dotacionReal < kpi.dotacionTeorica ? 'text-amber-500' : 'text-emerald-500'}`}>{kpi.dotacionReal} / {Math.ceil(kpi.dotacionTeorica)} FTEs</span></div></div>
                                    <div className="bg-slate-50 p-5 rounded-xl border border-slate-200"><div className="grid grid-cols-12 gap-4 items-center"><div className="col-span-5 bg-white border rounded-lg p-2 shadow-sm"><label className="block text-[9px] font-bold text-slate-400 uppercase">Categoría</label><select onChange={seleccionarCategoria} className="w-full font-bold text-sm outline-none bg-transparent"><option>Seleccionar...</option>{categoriasDb.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></div><div className="col-span-3 bg-white border rounded-lg p-2 shadow-sm"><label className="block text-[9px] font-bold text-slate-400 uppercase">Básico</label><input type="number" value={newRole.basico} onChange={e => setNewRole({...newRole, basico: parseFloat(e.target.value)})} className="w-full font-bold text-sm outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"/></div><div className="col-span-2 bg-white border rounded-lg p-2 shadow-sm"><label className="block text-[9px] font-bold text-slate-400 uppercase">Cant.</label><input type="number" value={newRole.cantidad} onChange={e => setNewRole({...newRole, cantidad: parseFloat(e.target.value)})} className="w-full font-bold text-sm outline-none text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"/></div><div className="col-span-2"><button onClick={agregarRolAlMix} className="w-full bg-indigo-600 text-white font-bold py-2 rounded-lg shadow-md"><Plus/></button></div></div></div>
                                    <div className="space-y-2">{q.teamMix.map(r => (<div key={r.id} className="flex justify-between items-center p-3 border rounded-xl"><span className="font-bold">{r.cantidad}x {r.categoria}</span><span className="font-mono text-slate-500">{formatMoney(r.basico)}</span><button onClick={() => eliminarRolMix(r.id)} className="text-red-400"><Trash2 size={16}/></button></div>))}</div>
                                    <div className="grid grid-cols-4 gap-4 mt-6">{['cargasPatronales', 'art', 'ausentismo', 'previsionDespido'].map(k => (<div key={k} className="bg-white border rounded-lg p-2 text-center shadow-sm"><label className="block text-[9px] font-bold text-slate-400 uppercase">{k.substring(0,6)}</label><input value={(q as any)[k]} onChange={e => setQ({...q, [k]: parseFloat(e.target.value)})} className="w-full text-center font-bold text-slate-700 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"/></div>))}</div>
                                </div>
                            )}

                            {/* PASO 3 */}
                            {step === 3 && (
                                <div className="space-y-6">
                                    <h3 className="text-lg font-black text-slate-800 border-b pb-4 mb-4">Costos Operativos</h3>
                                    <div className="grid grid-cols-2 gap-6"><div className="bg-white border border-slate-300 rounded-lg p-3 shadow-sm"><label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Uniformes</label><input type="number" value={q.uniformeMensual} onChange={e => setQ({...q, uniformeMensual: parseFloat(e.target.value)})} className="w-full text-lg font-black text-slate-800 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"/></div><div className="bg-white border border-slate-300 rounded-lg p-3 shadow-sm"><label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Equipos</label><input type="number" value={q.equipamiento} onChange={e => setQ({...q, equipamiento: parseFloat(e.target.value)})} className="w-full text-lg font-black text-slate-800 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"/></div></div>
                                    <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200"><div className="grid grid-cols-12 gap-4 items-center"><div className="col-span-5 bg-white border rounded-lg p-2"><label className="block text-[9px] font-bold text-slate-400 uppercase">Ítem</label><input value={newItem.nombre} onChange={e => setNewItem({...newItem, nombre: e.target.value})} className="w-full font-bold text-sm outline-none"/></div><div className="col-span-3 bg-white border rounded-lg p-2"><label className="block text-[9px] font-bold text-slate-400 uppercase">Costo</label><input type="number" value={newItem.costo} onChange={e => setNewItem({...newItem, costo: parseFloat(e.target.value)})} className="w-full font-bold text-sm outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"/></div><div className="col-span-3 bg-white border rounded-lg p-2"><label className="block text-[9px] font-bold text-slate-400 uppercase">Tipo</label><select value={newItem.tipo} onChange={e => setNewItem({...newItem, tipo: e.target.value})} className="w-full font-bold text-sm outline-none bg-transparent"><option value="mensual">Mensual</option><option value="fijo">Fijo</option></select></div><div className="col-span-1"><button onClick={agregarItemOperativo} className="w-full bg-indigo-600 text-white font-bold py-2 rounded-xl shadow-md"><Plus/></button></div></div></div>
                                    {itemsOperativos.map(i => (<div key={i.id} className="flex justify-between items-center p-3 border rounded-xl"><span className="font-bold">{i.nombre}</span><span className="font-mono text-slate-500">{formatMoney(i.costo)}</span><button onClick={() => eliminarItem(i.id)} className="text-red-400"><Trash2 size={16}/></button></div>))}
                                </div>
                            )}

                            {/* PASO 4 */}
                            {step === 4 && (
                                <div className="space-y-6">
                                    <h3 className="text-lg font-black text-slate-800 border-b pb-4 mb-4">Cierre Financiero</h3>
                                    <div className="bg-indigo-50 p-5 rounded-xl border border-indigo-100 mb-6"><div className="grid grid-cols-2 gap-6"><div className="bg-white border border-indigo-200 rounded-lg p-3 shadow-sm"><label className="block text-[10px] font-bold text-indigo-400 uppercase mb-1">Días de Pago</label><div className="flex gap-2">{[0,30,45,60].map(d => (<button key={d} onClick={() => setQ({...q, diasPago: d})} className={`flex-1 text-xs font-bold py-1 rounded ${q.diasPago === d ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-500'}`}>{d}</button>))}</div></div><div className="bg-white border border-indigo-200 rounded-lg p-3 shadow-sm relative"><label className="block text-[10px] font-bold text-indigo-400 uppercase mb-1">Inflación Mensual</label><input type="number" value={q.inflacionMensual} onChange={e => setQ({...q, inflacionMensual: parseFloat(e.target.value)})} className="w-full text-lg font-black text-indigo-900 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"/><span className="absolute right-4 bottom-3 font-bold text-indigo-200">%</span></div></div></div>
                                    <div className="grid grid-cols-2 gap-6"><div className="bg-white border border-slate-300 rounded-lg p-3 shadow-sm relative"><div className="flex justify-between"><label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Gastos Estructura</label><button onClick={() => setMostrarCalculadoraEstructura(true)} className="text-[9px] text-indigo-600 font-bold underline">CALCULAR</button></div><input type="number" value={q.gastosEstructura} onChange={e => setQ({...q, gastosEstructura: parseFloat(e.target.value)})} className="w-full text-lg font-black text-slate-800 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"/><span className="absolute right-4 bottom-3 font-bold text-slate-300">%</span></div><div className="bg-white border border-emerald-300 rounded-lg p-3 shadow-sm relative ring-2 ring-emerald-50"><label className="block text-[10px] font-bold text-emerald-600 uppercase mb-1">Margen Deseado</label><input type="number" value={q.margenDeseado} onChange={e => setQ({...q, margenDeseado: parseFloat(e.target.value)})} className="w-full text-lg font-black text-emerald-700 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"/><span className="absolute right-4 bottom-3 font-bold text-emerald-300">%</span></div></div>
                                    <div className="grid grid-cols-2 gap-6"><div className="bg-white border border-slate-300 rounded-lg p-3 shadow-sm relative"><label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">IIBB + Tasas</label><input value={q.iibb} onChange={e => setQ({...q, iibb: parseFloat(e.target.value)})} className="w-full text-lg font-black text-slate-800 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"/><span className="absolute right-4 bottom-3 font-bold text-slate-300">%</span></div><div className="bg-white border border-slate-300 rounded-lg p-3 shadow-sm relative"><label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Imp. Cheque</label><input value={q.impuestoDebCred} onChange={e => setQ({...q, impuestoDebCred: parseFloat(e.target.value)})} className="w-full text-lg font-black text-slate-800 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"/><span className="absolute right-4 bottom-3 font-bold text-slate-300">%</span></div></div>
                                </div>
                            )}

                        </div>
                    </div>

                    <div className="lg:col-span-4 space-y-4">
                        <div className="sticky top-6">
                            <div className="bg-gray-900 rounded-xl p-6 text-white shadow-2xl">
                                <p className="text-gray-400 text-[10px] font-bold uppercase tracking-widest mb-2">Precio por Hora Mes 1</p>
                                <div className="text-5xl font-black mb-6">{formatMoney(kpi.precioHoraMes1)}</div>
                                <div className="border-t border-gray-700 pt-4 space-y-2">
                                    <div className="flex justify-between text-xs font-bold text-gray-400"><span>PRECIO MES 1</span> <span>{formatMoney(kpi.precioVentaMes1)}</span></div>
                                    <div className="flex justify-between text-lg font-bold text-emerald-400"><span>TOTAL CONTRATO</span> <span>{formatMoney(kpi.valorTotalContrato)}</span></div>
                                    
                                    <div className="bg-gray-800 rounded p-3 mt-3 grid grid-cols-2 gap-2 text-center">
                                        <div><p className="text-[9px] text-gray-400 uppercase">HORAS TOTALES</p><p className="font-bold text-white text-sm">{kpi.horasTotales} hs</p></div>
                                        <div><p className="text-[9px] text-gray-400 uppercase">PROMEDIO MES</p><p className="font-bold text-white text-sm">{formatMoney(kpi.valorTotalContrato / (q.mesesContrato||1))}</p></div>
                                    </div>

                                    <button onClick={() => setMostrarDesglose(true)} className="w-full mt-4 bg-indigo-600 py-2 rounded flex items-center justify-center gap-2 text-xs font-bold hover:bg-indigo-700 transition-colors"><Eye size={14}/> Ver Desglose</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* FOOTER */}
                <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 flex justify-between z-50 lg:pl-72">
                    <button onClick={() => setStep(s => Math.max(1, s-1))} disabled={step===1} className="px-6 py-3 font-bold text-gray-500 hover:bg-gray-100 rounded-lg disabled:opacity-50">Atrás</button>
                    {step < 4 ? <button onClick={() => setStep(s => Math.min(4, s+1))} className="px-8 py-3 bg-indigo-600 text-white font-bold rounded-lg shadow hover:bg-indigo-700">Siguiente</button> : <button onClick={guardarCotizacion} className="px-8 py-3 bg-emerald-600 text-white font-bold rounded-lg shadow hover:bg-emerald-700">Guardar Final</button>}
                </div>
            </div>

            {/* MODALES */}
            {mostrarCalculadoraEstructura && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6">
                        <div className="flex justify-between items-center mb-6 border-b pb-4"><h3 className="text-lg font-bold text-gray-800">Calculadora Estructura</h3><button onClick={() => setMostrarCalculadoraEstructura(false)}><X/></button></div>
                        <div className="bg-indigo-50 p-4 rounded-lg border border-indigo-200 mb-4"><label className="block text-[10px] font-bold text-indigo-700 uppercase">Dotación Total</label><input type="number" value={estructuraData.totalLegajosEmpresa} onChange={e => setEstructuraData({...estructuraData, totalLegajosEmpresa: parseFloat(e.target.value)})} className="w-full text-center font-black text-lg bg-white border border-indigo-300 rounded p-2 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"/></div>
                        <div className="grid grid-cols-2 gap-3 mb-4">{Object.keys(estructuraData).filter(k => k!=='totalLegajosEmpresa' && k!=='promedioSueldo').map(k => (<div key={k}><label className="text-[9px] text-gray-400 font-bold uppercase">{k.replace(/([A-Z])/g, ' $1').trim()}</label><input type="number" value={(estructuraData as any)[k]} onChange={e => setEstructuraData({...estructuraData, [k]: parseFloat(e.target.value)})} className="w-full p-2 rounded border text-sm font-bold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"/></div>))}</div>
                        <button onClick={calcularPorcentajeEstructura} className="w-full bg-indigo-600 text-white font-bold py-3 rounded-lg">Calcular e Impactar</button>
                    </div>
                </div>
            )}
            
            {/* MODAL TUTORIAL (AUDITORÍA) */}
            {mostrarTutorial && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-0 overflow-hidden flex flex-col max-h-[90vh]">
                        <div className="bg-indigo-900 p-6 text-white">
                            <h2 className="text-2xl font-black flex items-center gap-2"><BookOpen/> Memoria de Cálculo</h2>
                            <p className="text-indigo-200 text-sm mt-1">Explicación técnica de la lógica financiera utilizada.</p>
                        </div>
                        <div className="p-6 overflow-y-auto space-y-6 text-sm text-slate-600">
                            <div><h3 className="font-bold text-slate-900 mb-2">1. Cálculo de Horas (Demanda)</h3><p>Se calcula la cantidad exacta de horas operativas mensuales basándose en el calendario real (días hábiles vs fines de semana) o la duración del evento.</p></div>
                            <div><h3 className="font-bold text-slate-900 mb-2">2. Costo Laboral (Oferta)</h3><p>Se suman los costos de todos los perfiles asignados (Sueldo Básico + Viáticos + Adicionales). A este subtotal se le aplican las Cargas Sociales ({q.cargasPatronales}%) y Provisiones (Aguinaldo, Vacaciones, Despido).</p></div>
                            <div><h3 className="font-bold text-slate-900 mb-2">3. Proyección de Flujo de Fondos (Cash Flow)</h3><p>El sistema proyecta el contrato a {q.mesesContrato} meses aplicando el índice de inflación mensual ({q.inflacionMensual}%) de forma compuesta mes a mes. Esto ajusta el Costo Total del Contrato a valores futuros reales.</p><div className="mt-2 p-3 bg-slate-100 rounded border border-slate-200 font-mono text-xs">Fórmula: CostoMes_n = CostoBase * (1 + Inflacion)^n</div></div>
                            <div><h3 className="font-bold text-slate-900 mb-2">4. Costo Financiero</h3><p>Se calcula el costo de oportunidad del dinero basado en los Días de Pago del cliente.</p></div>
                        </div>
                        <div className="p-4 border-t bg-slate-50 flex justify-end"><button onClick={() => setMostrarTutorial(false)} className="px-6 py-2 bg-slate-800 text-white rounded-lg font-bold text-xs hover:bg-slate-700">Entendido</button></div>
                    </div>
                </div>
            )}

            {mostrarDesglose && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl p-6 max-h-[90vh] overflow-y-auto">
                        <div className="flex justify-between items-center mb-6">
                            <div><h3 className="text-xl font-black flex items-center gap-2"><TrendingUp/> Proyección Financiera</h3><p className="text-xs text-slate-500">Flujo de fondos proyectado a {q.mesesContrato} meses con inflación del {q.inflacionMensual}%.</p></div>
                            <button onClick={() => setMostrarDesglose(false)}><X/></button>
                        </div>
                        <div className="overflow-x-auto rounded-lg border border-slate-200">
                            <table className="w-full text-xs text-left">
                                <thead className="bg-slate-100 font-bold text-slate-600 uppercase"><tr><th className="p-3">Periodo</th><th className="p-3">Horas</th><th className="p-3">Inflación Acum.</th><th className="p-3">Costo Total</th><th className="p-3">Precio Venta</th><th className="p-3">Valor Hora</th><th className="p-3">Margen $</th></tr></thead>
                                <tbody className="divide-y divide-slate-100">{proyeccionMensual.map((p:any, i:number) => (<tr key={i} className="hover:bg-slate-50 transition-colors"><td className="p-3 font-bold text-slate-700">{p.mes}</td><td className="p-3">{Math.round(p.horas)} hs</td><td className="p-3 text-red-500 font-bold">{p.inflacionAcum.toFixed(2)}%</td><td className="p-3 font-mono">{formatMoney(p.costo)}</td><td className="p-3 font-mono font-bold text-emerald-600 bg-emerald-50/50">{formatMoney(p.venta)}</td><td className="p-3 font-mono text-slate-500">{formatMoney(p.precioHora)}</td><td className="p-3 font-mono text-indigo-600">+{formatMoney(p.venta - p.costo)}</td></tr>))}</tbody>
                                <tfoot className="bg-slate-900 text-white font-bold"><tr><td className="p-3" colSpan={3}>TOTAL CONTRATO</td><td className="p-3 font-mono">{formatMoney(proyeccionMensual.reduce((acc, curr) => acc + curr.costo, 0))}</td><td className="p-3 font-mono text-emerald-300">{formatMoney(kpi.valorTotalContrato)}</td><td colSpan={2} className="p-3 font-mono">+ {formatMoney(kpi.valorTotalContrato - proyeccionMensual.reduce((acc, curr) => acc + curr.costo, 0))}</td></tr></tfoot>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </DashboardLayout>
    );
}