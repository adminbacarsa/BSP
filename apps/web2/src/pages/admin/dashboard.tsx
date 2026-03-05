import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import { 
  Shield, Users, Clock, AlertTriangle, 
  Briefcase, Activity, Calendar, 
  AlertOctagon, UserCheck, TrendingUp, Zap, MapPin, 
  Building2, BarChart3, PieChart as PieChartIcon, LayoutDashboard, UserX, Target, Filter
} from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { withAuthGuard } from '@/components/common/withAuthGuard';
import { auth, db } from '@/lib/firebase';
import { collection, getDocs, query, where, Timestamp, getCountFromServer } from 'firebase/firestore';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, AreaChart, Area, Legend 
} from 'recharts';

// --- TIPOS ---
interface IDashboardStats {
  clientsCount: number;
  objectivesCount: number;
  servicesCount: number;
  activeEmployees: number;
  totalEmployees: number;
  coverage: number;
  totalHours: number;
  overtimeHours: number;
  absentCount: number;
  lateCount: number;
  incidentCount: number;
}

interface IChartData {
  name: string;
  value: number;
  color?: string;
}

type TimeRange = 'day' | 'week' | 'month';

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];

const KpiCard = ({ title, value, icon: Icon, color, subtext, trend }: any) => (
  <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm hover:shadow-md transition-all duration-300 group">
    <div className="flex justify-between items-start mb-4">
      <div className={'p-3 rounded-xl bg-opacity-10 text-current ' + color}>
        <Icon size={24} className={color.replace('bg-', 'text-')} />
      </div>
      {trend && (
        <span className={'text-xs font-bold px-2 py-1 rounded-full ' + (trend === 'up' ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600')}>
          {trend === 'up' ? '▲' : '▼'}
        </span>
      )}
    </div>
    <div>
      <h3 className="text-3xl font-black text-slate-800 dark:text-white mb-1">{value}</h3>
      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{title}</p>
      {subtext && <p className="text-xs text-slate-500 mt-2 font-medium">{subtext}</p>}
    </div>
  </div>
);

function AdminDashboard() {
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<TimeRange>('day');
  const [stats, setStats] = useState<IDashboardStats>({ 
    clientsCount: 0, objectivesCount: 0, servicesCount: 0,
    activeEmployees: 0, totalEmployees: 0,
    coverage: 0, totalHours: 0, overtimeHours: 0,
    absentCount: 0, lateCount: 0, incidentCount: 0
  });

  const [mainChartData, setMainChartData] = useState<any[]>([]); 
  const [topClients, setTopClients] = useState<any[]>([]);
  const [absenceReasons, setAbsenceReasons] = useState<any[]>([]);
  const [employeeDistribution, setEmployeeDistribution] = useState<any[]>([]);

  const today = new Date();

  useEffect(() => {
    fetchData();
  }, [timeRange]); 

  const getRangeDates = () => {
      const now = new Date();
      let start = new Date(now);
      let end = new Date(now);

      if (timeRange === 'day') {
          start.setHours(0,0,0,0);
          end.setHours(23,59,59,999);
      } else if (timeRange === 'week') {
          start.setDate(now.getDate() - 6); 
          start.setHours(0,0,0,0);
          end.setHours(23,59,59,999);
      } else if (timeRange === 'month') {
          start.setDate(1); 
          start.setHours(0,0,0,0);
          end = new Date(now.getFullYear(), now.getMonth() + 1, 0); 
          end.setHours(23,59,59,999);
      }
      return { start, end };
  };

  const fetchData = async () => {
      setLoading(true);
      try {
        const { start, end } = getRangeDates();

        // 1. CARGA DE CLIENTES Y OBJETIVOS (MAPEO)
        const clientsSnap = await getDocs(collection(db, 'clients'));
        const servicesSnap = await getDocs(collection(db, 'servicios_sla'));
        
        let clientCount = 0;
        let objCount = 0;
        const objectiveMap: Record<string, string> = {}; 
        const clientMap: Record<string, string> = {};

        clientsSnap.forEach(doc => {
            clientCount++;
            const data = doc.data();
            if (data.name) clientMap[doc.id] = data.name;
            if (data.objetivos && Array.isArray(data.objetivos)) {
                objCount += data.objetivos.length;
                data.objetivos.forEach((obj: any) => {
                    if (obj.id && obj.name) {
                        objectiveMap[obj.id] = obj.name;
                    }
                });
            }
        });

        // 2. RECURSOS HUMANOS
        const employeesSnap = await getDocs(collection(db, 'empleados'));
        const date30DaysAgo = new Date();
        date30DaysAgo.setDate(date30DaysAgo.getDate() - 30);
        const absencesSnap = await getDocs(query(collection(db, 'ausencias'), where('startDate', '>=', date30DaysAgo.toISOString().split('T')[0])));

        // 3. OPERATIVA
        const shiftsSnap = await getDocs(query(
            collection(db, 'turnos'),
            where('startTime', '>=', Timestamp.fromDate(start)),
            where('startTime', '<=', Timestamp.fromDate(end))
        ));

        // --- PROCESAMIENTO ---
        let totalH = 0;
        let extraH = 0;
        let vacancies = 0;
        let uniqueGuards = new Set<string>();
        let absencesToday = 0;
        let lates = 0;
        let incidents = 0;
        let clientHours: Record<string, number> = {};

        // PREPARAR ESTRUCTURA DEL GRÁFICO PRINCIPAL
        let chartDataMap: Record<string, number> = {};
        
        if (timeRange === 'day') {
            for(let i=0; i<24; i++) {
                chartDataMap[i + 'h'] = 0;
            }
        } else {
            let loopDate = new Date(start);
            while(loopDate <= end) {
                const label = loopDate.getDate().toString();
                chartDataMap[label] = 0;
                loopDate.setDate(loopDate.getDate() + 1);
            }
        }

        shiftsSnap.forEach(doc => {
            const s = doc.data();
            if (s.status === 'Canceled') return;

            const shiftStart = s.startTime.toDate();
            const shiftEnd = s.endTime.toDate();
            const duration = (shiftEnd.getTime() - shiftStart.getTime()) / 3600000;

            if (!s.employeeId || s.employeeId === 'VACANTE') {
                vacancies++;
            } else {
                uniqueGuards.add(s.employeeId);
                totalH += duration;
                if (s.isExtended || s.isEarlyStart || s.isFrancoTrabajado) extraH += duration;
                if (s.status === 'ABSENT') absencesToday++;
                if (s.status === 'LATE') lates++;
                if (s.hasNovedad) incidents++;

                // LÓGICA DE GRÁFICO DINÁMICO
                if (timeRange === 'day') {
                    let temp = new Date(shiftStart);
                    while(temp < shiftEnd) {
                        const h = temp.getHours() + 'h';
                        if(chartDataMap[h] !== undefined) chartDataMap[h]++;
                        temp.setHours(temp.getHours() + 1);
                    }
                } else {
                    const dayLabel = shiftStart.getDate().toString();
                    if(chartDataMap[dayLabel] !== undefined) {
                        chartDataMap[dayLabel] += duration;
                    }
                }

                // CORRECCIÓN DE NOMBRES
                let cName = s.clientName;
                if (!cName || cName === 'Otros') {
                    cName = clientMap[s.clientId] || 'Sin Asignar';
                }
                clientHours[cName] = (clientHours[cName] || 0) + duration;
            }
        });

        const formattedChartData = Object.entries(chartDataMap).map(([label, value]) => ({
            label, 
            value: Math.round(value)
        }));
        
        if (timeRange !== 'day') {
             formattedChartData.sort((a,b) => parseInt(a.label) - parseInt(b.label));
        }

        const coverage = shiftsSnap.size > 0 ? ((shiftsSnap.size - vacancies) / shiftsSnap.size) * 100 : 100;

        const clientChartData = Object.entries(clientHours)
            .map(([name, val]) => ({ name: name.substring(0, 15), value: Math.round(val) }))
            .sort((a,b) => b.value - a.value)
            .filter(item => item.value > 0)
            .slice(0, 5);

        // Distribución por Objetivo
        let distMap: Record<string, number> = {};
        let totalActiveEmp = 0;
        employeesSnap.forEach(doc => {
            const e = doc.data();
            if (['active', 'activo'].includes(e.status)) {
                totalActiveEmp++;
                const objId = e.preferredObjectiveId;
                const objName = objId ? (objectiveMap[objId] || 'Sin Asignar') : 'Sin Asignar';
                distMap[objName] = (distMap[objName] || 0) + 1;
            }
        });
        if (distMap['Sin Asignar'] === 0) delete distMap['Sin Asignar'];
        const distChartData = Object.entries(distMap)
            .map(([name, value]) => ({ name: name.length > 15 ? name.substring(0,15)+'...' : name, value }))
            .sort((a,b) => b.value - a.value)
            .slice(0, 6);

        // Ausencias
        let absenceMap: Record<string, number> = {};
        absencesSnap.forEach(doc => {
            const d = doc.data();
            const absDate = new Date(d.startDate);
            if (absDate <= end) {
                const reason = d.type || 'Sin Motivo';
                absenceMap[reason] = (absenceMap[reason] || 0) + 1;
            }
        });
        const absenceChartData = Object.entries(absenceMap)
            .map(([name, value]) => ({ name, value }))
            .sort((a,b) => b.value - a.value)
            .slice(0, 5);

        setStats({
            clientsCount: clientCount,
            objectivesCount: objCount,
            servicesCount: servicesSnap.size,
            totalEmployees: totalActiveEmp,
            activeEmployees: uniqueGuards.size, 
            coverage,
            totalHours: totalH,
            overtimeHours: extraH,
            absentCount: absencesToday,
            lateCount: lates,
            incidentCount: incidents
        });

        setTopClients(clientChartData);
        setMainChartData(formattedChartData);
        setAbsenceReasons(absenceChartData);
        setEmployeeDistribution(distChartData);
        setLoading(false);

      } catch (error) {
        console.error(error);
        setLoading(false);
      }
    };

  const getChartTitle = () => {
      if (timeRange === 'day') return 'Actividad en Tiempo Real (Guardias Activos)';
      return 'Volumen Operativo Diario (Horas Hombre)';
  };

  return (
    <DashboardLayout>
      <Head><title>Dashboard Pro | CronoApp</title></Head>
      
      <div className="min-h-screen bg-slate-50/50 dark:bg-slate-900 p-6 animate-in fade-in pb-20">
        
        {/* HEADER & FILTROS */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 gap-4">
            <div>
                <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-3">
                    <LayoutDashboard size={32} className="text-indigo-600"/> 
                    PANEL DE CONTROL
                </h1>
                <p className="text-slate-500 font-medium mt-1">
                    Resumen operativo del <span className="text-indigo-600 font-bold">{today.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
                </p>
            </div>
            
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-2 bg-white p-1 rounded-xl border border-slate-200 shadow-sm">
                <button onClick={() => setTimeRange('day')} className={'px-4 py-2 rounded-lg text-xs font-bold transition-all ' + (timeRange === 'day' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50')}>Hoy</button>
                <button onClick={() => setTimeRange('week')} className={'px-4 py-2 rounded-lg text-xs font-bold transition-all ' + (timeRange === 'week' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50')}>Semana</button>
                <button onClick={() => setTimeRange('month')} className={'px-4 py-2 rounded-lg text-xs font-bold transition-all ' + (timeRange === 'month' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50')}>Mes</button>
              </div>
            </div>
        </div>

        {/* 1. KPIs PRINCIPALES */}
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-8">
            <KpiCard title="Clientes Activos" value={stats.clientsCount} icon={Building2} color="bg-blue-500" subtext={stats.objectivesCount + ' Objetivos Totales'} />
            <KpiCard title="Cumplimiento" value={stats.coverage.toFixed(1) + '%'} icon={Shield} color={stats.coverage > 95 ? "bg-emerald-500" : "bg-rose-500"} subtext="Nivel de Servicio" />
            <KpiCard title="Volumen Horas" value={Math.round(stats.totalHours)} icon={Clock} color="bg-violet-500" subtext={Math.round(stats.overtimeHours) + 'hs Recargo'} />
            <KpiCard title="Novedades" value={stats.incidentCount + stats.absentCount} icon={AlertOctagon} color={stats.incidentCount > 0 ? "bg-amber-500" : "bg-slate-400"} subtext={timeRange === 'day' ? 'Hoy' : 'En el periodo'} />
        </div>

        {/* 2. GRÁFICOS OPERATIVOS */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
            <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm p-6 flex flex-col h-[350px]">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="font-black text-lg text-slate-800 dark:text-white flex items-center gap-2">
                        <Activity className="text-indigo-500"/> {getChartTitle()}
                    </h3>
                </div>
                <div className="flex-1 w-full min-h-0">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={mainChartData}>
                            <defs>
                                <linearGradient id="colorMain" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0"/>
                            <XAxis dataKey="label" tick={{fontSize: 11}} axisLine={false} tickLine={false}/>
                            <Tooltip contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}}/>
                            <Area type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={3} fillOpacity={1} fill="url(#colorMain)" />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm p-6 flex flex-col h-[350px]">
                <h3 className="font-black text-lg text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                    <PieChartIcon className="text-emerald-500"/> Top Demanda (Hs)
                </h3>
                <div className="flex-1 w-full min-h-0">
                     <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={topClients} layout="vertical" margin={{top:0, left:0, right:30, bottom:0}}>
                            <XAxis type="number" hide/>
                            <YAxis dataKey="name" type="category" width={100} tick={{fontSize: 10, fontWeight: 600}} axisLine={false} tickLine={false}/>
                            <Tooltip cursor={{fill: '#f1f5f9'}} contentStyle={{borderRadius: '8px'}}/>
                            <Bar dataKey="value" fill="#4f46e5" radius={[0, 4, 4, 0]} barSize={20} />
                        </BarChart>
                     </ResponsiveContainer>
                </div>
            </div>
        </div>

        {/* 3. GRÁFICOS RRHH */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-200 shadow-sm h-[300px] flex flex-col">
                <h3 className="font-black text-lg text-slate-800 mb-2 flex items-center gap-2">
                    <UserX className="text-rose-500"/> Motivos de Ausencia
                </h3>
                <div className="flex-1 w-full">
                    {absenceReasons.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={absenceReasons} layout="vertical" margin={{ left: 20 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                                <XAxis type="number" hide />
                                <YAxis dataKey="name" type="category" width={120} tick={{fontSize: 10}} />
                                <Tooltip cursor={{fill: 'transparent'}} />
                                <Bar dataKey="value" fill="#6366f1" radius={[0, 4, 4, 0]} barSize={25} />
                            </BarChart>
                        </ResponsiveContainer>
                    ) : <div className="h-full flex items-center justify-center text-slate-400 text-xs">Sin datos en este periodo</div>}
                </div>
            </div>

            <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-200 shadow-sm h-[300px] flex flex-col">
                <h3 className="font-black text-lg text-slate-800 mb-2 flex items-center gap-2">
                    <Target className="text-emerald-500"/> Distribución por Objetivo
                </h3>
                <div className="flex-1 relative">
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie
                                data={employeeDistribution}
                                cx="50%"
                                cy="50%"
                                innerRadius={60}
                                outerRadius={80}
                                paddingAngle={5}
                                dataKey="value"
                            >
                                {employeeDistribution.map((entry, index) => (
                                    <Cell key={'cell-' + index} fill={COLORS[index % COLORS.length]} />
                                ))}
                            </Pie>
                            <Tooltip />
                            <Legend layout="vertical" verticalAlign="middle" align="right" />
                        </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none mr-24">
                        <span className="text-3xl font-black text-slate-800">{stats.activeEmployees}</span>
                        <span className="text-[9px] uppercase text-slate-400 font-bold">Activos</span>
                    </div>
                </div>
            </div>
        </div>

        {/* 4. ACCESOS RÁPIDOS */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <button onClick={() => window.location.href='/admin/planificacion'} className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all text-left group">
                <Calendar className="text-indigo-500 mb-2 group-hover:scale-110 transition-transform"/>
                <p className="font-black text-slate-700">Planificador</p>
                <p className="text-[10px] text-slate-400">Gestionar turnos</p>
            </button>
            <button onClick={() => window.location.href='/admin/empleados'} className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all text-left group">
                <Users className="text-emerald-500 mb-2 group-hover:scale-110 transition-transform"/>
                <p className="font-black text-slate-700">Personal</p>
                <p className="text-[10px] text-slate-400">Ver legajos</p>
            </button>
            <button onClick={() => window.location.href='/admin/crm'} className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all text-left group">
                <Building2 className="text-blue-500 mb-2 group-hover:scale-110 transition-transform"/>
                <p className="font-black text-slate-700">Comercial</p>
                <p className="text-[10px] text-slate-400">Clientes y tarifas</p>
            </button>
            <button onClick={() => window.location.href='/admin/reportes'} className="p-4 bg-indigo-600 rounded-xl shadow-lg hover:bg-indigo-700 transition-all text-left group">
                <BarChart3 className="text-white mb-2 group-hover:scale-110 transition-transform"/>
                <p className="font-black text-white">Reportes</p>
                <p className="text-[10px] text-indigo-200">Exportar data</p>
            </button>
        </div>

      </div>
    </DashboardLayout>
  );
}

export default withAuthGuard(AdminDashboard, ['admin', 'SuperAdmin', 'Director', 'Auditor']);
