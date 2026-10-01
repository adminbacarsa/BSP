import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';
import { MovilMenuGrid } from '@/components/movil/MovilMenuGrid';
import { movilModulesForPermissions } from '@/lib/movil/navItems';
import { writeMovilChoice } from '@/lib/movil/useMovilMode';

/** Selector de módulos. Con un solo permiso entra directo y esta pantalla no se muestra. */
export function MovilSelector() {
  const router = useRouter();
  const { canReadModule, isSuperAdmin, allEmpresas } = useAuth();
  const { empresa, empresas, empresaId, switchEmpresa } = useEmpresa();
  const modules = movilModulesForPermissions((key) => isSuperAdmin || canReadModule(key));

  useEffect(() => {
    if (modules.length === 1) void router.replace(modules[0].href);
  }, [modules, router]);

  if (modules.length <= 1) return null;

  return (
    <div className="mx-auto min-h-screen w-full max-w-[480px] bg-slate-100 px-3 pb-8 pt-4" data-movil-screen="selector">
      <header className="mb-3">
        <p className="text-[10px] font-black uppercase tracking-widest text-indigo-600">COSP</p>
        <h1 className="text-lg font-black text-slate-900">Módulos</h1>
      </header>
      <MovilMenuGrid
        empresaId={empresaId}
        empresaName={empresa?.name || empresaId || 'Empresa'}
        empresas={empresas.filter((item) => item.active !== false).map((item) => ({ id: item.id, name: item.name || item.id }))}
        canSwitchEmpresa={isSuperAdmin || allEmpresas}
        modules={modules}
        currentModuleId={null}
        onModule={(module) => { void router.push(module.href); }}
        onSwitchEmpresa={(id) => switchEmpresa(id)}
        onAsistente={() => window.dispatchEvent(new Event('cosp-assistant-open'))}
        onEscritorio={() => writeMovilChoice('0')}
        onAvisos={() => {
          if (typeof Notification === 'undefined') return;
          void Notification.requestPermission().then((perm) => {
            if (perm === 'granted') window.location.reload();
          });
        }}
        onLogout={() => {
          void signOut(auth).then(() => { window.location.href = '/login'; }).catch((error) => console.error(error));
        }}
      />
    </div>
  );
}
