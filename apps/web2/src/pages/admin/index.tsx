import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import { 
  Shield, Users, Clock, AlertTriangle, 
  CheckCircle, Briefcase, MapPin, 
  Activity, ArrowRight, Calendar 
, AlertOctagon } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { withAuthGuard } from '@/components/common/withAuthGuard';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where, Timestamp } from 'firebase/firestore';

// --- TIPOS ---
interface IDashboardStats {
  coverage: number;
  vacancies: number;
  totalHours: number;
  activeGuards: number;
  totalShifts: number;
}

interface IVacancy {
  id: string;
  client: string;
  objective: string;
  startTime: Date;
  hours: number;
}

interface IClientLoad {
  name: string;
  hours: number;
  percentage: number;
}

// --- COMPONENTES UI (Gráficos CSS Puros) ---
const ProgressBar = ({ value, color = 'bg-indigo-500' }: { value: number, color?: string }) => (
  <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-2 mt-2">
    <div className={`h-2 rounded-full ${color}`} style={{ width: `${value}%` }}></div>
  </div>
);

const ActivityHeatmap = ({ hourlyData }: { hourlyData: number[] }) => {
  const max = Math.max(...hourlyData, 1);
  return (
    <div className="flex items-end justify-between h-24 gap-1 mt-4">
      {hourlyData.map((val, i) => (
        <div key={i} className="flex-1 flex flex-col items-center group relative">
           {/* Tooltip */}
           <div className="absolute bottom-full mb-1 hidden group-hover:block bg-slate-800 text-white text-[10px] px-2 py-1 rounded whitespace-nowrap z-10">
             {i}:00hs - {val} guardias
           </div>
           {/* Bar */}
           <div 
             className="w-full bg-indigo-200 dark:bg-indigo-900/50 hover:bg-indigo-500 transition-all rounded-t-sm" 
             style={{ height: `${(val / max) * 100}%` }}
           ></div>
           {/* Label */}
           {i % 4 === 0 && <span className="text-[9px] text-slate-400 mt-1">{i}h</span>}
        </div>
      ))}
    </div>
  );
};

function AdminDashboard() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<IDashboardStats>({ coverage: 0, vacancies: 0, totalHours: 0, activeGuards: 0, totalShifts: 0 });
  const [vacanciesList, setVacanciesList] = useState<IVacancy[]>([]);
  const [topClients, setTopClients] = useState<IClientLoad[]>([]);
  const [activityCurve, setActivityCurve] = useState<number[]>(new Array(24).fill(0));
  
  const today = new Date();

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    setLoading(true);
    try {
        // 1. Rango de Fechas: HOY (00:00 a 23:59)
        const start = new Date(); start.setHours(0,0,0,0);
        const end = new Date(); end.setHours(23,59,59,999);
        
        // 2. Cargar Turnos de HOY
        const shiftsQ = query(
            collection(db, 'turnos'), 
            where('startTime', '>=', Timestamp.fromDate(start)), 
            where('startTime', '<=', Timestamp.fromDate(end))
        );
        const shiftsSnap = await getDocs(shiftsQ);
        
        // 3. Procesar Datos
        let totalH = 0;
        let activeEmp = new Set<string>();
        let vacancyCount = 0;
        let vacancies: IVacancy[] = [];
        let clientHours: Record<string, number> = {};
        let hourlyActivity = new Array(24).fill(0);

        // Pre-carga de nombres de clientes (Optimización: Podríamos cargar collection('clients') si son muchos)
        // Por ahora usamos el nombre denormalizado en el turno si existe, o 'Cliente'
        
        shiftsSnap.forEach(doc => {
            const s = doc.data();
            if (s.status === 'Canceled') return;

            const sStart = s.startTime.toDate();
            const sEnd = s.endTime.toDate();
            const duration = (sEnd.getTime() - sStart.getTime()) / 3600000;
            
            // A. Totales
            totalH += duration;
            
            // B. Vacantes vs Activos
            const isVacante = s.employeeId === 'VACANTE' || s.employeeName === 'VACANTE' || !s.employeeId;
            
            if (isVacante) {
                vacancyCount++;
                vacancies.push({
                    id: doc.id,
                    client: s.clientName || 'Cliente', // Asumiendo que guardamos el nombre, si no habría que cruzar
                    objective: s.objectiveName || 'Objetivo',
                    startTime: sStart,
                    hours: duration
                });
            } else {
                activeEmp.add(s.employeeId);
            }

            // C. Por Cliente (Agrupación)
            const cName = s.objectiveName ? s.objectiveName.split('(')[0] : 'General'; // Simplificación visual
            // Idealmente usar s.clientId y cruzar con mapa de clientes, pero para el dashboard rápido usamos lo que hay
            const cleanClient = s.clientId || 'Sin Cliente';
            clientHours[cleanClient] = (clientHours[cleanClient] || 0) + duration;

            // D. Curva de Actividad (Heatmap)
            let temp = new Date(sStart);
            while(temp < sEnd) {
                const h = temp.getHours();
                hourlyActivity[h]++;
                temp.setHours(h + 1);
            }
        });

        // 4. Calcular KPIs Finales
        const totalShifts = shiftsSnap.size;
        const coverage = totalShifts > 0 ? ((totalShifts - vacancyCount) / totalShifts) * 100 : 100;

        // Top Clientes (Necesitamos nombres reales, haremos un fetch rápido de clientes si hay IDs)
        // Para simplificar V1, mostramos los IDs o lo que tengamos
        const sortedClients = Object.entries(clientHours)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 5)
            .map(([name, hours]) => ({
                name: name.substring(0, 15), // Truncar
                hours,
                percentage: (hours / totalH) * 100
            }));

        // Actualizar Estado
        setStats({
            coverage,
            vacancies: vacancyCount,
            totalHours: totalH,
            activeGuards: activeEmp.size,
            totalShifts
        });
        setVacanciesList(vacancies.sort((a,b) => a.startTime.getTime() - b.startTime.getTime()));
        setTopClients(sortedClients);
        setActivityCurve(hourlyActivity);

    } catch (error) {
        console.error("Error loading dashboard", error);
    } finally {
        setLoading(false);
    }
  };

  return (
    <DashboardLayout>
      <Head><title>Dashboard | CronoApp</title></Head>
      
      <div className="p-6 max-w-7xl mx-auto space-y-6 animate-in fade-in">
        
        {/* HEADER FECHA */}
        <div className="flex justify-between items-end mb-4">
            <div>
                <h1 className="text-2xl font-black text-slate-900 dark:text-white uppercase">Operaciones Hoy</h1>
                <p className="text-slate-500 font-medium flex items-center gap-2">
                    <Calendar size={16}/> {today.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
            </div>
            <div className="flex gap-2">
               {/* Aquí podrías poner selector de fecha futuro */}
            </div>
        </div>

        {/* 1. KPIs SUPERIORES */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* COBERTURA */}
            <div className="p-5 bg-white dark:bg-slate-800 rounded-3xl border dark:border-slate-700 shadow-sm relative overflow-hidden">
                <div className="absolute right-0 top-0 p-4 opacity-5"><Shield size={64}/></div>
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Cobertura</p>
                <h3 className={`text-3xl font-black ${stats.coverage < 100 ? 'text-amber-500' : 'text-emerald-500'}`}>
                    {stats.coverage.toFixed(1)}%
                </h3>
                <ProgressBar value={stats.coverage} color={stats.coverage < 100 ? 'bg-amber-500' : 'bg-emerald-500'} />
                <p className="text-[10px] text-slate-400 mt-2 text-right">{stats.totalShifts} turnos tot.</p>
            </div>

            {/* VACANTES */}
            <div className={`p-5 rounded-3xl border shadow-sm relative overflow-hidden ${stats.vacancies > 0 ? 'bg-rose-50 border-rose-100 dark:bg-rose-900/20 dark:border-rose-800' : 'bg-white border-slate-100 dark:bg-slate-800 dark:border-slate-700'}`}>
                <div className="absolute right-0 top-0 p-4 opacity-5"><AlertTriangle size={64}/></div>
                <p className={`text-xs font-black uppercase tracking-widest mb-1 ${stats.vacancies > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400'}`}>Vacantes Criticas</p>
                <h3 className={`text-3xl font-black ${stats.vacancies > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-700 dark:text-white'}`}>
                    {stats.vacancies}
                </h3>
                <p className="text-[10px] mt-2 opacity-60 font-bold">Puestos sin cubrir hoy</p>
            </div>

            {/* VOLUMEN */}
            <div className="p-5 bg-white dark:bg-slate-800 rounded-3xl border dark:border-slate-700 shadow-sm relative overflow-hidden">
                <div className="absolute right-0 top-0 p-4 opacity-5"><Clock size={64}/></div>
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Volumen Hoy</p>
                <h3 className="text-3xl font-black text-indigo-600 dark:text-indigo-400">
                    {stats.totalHours.toFixed(0)} <span className="text-sm text-slate-400">hs</span>
                </h3>
                <div className="mt-2 flex items-center gap-1 text-[10px] text-slate-400">
                    <Activity size={12}/> Actividad planificada
                </div>
            </div>

            {/* DOTACIÓN */}
            <div className="p-5 bg-white dark:bg-slate-800 rounded-3xl border dark:border-slate-700 shadow-sm relative overflow-hidden">
                <div className="absolute right-0 top-0 p-4 opacity-5"><Users size={64}/></div>
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Dotación Activa</p>
                <h3 className="text-3xl font-black text-slate-700 dark:text-white">
                    {stats.activeGuards}
                </h3>
                <p className="text-[10px] text-slate-400 mt-2">Guardias en servicio</p>
            </div>
        </div>

        {/* 2. SECCIÓN PRINCIPAL: VACANTES Y DISTRIBUCIÓN */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* A. ALERTAS DE VACANTES (2/3 de ancho) */}
            <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-3xl border dark:border-slate-700 shadow-sm p-6 flex flex-col">
                <h3 className="text-lg font-black text-slate-800 dark:text-white flex items-center gap-2 mb-4">
                    <AlertOctagon className="text-rose-500"/> Próximas Vacantes <span className="text-xs bg-rose-100 text-rose-700 px-2 py-1 rounded-full">{vacanciesList.length}</span>
                </h3>
                
                <div className="flex-1 overflow-auto custom-scrollbar max-h-[300px]">
                    {vacanciesList.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-2 opacity-50">
                            <CheckCircle size={48} className="text-emerald-500"/>
                            <p>¡Todo cubierto! No hay vacantes pendientes para hoy.</p>
                        </div>
                    ) : (
                        <table className="w-full text-left text-sm">
                            <thead className="bg-slate-50 dark:bg-slate-900 text-[10px] uppercase text-slate-400 font-black sticky top-0">
                                <tr>
                                    <th className="p-3">Horario</th>
                                    <th className="p-3">Objetivo / Sede</th>
                                    <th className="p-3 text-right">Duración</th>
                                    <th className="p-3 text-center">Acción</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y dark:divide-slate-700">
                                {vacanciesList.map(v => (
                                    <tr key={v.id} className="group hover:bg-rose-50 dark:hover:bg-rose-900/10 transition-colors">
                                        <td className="p-3 font-mono font-bold text-rose-600">
                                            {v.startTime.toLocaleTimeString('es-AR', {hour:'2-digit', minute:'2-digit'})}
                                        </td>
                                        <td className="p-3">
                                            <div className="font-bold text-slate-700 dark:text-white">{v.objective}</div>
                                            <div className="text-[10px] text-slate-400 uppercase">{v.client}</div>
                                        </td>
                                        <td className="p-3 text-right text-slate-500">{v.hours}h</td>
                                        <td className="p-3 text-center">
                                            <button className="bg-slate-900 text-white px-3 py-1 rounded-lg text-xs font-bold hover:scale-105 transition-transform shadow-lg">
                                                Asignar
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>

            {/* B. DISTRIBUCIÓN POR CLIENTE (1/3 ancho) */}
            <div className="bg-white dark:bg-slate-800 rounded-3xl border dark:border-slate-700 shadow-sm p-6">
                <h3 className="text-lg font-black text-slate-800 dark:text-white mb-4">Top Demanda Hoy</h3>
                <div className="space-y-4">
                    {topClients.length > 0 ? topClients.map((c, i) => (
                        <div key={i}>
                            <div className="flex justify-between text-xs font-bold mb-1">
                                <span className="text-slate-600 dark:text-slate-300 truncate w-32">{c.name}</span>
                                <span className="text-indigo-600">{Math.round(c.hours)} hs</span>
                            </div>
                            <ProgressBar value={c.percentage} color="bg-indigo-500" />
                        </div>
                    )) : <p className="text-slate-400 text-sm">Sin datos para hoy</p>}
                </div>
                <div className="mt-6 pt-4 border-t dark:border-slate-700">
                    <button className="w-full py-2 flex items-center justify-center gap-2 text-xs font-black text-slate-500 hover:text-indigo-600 transition-colors">
                        VER REPORTE COMPLETO <ArrowRight size={12}/>
                    </button>
                </div>
            </div>
        </div>

        {/* 3. CURVA DE ACTIVIDAD (Heatmap) */}
        <div className="bg-white dark:bg-slate-800 rounded-3xl border dark:border-slate-700 shadow-sm p-6">
            <h3 className="text-lg font-black text-slate-800 dark:text-white mb-2">Curva de Actividad (24h)</h3>
            <p className="text-xs text-slate-400 mb-6">Cantidad de personal activo por hora del día.</p>
            <ActivityHeatmap hourlyData={activityCurve} />
        </div>

      </div>
    </DashboardLayout>
  );
}

export default withAuthGuard(AdminDashboard, ['admin', 'SuperAdmin', 'Director', 'Auditor']);
