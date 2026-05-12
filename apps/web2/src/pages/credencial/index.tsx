import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { ShieldCheck, AlertTriangle, CheckCircle } from 'lucide-react';

interface CredPublica {
  firstName: string;
  lastName: string;
  dni: string;
  fileNumber: string;
  category: string;
  empresaNombre: string;
  photoUrl?: string;
}

export default function CredencialPublica() {
  const router = useRouter();
  const [data, setData]         = useState<CredPublica | null>(null);
  const [loading, setLoading]   = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const id = router.query.id as string;
    if (!id) return;
    getDoc(doc(db, 'credenciales_publicas', id))
      .then(snap => {
        if (snap.exists()) setData(snap.data() as CredPublica);
        else setNotFound(true);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [router.query.id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-600 border-t-white"/>
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-3 px-6 text-center">
        <AlertTriangle size={40} className="text-amber-500"/>
        <p className="text-white font-black text-lg">Credencial no encontrada</p>
        <p className="text-slate-400 text-sm">
          Esta credencial no está verificada o no existe en el sistema.
        </p>
      </div>
    );
  }

  const apellidoNombre = [data.lastName?.toUpperCase(), data.firstName].filter(Boolean).join(', ');

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl bg-white">

        {/* Header */}
        <div className="px-5 py-5 flex items-center gap-3 bg-[#0f2351]">
          <ShieldCheck size={36} strokeWidth={1.5} className="text-amber-400 flex-shrink-0"/>
          <div>
            <p className="text-white text-base font-black tracking-wide leading-tight">
              {(data.empresaNombre || 'SEGURIDAD PRIVADA').toUpperCase()}
            </p>
            <p className="text-[10px] tracking-widest uppercase mt-0.5 text-amber-400">
              Verificación de Credencial
            </p>
          </div>
        </div>
        <div className="h-1 bg-amber-400"/>

        {/* Foto + datos */}
        <div className="flex gap-4 px-5 py-4">
          {data.photoUrl && (
            <img
              src={data.photoUrl}
              alt="Foto"
              className="w-24 h-32 object-cover object-top rounded-xl flex-shrink-0"
              style={{ border: '2px solid #0f2351' }}
            />
          )}
          <div className="flex-1 min-w-0">
            <p className="font-black text-gray-900 text-base leading-tight">{apellidoNombre || '—'}</p>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-0.5">
              {data.category || 'Vigilador'}
            </p>
            <div className="mt-3 space-y-1.5">
              {data.dni && (
                <div className="flex gap-2 items-center">
                  <span className="text-[10px] font-bold text-gray-400 w-12">DNI</span>
                  <span className="text-sm font-mono font-bold text-gray-800">{data.dni}</span>
                </div>
              )}
              {data.fileNumber && (
                <div className="flex gap-2 items-center">
                  <span className="text-[10px] font-bold text-gray-400 w-12">Legajo</span>
                  <span className="text-sm font-mono font-bold text-gray-800">{data.fileNumber}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Badge verificado */}
        <div className="mx-5 mb-4 flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-3 py-2">
          <CheckCircle size={16} className="text-green-600 flex-shrink-0"/>
          <p className="text-[11px] font-bold text-green-700">
            Credencial verificada · Empleado registrado en el sistema
          </p>
        </div>

        <div className="h-2 bg-[#0f2351]"/>
      </div>

      <p className="mt-4 text-[10px] text-slate-600 text-center">
        COSP V1.0 · Sistema de Gestión Operativa
      </p>
    </div>
  );
}
