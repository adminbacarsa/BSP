import React, { useState, useEffect, useCallback } from 'react';
import {
  collection, query, where, orderBy, getDocs, addDoc,
  doc, updateDoc, serverTimestamp, Timestamp, limit,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { db } from '@/lib/firebase';
import { useEmpresa } from '@/context/EmpresaContext';
import { useToast } from '@/context/ToastContext';
import {
  Plus, X, Save, Clock, CheckCircle, AlertTriangle,
  RefreshCw, Search, Edit3,
} from 'lucide-react';

type CorrectionType =
  | 'AJUSTE_HORAS'
  | 'CORRECCION_PRESENCIA'
  | 'CORRECCION_CODIGO'
  | 'RETENCION_FALTANTE'
  | 'CORRECCION_PLANIFICACION';

const TIPO_LABELS: Record<CorrectionType, string> = {
  AJUSTE_HORAS:             'Ajuste de Horas',
  CORRECCION_PRESENCIA:     'Correcci?n Presencia',
  CORRECCION_CODIGO:        'Correcci?n C?digo',
  RETENCION_FALTANTE:       'Retenci?n No Registrada',
  CORRECCION_PLANIFICACION: 'Correcci?n Planificaci?n',
};

const TIPO_COLORS: Record<CorrectionType, string> = {
  AJUSTE_HORAS:             'bg-indigo-100 text-indigo-700',
  CORRECCION_PRESENCIA:     'bg-emerald-100 text-emerald-700',
  CORRECCION_CODIGO:        'bg-amber-100 text-amber-700',
  RETENCION_FALTANTE:       'bg-rose-100 text-rose-700',
  CORRECCION_PLANIFICACION: 'bg-violet-100 text-violet-700',
};

const stripAuditPrefix = (details: string) => details.replace(/^\[[^\]]+\]\s*/, '');

const SHIFT_CODES = ['M','T','N','D12','N12','F','FF','FP','AA','V','L','E','PG','A'];

const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

interface Props {
  employees: any[];
  canAdjust: boolean;
}

interface CorrForm {
  employeeId: string;
  fecha: string;
  tipo: CorrectionType;
  horas: string;
  minutos: string;
  isPresente: boolean;
  turnoId: string;
  codigoAntes: string;
  codigoDespues: string;
  retencionHoras: string;
  retencionMinutos: string;
  motivo: string;
}

const EMPTY_FORM: CorrForm = {
  employeeId: '', fecha: new Date().toISOString().split('T')[0],
  tipo: 'AJUSTE_HORAS', horas: '', minutos: '0', isPresente: true,
  turnoId: '', codigoAntes: '', codigoDespues: '',
  retencionHoras: '', retencionMinutos: '0', motivo: '',
};

const toDecimalHours = (h: string, m: string) =>
  (parseInt(h || '0', 10) || 0) + (parseInt(m || '0', 10) || 0) / 60;

const fmtHorasMinutos = (h: number) => {
  const sign = h < 0 ? '-' : '+';
  const abs = Math.abs(h);
  const hh = Math.floor(abs);
  const mm = Math.round((abs - hh) * 60);
  if (mm === 0) return `${sign}${hh}h`;
  if (hh === 0) return `${sign}${mm}m`;
  return `${sign}${hh}h ${mm}m`;
};

const toDate = (ts: unknown): Date | null => {
  if (!ts) return null;
  try {
    if (typeof ts === 'object' && ts !== null && 'toDate' in ts && typeof (ts as { toDate: () => Date }).toDate === 'function') {
      return (ts as { toDate: () => Date }).toDate();
    }
    const d = new Date(ts as string | number);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
};

const isInPeriod = (d: Date, year: number, month: number) =>
  d.getFullYear() === year && d.getMonth() + 1 === month;

const parseEmployeeIdFromAudit = (log: Record<string, unknown>, roster: any[]): string | null => {
  if (typeof log.employeeId === 'string' && log.employeeId) return log.employeeId;
  const details = String(log.details || '');
  for (const emp of roster) {
    if (emp.name && details.includes(emp.name)) return emp.id;
  }
  return null;
};

const parseFechaFromAudit = (log: Record<string, unknown>): Date | null => {
  const fromField = toDate(log.fecha);
  if (fromField) return fromField;
  const m = String(log.details || '').match(/el (\d{4}-\d{2}-\d{2})/);
  if (m) return new Date(`${m[1]}T12:00:00`);
  return toDate(log.timestamp);
};

export default function CorreccionesTab({ employees, canAdjust }: Props) {
  const { empresaId } = useEmpresa();
  const { addToast } = useToast();

  const [selectedEmpId, setSelectedEmpId] = useState('');
  const [searchTerm, setSearchTerm]       = useState('');
  const [year, setYear]   = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [corrections, setCorrections] = useState<any[]>([]);
  const [loading, setLoading]         = useState(false);
  const [showModal, setShowModal]     = useState(false);
  const [form, setForm]   = useState<CorrForm>(EMPTY_FORM);
  const [saving, setSaving]           = useState(false);
  const [turnos, setTurnos]           = useState<any[]>([]);
  const [loadingTurnos, setLoadingTurnos] = useState(false);

  const filteredEmployees = employees.filter(e =>
    !searchTerm ||
    e.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    e.legajoId?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const loadCorrections = useCallback(async () => {
    if (!empresaId) return;
    setLoading(true);
    try {
      const ajustesSnap = await getDocs(
        query(collection(db, 'ajustes_horas'), where('empresaId', '==', empresaId)),
      );
      const fromAjustes = ajustesSnap.docs
        .map(d => ({ id: d.id, source: 'ajustes_horas' as const, ...d.data() }))
        .filter(row => {
          const fecha = toDate(row.fecha) || toDate(row.creadoEn);
          if (!fecha || !isInPeriod(fecha, year, month)) return false;
          if (selectedEmpId && row.employeeId !== selectedEmpId) return false;
          return true;
        });

      const auditSnap = await getDocs(
        query(collection(db, 'audit_logs'), orderBy('timestamp', 'desc'), limit(400)),
      );
      const ajusteKeys = new Set(
        fromAjustes
          .filter(r => r.origen === 'PLANIFICACION')
          .map(r => `${r.employeeId}_${toDate(r.fecha)?.toISOString().slice(0, 10)}_${r.motivo}`),
      );

      const fromAudit = auditSnap.docs
        .map(d => ({ id: d.id, source: 'audit_logs' as const, ...d.data() }))
        .filter(log => {
          if (log.action !== 'CORRECCION_SUPERADMIN') return false;
          if (log.empresaId && log.empresaId !== empresaId) return false;
          const empId = parseEmployeeIdFromAudit(log, employees);
          if (selectedEmpId && empId !== selectedEmpId) return false;
          const fecha = parseFechaFromAudit(log);
          if (!fecha || !isInPeriod(fecha, year, month)) return false;
          const key = `${empId}_${fecha.toISOString().slice(0, 10)}_${stripAuditPrefix(String(log.details || ''))}`;
          if (ajusteKeys.has(key)) return false;
          return true;
        })
        .map(log => {
          const empId = parseEmployeeIdFromAudit(log, employees);
          const fecha = parseFechaFromAudit(log)!;
          const emp = employees.find(e => e.id === empId);
          const motivo = stripAuditPrefix(String(log.details || ''));
          return {
            id: `audit_${log.id}`,
            source: 'audit_logs' as const,
            employeeId: empId,
            employeeName: log.employeeName || emp?.name || '?',
            tipo: 'CORRECCION_PLANIFICACION' as CorrectionType,
            fecha: Timestamp.fromDate(fecha),
            motivo,
            creadoPor: log.actorUid,
            creadoPorNombre: log.actorName || '?',
            creadoEn: log.timestamp,
            origen: 'PLANIFICACION',
          };
        });

      const merged = [...fromAjustes, ...fromAudit].sort((a, b) => {
        const ta = toDate(a.creadoEn)?.getTime() || toDate(a.fecha)?.getTime() || 0;
        const tb = toDate(b.creadoEn)?.getTime() || toDate(b.fecha)?.getTime() || 0;
        return tb - ta;
      });

      setCorrections(merged);
    } catch (e) {
      console.error('[CorreccionesTab] loadCorrections:', e);
      addToast('No se pudieron cargar las correcciones. Revis? la consola.', 'error');
    } finally {
      setLoading(false);
    }
  }, [empresaId, selectedEmpId, year, month, employees, addToast]);

  useEffect(() => { loadCorrections(); }, [loadCorrections]);

  // Cargar turnos del d?a cuando cambia empleado/fecha en el modal
  useEffect(() => {
    if (!form.employeeId || !form.fecha || form.tipo === 'AJUSTE_HORAS') {
      setTurnos([]);
      return;
    }
    setLoadingTurnos(true);
    const d = new Date(form.fecha + 'T00:00:00');
    const dayStart = Timestamp.fromDate(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayEnd   = Timestamp.fromDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1));
    getDocs(query(
      collection(db, 'turnos'),
      where('employeeId', '==', form.employeeId),
      where('startTime', '>=', dayStart),
      where('startTime', '<', dayEnd),
    )).then(snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setTurnos(list);
      if (list.length > 0) {
        setForm(f => ({ ...f, turnoId: list[0].id, codigoAntes: (list[0] as any).code || '' }));
      }
    }).catch(console.error).finally(() => setLoadingTurnos(false));
  }, [form.employeeId, form.fecha, form.tipo]);

  const handleOpenModal = (empId?: string) => {
    setForm({ ...EMPTY_FORM, employeeId: empId || selectedEmpId });
    setTurnos([]);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.employeeId)                               { addToast('Seleccion? un empleado', 'error'); return; }
    if (!form.fecha)                                    { addToast('Seleccion? una fecha', 'error'); return; }
    if (!form.motivo.trim())                            { addToast('El motivo es obligatorio', 'error'); return; }
    if (form.tipo === 'AJUSTE_HORAS' && !form.horas && !form.minutos)   { addToast('Ingres? horas o minutos a ajustar', 'error'); return; }
    if (form.tipo === 'CORRECCION_CODIGO' && !form.codigoDespues) { addToast('Seleccion? el c?digo nuevo', 'error'); return; }
    if (form.tipo === 'RETENCION_FALTANTE' && !form.retencionHoras && !form.retencionMinutos) { addToast('Ingres? la duraci?n de la retenci?n', 'error'); return; }

    setSaving(true);
    try {
      const user = getAuth().currentUser;
      const emp  = employees.find(e => e.id === form.employeeId);

      const corrData: any = {
        empresaId,
        employeeId:       form.employeeId,
        employeeName:     emp?.name || form.employeeId,
        tipo:             form.tipo,
        fecha:            Timestamp.fromDate(new Date(form.fecha + 'T12:00:00')),
        motivo:           form.motivo.trim(),
        creadoPor:        user?.uid || '',
        creadoPorNombre:  user?.displayName || user?.email || 'Admin',
        creadoEn:         serverTimestamp(),
      };

      if (form.tipo === 'AJUSTE_HORAS') {
        corrData.horas = toDecimalHours(form.horas, form.minutos);
      }

      if (form.tipo === 'CORRECCION_PRESENCIA' && form.turnoId) {
        corrData.turnoId    = form.turnoId;
        corrData.isPresente = form.isPresente;
        await updateDoc(doc(db, 'turnos', form.turnoId), {
          isPresent: form.isPresente,
          isAbsent:  !form.isPresente,
        });
      }

      if (form.tipo === 'CORRECCION_CODIGO' && form.turnoId) {
        corrData.turnoId       = form.turnoId;
        corrData.codigoAntes   = form.codigoAntes;
        corrData.codigoDespues = form.codigoDespues;
        await updateDoc(doc(db, 'turnos', form.turnoId), { code: form.codigoDespues });
      }

      if (form.tipo === 'RETENCION_FALTANTE') {
        const retenHoras = toDecimalHours(form.retencionHoras, form.retencionMinutos);
        corrData.retencionHoras = retenHoras;
        const baseTurno = turnos[0] as any;
        const baseDate  = new Date(form.fecha + 'T00:00:00');
        const startTs   = baseTurno?.endTime
          || Timestamp.fromDate(new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 6, 0));
        const endTs = Timestamp.fromDate(
          new Date((startTs.toDate ? startTs.toDate() : new Date(startTs)).getTime() + retenHoras * 3600000)
        );
        await addDoc(collection(db, 'turnos'), {
          employeeId:   form.employeeId,
          empresaId,
          objectiveId:  baseTurno?.objectiveId  || null,
          clientId:     baseTurno?.clientId     || null,
          objectiveName: baseTurno?.objectiveName || null,
          code:    'RET',
          origin:  'RETEN',
          isReten: true,
          startTime: startTs,
          endTime:   endTs,
          isPresent: true,
          isAbsent:  false,
          draft:     false,
          createdAt: serverTimestamp(),
          notes: `Retenci?n manual ÿÿÿ ${form.motivo}`,
        });
      }

      await addDoc(collection(db, 'ajustes_horas'), corrData);
      addToast('Correcci?n registrada', 'success');
      setShowModal(false);
      loadCorrections();
    } catch (e: any) {
      console.error(e);
      addToast('Error al guardar: ' + (e.message || e), 'error');
    } finally {
      setSaving(false);
    }
  };

  const fmtDate = (ts: any) => {
    if (!ts) return '';
    try {
      const d = ts.toDate ? ts.toDate() : new Date(ts);
      return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch { return ''; }
  };

  const ajusteNeto = corrections
    .filter(c => c.tipo === 'AJUSTE_HORAS')
    .reduce((acc, c) => acc + (c.horas || 0), 0);

  const corrCount = corrections.filter(c => c.tipo !== 'AJUSTE_HORAS').length;

  const fmtDateTime = (ts: unknown) => {
    const d = toDate(ts);
    if (!d) return '?';
    return d.toLocaleString('es-AR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  return (
    <div className="flex-1 flex gap-4 overflow-hidden">

      {/* ÿÿÿÿÿÿ Panel izquierdo: lista de empleados ÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿ */}
      <div className="w-[260px] bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 shadow-sm flex flex-col overflow-hidden shrink-0">
        <div className="px-3 pt-3 pb-2 border-b border-slate-100 dark:border-slate-700">
          <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-900 px-3 py-2 rounded-xl border border-slate-100 dark:border-slate-700">
            <Search size={13} className="text-slate-400 shrink-0"/>
            <input
              placeholder="Buscar..."
              className="bg-transparent outline-none w-full text-xs font-bold text-slate-900 dark:text-white placeholder:font-medium placeholder:text-slate-400"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
            {searchTerm && <button onClick={() => setSearchTerm('')} className="text-slate-300 hover:text-slate-500"><X size={12}/></button>}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          <button
            onClick={() => setSelectedEmpId('')}
            className={`w-full px-3 py-2 text-left text-[11px] font-bold border-b border-slate-50 dark:border-slate-700 transition-colors ${!selectedEmpId ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300' : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700/50'}`}
          >
            Todos los empleados
          </button>
          {filteredEmployees.map(emp => (
            <button
              key={emp.id}
              onClick={() => setSelectedEmpId(emp.id)}
              className={`w-full px-3 py-2.5 text-left border-b border-slate-50 dark:border-slate-700 transition-colors ${selectedEmpId === emp.id ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'}`}
            >
              <p className="text-xs font-black truncate">{emp.name}</p>
              {emp.legajoId && <p className="text-[10px] text-slate-400">Legajo {emp.legajoId}</p>}
            </button>
          ))}
        </div>
      </div>

      {/* ÿÿÿÿÿÿ Panel derecho ÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿ */}
      <div className="flex-1 flex flex-col gap-3 overflow-hidden min-w-0">

        {/* Header: periodo + bot?n */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <select value={month} onChange={e => setMonth(Number(e.target.value))}
              className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-white">
              {MONTHS.map((m, i) => <option key={i} value={i+1}>{m}</option>)}
            </select>
            <select value={year} onChange={e => setYear(Number(e.target.value))}
              className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-white">
              {[2024,2025,2026,2027].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <button onClick={loadCorrections} className="p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-400 hover:text-indigo-600 transition-colors">
              <RefreshCw size={14}/>
            </button>
          </div>
          {canAdjust && (
            <button onClick={() => handleOpenModal()}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-xs font-black shadow transition-colors">
              <Plus size={14}/> Nueva Correcci?n
            </button>
          )}
        </div>

        {/* Tarjetas resumen (solo si hay empleado seleccionado y hay datos) */}
        {selectedEmpId && corrections.length > 0 && (
          <div className="flex gap-3">
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 px-4 py-3 flex items-center gap-3">
              <Clock size={16} className="text-indigo-500"/>
              <div>
                <p className="text-[10px] text-slate-400 font-bold uppercase">Ajuste neto</p>
                <p className={`text-lg font-black ${ajusteNeto >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {fmtHorasMinutos(ajusteNeto)}
                </p>
              </div>
            </div>
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 px-4 py-3 flex items-center gap-3">
              <Edit3 size={16} className="text-amber-500"/>
              <div>
                <p className="text-[10px] text-slate-400 font-bold uppercase">Correcciones</p>
                <p className="text-lg font-black text-slate-700 dark:text-white">{corrCount}</p>
              </div>
            </div>
          </div>
        )}

        {/* Tabla */}
        <div className="flex-1 overflow-auto bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 shadow-sm">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <RefreshCw size={18} className="animate-spin text-slate-300"/>
            </div>
          ) : corrections.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 gap-2 text-slate-400">
              <Clock size={24}/>
              <p className="text-xs font-bold">Sin correcciones en este per?odo</p>
              {canAdjust && (
                <button onClick={() => handleOpenModal()} className="text-indigo-500 text-xs font-black hover:underline">
                  + Nueva correcci?n
                </button>
              )}
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50">
                  <th className="px-4 py-2.5 text-left font-black text-slate-500 uppercase text-[10px] tracking-wider whitespace-nowrap">Fecha</th>
                  {!selectedEmpId && <th className="px-4 py-2.5 text-left font-black text-slate-500 uppercase text-[10px] tracking-wider">Empleado</th>}
                  <th className="px-4 py-2.5 text-left font-black text-slate-500 uppercase text-[10px] tracking-wider">Tipo</th>
                  <th className="px-4 py-2.5 text-left font-black text-slate-500 uppercase text-[10px] tracking-wider">Detalle</th>
                  <th className="px-4 py-2.5 text-left font-black text-slate-500 uppercase text-[10px] tracking-wider">Motivo</th>
                  <th className="px-4 py-2.5 text-left font-black text-slate-500 uppercase text-[10px] tracking-wider whitespace-nowrap">Registrado</th>
                  <th className="px-4 py-2.5 text-left font-black text-slate-500 uppercase text-[10px] tracking-wider whitespace-nowrap">Creado por</th>
                </tr>
              </thead>
              <tbody>
                {corrections.map(c => (
                  <tr key={c.id} className="border-b border-slate-50 dark:border-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-700/30">
                    <td className="px-4 py-3 font-bold text-slate-700 dark:text-slate-200 whitespace-nowrap">{fmtDate(c.fecha)}</td>
                    {!selectedEmpId && (
                      <td className="px-4 py-3 font-bold text-slate-700 dark:text-slate-200 max-w-[130px] truncate">{c.employeeName}</td>
                    )}
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${TIPO_COLORS[c.tipo as CorrectionType] || 'bg-slate-100 text-slate-600'}`}>
                        {TIPO_LABELS[c.tipo as CorrectionType] || c.tipo}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {c.tipo === 'AJUSTE_HORAS' && (
                        <span className={`font-black ${(c.horas || 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {fmtHorasMinutos(c.horas || 0)}
                        </span>
                      )}
                      {c.tipo === 'CORRECCION_PRESENCIA' && (
                        <span className={`font-black ${c.isPresente ? 'text-emerald-600' : 'text-rose-600'}`}>
                          ÿÿÿ {c.isPresente ? 'Presente' : 'Ausente'}
                        </span>
                      )}
                      {c.tipo === 'CORRECCION_CODIGO' && (
                        <span className="font-black text-amber-700">{c.codigoAntes} ? {c.codigoDespues}</span>
                      )}
                      {c.tipo === 'CORRECCION_PLANIFICACION' && (
                        <span className="font-black text-violet-700">
                          {c.codigoAntes && c.codigoDespues
                            ? `${c.codigoAntes} ? ${c.codigoDespues}`
                            : c.objectiveName || 'Planificaci?n'}
                        </span>
                      )}
                      {c.tipo === 'RETENCION_FALTANTE' && (
                        <span className="font-black text-rose-700">{fmtHorasMinutos(c.retencionHoras || 0)} retenci?n</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500 max-w-[200px] truncate" title={c.motivo}>{c.motivo}</td>
                    <td className="px-4 py-3 text-slate-400 whitespace-nowrap text-[10px]">{fmtDateTime(c.creadoEn)}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300 whitespace-nowrap font-bold">{c.creadoPorNombre || '\u2014'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ÿÿÿÿÿÿ MODAL Nueva Correcci?n ÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿ */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-[200] flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-black text-slate-800 dark:text-white">Nueva Correcci?n de Registro</h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600 transition-colors"><X size={18}/></button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto max-h-[70vh]">
              {/* Empleado */}
              <div>
                <label className="text-[11px] font-black text-slate-500 uppercase tracking-wider block mb-1">Empleado</label>
                <select
                  value={form.employeeId}
                  onChange={e => setForm(f => ({ ...f, employeeId: e.target.value, turnoId: '', codigoAntes: '' }))}
                  className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-700 dark:text-white dark:bg-slate-800"
                >
                  <option value="">ÿÿÿ Seleccionar ÿÿÿ</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>

              {/* Fecha */}
              <div>
                <label className="text-[11px] font-black text-slate-500 uppercase tracking-wider block mb-1">Fecha</label>
                <input type="date" value={form.fecha}
                  onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))}
                  className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-700 dark:text-white dark:bg-slate-800"
                />
              </div>

              {/* Tipo */}
              <div>
                <label className="text-[11px] font-black text-slate-500 uppercase tracking-wider block mb-1">Tipo de Correcci?n</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['AJUSTE_HORAS','CORRECCION_PRESENCIA','CORRECCION_CODIGO','RETENCION_FALTANTE'] as CorrectionType[]).map(t => (
                    <button key={t} onClick={() => setForm(f => ({ ...f, tipo: t }))}
                      className={`px-3 py-2 rounded-xl text-[11px] font-black text-left transition-colors ${form.tipo === t ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'}`}>
                      {TIPO_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>

              {/* AJUSTE_HORAS */}
              {form.tipo === 'AJUSTE_HORAS' && (
                <div>
                  <label className="text-[11px] font-black text-slate-500 uppercase tracking-wider block mb-1">Cantidad</label>
                  <div className="flex items-center gap-2">
                    <div className="flex rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 shrink-0">
                      <button type="button" onClick={() => setForm(f => ({ ...f, horas: f.horas.startsWith('-') ? f.horas : f.horas ? `-${f.horas}` : '-0' }))}
                        className={`px-3 py-2 text-xs font-black transition-colors ${form.horas.startsWith('-') ? 'bg-rose-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 hover:bg-slate-200'}`}>
                        ÿÿÿ Restar
                      </button>
                      <button type="button" onClick={() => setForm(f => ({ ...f, horas: f.horas.replace(/^-/, '') }))}
                        className={`px-3 py-2 text-xs font-black transition-colors ${!form.horas.startsWith('-') ? 'bg-emerald-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 hover:bg-slate-200'}`}>
                        + Sumar
                      </button>
                    </div>
                    <input type="number" min="0" max="99" placeholder="0"
                      value={form.horas.replace(/^-/, '')}
                      onChange={e => {
                        const sign = form.horas.startsWith('-') ? '-' : '';
                        setForm(f => ({ ...f, horas: e.target.value ? `${sign}${e.target.value}` : '' }));
                      }}
                      className="w-16 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-700 dark:text-white dark:bg-slate-800 text-center"
                    />
                    <span className="text-xs font-bold text-slate-500">hs</span>
                    <input type="number" min="0" max="59" placeholder="0"
                      value={form.minutos}
                      onChange={e => setForm(f => ({ ...f, minutos: e.target.value }))}
                      className="w-16 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-700 dark:text-white dark:bg-slate-800 text-center"
                    />
                    <span className="text-xs font-bold text-slate-500">min</span>
                  </div>
                </div>
              )}

              {/* Selector de turno para tipos que lo necesitan */}
              {(form.tipo === 'CORRECCION_PRESENCIA' || form.tipo === 'CORRECCION_CODIGO') && (
                <div>
                  <label className="text-[11px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                    Turno del d?a {loadingTurnos ? '(cargandoÿÿÿ)' : `(${turnos.length} encontrado${turnos.length !== 1 ? 's' : ''})`}
                  </label>
                  {turnos.length === 0 && !loadingTurnos ? (
                    <p className="text-xs text-slate-400 italic px-1">No se encontraron turnos para ese empleado y fecha.</p>
                  ) : (
                    <select value={form.turnoId}
                      onChange={e => {
                        const t = turnos.find(t => t.id === e.target.value) as any;
                        setForm(f => ({ ...f, turnoId: e.target.value, codigoAntes: t?.code || '' }));
                      }}
                      className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-700 dark:text-white dark:bg-slate-800"
                    >
                      {turnos.map(t => (
                        <option key={(t as any).id} value={(t as any).id}>
                          {(t as any).code || '?'} ÿÿÿ {(t as any).isPresent ? 'ÿÿÿ Presente' : 'ÿÿÿ No marcado'} ÿÿÿ {(t as any).objectiveName || 'Sin objetivo'}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {/* CORRECCION_PRESENCIA */}
              {form.tipo === 'CORRECCION_PRESENCIA' && (
                <div>
                  <label className="text-[11px] font-black text-slate-500 uppercase tracking-wider block mb-1">Estado a aplicar</label>
                  <div className="flex gap-2">
                    <button onClick={() => setForm(f => ({ ...f, isPresente: true }))}
                      className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-black transition-colors ${form.isPresente ? 'bg-emerald-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'}`}>
                      <CheckCircle size={14}/> Presente
                    </button>
                    <button onClick={() => setForm(f => ({ ...f, isPresente: false }))}
                      className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-black transition-colors ${!form.isPresente ? 'bg-rose-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'}`}>
                      <AlertTriangle size={14}/> Ausente
                    </button>
                  </div>
                </div>
              )}

              {/* CORRECCION_CODIGO */}
              {form.tipo === 'CORRECCION_CODIGO' && (
                <div className="flex gap-3 items-end">
                  <div className="flex-1">
                    <label className="text-[11px] font-black text-slate-500 uppercase tracking-wider block mb-1">C?digo actual</label>
                    <input value={form.codigoAntes} readOnly
                      className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 text-slate-400"
                    />
                  </div>
                  <span className="text-slate-400 pb-2 text-lg">ÿÿÿ</span>
                  <div className="flex-1">
                    <label className="text-[11px] font-black text-slate-500 uppercase tracking-wider block mb-1">C?digo nuevo</label>
                    <select value={form.codigoDespues} onChange={e => setForm(f => ({ ...f, codigoDespues: e.target.value }))}
                      className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-700 dark:text-white dark:bg-slate-800">
                      <option value="">ÿÿÿ Seleccionar ÿÿÿ</option>
                      {SHIFT_CODES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
              )}

              {/* RETENCION_FALTANTE */}
              {form.tipo === 'RETENCION_FALTANTE' && (
                <div>
                  <label className="text-[11px] font-black text-slate-500 uppercase tracking-wider block mb-1">Duraci?n de la retenci?n</label>
                  <div className="flex items-center gap-2">
                    <input type="number" min="0" max="12" placeholder="0"
                      value={form.retencionHoras} onChange={e => setForm(f => ({ ...f, retencionHoras: e.target.value }))}
                      className="w-16 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-700 dark:text-white dark:bg-slate-800 text-center"
                    />
                    <span className="text-xs font-bold text-slate-500">hs</span>
                    <input type="number" min="0" max="59" placeholder="0"
                      value={form.retencionMinutos} onChange={e => setForm(f => ({ ...f, retencionMinutos: e.target.value }))}
                      className="w-16 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-700 dark:text-white dark:bg-slate-800 text-center"
                    />
                    <span className="text-xs font-bold text-slate-500">min</span>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">Se crear? un turno de tipo RET a partir del egreso del turno del d?a.</p>
                </div>
              )}

              {/* Motivo */}
              <div>
                <label className="text-[11px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                  Motivo <span className="text-rose-500">*</span>
                </label>
                <textarea placeholder="Describ? el motivo de la correcci?nÿÿÿ"
                  value={form.motivo} onChange={e => setForm(f => ({ ...f, motivo: e.target.value }))}
                  rows={3}
                  className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-700 dark:text-white dark:bg-slate-800 resize-none"
                />
              </div>
            </div>

            <div className="flex gap-3 px-6 py-4 border-t border-slate-100 dark:border-slate-800">
              <button onClick={() => setShowModal(false)}
                className="flex-1 py-2.5 rounded-xl text-sm font-black border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                Cancelar
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-black bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white transition-colors">
                {saving ? <RefreshCw size={14} className="animate-spin"/> : <Save size={14}/>}
                {saving ? 'Guardandoÿÿÿ' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
