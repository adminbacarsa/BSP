import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { getPortalFirebase } from '../lib/portal';

export function useEmpresaBranding(empresaId?: string | null) {
  const [nombre, setNombre] = useState('');
  const [primaryColor, setPrimaryColor] = useState<string | null>(null);

  useEffect(() => {
    if (!empresaId) {
      setNombre('');
      setPrimaryColor(null);
      return;
    }
    const { db } = getPortalFirebase();
    getDoc(doc(db, 'empresas', empresaId))
      .then((snap) => {
        if (!snap.exists()) return;
        const d = snap.data();
        setNombre(String(d.name || d.nombre || ''));
        if (d.primaryColor) setPrimaryColor(String(d.primaryColor));
      })
      .catch(() => {});
  }, [empresaId]);

  return { empresaNombre: nombre, empresaColor: primaryColor };
}
