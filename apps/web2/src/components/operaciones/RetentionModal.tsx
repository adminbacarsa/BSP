
import React, { useState, useEffect } from 'react';
import { X, Clock, UserCheck, Shield, CalendarClock, User, Search, Phone, CheckCircle } from 'lucide-react';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, Timestamp, updateDoc, doc, serverTimestamp, addDoc, orderBy, limit } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { toast } from 'sonner';

const EmployeeCard = ({ data, actionLabel, onAction, colorClass, type }: any) => {
    let displayName = "Guardia";
    if (data.employeeName) displayName = data.employeeName;
    else if (data.firstName) displayName = `${data.lastName} ${data.firstName}`;

    return (
        <div className="flex flex-col p-3 border rounded-xl bg-white hover:shadow-md transition-all">
            <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-slate-100 text-slate-600"><User size={18}/></div>
                    <div><p className="font-bold text-sm">{displayName}</p></div>
                </div>
                {onAction && (<button onClick={() => onAction(data)} className="px-3 py-1 bg-indigo-50 text-indigo-600 rounded-lg text-[10px] font-bold uppercase">{actionLabel}</button>)}
            </div>
        </div>
    );
};

export default function RetentionModal({ isOpen, onClose, retainedShift, onResolve }: any) {
    const [step, setStep] = useState('SELECT_ACTION');
    const [nextShiftCandidates, setNextShiftCandidates] = useState<any[]>([]);

    useEffect(() => { if (isOpen) { setStep('SELECT_ACTION'); loadReliefCandidates(); } }, [isOpen]);

    const loadReliefCandidates = async () => {
        try {
            const now = new Date();
            const q = query(collection(db, 'turnos'), where('objectiveId', '==', retainedShift.objectiveId), where('startTime', '>=', Timestamp.fromDate(now)), orderBy('startTime', 'asc'), limit(5));
            const snap = await getDocs(q);
            setNextShiftCandidates(snap.docs.map(d => ({id:d.id, ...d.data()})));
        } catch(e) {}
    };

    const handleFullCoverage = async () => {
        if(!confirm("¿Confirmar Doble Turno?")) return;
        try {
            await updateDoc(doc(db, 'turnos', retainedShift.id), { isRetention: false, isExtraShift: true, status: 'PRESENT', comments: 'Doble Turno' });
            toast.success("Doble Turno Confirmado"); onResolve();
        } catch(e) { toast.error("Error"); }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[9000] bg-black/60 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
            <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden border flex flex-col">
                <div className="bg-orange-50 p-4 border-b border-orange-100 flex justify-between items-center">
                    <h3 className="font-black text-orange-700 flex items-center gap-2"><Clock size={20}/> RESOLVER RETENCIÓN</h3>
                    <button onClick={onClose}><X size={20}/></button>
                </div>
                <div className="p-6 space-y-4">
                    <div className="bg-white border rounded-xl p-4 shadow-sm flex justify-between items-center">
                        <div><p className="text-xs text-slate-400 font-bold uppercase">Guardia Actual</p><p className="font-bold text-lg">{retainedShift.employeeName}</p></div>
                        <span className="bg-orange-100 text-orange-700 px-3 py-1 rounded-lg text-xs font-bold animate-pulse">EN ESPERA</span>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                         <button onClick={handleFullCoverage} className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl hover:shadow-md transition-all text-emerald-700 font-bold text-sm">🛡️ Doble Turno</button>
                         <button className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl hover:shadow-md transition-all text-indigo-700 font-bold text-sm">🔄 Buscar Relevo</button>
                    </div>
                </div>
            </div>
        </div>
    );
}
