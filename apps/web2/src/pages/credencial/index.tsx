import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { ShieldCheck, AlertTriangle, BadgeCheck } from 'lucide-react';

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
      .then(snap => { snap.exists() ? setData(snap.data() as CredPublica) : setNotFound(true); })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [router.query.id]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center"
        style={{ background: 'linear-gradient(160deg, #0a1628 0%, #1a3a6b 100%)' }}>
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-full border-2 border-slate-600 border-t-amber-400 animate-spin"/>
          <p className="text-slate-400 text-sm font-bold uppercase tracking-widest">Verificando...</p>
        </div>
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-6 text-center"
        style={{ background: 'linear-gradient(160deg, #0a1628 0%, #1a3a6b 100%)' }}>
        <div className="w-20 h-20 rounded-full bg-amber-500/10 border-2 border-amber-500/30 flex items-center justify-center">
          <AlertTriangle size={36} className="text-amber-400"/>
        </div>
        <div>
          <p className="text-white font-black text-xl">Credencial no encontrada</p>
          <p className="text-slate-400 text-sm mt-1 max-w-xs">
            Esta credencial no ha sido activada o no existe en el sistema.
          </p>
        </div>
        <div className="mt-2 px-4 py-2 rounded-full border border-amber-500/30 bg-amber-500/10">
          <p className="text-amber-400 text-[11px] font-bold uppercase tracking-widest">
            Documento no válido
          </p>
        </div>
      </div>
    );
  }

  const apellidoNombre = [data.lastName?.toUpperCase(), data.firstName].filter(Boolean).join(', ');

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: 'linear-gradient(160deg, #0a1628 0%, #0f2a5a 60%, #0a1628 100%)' }}
    >
      {/* Header verificación */}
      <div className="flex-shrink-0 flex flex-col items-center pt-10 pb-6 px-6">
        {/* Badge animado */}
        <div
          className="w-24 h-24 rounded-full flex items-center justify-center mb-4 shadow-2xl"
          style={{
            background: 'linear-gradient(135deg, #16a34a, #15803d)',
            boxShadow: '0 0 0 6px rgba(34,197,94,0.15), 0 0 0 12px rgba(34,197,94,0.07)',
          }}
        >
          <BadgeCheck size={48} className="text-white" strokeWidth={1.5}/>
        </div>

        <p className="text-white text-2xl font-black tracking-wide text-center">
          IDENTIDAD VERIFICADA
        </p>
        <p className="text-green-400 text-[11px] font-bold uppercase tracking-widest mt-1 text-center">
          Documento auténtico · Sistema COSP
        </p>
      </div>

      {/* Tarjeta credencial */}
      <div className="flex-1 px-5 pb-8 flex flex-col gap-4">
        <div className="w-full max-w-sm mx-auto rounded-3xl overflow-hidden shadow-2xl bg-white">

          {/* Header empresa */}
          <div
            className="px-5 py-5 flex items-center gap-3 relative overflow-hidden"
            style={{ background: 'linear-gradient(135deg, #0a1628 0%, #1a3a6b 100%)' }}
          >
            <div className="absolute inset-0 pointer-events-none" style={{
              backgroundImage: 'repeating-linear-gradient(135deg, rgba(200,168,75,0.08) 0px, rgba(200,168,75,0.08) 1px, transparent 1px, transparent 12px)',
            }}/>
            <ShieldCheck size={38} strokeWidth={1.5} className="text-amber-400 flex-shrink-0 relative"/>
            <div className="relative">
              <p className="text-white text-base font-black tracking-wide leading-tight">
                {(data.empresaNombre || 'SEGURIDAD PRIVADA').toUpperCase()}
              </p>
              <p className="text-amber-400 text-[9px] tracking-widest uppercase mt-0.5 font-bold">
                Verificación de Credencial
              </p>
            </div>
          </div>
          <div className="h-1.5" style={{ background: 'linear-gradient(90deg, #1a3a6b, #c8a84b, #1a3a6b)' }}/>

          {/* Foto + datos */}
          <div className="px-5 pt-5 pb-4 flex gap-4">
            {data.photoUrl ? (
              <div className="flex-shrink-0">
                <img
                  src={data.photoUrl}
                  alt="Foto"
                  className="object-cover object-center rounded-2xl shadow-md"
                  style={{ width: 100, height: 130, border: '2.5px solid #c8a84b' }}
                />
              </div>
            ) : (
              <div
                className="flex-shrink-0 rounded-2xl flex items-center justify-center bg-slate-100"
                style={{ width: 100, height: 130, border: '2px dashed #cbd5e1' }}
              >
                <ShieldCheck size={28} className="text-slate-300"/>
              </div>
            )}

            <div className="flex-1 min-w-0">
              <p className="font-black text-gray-900 text-lg leading-tight">{apellidoNombre || '—'}</p>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mt-0.5">
                {data.category || 'Vigilador'}
              </p>

              <div className="mt-3 space-y-2.5">
                {data.dni && (
                  <div>
                    <p className="text-[8px] font-bold text-gray-400 uppercase tracking-wider">DNI</p>
                    <p className="text-base font-black font-mono text-gray-800 leading-tight">{data.dni}</p>
                  </div>
                )}
                {data.fileNumber && (
                  <div>
                    <p className="text-[8px] font-bold text-gray-400 uppercase tracking-wider">Legajo</p>
                    <p className="text-base font-black font-mono text-gray-800 leading-tight">{data.fileNumber}</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Separador */}
          <div className="mx-5 border-t border-gray-100"/>

          {/* Badge verificado */}
          <div className="mx-5 my-4 flex items-center gap-3 bg-green-50 border border-green-200 rounded-2xl px-4 py-3">
            <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
              <BadgeCheck size={18} className="text-green-600"/>
            </div>
            <div>
              <p className="text-[12px] font-black text-green-800">Credencial verificada</p>
              <p className="text-[10px] text-green-600 font-bold">Empleado registrado y activo en el sistema</p>
            </div>
          </div>

          {/* Footer */}
          <div className="h-2" style={{ background: 'linear-gradient(90deg, #0a1628, #1a3a6b)' }}/>
        </div>

        {/* Tagline */}
        <p className="text-center text-[10px] text-slate-600 font-bold uppercase tracking-widest">
          COSP V1.0 · Sistema de Gestión Operativa
        </p>
      </div>
    </div>
  );
}
