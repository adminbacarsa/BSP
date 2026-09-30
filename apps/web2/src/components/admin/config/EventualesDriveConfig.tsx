import { useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { FolderOpen, Save } from 'lucide-react';
import { toast } from 'sonner';
import { functions } from '@/lib/firebase';
import { DRIVE_ROOT_EVENTUALES_DEFAULT } from '@/lib/eventuales/marcoAnexoConst.mjs';

export default function EventualesDriveConfig() {
  const [folderId, setFolderId] = useState(DRIVE_ROOT_EVENTUALES_DEFAULT);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    const fn = httpsCallable(functions, 'gestionarMarcoEventual');
    fn({ accion: 'config' }).then((res) => {
      const id = String((res.data as { driveRootFolderId?: string }).driveRootFolderId || '');
      if (id) setFolderId(id);
    }).catch(() => {});
  }, []);

  const guardar = async () => {
    setGuardando(true);
    try {
      const fn = httpsCallable(functions, 'gestionarMarcoEventual');
      await fn({ accion: 'config', guardar: true, driveRootFolderId: folderId.trim() });
      toast.success('Carpeta de Drive guardada.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="rounded-2xl border p-6 shadow-sm" style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}>
      <h3 className="mb-3 flex items-center gap-2 text-sm font-black" style={{ color: 'var(--txt)' }}>
        <FolderOpen size={16} /> Drive de eventuales
      </h3>
      <p className="mb-3 text-xs" style={{ color: 'var(--txt3)' }}>
        Carpeta raíz. Ahí se crea Eventuales y, adentro, una carpeta por persona. Hay que invitar como Editor a comtroldata@appspot.gserviceaccount.com.
      </p>
      <div className="flex flex-wrap gap-2">
        <input value={folderId} onChange={(e) => setFolderId(e.target.value)} className="w-80 rounded-xl border px-3 py-2 text-sm" />
        <button type="button" onClick={guardar} disabled={guardando} className="inline-flex items-center gap-1 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-bold text-white">
          <Save size={14} /> Guardar
        </button>
      </div>
    </div>
  );
}
