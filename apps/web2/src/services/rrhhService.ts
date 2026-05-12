
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs, doc, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore';

export const rrhhService = {
  // --- EMPLEADOS ---
  getEmployees: async () => {
    try {
      const s = await getDocs(collection(db, 'empleados'));
      return s.docs.map(d => {
        const data = d.data();
        return { 
          id: d.id, 
          legajo: data.fileNumber || data.legajo || 'S/D', 
          name: data.name || '',
          cuit: data.dni || data.cuil || '', 
          address: data.address || '',
          cct: data.laborAgreement || data.cct || '', 
          category: data.category || 'Sin Categoría',
          status: data.isAvailable ? 'activo' : 'inactivo',
          lat: data.lat || 0,
          lng: data.lng || 0,
          maxHours: data.maxHours || 200,
          periodType: data.periodType || 'Mensual',
          cycleStartDay: data.cycleStartDay || 21,
          ...data 
        };
      });
    } catch (e) {
      console.error("Error leyendo empleados:", e);
      return [];
    }
  },

  addEmployee: (data: any) => addDoc(collection(db, 'empleados'), { 
    ...data, 
    fileNumber: data.legajo,
    dni: data.cuit,
    laborAgreement: data.cct,
    createdAt: new Date().toISOString(),
    isAvailable: true, 
    docs: [] 
  }),

  updateEmployee: (id: string, data: any) => updateDoc(doc(db, 'empleados', id), data),
  deleteEmployee: (id: string) => deleteDoc(doc(db, 'empleados', id)),

  importEmployeesBatch: async (employeesData: any[]) => {
    const batch = writeBatch(db);
    employeesData.forEach(emp => {
      const docRef = doc(collection(db, 'empleados'));
      batch.set(docRef, {
        ...emp,
        fileNumber: emp.legajo,
        dni: emp.cuit,
        laborAgreement: emp.cct,
        createdAt: new Date().toISOString(),
        isAvailable: true,
        docs: []
      });
    });
    await batch.commit();
  },

  // --- CONVENIOS ---
  getAgreements: async () => {
    const s = await getDocs(collection(db, 'convenios_colectivos'));
    return s.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  addAgreement: (data: any) => addDoc(collection(db, 'convenios_colectivos'), data),
  updateAgreement: (id: string, data: any) => updateDoc(doc(db, 'convenios_colectivos', id), data),
  deleteAgreement: (id: string) => deleteDoc(doc(db, 'convenios_colectivos', id)),

  // --- CALENDARIO Y AUSENCIAS ---
  getHolidays: async () => {
    // Traemos TODOS los feriados cargados para no filtrar por año hardcodeado
    const s = await getDocs(collection(db, 'feriados'));
    return s.docs.map(d => ({ id: d.id, ...d.data() })); 
  },

  addHoliday: (data: any) => addDoc(collection(db, 'feriados'), data),
  deleteHoliday: (id: string) => deleteDoc(doc(db, 'feriados', id)),

  // Seed Dinámico para cualquier año
  seedHolidays: async (holidays: any[], yearData: { year: number, link: string }) => {
    const batch = writeBatch(db);
    
    // Guardamos referencia del año (opcional)
    const metaRef = doc(collection(db, 'feriados'));
    batch.set(metaRef, { 
        date: `${yearData.year}-01-00`, 
        name: 'CONFIG_YEAR', 
        link: yearData.link, 
        type: 'System' 
    });

    // Guardamos los feriados
    holidays.forEach(h => {
      const docRef = doc(collection(db, 'feriados'));
      batch.set(docRef, h);
    });
    await batch.commit();
  },

  getAbsences: async () => {
    const s = await getDocs(collection(db, 'ausencias'));
    return s.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  addAbsence: (data: any) => addDoc(collection(db, 'ausencias'), { ...data, createdAt: new Date().toISOString() }),
  updateAbsence: (id: string, data: any) => updateDoc(doc(db, 'ausencias', id), data),
  deleteAbsence: (id: string) => deleteDoc(doc(db, 'ausencias', id))
};
