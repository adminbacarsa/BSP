import React, { useState, useEffect, useMemo } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where, Timestamp } from 'firebase/firestore';
import { useEmpresa } from '@/context/EmpresaContext';
import { belongsToEmpresaView, filterSlaRowsByEmpresa, empresaCollectionQuery } from '@/lib/multiempresa';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import {
  TrendingUp, TrendingDown, Users, Clock, Shield, AlertTriangle, CheckCircle,
  Activity, Loader2, RefreshCw, Building2, Briefcase, UserCheck, ChevronUp, ChevronDown,
} from 'lucide-react';

type TabId = 'resumen' | 'servicios' | 'clientes' | 'personal' | 'liquidacion';
type SortDir = 'asc' | 'desc';

interface ServiceRow {
  objectiveId: string; objectiveName: string; clientId: string; clientName: string;
  hsEjecutadas: number; hsPlanificadas: number; hsPerdidas: number;
  presentes: number; ausentes: number; tardanzas: number; retenciones: number; vacantes: number;
}
interface ClientRow {
  clientId: string; clientName: string; objectives: number;
  hsEjecutadas: number; hsPlanificadas: number; hsPerdidas: number;
  presentes: number; ausentes: number; tardanzas: number; retenciones: number;
}
interface EmployeeRow {
  employeeId: string; employeeName: string;
  hsEjecutadas: number; presentes: number; ausentes: number; tardanzas: number; retenciones: number;
}
interface LiqRow {
  objectiveId: string; objectiveName: string; clientName: string;
  hsVendidas: number; hsPlanificadas: number; hsEjecutadas: number;
  hsAusencia: number; hsExtras: number; hsFT: number; hsLiquidadas: number; delta: number;
}

function tsToDate(ts: unknown): Date | null {
  if (!ts) return null;
  if (ts instanceof Timestamp) return ts.toDate();
  if (typeof ts === 'object' && ts !== null && 'seconds' in ts)
    return new Date((ts as { seconds: number }).seconds * 1000);
  if (typeof ts === 'string') return new Date(ts);
  return null;
}
function shiftHours(s: Record<string, unknown>): number {
  const rs = tsToDate(s.realStartTime), re = tsToDate(s.realEndTime);
  if (rs && re) { const h = (re.getTime() - rs.getTime()) / 3600000; if (h > 0 && h <= 36) return h; }
  const st = tsToDate(s.startTime), en = tsToDate(s.endTime);
  if (st && en) { const h = (en.getTime() - st.getTime()) / 3600000; if (h > 0 && h <= 36) return h; }
  return 0;
}
function fmt1(n: number) { return n.toFixed(1); }
function plannedHours(t: Record<string,unknown>): number {
  const st=tsToDate(t.startTime), en=tsToDate(t.endTime);
  if(st&&en){const h=(en.getTime()-st.getTime())/3600000; if(h>0&&h<=36) return h;} return 0;
}
function realHoursOnly(t: Record<string,unknown>): number {
  const rs=tsToDate(t.realStartTime), re=tsToDate(t.realEndTime);
  if(rs&&re){const h=(re.getTime()-rs.getTime())/3600000; if(h>0&&h<=36) return h;} return 0;
}
function extraHours(t: Record<string,unknown>): number {
  const re=tsToDate(t.realEndTime), en=tsToDate(t.endTime);
  if(re&&en){const h=(re.getTime()-en.getTime())/3600000; if(h>0&&h<=12) return h;} return 0;
}
const DAYS_OPTIONS = [7, 14, 30, 90] as const;
type DaysOption = typeof DAYS_OPTIONS[number];

const CM: Record<string, { bg: string; icon: string; text: string }> = {
  emerald: { bg: 'bg-emerald-50', icon: 'text-emerald-500', text: 'text-emerald-700' },
  rose:    { bg: 'bg-rose-50',    icon: 'text-rose-500',    text: 'text-rose-700'    },
  blue:    { bg: 'bg-blue-50',    icon: 'text-blue-500',    text: 'text-blue-700'    },
  amber:   { bg: 'bg-amber-50',   icon: 'text-amber-500',   text: 'text-amber-700'   },
  violet:  { bg: 'bg-violet-50',  icon: 'text-violet-500',  text: 'text-violet-700'  },
  slate:   { bg: 'bg-slate-100',  icon: 'text-slate-500',   text: 'text-slate-700'   },
};

function KpiCard({ label, value, icon, color, subtitle }: { label: string; value: string; icon: React.ReactNode; color: string; subtitle?: string }) {
  const c = CM[color] || CM.slate;
  return (
    <div className="bg-white rounded-2xl shadow-sm p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">{label}</span>
        <span className={`w-9 h-9 rounded-xl ${c.bg} ${c.icon} flex items-center justify-center`}>{icon}</span>
      </div>
      <span className={`text-3xl font-black ${c.text} leading-none`}>{value}</span>
      {subtitle && <span className="text-xs text-slate-400">{subtitle}</span>}
    </div>
  );
}

function CovBadge({ pct }: { pct: number }) {
  const cls = pct >= 90 ? 'bg-emerald-50 text-emerald-700' : pct >= 70 ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700';
  return <span className={`inline-block px-2 py-0.5 rounded-lg text-xs font-bold ${cls}`}>{pct}%</span>;
}

function SortTh({ label, col, sort, onSort }: { label: string; col: string; sort: [string, SortDir]; onSort: (c: string) => void }) {
  const active = sort[0] === col;
  return (
    <th className="text-right py-2 px-3 text-xs font-semibold uppercase text-slate-400 tracking-wide cursor-pointer hover:text-slate-600 whitespace-nowrap select-none" onClick={() => onSort(col)}>
      <span className="inline-flex items-center gap-0.5 justify-end">
        {label}{active ? (sort[1] === 'asc' ? <ChevronUp size={11}/> : <ChevronDown size={11}/>) : null}
      </span>
    </th>
  );
}

export default function KpisPage() {
  const { empresaId, empresa } = useEmpresa();
  const migracionCompleta = empresa?.migracionCompleta ?? false;
  const scopeEmpresa = migracionCompleta;

  const [tab, setTab]           = useState<TabId>('resumen');
  const [days, setDays]         = useState<DaysOption>(30);
  const [loading, setLoading]   = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [srvSort, setSrvSort]   = useState<[string, SortDir]>(['hsPerdidas', 'desc']);
  const [cliSort, setCliSort]   = useState<[string, SortDir]>(['hsPerdidas', 'desc']);
  const [empSort, setEmpSort]   = useState<[string, SortDir]>(['hsEjecutadas', 'desc']);
  const [liqSort, setLiqSort]   = useState<[string, SortDir]>(['delta', 'desc']);

  const [turnosRaw,    setTurnosRaw]    = useState<Record<string, unknown>[]>([]);
  const [ausenciasRaw, setAusenciasRaw] = useState<Record<string, unknown>[]>([]);
  const [auditLogsRaw, setAuditLogsRaw] = useState<Record<string, unknown>[]>([]);
  const [slaRaw,       setSlaRaw]       = useState<Record<string, unknown>[]>([]);
  const [empleadosRaw, setEmpleadosRaw] = useState<Record<string, unknown>[]>([]);
  const [clientsRaw,   setClientsRaw]   = useState<Record<string, unknown>[]>([]);

  useEffect(() => {
    if (!empresaId) return;
    let cancelled = false;
    setLoading(true);
    const sd = new Date(); sd.setDate(sd.getDate() - days); sd.setHours(0,0,0,0);
    const startTs = Timestamp.fromDate(sd);
    async function go() {
      try {
        const [tSnap, aSnap, auSnap, sSnap, eSnap, cSnap] = await Promise.all([
          getDocs(query(collection(db, 'turnos'),     where('startTime',  '>=', startTs))),
          getDocs(collection(db, 'ausencias')),
          getDocs(query(collection(db, 'audit_logs'), where('timestamp',  '>=', startTs))),
          getDocs(empresaCollectionQuery('servicios_sla', empresaId, scopeEmpresa)),
          getDocs(collection(db, 'empleados')),
          getDocs(collection(db, 'clients')),
        ]);
        if (!cancelled) {
          setTurnosRaw(tSnap.docs.map(d=>({id:d.id,...d.data()})));
          setAusenciasRaw(aSnap.docs.map(d=>({id:d.id,...d.data()})));
          setAuditLogsRaw(auSnap.docs.map(d=>({id:d.id,...d.data()})));
          setSlaRaw(sSnap.docs.map(d=>({id:d.id,...(d.data() as Record<string,unknown>)})));
          setEmpleadosRaw(eSnap.docs.map(d=>({id:d.id,...d.data()})));
          setClientsRaw(cSnap.docs.map(d=>({id:d.id,...d.data()})));
          setLoading(false);
        }
      } catch(e) { console.error('[KPIs]',e); if(!cancelled) setLoading(false); }
    }
    go(); return () => { cancelled = true; };
  }, [empresaId, days, refreshKey, scopeEmpresa]);

  const fd = (d: Record<string,unknown>) => belongsToEmpresaView(d as {empresaId?:unknown}, empresaId, migracionCompleta);

  // Mapa objectiveId → {name, clientName, clientId} construido desde colección clients
  const objMap = useMemo(() => {
    const m = new Map<string, {name:string; clientName:string; clientId:string}>();
    clientsRaw.forEach(c => {
      const clientName = String(c.name ?? c.nombre ?? c.razonSocial ?? '');
      const clientId   = String(c.id ?? '');
      const objetivos  = Array.isArray(c.objetivos) ? c.objetivos : [];
      objetivos.forEach((o: any) => {
        const oid = String(o.id ?? o.objectiveId ?? '').trim();
        if (oid) m.set(oid, { name: String(o.name ?? o.nombre ?? oid), clientName, clientId });
      });
      // Algunos clientes son a su vez el objetivo (sin array objetivos)
      if (objetivos.length === 0 && clientId) {
        m.set(clientId, { name: clientName, clientName, clientId });
      }
    });
    return m;
  }, [clientsRaw]);

  const { turnos, audit, slas } = useMemo(() => {
    const t = turnosRaw.filter(fd);
    const cids = new Set(t.map(x=>String(x.clientId??'')).filter(Boolean));
    return { turnos: t, audit: auditLogsRaw.filter(fd), slas: filterSlaRowsByEmpresa(slaRaw, empresaId, scopeEmpresa, cids) };
  }, [turnosRaw, auditLogsRaw, slaRaw, empresaId, migracionCompleta, scopeEmpresa]);

  const gk = useMemo(() => {
    const emps = empleadosRaw.filter(fd);
    const ea = emps.filter(e=>e.isAvailable===true).length;
    // Cobertura: usar audit_logs PRESENTE vs turnos isAbsent (más confiable que isPresent flag)
    const ing  = audit.filter(a=>a.action==='PRESENTE').length;
    const aus  = turnos.filter(t=>t.isAbsent===true).length;
    const tot  = ing + aus;
    const cov  = tot>0?Math.round(ing/tot*100):0;
    // Ausentismo: % de empleados DISTINTOS con al menos 1 ausencia en el período
    const sd=new Date(); sd.setDate(sd.getDate()-days); sd.setHours(0,0,0,0);
    const ed=new Date();
    const ausP = ausenciasRaw.filter(fd).filter(a=>{
      const s=a.startDate?new Date(String(a.startDate)):null; if(!s) return false;
      const e=a.endDate?new Date(String(a.endDate)):s;
      return s<=ed&&e>=sd;
    });
    const empConAusencia = new Set(ausP.map(a=>String(a.employeeId??'')).filter(Boolean)).size;
    const ausm = ea>0?Math.min(100,Math.round(empConAusencia/ea*100)):0;
    const tard = audit.filter(a=>a.action==='LLEGADA_TARDE').length;
    const ret  = audit.filter(a=>a.action==='RETENCION').length;
    const baj  = audit.filter(a=>['BAJA_CUBIERTA','BAJA_PROTOCOLO','INTERRUPT'].includes(String(a.action??''))).length;
    const hsE  = turnos.filter(t=>t.isCompleted===true||t.isPresent===true).reduce((a,t)=>a+shiftHours(t),0);
    const hsP  = turnos.filter(t=>t.isAbsent===true).reduce((a,t)=>a+shiftHours(t),0);
    return { cov, ausm, tard, ret, ing, baj, ea, hsE, hsP };
  }, [turnos, audit, ausenciasRaw, empleadosRaw, empresaId, migracionCompleta, days]);

  const daily = useMemo(() => {
    const cd=Math.min(days,14);
    const m: Record<string,{date:string;ingresos:number;ausencias:number}> = {};
    for(let i=cd-1;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);const k=d.toISOString().slice(0,10);m[k]={date:k.slice(5),ingresos:0,ausencias:0};}
    audit.filter(a=>a.action==='PRESENTE').forEach(a=>{const k=tsToDate(a.timestamp)?.toISOString().slice(0,10)??'';if(m[k])m[k].ingresos++;});
    turnos.filter(t=>t.isAbsent===true).forEach(t=>{const k=tsToDate(t.startTime)?.toISOString().slice(0,10)??'';if(m[k])m[k].ausencias++;});
    return Object.values(m);
  }, [turnos, audit, days]);

  const srvRows = useMemo<ServiceRow[]>(() => {
    const tm:Record<string,number>={}, rm:Record<string,number>={};
    audit.forEach(a=>{
      const o=String(a.objectiveId??''); if(!o) return;
      if(a.action==='LLEGADA_TARDE') tm[o]=(tm[o]??0)+1;
      if(a.action==='RETENCION')     rm[o]=(rm[o]??0)+1;
    });
    const m:Record<string,ServiceRow>={};
    turnos.forEach(t=>{
      const oid=String(t.objectiveId??t.objetivoId??'').trim(); if(!oid) return;
      if(!m[oid]) {
        // Enriquecer con objMap (clients collection) — los turnos planificados no tienen nombre directo
        const info = objMap.get(oid);
        m[oid]={
          objectiveId:oid,
          objectiveName: info?.name || String(t.objectiveName??'') || oid,
          clientId:      info?.clientId || String(t.clientId??''),
          clientName:    info?.clientName || String(t.clientName??'Sin cliente'),
          hsEjecutadas:0,hsPlanificadas:0,hsPerdidas:0,presentes:0,ausentes:0,tardanzas:0,retenciones:0,vacantes:0,
        };
      }
      const r=m[oid],hs=shiftHours(t);
      if(t.isPresent===true||t.isCompleted===true){r.hsEjecutadas+=hs;r.presentes++;}
      if(t.isAbsent===true){r.hsPerdidas+=hs;r.ausentes++;}
      if(!t.isAbsent&&!t.isFranco) r.hsPlanificadas+=hs;
      if(!t.employeeId||t.employeeId==='VACANTE'||t.isUnassigned===true) r.vacantes++;
    });
    Object.keys(m).forEach(o=>{m[o].tardanzas=tm[o]??0;m[o].retenciones=rm[o]??0;});
    return Object.values(m);
  }, [turnos, audit, objMap]);

  const cliRows = useMemo<ClientRow[]>(() => {
    const m:Record<string,ClientRow>={};
    srvRows.forEach(s=>{
      const cid=s.clientId||'sin_cliente';
      if(!m[cid]) m[cid]={clientId:cid,clientName:s.clientName,objectives:0,hsEjecutadas:0,hsPlanificadas:0,hsPerdidas:0,presentes:0,ausentes:0,tardanzas:0,retenciones:0};
      const r=m[cid]; r.objectives++;
      r.hsEjecutadas+=s.hsEjecutadas; r.hsPlanificadas+=s.hsPlanificadas; r.hsPerdidas+=s.hsPerdidas;
      r.presentes+=s.presentes; r.ausentes+=s.ausentes; r.tardanzas+=s.tardanzas; r.retenciones+=s.retenciones;
    });
    return Object.values(m);
  }, [srvRows]);

  const empRows = useMemo<EmployeeRow[]>(() => {
    const tm:Record<string,number>={}, rm:Record<string,number>={};
    audit.forEach(a=>{
      const e=String(a.employeeId??a.actorId??''); if(!e||e==='SISTEMA') return;
      if(a.action==='LLEGADA_TARDE') tm[e]=(tm[e]??0)+1;
      if(a.action==='RETENCION')     rm[e]=(rm[e]??0)+1;
    });
    const m:Record<string,EmployeeRow>={};
    turnos.forEach(t=>{
      const eid=String(t.employeeId??''); if(!eid||eid==='VACANTE'||eid==='SIN_COBERTURA') return;
      if(!m[eid]) m[eid]={employeeId:eid,employeeName:String(t.employeeName??'Desconocido'),hsEjecutadas:0,presentes:0,ausentes:0,tardanzas:0,retenciones:0};
      if(t.isPresent===true||t.isCompleted===true){m[eid].hsEjecutadas+=shiftHours(t);m[eid].presentes++;}
      if(t.isAbsent===true) m[eid].ausentes++;
    });
    Object.keys(m).forEach(e=>{m[e].tardanzas=tm[e]??0;m[e].retenciones=rm[e]??0;});
    return Object.values(m);
  }, [turnos, audit]);

  const liqRows = useMemo<LiqRow[]>(() => {
    // Mapa SLA: objectiveId → totalMonthlyHours
    const slaMap = new Map<string,number>();
    (slas as any[]).forEach((s:any) => {
      const oid = String(s.objectiveId ?? s.id ?? '').trim();
      if (oid) slaMap.set(oid, Number(s.totalMonthlyHours ?? 0));
    });
    const slaMult = days / 30; // prorate al período
    const m: Record<string,LiqRow> = {};
    turnos.forEach(t => {
      const oid = String(t.objectiveId ?? t.objetivoId ?? '').trim(); if (!oid) return;
      if (!m[oid]) {
        const info = objMap.get(oid);
        m[oid] = {
          objectiveId: oid,
          objectiveName: info?.name || String(t.objectiveName ?? '') || oid,
          clientName:    info?.clientName || String(t.clientName ?? 'Sin cliente'),
          hsVendidas: (slaMap.get(oid) ?? 0) * slaMult,
          hsPlanificadas:0, hsEjecutadas:0, hsAusencia:0, hsExtras:0, hsFT:0, hsLiquidadas:0, delta:0,
        };
      }
      const r = m[oid];
      const ph = plannedHours(t);
      const rh = realHoursOnly(t);
      const eh = extraHours(t);
      if (!t.isAbsent && !t.isFranco && !t.isFrancoTrabajado) r.hsPlanificadas += ph;
      if (t.isPresent===true||t.isCompleted===true) { r.hsEjecutadas += rh; r.hsExtras += eh; }
      if (t.isAbsent===true) r.hsAusencia += ph;
      if (t.isFrancoTrabajado===true) r.hsFT += ph;
    });
    Object.values(m).forEach(r => {
      r.hsLiquidadas = r.hsEjecutadas + r.hsExtras + r.hsFT;
      r.delta = r.hsVendidas > 0 ? r.hsLiquidadas - r.hsVendidas : 0;
    });
    return Object.values(m);
  }, [turnos, slas, objMap, days]);

  function tgl(cur:[string,SortDir],col:string,set:(v:[string,SortDir])=>void){
    set(cur[0]===col?[col,cur[1]==='asc'?'desc':'asc']:[col,'desc']);
  }
  function srt<T>(rows:T[],sort:[string,SortDir]):T[]{
    return [...rows].sort((a:any,b:any)=>{
      const av=a[sort[0]]??0,bv=b[sort[0]]??0;
      const c=typeof av==='string'?av.localeCompare(bv):av-bv;
      return sort[1]==='asc'?c:-c;
    });
  }

  const sS=useMemo(()=>srt(srvRows,srvSort),[srvRows,srvSort]);
  const sC=useMemo(()=>srt(cliRows,cliSort),[cliRows,cliSort]);
  const sE=useMemo(()=>srt(empRows,empSort),[empRows,empSort]);
  const sL=useMemo(()=>srt(liqRows,liqSort),[liqRows,liqSort]);

  const cliChart=useMemo(()=>
    [...cliRows].sort((a,b)=>b.hsEjecutadas-a.hsEjecutadas).slice(0,10).map(c=>({
      name:c.clientName.length>16?c.clientName.slice(0,14)+'…':c.clientName,
      ejecutadas:Math.round(c.hsEjecutadas),perdidas:Math.round(c.hsPerdidas),
    })),[cliRows]);

  const TABS:{id:TabId;label:string;icon:React.ReactNode}[]=[
    {id:'resumen',      label:'Resumen',      icon:<Activity size={14}/>},
    {id:'servicios',    label:'Servicios',    icon:<Building2 size={14}/>},
    {id:'clientes',     label:'Clientes',     icon:<Briefcase size={14}/>},
    {id:'personal',     label:'Personal',     icon:<UserCheck size={14}/>},
    {id:'liquidacion',  label:'Liquidación',  icon:<TrendingUp size={14}/>},
  ];

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-slate-800">KPIs Ejecutivo</h1>
            <p className="text-sm text-slate-500 mt-0.5">Análisis operativo por período — {days} días</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1">
              {DAYS_OPTIONS.map(d=>(
                <button key={d} onClick={()=>setDays(d)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${days===d?'bg-white text-slate-800 shadow-sm':'text-slate-500 hover:text-slate-700'}`}
                >{d}d</button>
              ))}
            </div>
            <button onClick={()=>setRefreshKey(k=>k+1)} disabled={loading}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium shadow-sm disabled:opacity-50 transition-all">
              <RefreshCw size={14} className={loading?'animate-spin':''}/>Actualizar
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1 w-fit">
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${tab===t.id?'bg-white text-slate-800 shadow-sm':'text-slate-500 hover:text-slate-700'}`}>
              {t.icon}{t.label}
            </button>
          ))}
        </div>

        {loading && (
          <div className="flex items-center justify-center gap-3 py-16 text-slate-400">
            <Loader2 size={22} className="animate-spin"/>
            <span className="text-sm font-medium">Cargando datos…</span>
          </div>
        )}

        {!loading && <>
          {/* ══ RESUMEN ══ */}
          {tab==='resumen' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <KpiCard label="Cobertura"       value={`${gk.cov}%`}               icon={<Shield size={18}/>}        color="emerald" subtitle="Ingresos / (Ingresos + Ausentes)"/>
                <KpiCard label="Ausentismo"      value={`${gk.ausm}%`}              icon={<TrendingDown size={18}/>}   color="rose"    subtitle="Empleados con ausencia / activos"/>
                <KpiCard label="Hs ejecutadas"   value={fmt1(gk.hsE)}               icon={<CheckCircle size={18}/>}   color="blue"    subtitle={`Total horas trabajadas en ${days}d`}/>
                <KpiCard label="Hs perdidas"     value={fmt1(gk.hsP)}               icon={<AlertTriangle size={18}/>} color="rose"    subtitle="Horas en turnos con ausencia"/>
                <KpiCard label="Tardanzas"       value={String(gk.tard)}            icon={<Clock size={18}/>}         color="amber"   subtitle={`Últimos ${days} días`}/>
                <KpiCard label="Retenciones"     value={String(gk.ret)}             icon={<AlertTriangle size={18}/>} color="violet"  subtitle="Horas extra no planificadas"/>
                <KpiCard label="Total ingresos"  value={String(gk.ing)}             icon={<TrendingUp size={18}/>}    color="emerald" subtitle={`Eventos PRESENTE en ${days}d`}/>
                <KpiCard label="Empleados activos" value={String(gk.ea)}            icon={<Users size={18}/>}         color="slate"   subtitle="isAvailable = true"/>
              </div>

              <div className="grid grid-cols-3 gap-4">
                {[
                  {label:'Eficiencia operativa', val:(gk.hsE+gk.hsP)>0?Math.round(gk.hsE/(gk.hsE+gk.hsP)*100):0, sfx:'%', color:'text-slate-800'},
                  {label:'Hs perdidas / total',  val:(gk.hsE+gk.hsP)>0?Math.round(gk.hsP/(gk.hsE+gk.hsP)*100):0, sfx:'%', color:'text-rose-600'},
                  {label:'Servicios SLA activos',val:(slas as any[]).filter((s:any)=>s.status==='active').length,  sfx:'',  color:'text-blue-700'},
                ].map(k=>(
                  <div key={k.label} className="bg-white rounded-2xl shadow-sm p-5 flex flex-col gap-2">
                    <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">{k.label}</span>
                    <span className={`text-4xl font-black leading-none ${k.color}`}>{k.val}{k.sfx}</span>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white rounded-2xl shadow-sm p-5">
                  <h2 className="text-sm font-bold text-slate-700 mb-4 uppercase tracking-wide">
                    Ingresos vs Ausencias<span className="ml-2 text-xs font-normal text-slate-400 normal-case">(últimos {Math.min(days,14)}d)</span>
                  </h2>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={daily} margin={{top:4,right:8,left:-16,bottom:0}}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
                      <XAxis dataKey="date" tick={{fontSize:11,fill:'#94a3b8'}}/>
                      <YAxis tick={{fontSize:11,fill:'#94a3b8'}} allowDecimals={false}/>
                      <Tooltip contentStyle={{borderRadius:'12px',border:'none',boxShadow:'0 4px 24px rgba(0,0,0,0.08)'}} labelStyle={{fontWeight:700}}/>
                      <Bar dataKey="ingresos"  name="Ingresos"  fill="#10b981" radius={[4,4,0,0]}/>
                      <Bar dataKey="ausencias" name="Ausencias" fill="#f43f5e" radius={[4,4,0,0]}/>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="bg-white rounded-2xl shadow-sm p-5">
                  <h2 className="text-sm font-bold text-slate-700 mb-4 uppercase tracking-wide">Hs ejecutadas vs perdidas por cliente</h2>
                  {cliChart.length===0
                    ? <div className="flex items-center justify-center h-[220px] text-slate-400 text-sm">Sin datos</div>
                    : <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={cliChart} layout="vertical" margin={{top:4,right:40,left:4,bottom:4}}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false}/>
                          <XAxis type="number" tick={{fontSize:10,fill:'#94a3b8'}} allowDecimals={false}/>
                          <YAxis type="category" dataKey="name" tick={{fontSize:10,fill:'#64748b'}} width={90}/>
                          <Tooltip contentStyle={{borderRadius:'12px',border:'none',boxShadow:'0 4px 24px rgba(0,0,0,0.08)'}}/>
                          <Bar dataKey="ejecutadas" name="Hs ejecutadas" fill="#3b82f6" radius={[0,4,4,0]}/>
                          <Bar dataKey="perdidas"   name="Hs perdidas"   fill="#f43f5e" radius={[0,4,4,0]}/>
                        </BarChart>
                      </ResponsiveContainer>
                  }
                </div>
              </div>
            </div>
          )}

          {/* ══ SERVICIOS ══ */}
          {tab==='servicios' && (
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Análisis por Objetivo / Servicio</h2>
                <span className="text-xs text-slate-400">{sS.length} servicios · {days}d</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="text-left py-2 px-4 text-xs font-semibold uppercase text-slate-400 tracking-wide">Objetivo</th>
                      <th className="text-left py-2 px-3 text-xs font-semibold uppercase text-slate-400 tracking-wide">Cliente</th>
                      <SortTh label="Hs ejecut."   col="hsEjecutadas"   sort={srvSort} onSort={c=>tgl(srvSort,c,setSrvSort)}/>
                      <SortTh label="Hs planif."   col="hsPlanificadas" sort={srvSort} onSort={c=>tgl(srvSort,c,setSrvSort)}/>
                      <SortTh label="Hs perdidas"  col="hsPerdidas"     sort={srvSort} onSort={c=>tgl(srvSort,c,setSrvSort)}/>
                      <SortTh label="Presentes"    col="presentes"      sort={srvSort} onSort={c=>tgl(srvSort,c,setSrvSort)}/>
                      <SortTh label="Ausentes"     col="ausentes"       sort={srvSort} onSort={c=>tgl(srvSort,c,setSrvSort)}/>
                      <SortTh label="Tardanzas"    col="tardanzas"      sort={srvSort} onSort={c=>tgl(srvSort,c,setSrvSort)}/>
                      <SortTh label="Retenciones"  col="retenciones"    sort={srvSort} onSort={c=>tgl(srvSort,c,setSrvSort)}/>
                      <th className="text-right py-2 px-4 text-xs font-semibold uppercase text-slate-400 tracking-wide">Cobertura</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sS.length===0&&<tr><td colSpan={10} className="text-center py-12 text-slate-400 text-sm">Sin datos para este período</td></tr>}
                    {sS.map(row=>{
                      const tot=row.presentes+row.ausentes, pct=tot>0?Math.round(row.presentes/tot*100):0;
                      return (
                        <tr key={row.objectiveId} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                          <td className="py-3 px-4 font-medium text-slate-800 max-w-[180px] truncate">{row.objectiveName}</td>
                          <td className="py-3 px-3 text-slate-500 text-xs max-w-[140px] truncate">{row.clientName}</td>
                          <td className="py-3 px-3 text-right font-semibold text-blue-600">{fmt1(row.hsEjecutadas)}</td>
                          <td className="py-3 px-3 text-right text-slate-400">{fmt1(row.hsPlanificadas)}</td>
                          <td className="py-3 px-3 text-right font-semibold text-rose-500">{fmt1(row.hsPerdidas)}</td>
                          <td className="py-3 px-3 text-right text-emerald-600 font-semibold">{row.presentes}</td>
                          <td className="py-3 px-3 text-right text-rose-500">{row.ausentes}</td>
                          <td className="py-3 px-3 text-right text-amber-600">{row.tardanzas}</td>
                          <td className="py-3 px-3 text-right text-violet-600">{row.retenciones}</td>
                          <td className="py-3 px-4 text-right"><CovBadge pct={pct}/></td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {sS.length>0&&(
                    <tfoot className="bg-slate-50 border-t border-slate-200">
                      <tr>
                        <td colSpan={2} className="py-2 px-4 text-xs font-bold text-slate-500 uppercase">Total</td>
                        <td className="py-2 px-3 text-right text-xs font-black text-blue-600">{fmt1(sS.reduce((a,r)=>a+r.hsEjecutadas,0))}</td>
                        <td className="py-2 px-3 text-right text-xs text-slate-400">{fmt1(sS.reduce((a,r)=>a+r.hsPlanificadas,0))}</td>
                        <td className="py-2 px-3 text-right text-xs font-black text-rose-500">{fmt1(sS.reduce((a,r)=>a+r.hsPerdidas,0))}</td>
                        <td className="py-2 px-3 text-right text-xs font-bold text-emerald-600">{sS.reduce((a,r)=>a+r.presentes,0)}</td>
                        <td className="py-2 px-3 text-right text-xs font-bold text-rose-500">{sS.reduce((a,r)=>a+r.ausentes,0)}</td>
                        <td className="py-2 px-3 text-right text-xs font-bold text-amber-600">{sS.reduce((a,r)=>a+r.tardanzas,0)}</td>
                        <td className="py-2 px-3 text-right text-xs font-bold text-violet-600">{sS.reduce((a,r)=>a+r.retenciones,0)}</td>
                        <td className="py-2 px-4"/>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}

          {/* ══ CLIENTES ══ */}
          {tab==='clientes' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <KpiCard label="Clientes activos"    value={String(cliRows.length)}                                                  icon={<Briefcase size={18}/>}     color="blue"    subtitle="Con turnos en el período"/>
                <KpiCard label="Total hs ejecutadas" value={fmt1(cliRows.reduce((a,r)=>a+r.hsEjecutadas,0))}                        icon={<CheckCircle size={18}/>}   color="emerald" subtitle="Suma todos los clientes"/>
                <KpiCard label="Total hs perdidas"   value={fmt1(cliRows.reduce((a,r)=>a+r.hsPerdidas,0))}                          icon={<AlertTriangle size={18}/>} color="rose"    subtitle="Por ausencias"/>
                <KpiCard label="Eficiencia global"   value={(()=>{const e=cliRows.reduce((a,r)=>a+r.hsEjecutadas,0),p=cliRows.reduce((a,r)=>a+r.hsPerdidas,0);return (e+p)>0?Math.round(e/(e+p)*100)+'%':'—';})()}
                                                                                                                                     icon={<TrendingUp size={18}/>}    color="emerald" subtitle="Hs ejecutadas / (exec + perdidas)"/>
              </div>

              <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100">
                  <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Rentabilidad Operativa por Cliente</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="text-left py-2 px-4 text-xs font-semibold uppercase text-slate-400 tracking-wide">Cliente</th>
                        <SortTh label="Servicios"   col="objectives"    sort={cliSort} onSort={c=>tgl(cliSort,c,setCliSort)}/>
                        <SortTh label="Hs ejecut."  col="hsEjecutadas"  sort={cliSort} onSort={c=>tgl(cliSort,c,setCliSort)}/>
                        <SortTh label="Hs planif."  col="hsPlanificadas" sort={cliSort} onSort={c=>tgl(cliSort,c,setCliSort)}/>
                        <SortTh label="Hs perdidas" col="hsPerdidas"    sort={cliSort} onSort={c=>tgl(cliSort,c,setCliSort)}/>
                        <SortTh label="Ausentes"    col="ausentes"      sort={cliSort} onSort={c=>tgl(cliSort,c,setCliSort)}/>
                        <SortTh label="Tardanzas"   col="tardanzas"     sort={cliSort} onSort={c=>tgl(cliSort,c,setCliSort)}/>
                        <SortTh label="Retenciones" col="retenciones"   sort={cliSort} onSort={c=>tgl(cliSort,c,setCliSort)}/>
                        <th className="text-right py-2 px-4 text-xs font-semibold uppercase text-slate-400 tracking-wide">Eficiencia</th>
                        <th className="text-right py-2 px-4 text-xs font-semibold uppercase text-slate-400 tracking-wide">Cobertura</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sC.length===0&&<tr><td colSpan={10} className="text-center py-12 text-slate-400 text-sm">Sin datos</td></tr>}
                      {sC.map(row=>{
                        const tot=row.presentes+row.ausentes;
                        const cov=tot>0?Math.round(row.presentes/tot*100):0;
                        const efi=(row.hsEjecutadas+row.hsPerdidas)>0?Math.round(row.hsEjecutadas/(row.hsEjecutadas+row.hsPerdidas)*100):0;
                        return (
                          <tr key={row.clientId} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                            <td className="py-3 px-4 font-semibold text-slate-800 max-w-[200px] truncate">{row.clientName}</td>
                            <td className="py-3 px-3 text-right text-slate-500">{row.objectives}</td>
                            <td className="py-3 px-3 text-right font-semibold text-blue-600">{fmt1(row.hsEjecutadas)}</td>
                            <td className="py-3 px-3 text-right text-slate-400">{fmt1(row.hsPlanificadas)}</td>
                            <td className="py-3 px-3 text-right font-bold text-rose-500">{fmt1(row.hsPerdidas)}</td>
                            <td className="py-3 px-3 text-right text-rose-400">{row.ausentes}</td>
                            <td className="py-3 px-3 text-right text-amber-600">{row.tardanzas}</td>
                            <td className="py-3 px-3 text-right text-violet-600">{row.retenciones}</td>
                            <td className="py-3 px-4 text-right"><CovBadge pct={efi}/></td>
                            <td className="py-3 px-4 text-right"><CovBadge pct={cov}/></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {cliRows.length>0&&(
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {([
                    {title:'Top por hs perdidas',   data:[...cliRows].sort((a,b)=>b.hsPerdidas-a.hsPerdidas).slice(0,6),   vk:'hsPerdidas'   as const, bar:'bg-rose-400',  tc:'text-rose-600'},
                    {title:'Top por hs ejecutadas', data:[...cliRows].sort((a,b)=>b.hsEjecutadas-a.hsEjecutadas).slice(0,6),vk:'hsEjecutadas' as const, bar:'bg-blue-400',  tc:'text-blue-600'},
                  ] as const).map(panel=>(
                    <div key={panel.title} className="bg-white rounded-2xl shadow-sm p-5">
                      <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wide mb-4">{panel.title}</h3>
                      <div className="space-y-3">
                        {panel.data.map((c,i)=>{
                          const max=Math.max(...cliRows.map(r=>r[panel.vk]))||1;
                          const pct=(c[panel.vk]/max)*100;
                          return (
                            <div key={c.clientId} className="flex items-center gap-3">
                              <span className="text-xs font-black text-slate-400 w-4">{i+1}</span>
                              <div className="flex-1 min-w-0">
                                <div className="flex justify-between mb-1">
                                  <span className="text-xs font-semibold text-slate-700 truncate">{c.clientName}</span>
                                  <span className={`text-xs font-black ml-2 ${panel.tc}`}>{fmt1(c[panel.vk])}h</span>
                                </div>
                                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                  <div className={`h-full ${panel.bar} rounded-full`} style={{width:`${pct}%`}}/>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ══ PERSONAL ══ */}
          {tab==='personal' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <KpiCard label="Guardias con turnos"  value={String(empRows.length)}                                                                                    icon={<Users size={18}/>}         color="blue"    subtitle="Con actividad en el período"/>
                <KpiCard label="Total hs trabajadas"  value={fmt1(empRows.reduce((a,r)=>a+r.hsEjecutadas,0))}                                                           icon={<Clock size={18}/>}         color="emerald" subtitle="Suma todos los guardias"/>
                <KpiCard label="Hs prom. por guardia" value={fmt1(empRows.length>0?empRows.reduce((a,r)=>a+r.hsEjecutadas,0)/empRows.length:0)}                         icon={<Activity size={18}/>}      color="slate"   subtitle="Promedio del período"/>
                <KpiCard label="Con ausencias"        value={String(empRows.filter(r=>r.ausentes>0).length)}                                                            icon={<AlertTriangle size={18}/>} color="rose"    subtitle="Guardias con al menos 1 ausencia"/>
              </div>

              <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                  <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Desempeño por Guardia</h2>
                  <span className="text-xs text-slate-400">{sE.length} guardias</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="text-left py-2 px-4 text-xs font-semibold uppercase text-slate-400 tracking-wide">Guardia</th>
                        <SortTh label="Hs trabajadas" col="hsEjecutadas" sort={empSort} onSort={c=>tgl(empSort,c,setEmpSort)}/>
                        <SortTh label="Presencias"    col="presentes"    sort={empSort} onSort={c=>tgl(empSort,c,setEmpSort)}/>
                        <SortTh label="Ausencias"     col="ausentes"     sort={empSort} onSort={c=>tgl(empSort,c,setEmpSort)}/>
                        <SortTh label="Tardanzas"     col="tardanzas"    sort={empSort} onSort={c=>tgl(empSort,c,setEmpSort)}/>
                        <SortTh label="Retenciones"   col="retenciones"  sort={empSort} onSort={c=>tgl(empSort,c,setEmpSort)}/>
                        <th className="text-right py-2 px-4 text-xs font-semibold uppercase text-slate-400 tracking-wide">Puntualidad</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sE.length===0&&<tr><td colSpan={7} className="text-center py-12 text-slate-400 text-sm">Sin datos para este período</td></tr>}
                      {sE.map(row=>{
                        const tot=row.presentes+row.ausentes;
                        const punt=tot>0?Math.max(0,Math.round((row.presentes-row.tardanzas)/tot*100)):100;
                        return (
                          <tr key={row.employeeId} className={`border-b border-slate-50 hover:bg-slate-50 transition-colors ${row.ausentes>2?'bg-rose-50/30':''}`}>
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-2">
                                <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center text-xs font-black text-slate-600 shrink-0">
                                  {(row.employeeName[0]||'?').toUpperCase()}
                                </div>
                                <span className="font-medium text-slate-800 truncate max-w-[180px]">{row.employeeName}</span>
                              </div>
                            </td>
                            <td className="py-3 px-3 text-right font-semibold text-blue-600">{fmt1(row.hsEjecutadas)}</td>
                            <td className="py-3 px-3 text-right text-emerald-600 font-semibold">{row.presentes}</td>
                            <td className="py-3 px-3 text-right"><span className={`font-semibold ${row.ausentes>0?'text-rose-500':'text-slate-400'}`}>{row.ausentes}</span></td>
                            <td className="py-3 px-3 text-right"><span className={row.tardanzas>0?'text-amber-600 font-semibold':'text-slate-400'}>{row.tardanzas}</span></td>
                            <td className="py-3 px-3 text-right"><span className={row.retenciones>0?'text-violet-600 font-semibold':'text-slate-400'}>{row.retenciones}</span></td>
                            <td className="py-3 px-4 text-right"><CovBadge pct={punt}/></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ══ LIQUIDACIÓN / COSTO REAL ══ */}
          {tab==='liquidacion' && (
            <div className="space-y-6">
              {/* Summary cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <KpiCard label="Objetivos analizados"  value={String(liqRows.length)}
                  icon={<Building2 size={18}/>} color="blue" subtitle="Con turnos en el período"/>
                <KpiCard label="Hs Vendidas (SLA)" value={fmt1(liqRows.reduce((a,r)=>a+r.hsVendidas,0))}
                  icon={<Briefcase size={18}/>} color="slate" subtitle="Contratadas × período/30"/>
                <KpiCard label="Hs Liquidadas" value={fmt1(liqRows.reduce((a,r)=>a+r.hsLiquidadas,0))}
                  icon={<Clock size={18}/>} color="emerald" subtitle="Ejecutadas + Extras + FT"/>
                <KpiCard label="Delta total" value={`${liqRows.reduce((a,r)=>a+r.delta,0)>=0?'+':''}${fmt1(liqRows.reduce((a,r)=>a+r.delta,0))}h`}
                  icon={<TrendingUp size={18}/>}
                  color={liqRows.reduce((a,r)=>a+r.delta,0)>0?'rose':'emerald'}
                  subtitle="Liquidadas − Vendidas"/>
              </div>

              {/* Detail cards row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <KpiCard label="Hs Planificadas"  value={fmt1(liqRows.reduce((a,r)=>a+r.hsPlanificadas,0))}  icon={<Activity size={18}/>}      color="blue"   subtitle="Turnos programados no-franco"/>
                <KpiCard label="Hs Ejecutadas"    value={fmt1(liqRows.reduce((a,r)=>a+r.hsEjecutadas,0))}    icon={<CheckCircle size={18}/>}   color="emerald" subtitle="Real trabajado (reloj/real)"/>
                <KpiCard label="Hs Ausencia"      value={fmt1(liqRows.reduce((a,r)=>a+r.hsAusencia,0))}      icon={<AlertTriangle size={18}/>} color="rose"   subtitle="Turnos isAbsent=true"/>
                <KpiCard label="Hs Extras + FT"   value={fmt1(liqRows.reduce((a,r)=>a+r.hsExtras+r.hsFT,0))} icon={<TrendingUp size={18}/>}    color="amber"  subtitle="Horas extra + Franco trabajado"/>
              </div>

              {/* Table */}
              <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Costo Real por Objetivo</h2>
                    <p className="text-xs text-slate-400 mt-0.5">Hs Vendidas = SLA × ({days}d/30d) · Delta = Liquidadas − Vendidas</p>
                  </div>
                  <span className="text-xs text-slate-400">{sL.length} objetivos · {days}d</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="text-left py-2 px-4 text-xs font-semibold uppercase text-slate-400 tracking-wide">Objetivo</th>
                        <th className="text-left py-2 px-3 text-xs font-semibold uppercase text-slate-400 tracking-wide">Cliente</th>
                        <SortTh label="Vendidas"   col="hsVendidas"    sort={liqSort} onSort={c=>tgl(liqSort,c,setLiqSort)}/>
                        <SortTh label="Planif."    col="hsPlanificadas" sort={liqSort} onSort={c=>tgl(liqSort,c,setLiqSort)}/>
                        <SortTh label="Ejecutadas" col="hsEjecutadas"  sort={liqSort} onSort={c=>tgl(liqSort,c,setLiqSort)}/>
                        <SortTh label="Ausencia"   col="hsAusencia"    sort={liqSort} onSort={c=>tgl(liqSort,c,setLiqSort)}/>
                        <SortTh label="Extras"     col="hsExtras"      sort={liqSort} onSort={c=>tgl(liqSort,c,setLiqSort)}/>
                        <SortTh label="FT"         col="hsFT"          sort={liqSort} onSort={c=>tgl(liqSort,c,setLiqSort)}/>
                        <SortTh label="Liquidadas" col="hsLiquidadas"  sort={liqSort} onSort={c=>tgl(liqSort,c,setLiqSort)}/>
                        <SortTh label="Delta"      col="delta"         sort={liqSort} onSort={c=>tgl(liqSort,c,setLiqSort)}/>
                      </tr>
                    </thead>
                    <tbody>
                      {sL.length===0&&<tr><td colSpan={10} className="text-center py-12 text-slate-400 text-sm">Sin datos para este período</td></tr>}
                      {sL.map(row=>{
                        const deltaPos = row.delta >= 0;
                        const deltaColor = deltaPos ? 'text-rose-600 font-bold' : 'text-emerald-600 font-bold';
                        const liqColor  = 'text-violet-600 font-semibold';
                        return (
                          <tr key={row.objectiveId} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                            <td className="py-3 px-4 font-medium text-slate-800 max-w-[160px] truncate">{row.objectiveName}</td>
                            <td className="py-3 px-3 text-slate-500 text-xs max-w-[130px] truncate">{row.clientName}</td>
                            <td className="py-3 px-3 text-right text-slate-500">{row.hsVendidas>0?fmt1(row.hsVendidas):'—'}</td>
                            <td className="py-3 px-3 text-right text-slate-400">{fmt1(row.hsPlanificadas)}</td>
                            <td className="py-3 px-3 text-right font-semibold text-blue-600">{fmt1(row.hsEjecutadas)}</td>
                            <td className="py-3 px-3 text-right text-rose-400">{fmt1(row.hsAusencia)}</td>
                            <td className="py-3 px-3 text-right text-amber-500">{fmt1(row.hsExtras)}</td>
                            <td className="py-3 px-3 text-right text-orange-500">{fmt1(row.hsFT)}</td>
                            <td className={`py-3 px-3 text-right ${liqColor}`}>{fmt1(row.hsLiquidadas)}</td>
                            <td className="py-3 px-4 text-right">
                              {row.hsVendidas>0
                                ? <span className={deltaColor}>{deltaPos?'+':''}{fmt1(row.delta)}h</span>
                                : <span className="text-slate-300 text-xs">sin SLA</span>
                              }
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    {sL.length>0&&(
                      <tfoot className="bg-slate-50 border-t border-slate-200">
                        <tr>
                          <td colSpan={2} className="py-2 px-4 text-xs font-bold text-slate-500 uppercase">Total</td>
                          <td className="py-2 px-3 text-right text-xs text-slate-500">{fmt1(sL.reduce((a,r)=>a+r.hsVendidas,0))}</td>
                          <td className="py-2 px-3 text-right text-xs text-slate-400">{fmt1(sL.reduce((a,r)=>a+r.hsPlanificadas,0))}</td>
                          <td className="py-2 px-3 text-right text-xs font-black text-blue-600">{fmt1(sL.reduce((a,r)=>a+r.hsEjecutadas,0))}</td>
                          <td className="py-2 px-3 text-right text-xs font-bold text-rose-500">{fmt1(sL.reduce((a,r)=>a+r.hsAusencia,0))}</td>
                          <td className="py-2 px-3 text-right text-xs font-bold text-amber-500">{fmt1(sL.reduce((a,r)=>a+r.hsExtras,0))}</td>
                          <td className="py-2 px-3 text-right text-xs font-bold text-orange-500">{fmt1(sL.reduce((a,r)=>a+r.hsFT,0))}</td>
                          <td className="py-2 px-3 text-right text-xs font-black text-violet-600">{fmt1(sL.reduce((a,r)=>a+r.hsLiquidadas,0))}</td>
                          <td className="py-2 px-4 text-right text-xs font-black">
                            {(()=>{const d=sL.reduce((a,r)=>a+r.delta,0);return<span className={d>=0?'text-rose-600':'text-emerald-600'}>{d>=0?'+':''}{fmt1(d)}h</span>;})()}
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>

              {/* Legend */}
              <div className="bg-slate-50 rounded-xl p-4 text-xs text-slate-500 space-y-1">
                <p><span className="font-semibold text-slate-700">Hs Vendidas:</span> totalMonthlyHours del SLA × ({days}d / 30d)</p>
                <p><span className="font-semibold text-slate-700">Hs Ejecutadas:</span> realStartTime → realEndTime en turnos presentes</p>
                <p><span className="font-semibold text-slate-700">Extras:</span> max(0, realEndTime − endTime) por turno</p>
                <p><span className="font-semibold text-slate-700">FT (Franco Trabajado):</span> turnos con isFrancoTrabajado = true</p>
                <p><span className="font-semibold text-slate-700">Hs Liquidadas:</span> Ejecutadas + Extras + FT</p>
                <p><span className="font-semibold">Delta positivo</span> (rojo) = se entregó más de lo vendido. <span className="font-semibold">Delta negativo</span> (verde) = margen a favor.</p>
              </div>
            </div>
          )}
        </>}
      </div>
    </DashboardLayout>
  );
}
