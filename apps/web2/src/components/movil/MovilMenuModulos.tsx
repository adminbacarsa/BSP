import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { signOut } from 'firebase/auth';
import { MovilMenuScreens } from '@/components/movil/MovilMenuScreens';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';
import { auth } from '@/lib/firebase';
import { menuMovil, modulosMovil } from '@/lib/movil/movilModulos';
import { writeMovilChoice } from '@/lib/movil/useMovilMode';

/**
 * Selector de módulos (`/admin/movil/`).
 * `entrada`: se usa al entrar al panel; con un solo módulo permitido se entra directo sin pasar por el menú.
 */
export function MovilMenuModulos({ entrada = false }: { entrada?: boolean }) {
  const router = useRouter();
  const { canReadModule, isSuperAdmin, allEmpresas } = useAuth();
  const { empresa, empresas, empresaId, switchEmpresa } = useEmpresa();
  const modulos = modulosMovil(canReadModule, isSuperAdmin);
  const { unico } = menuMovil(modulos);

  useEffect(() => {
    if (entrada && unico) void router.replace(unico.href);
  }, [entrada, unico, router]);

  if (entrada && unico) return <div className="min-h-screen bg-slate-100" />;
  return (
    <MovilMenuScreens
      empresaId={empresaId}
      empresaName={empresa?.name || empresaId || 'Empresa'}
      empresas={empresas.filter((e) => e.active !== false).map((e) => ({ id: e.id, name: e.name || e.id }))}
      canSwitchEmpresa={isSuperAdmin || allEmpresas}
      modulos={modulos}
      unico={unico}
      onModulo={(modulo) => { void router.push(modulo.href); }}
      onSwitchEmpresa={switchEmpresa}
      onAsistente={() => window.dispatchEvent(new Event('cosp-assistant-open'))}
      onEscritorio={() => { writeMovilChoice('0'); void router.push('/admin/'); }}
      onLogout={() => {
        void signOut(auth).then(() => { window.location.href = '/login'; }).catch((error) => console.error(error));
      }}
    />
  );
}
