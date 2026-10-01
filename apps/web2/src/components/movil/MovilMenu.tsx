import { useRouter } from 'next/router';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';
import { BottomSheet } from '@/components/movil/BottomSheet';
import { MovilMenuGrid } from '@/components/movil/MovilMenuGrid';
import { movilModuleForPath, movilModulesForPermissions } from '@/lib/movil/navItems';
import { writeMovilChoice } from '@/lib/movil/useMovilMode';

/** Hoja «Más»: módulos por permiso, empresa activa, asistente y salida. */
export function MovilMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { canReadModule, isSuperAdmin, allEmpresas } = useAuth();
  const { empresa, empresas, empresaId, switchEmpresa } = useEmpresa();
  const modules = movilModulesForPermissions((key) => isSuperAdmin || canReadModule(key));
  const current = movilModuleForPath(router.pathname, router.query as Record<string, string | string[] | undefined>);

  return (
    <BottomSheet open={open} title="Más" onClose={onClose}>
      <MovilMenuGrid
        empresaId={empresaId}
        empresaName={empresa?.name || empresaId || 'Empresa'}
        empresas={empresas.filter((item) => item.active !== false).map((item) => ({ id: item.id, name: item.name || item.id }))}
        canSwitchEmpresa={isSuperAdmin || allEmpresas}
        modules={modules}
        currentModuleId={current?.id || null}
        onModule={(module) => { onClose(); void router.push(module.href); }}
        onSwitchEmpresa={(id) => { switchEmpresa(id); onClose(); }}
        onAsistente={() => { onClose(); window.dispatchEvent(new Event('cosp-assistant-open')); }}
        onEscritorio={() => { onClose(); writeMovilChoice('0'); }}
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
    </BottomSheet>
  );
}
