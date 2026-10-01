import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { signOut } from 'firebase/auth';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { MovilMenuScreens } from '@/components/movil/MovilMenuScreens';
import { useEmpresaSheet } from '@/components/movil/useEmpresaSheet';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';
import { auth, db } from '@/lib/firebase';
import { menuMovil, modulosMovil } from '@/lib/movil/movilModulos';
import type { MovilAlerta } from '@/lib/movil/modulos';
import { writeMovilChoice } from '@/lib/movil/useMovilMode';

const ALERTAS_VENTANA_MS = 24 * 60 * 60 * 1000;

function atendida(status: unknown): boolean {
  const s = String(status || '').toUpperCase();
  return s === 'ATENDIDA' || s === 'RESUELTA' || s === 'CERRADA';
}

/**
 * Selector de módulos (`/admin/movil/`).
 * `entrada`: se usa al entrar al panel; con un solo módulo permitido se entra directo sin pasar por el menú.
 * El número de alertas de cada tile son las novedades pendientes de las últimas 24 h que el módulo reconoce.
 */
export function MovilMenuModulos({ entrada = false }: { entrada?: boolean }) {
  const router = useRouter();
  const { canReadModule, isSuperAdmin } = useAuth();
  const { empresaId } = useEmpresa();
  const empresaSheet = useEmpresaSheet();
  const modulos = modulosMovil(canReadModule, isSuperAdmin);
  const { unico } = menuMovil(modulos);
  const [novedades, setNovedades] = useState<Array<MovilAlerta & { status?: unknown }>>([]);

  useEffect(() => {
    if (entrada && unico) void router.replace(unico.href);
  }, [entrada, unico, router]);

  useEffect(() => {
    if (!empresaId || (entrada && unico)) return;
    const since = new Date(Date.now() - ALERTAS_VENTANA_MS);
    const q = query(collection(db, 'novedades'), where('empresaId', '==', empresaId), where('createdAt', '>=', since), orderBy('createdAt', 'desc'), limit(200));
    const unsub = onSnapshot(
      q,
      (snap) => setNovedades(snap.docs.map((d) => d.data() as MovilAlerta & { status?: unknown })),
      () => setNovedades([]),
    );
    return () => unsub();
  }, [empresaId, entrada, unico]);

  const alertas = useMemo(() => {
    const pendientes = novedades.filter((n) => !atendida(n.status));
    const out: Record<string, number> = {};
    for (const modulo of modulos) out[modulo.id] = pendientes.filter((n) => modulo.esAlertaDelModulo(n)).length;
    return out;
  }, [novedades, modulos]);

  if (entrada && unico) return <div className="min-h-screen bg-[#f7f8fa]" />;
  return (
    <>
      <MovilMenuScreens
        empresaName={empresaSheet.empresaName}
        modulos={modulos}
        unico={unico}
        alertas={alertas}
        onEmpresa={empresaSheet.onEmpresa}
        onModulo={(modulo) => { void router.push(modulo.href); }}
        onAsistente={() => window.dispatchEvent(new Event('cosp-assistant-open'))}
        onEscritorio={() => { writeMovilChoice('0'); void router.push('/admin/'); }}
        onLogout={() => {
          void signOut(auth).then(() => { window.location.href = '/login'; }).catch((error) => console.error(error));
        }}
      />
      {empresaSheet.sheet}
    </>
  );
}
