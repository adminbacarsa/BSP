import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, query, where, getDocs, writeBatch, serverTimestamp, Timestamp, doc } from 'firebase/firestore';
import { toast } from 'sonner';
import { getDateKey } from './utils';
export function usePlanificacionLogic(selectedClient: string, selectedObjective: string, operatorName: string) {
    const [employees, setEmployees] = useState<any[]>([]);
    const [shiftsMap, setShiftsMap] = useState<any>({});
    const [absencesMap, setAbsencesMap] = useState<any>({});
    const [clients, setClients] = useState<any[]>([]);
    const [pendingChanges, setPendingChanges] = useState<any>({});
    const [isProcessing, setIsProcessing] = useState(false);
    const [positionStructure, setPositionStructure] = useState<any[]>([]);
    useEffect(() => {
        const unsubE = onSnapshot(collection(db, 'empleados'), snap => setEmployees(snap.docs.map(d => ({ id: d.id, ...d.data(), name: d.data().name || (d.data().firstName + ' ' + d.data().lastName) }))));
        const unsubC = onSnapshot(collection(db, 'clients'), snap => setClients(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
        const unsubS = onSnapshot(collection(db, 'turnos'), snap => {
            const map: any = {};
            snap.docs.forEach(d => { if(d.data().startTime) map[`${d.data().employeeId}_${getDateKey(d.data().startTime)}`] = { id: d.id, ...d.data(), code: d.data().code || d.data().type }; });
            setShiftsMap(map);
        });
        const unsubA = onSnapshot(collection(db, 'ausencias'), snap => {
            const map: any = {};
            snap.docs.forEach(d => { if(d.data().startDate) map[`${d.data().employeeId}_${d.data().startDate}`] = { id: d.id, ...d.data() }; });
            setAbsencesMap(map);
        });
        return () => { unsubE(); unsubC(); unsubS(); unsubA(); };
    }, []);
    useEffect(() => {
        if (!selectedClient || !selectedObjective) return;
        getDocs(query(collection(db, 'servicios_sla'), where('clientId', '==', selectedClient))).then(snap => {
            const srv = snap.docs.map(d => d.data()).find(d => d.objectiveId === selectedObjective);
            if (srv?.positions) setPositionStructure(Array.isArray(srv.positions) ? srv.positions : Object.values(srv.positions));
        });
    }, [selectedClient, selectedObjective]);
    const handleSaveAll = async () => {
        setIsProcessing(true); const batch = writeBatch(db);
        try {
            for (const [key, change] of Object.entries(pendingChanges)) {
                const [empId, dateStr] = key.split('_'); const existing = shiftsMap[key];
                if ((change as any).isDeleted) { if(existing?.id) batch.delete(doc(db, 'turnos', existing.id)); }
                else {
                    if(existing?.id) batch.delete(doc(db, 'turnos', existing.id));
                    const [y, m, d] = dateStr.split('-').map(Number);
                    batch.set(doc(collection(db, 'turnos')), {
                        employeeId: empId, clientId: selectedClient, objectiveId: selectedObjective, code: (change as any).code, startTime: Timestamp.fromDate(new Date(y, m-1, d, 7, 0)), endTime: Timestamp.fromDate(new Date(y, m-1, d, 15, 0)), positionName: (change as any).positionName || 'General', status: 'Assigned', createdAt: serverTimestamp(), actor: operatorName
                    });
                }
            }
            await batch.commit(); setPendingChanges({}); toast.success('Guardado');
        } catch (e) { toast.error('Error'); } finally { setIsProcessing(false); }
    };
    return { employees, shiftsMap, absencesMap, clients, pendingChanges, setPendingChanges, isProcessing, positionStructure, handleSaveAll };
}