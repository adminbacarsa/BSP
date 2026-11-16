import React, { createContext, useContext, useEffect, useState } from 'react';
import { doc, collection, setDoc, onSnapshot } from 'firebase/firestore';
import { db, onSnapshotFresh } from '@/lib/firebase';
import { useAuth } from './AuthContext';
import { SUPERADMIN_EMPRESA_STORAGE_KEY } from '@/lib/multiempresa';
import { applyCompanyTheme } from '@/lib/companyTheme';
import { persistGoogleMapsApiKey } from '@/lib/googleMapsConfig';

export interface Empresa {
  id: string;
  name: string;
  cuit?: string;
  direccion?: string;
  website?: string;
  email?: string;
  phone?: string;
  logo?: string;
  plan?: string;
  active?: boolean;
  primaryColor?: string;
  brandColor?: string;
  assistantEnabled?: boolean;
  centroControlEnabled?: boolean;
  /** true = consumidores usan @cosp/hours-core F1 (persona/puesto). Default false. */
  hoursCoreEnabled?: boolean;
  pilotoAutoEnabled?: boolean;
  modoDemoEnabled?: boolean;
  migracionCompleta?: boolean;
  /** true = empresa sandbox de capacitación; muestra banner en la UI */
  isTrainingEmpresa?: boolean;
  /** Maps JavaScript API — restringir por HTTP referrer en Google Cloud. */
  googleMapsApiKey?: string;
  /** Domicilio de explotación declarado en ARCA (alta RG 5508). No es el del objetivo. */
  arcaDomicilioExplotacion?: string;
  /** Código de modalidad eventual ARCA/SICOSS. Vacío hasta verificar 14 o 102. */
  arcaModalidadEventual?: string;
  /** Parámetros del TXT de carga masiva. Default de código: modalidad 012. */
  arcaEventuales?: import('@/lib/eventuales/types').ArcaEventualesConfig;
}

interface EmpresaContextType {
  /** ID de la empresa activa (puede ser distinto al del auth si superadmin cambió) */
  empresaId: string;
  /** Datos de la empresa activa */
  empresa: Empresa | null;
  /** Lista de empresas cargadas para el selector (superadmin / allEmpresas / multi-empresa) */
  empresas: Empresa[];
  /** Cambia de empresa sin cerrar sesión (solo si el usuario puede cambiar) */
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
  const { empresaId: authEmpresaId, isSuperAdmin, allEmpresas, empresaIds } = useAuth();
  // SuperAdmin / allEmpresas / subconjunto explícito (empresaIds.length > 1).
  // Antes solo SuperAdmin||allEmpresas: el usuario multi-empresa veía Bacar y el
  // selector no listaba el resto (empresas=[] y switchEmpresa era no-op).
  const canSwitchEmpresa = isSuperAdmin || allEmpresas || empresaIds.length > 1;
  const canPickAnyEmpresa = isSuperAdmin || allEmpresas;
  const [empresaId, setEmpresaId] = useState<string>(() => {
    // Leer localStorage en el initializer evita el render inicial con la empresa
    // del auth ('bacarsa') cuando el superadmin tiene otra empresa guardada.
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(SUPERADMIN_EMPRESA_STORAGE_KEY);
      if (saved) return saved;
    }
    return authEmpresaId || '';
  });
  const [empresa, setEmpresa] = useState<Empresa | null>(null);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [loadingEmpresa, setLoadingEmpresa] = useState(true);

  const isAllowedEmpresa = (id: string): boolean => {
    if (!id) return false;
    if (canPickAnyEmpresa) return true;
    if (empresaIds.length > 1) return empresaIds.includes(id);
    return id === (authEmpresaId || 'bacarsa');
  };

  // Cuando el auth carga el empresaId del usuario, sincronizamos (quien puede cambiar conserva selección en sesión)
  useEffect(() => {
    if (authEmpresaId === undefined) return;
    if (canSwitchEmpresa) {
      const saved =
        typeof localStorage !== 'undefined' ? localStorage.getItem(SUPERADMIN_EMPRESA_STORAGE_KEY) : null;
      if (saved && isAllowedEmpresa(saved)) {
        setEmpresaId(saved);
      } else {
        setEmpresaId(authEmpresaId || (empresaIds[0] || ''));
      }
    } else {
      setEmpresaId(authEmpresaId || 'bacarsa');
    }
  }, [authEmpresaId, canSwitchEmpresa, canPickAnyEmpresa, empresaIds.join('|')]);

  // Sin empresa seleccionada → auto-seleccionar la primera permitida y persistir
  useEffect(() => {
    if (!canSwitchEmpresa || empresaId || empresas.length === 0) return;
    const saved =
      typeof localStorage !== 'undefined' ? localStorage.getItem(SUPERADMIN_EMPRESA_STORAGE_KEY) : null;
    const allowed = canPickAnyEmpresa
      ? empresas
      : empresas.filter((e) => empresaIds.includes(e.id));
    if (allowed.length === 0) return;
    const pick = saved && allowed.some((e) => e.id === saved) ? saved : allowed[0].id;
    setEmpresaId(pick);
    try { localStorage.setItem(SUPERADMIN_EMPRESA_STORAGE_KEY, pick); } catch { /* ignore */ }
  }, [canSwitchEmpresa, canPickAnyEmpresa, empresaId, empresas, empresaIds.join('|')]);

  // Suscripción al documento de la empresa activa.
  // Usamos onSnapshot regular (no onSnapshotFresh) para que loadingEmpresa resuelva
  // inmediatamente con datos de cache y no bloquee la UI mientras espera al servidor.
  // El fix del F5 (empresa incorrecta) lo resuelve el lazy initializer del useState.
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
          persistGoogleMapsApiKey(data.googleMapsApiKey);
          if (data.brandColor && /^#[0-9a-fA-F]{6}$/.test(data.brandColor)) {
            applyCompanyTheme(data.brandColor);
          }
        } else {
          // Documento no existe.
          // Solo auto-crear para 'bacarsa' (empresa default del sistema).
          // Para otras empresas NO recrear: si el doc fue borrado deliberadamente
          // el listener no debe resucitarlo.
          setEmpresa({ id: empresaId, name: defaultName });
          if (empresaId === 'bacarsa') {
            setDoc(
              doc(db, 'empresas', empresaId),
              { name: defaultName, active: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
              { merge: true }
            ).catch(() => {});
          }
        }
        setLoadingEmpresa(false);
      },
      () => {
        const fallbackName = empresaId === 'bacarsa' ? 'Bacar SA' : empresaId;
        setEmpresa({ id: empresaId, name: fallbackName });
        setLoadingEmpresa(false);
      }
    );
    return () => unsub();
  }, [empresaId]);

  // Carga el catálogo de empresas para el selector (superadmin / allEmpresas / multi-empresa)
  useEffect(() => {
    if (!canSwitchEmpresa) {
      setEmpresas([]);
      return;
    }
    const unsub = onSnapshotFresh(
      collection(db, 'empresas'),
      snap => setEmpresas(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Empresa, 'id'>) }))),
      () => {}
    );
    return () => unsub();
  }, [canSwitchEmpresa]);

  const switchEmpresa = (id: string) => {
    if (!canSwitchEmpresa) return;
    if (!isAllowedEmpresa(id)) return;
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
