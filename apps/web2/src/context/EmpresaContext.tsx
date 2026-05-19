import React, { createContext, useContext, useEffect, useState } from 'react';
import { doc, onSnapshot, collection, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from './AuthContext';
import { SUPERADMIN_EMPRESA_STORAGE_KEY } from '@/lib/multiempresa';

export interface Empresa {
  id: string;
  name: string;
  cuit?: string;
  direccion?: string;
  logo?: string;
  plan?: string;
  active?: boolean;
  primaryColor?: string;
  assistantEnabled?: boolean;
}

interface EmpresaContextType {
  /** ID de la empresa activa (puede ser distinto al del auth si superadmin cambió) */
  empresaId: string;
  /** Datos de la empresa activa */
  empresa: Empresa | null;
  /** Lista de todas las empresas (solo disponible para superadmin) */
  empresas: Empresa[];
  /** Permite al superadmin cambiar de empresa sin cerrar sesión */
  switchEmpresa: (id: string) => void;
  loadingEmpresa: boolean;
}

const EmpresaContext = createContext<EmpresaContextType>({
  empresaId: 'bacarsa',
  empresa: null,
  empresas: [],
  switchEmpresa: () => {},
  loadingEmpresa: true,
});

export const useEmpresa = () => useContext(EmpresaContext);

export const EmpresaProvider = ({ children }: { children: React.ReactNode }) => {
  const { empresaId: authEmpresaId, isSuperAdmin } = useAuth();
  const [empresaId, setEmpresaId] = useState(authEmpresaId || '');
  const [empresa, setEmpresa] = useState<Empresa | null>(null);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [loadingEmpresa, setLoadingEmpresa] = useState(true);

  // Cuando el auth carga el empresaId del usuario, sincronizamos (superadmin conserva selección en sesión)
  useEffect(() => {
    if (authEmpresaId === undefined) return;
    if (isSuperAdmin) {
      const saved =
        typeof localStorage !== 'undefined' ? localStorage.getItem(SUPERADMIN_EMPRESA_STORAGE_KEY) : null;
      setEmpresaId(saved || authEmpresaId || '');
    } else {
      setEmpresaId(authEmpresaId || 'bacarsa');
    }
  }, [authEmpresaId, isSuperAdmin]);

  // Superadmin sin empresa seleccionada → auto-seleccionar la primera de la lista
  useEffect(() => {
    if (!isSuperAdmin || empresaId || empresas.length === 0) return;
    const saved =
      typeof localStorage !== 'undefined' ? localStorage.getItem(SUPERADMIN_EMPRESA_STORAGE_KEY) : null;
    const pick = saved && empresas.some(e => e.id === saved) ? saved : empresas[0].id;
    setEmpresaId(pick);
  }, [isSuperAdmin, empresaId, empresas]);

  // Suscripción al documento de la empresa activa
  useEffect(() => {
    if (!empresaId) return;
    setLoadingEmpresa(true);
    const unsub = onSnapshot(
      doc(db, 'empresas', empresaId),
      snap => {
        const defaultName = empresaId === 'bacarsa' ? 'Bacar SA' : empresaId;
        if (snap.exists()) {
          const data = snap.data() as Omit<Empresa, 'id'>;
          // Si el doc existe pero le falta el nombre, lo rellenamos
          if (!data.name) {
            setDoc(doc(db, 'empresas', empresaId), { name: defaultName }, { merge: true }).catch(() => {});
          }
          setEmpresa({ id: snap.id, name: defaultName, ...data });
        } else {
          // Documento no existe — lo creamos automáticamente
          setEmpresa({ id: empresaId, name: defaultName });
          setDoc(
            doc(db, 'empresas', empresaId),
            { name: defaultName, active: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
            { merge: true }
          ).catch(() => {});
        }
        setLoadingEmpresa(false);
      },
      () => {
        setEmpresa({ id: empresaId, name: empresaId });
        setLoadingEmpresa(false);
      }
    );
    return () => unsub();
  }, [empresaId]);

  // Superadmin: carga todas las empresas para el selector
  useEffect(() => {
    if (!isSuperAdmin) return;
    const unsub = onSnapshot(
      collection(db, 'empresas'),
      snap => setEmpresas(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Empresa, 'id'>) }))),
      () => {}
    );
    return () => unsub();
  }, [isSuperAdmin]);

  const switchEmpresa = (id: string) => {
    if (!isSuperAdmin) return;
    setEmpresaId(id);
    try {
      localStorage.setItem(SUPERADMIN_EMPRESA_STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  };

  return (
    <EmpresaContext.Provider value={{ empresaId, empresa, empresas, switchEmpresa, loadingEmpresa }}>
      {children}
    </EmpresaContext.Provider>
  );
};
