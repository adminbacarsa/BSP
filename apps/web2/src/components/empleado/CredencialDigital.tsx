import { useEffect, useRef, useState } from 'react';
import {
  Camera, Download, RefreshCw, ShieldCheck, X,
  Sparkles, ChevronLeft, ChevronRight, Pencil,
} from 'lucide-react';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { storage, db } from '@/lib/firebase';
import QRCode from 'qrcode';

interface Props {
  empDocId: string;
  empData: {
    firstName?: string;
    lastName?: string;
    dni?: string;
    cuil?: string;
    fileNumber?: string;
    category?: string;
    photoUrl?: string;
  };
  empresaNombre?: string;
}

const TEMAS = [
  { id: 'navy',  label: 'Marino', header: '#0f2351', accent: '#c8a84b' },
  { id: 'rojo',  label: 'Rojo',   header: '#991b1b', accent: '#fecaca' },
  { id: 'verde', label: 'Verde',  header: '#14532d', accent: '#86efac' },
  { id: 'negro', label: 'Negro',  header: '#171717', accent: '#e5e5e5' },
  { id: 'acero', label: 'Acero',  header: '#1e3a5f', accent: '#7dd3fc' },
  { id: 'royal', label: 'Royal',  header: '#4c1d95', accent: '#c084fc' },
];

export default function CredencialDigital({ empDocId, empData, empresaNombre }: Props) {
  const [fotoSrc, setFotoSrc]               = useState<string | null>(empData.photoUrl || null);
  const [fotoFinal, setFotoFinal]           = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl]           = useState<string>('');
  const [temaIdx, setTemaIdx]               = useState(0);
  const [guardando, setGuardando]           = useState(false);
  const [quitandoFondo, setQuitandoFondo]   = useState(false);
  const [progFondo, setProgFondo]           = useState(0);
  const [showCamera, setShowCamera]         = useState(false);
  const [stream, setStream]                 = useState<MediaStream | null>(null);
  const [capturedBlob, setCapturedBlob]     = useState<Blob | null>(null);
  const [credGuardada, setCredGuardada]     = useState(false);
  const [modoEdicion, setModoEdicion]       = useState(false);
  const [empresaLocal, setEmpresaLocal]     = useState(empresaNombre || '');

  const videoRef    = useRef<HTMLVideoElement>(null);
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const tema           = TEMAS[temaIdx];
  const nombre         = [empData.firstName, empData.lastName].filter(Boolean).join(' ');
  const apellidoNombre = [empData.lastName?.toUpperCase(), empData.firstName].filter(Boolean).join(', ');
  const fotoMostrada   = fotoFinal || fotoSrc;
  const showEditUI     = !credGuardada || modoEdicion;
  const empresaDisplay = empresaLocal || empresaNombre || '';

  // QR → URL de credencial pública
  useEffect(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://comtroldata.web.app';
    QRCode.toDataURL(`${origin}/credencial/?id=${empDocId}`, {
      width: 200, margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
    }).then(setQrDataUrl).catch(() => {});
  }, [empDocId]);

  // Cargar credencial guardada si existe
  useEffect(() => {
    if (!empDocId) return;
    getDoc(doc(db, 'credenciales_publicas', empDocId))
      .then(snap => {
        if (snap.exists()) {
          setCredGuardada(true);
          const d = snap.data();
          if (d.photoUrl) setFotoSrc(d.photoUrl);
          if (d.empresaNombre) setEmpresaLocal(d.empresaNombre);
        } else {
          // fallback: intentar foto desde storage
          getDownloadURL(storageRef(storage, `credenciales/${empDocId}/foto_sb.png`))
            .then(url => { setFotoFinal(url); setFotoSrc(url); })
            .catch(() => getDownloadURL(storageRef(storage, `credenciales/${empDocId}/foto.png`))
              .then(setFotoSrc).catch(() => {}));
        }
      })
      .catch(() => {});
  }, [empDocId]);

  // Actualizar empresaLocal cuando cambia el prop
  useEffect(() => {
    if (empresaNombre) setEmpresaLocal(empresaNombre);
  }, [empresaNombre]);

  // ── Cámara ──────────────────────────────────────────────────────────────────
  const abrirCamara = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1024 }, height: { ideal: 1024 } },
        audio: false,
      });
      setStream(s);
      setShowCamera(true);
      setTimeout(() => {
        if (videoRef.current) { videoRef.current.srcObject = s; videoRef.current.play(); }
      }, 150);
    } catch { fileInputRef.current?.click(); }
  };

  const cerrarCamara = () => {
    stream?.getTracks().forEach(t => t.stop());
    setStream(null);
    setShowCamera(false);
  };

  const capturarFoto = () => {
    const video = videoRef.current, canvas = canvasRef.current;
    if (!video || !canvas) return;
    const side = Math.min(video.videoWidth, video.videoHeight);
    canvas.width = side; canvas.height = side;
    const ctx = canvas.getContext('2d')!;
    const ox = (video.videoWidth - side) / 2, oy = (video.videoHeight - side) / 2;
    ctx.save(); ctx.translate(side, 0); ctx.scale(-1, 1);
    ctx.drawImage(video, ox, oy, side, side, 0, 0, side, side);
    ctx.restore();
    canvas.toBlob(blob => {
      if (!blob) return;
      setCapturedBlob(blob);
      setFotoSrc(canvas.toDataURL('image/png'));
      setFotoFinal(null);
      cerrarCamara();
    }, 'image/png');
  };

  const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const src = ev.target?.result as string; if (!src) return;
      setFotoSrc(src); setFotoFinal(null);
      fetch(src).then(r => r.blob()).then(setCapturedBlob);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // ── Quitar fondo con IA ─────────────────────────────────────────────────────
  const quitarFondo = async () => {
    const blob = capturedBlob || (fotoSrc ? await fetch(fotoSrc).then(r => r.blob()) : null);
    if (!blob) return;
    setQuitandoFondo(true); setProgFondo(0);
    try {
      const { removeBackground } = await import('@imgly/background-removal');
      const resultBlob = await removeBackground(blob, {
        model: 'isnet_quint8',
        output: { format: 'image/png' },
        progress: (_k: string, cur: number, tot: number) => {
          if (tot > 0) setProgFondo(Math.round((cur / tot) * 100));
        },
      });
      setFotoFinal(URL.createObjectURL(resultBlob));
      setCapturedBlob(resultBlob);
    } catch (e) { console.error(e); }
    finally { setQuitandoFondo(false); setProgFondo(0); }
  };

  // ── Guardar foto + credencial pública ────────────────────────────────────────
  const guardarFoto = async () => {
    if (!capturedBlob || !empDocId) return;
    setGuardando(true);
    try {
      const isSF = !!fotoFinal;
      const path = isSF ? `credenciales/${empDocId}/foto_sb.png` : `credenciales/${empDocId}/foto.png`;
      const r = storageRef(storage, path);
      await uploadBytes(r, capturedBlob, { contentType: 'image/png' });
      const url = await getDownloadURL(r);
      if (isSF) setFotoFinal(url); else setFotoSrc(url);
      setCapturedBlob(null);

      await setDoc(doc(db, 'credenciales_publicas', empDocId), {
        firstName:    empData.firstName  || '',
        lastName:     empData.lastName   || '',
        dni:          empData.dni        || '',
        fileNumber:   empData.fileNumber || '',
        category:     empData.category   || '',
        empresaNombre: empresaDisplay,
        photoUrl:     url,
        updatedAt:    serverTimestamp(),
      });

      setCredGuardada(true);
      setModoEdicion(false);
    } catch { /* mantener en memoria si falla */ }
    finally { setGuardando(false); }
  };

  // ── Descargar PNG ────────────────────────────────────────────────────────────
  const descargar = async () => {
    const W = 400, H = 600;
    const cv = document.createElement('canvas');
    cv.width = W * 2; cv.height = H * 2;
    const ctx = cv.getContext('2d')!;
    ctx.scale(2, 2);

    // Fondo blanco
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, 0, 0, W, H, 16); ctx.fill();

    // Header
    const HH = 130;
    ctx.fillStyle = tema.header;
    ctx.beginPath();
    ctx.moveTo(16, 0); ctx.lineTo(W - 16, 0);
    ctx.quadraticCurveTo(W, 0, W, 16);
    ctx.lineTo(W, HH); ctx.lineTo(0, HH); ctx.lineTo(0, 16);
    ctx.quadraticCurveTo(0, 0, 16, 0);
    ctx.closePath(); ctx.fill();

    // Empresa en header
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'left';
    ctx.fillText((empresaDisplay || 'SEGURIDAD PRIVADA').toUpperCase(), 20, 52);
    ctx.fillStyle = tema.accent;
    ctx.font = '10px Arial';
    ctx.fillText('Credencial Digital de Identidad', 20, 72);

    // Línea de acento
    ctx.fillStyle = tema.accent;
    ctx.fillRect(0, HH, W, 3);

    // Nombre y cargo
    ctx.fillStyle = '#111827';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(apellidoNombre || nombre || '—', 20, HH + 32);
    ctx.fillStyle = '#6b7280'; ctx.font = 'bold 10px Arial';
    ctx.fillText((empData.category || 'Vigilador').toUpperCase(), 20, HH + 50);

    // Datos
    let y = HH + 75;
    const drawRow = (label: string, value: string) => {
      ctx.fillStyle = '#9ca3af'; ctx.font = '9px Arial'; ctx.textAlign = 'left';
      ctx.fillText(label, 20, y);
      ctx.fillStyle = '#1f2937'; ctx.font = 'bold 11px Arial';
      ctx.fillText(value, 72, y); y += 18;
    };
    if (empData.dni)        drawRow('DNI',    empData.dni);
    if (empData.cuil)       drawRow('CUIL',   empData.cuil);
    if (empData.fileNumber) drawRow('Legajo', empData.fileNumber);

    // Foto (abajo izquierda)
    const photoY = HH + 130, photoH = 200, photoW = 150;
    if (fotoMostrada) {
      const img = new Image(); img.crossOrigin = 'anonymous';
      await new Promise<void>(res => { img.onload = () => res(); img.onerror = () => res(); img.src = fotoMostrada; });
      ctx.save();
      roundRect(ctx, 20, photoY, photoW, photoH, 8); ctx.clip();
      ctx.drawImage(img, 20, photoY, photoW, photoH);
      ctx.restore();
      ctx.strokeStyle = tema.header; ctx.lineWidth = 2;
      roundRect(ctx, 20, photoY, photoW, photoH, 8); ctx.stroke();
    } else {
      ctx.fillStyle = '#f3f4f6';
      roundRect(ctx, 20, photoY, photoW, photoH, 8); ctx.fill();
    }

    // QR (abajo derecha)
    if (qrDataUrl) {
      const qr = new Image();
      await new Promise<void>(res => { qr.onload = () => res(); qr.onerror = () => res(); qr.src = qrDataUrl; });
      const qrSize = 120, qrX = 20 + photoW + 20, qrY = photoY + (photoH - qrSize) / 2;
      ctx.fillStyle = '#ffffff'; ctx.strokeStyle = tema.header; ctx.lineWidth = 2;
      roundRect(ctx, qrX - 6, qrY - 6, qrSize + 12, qrSize + 12, 8);
      ctx.fill(); ctx.stroke();
      ctx.drawImage(qr, qrX, qrY, qrSize, qrSize);
      ctx.fillStyle = '#6b7280'; ctx.font = '8px Arial'; ctx.textAlign = 'center';
      ctx.fillText('ESCANEAR PARA VERIFICAR', qrX + qrSize / 2, qrY + qrSize + 14);
    }

    // Banda inferior
    ctx.fillStyle = tema.header;
    ctx.fillRect(0, H - 8, W, 8);

    const link = document.createElement('a');
    link.download = `credencial_${empData.fileNumber || empDocId}.png`;
    link.href = cv.toDataURL('image/png');
    link.click();
  };

  // ── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-3">

      {/* Tarjeta */}
      <div className="relative rounded-2xl overflow-hidden shadow-2xl mx-auto w-full bg-white" style={{ maxWidth: 340 }}>

        {/* Header colorido */}
        <div className="px-5 py-5 flex items-center gap-3" style={{ background: tema.header }}>
          <ShieldCheck size={36} strokeWidth={1.5} style={{ color: tema.accent, flexShrink: 0 }}/>
          <div>
            <p className="text-white text-base font-black tracking-wide leading-tight">
              {(empresaDisplay || 'SEGURIDAD PRIVADA').toUpperCase()}
            </p>
            <p className="text-[10px] tracking-widest uppercase mt-0.5" style={{ color: tema.accent }}>
              Credencial Digital
            </p>
          </div>
        </div>

        {/* Línea de acento */}
        <div className="h-1" style={{ background: tema.accent }}/>

        {/* Datos empleado */}
        <div className="px-5 pt-4 pb-3">
          <p className="font-black text-gray-900 text-base leading-tight">
            {apellidoNombre || nombre || '—'}
          </p>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-0.5">
            {empData.category || 'Vigilador'}
          </p>
          <div className="mt-2.5 space-y-1.5">
            {empData.dni && (
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-bold text-gray-400 w-10">DNI</span>
                <span className="text-sm font-mono font-bold text-gray-800">{empData.dni}</span>
              </div>
            )}
            {empData.cuil && (
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-bold text-gray-400 w-10">CUIL</span>
                <span className="text-sm font-mono font-bold text-gray-800">{empData.cuil}</span>
              </div>
            )}
            {empData.fileNumber && (
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-bold text-gray-400 w-10">Legajo</span>
                <span className="text-sm font-mono font-bold text-gray-800">{empData.fileNumber}</span>
              </div>
            )}
          </div>
        </div>

        <div className="mx-5 border-t border-gray-100"/>

        {/* Foto + QR */}
        <div className="flex items-end gap-3 px-5 py-4">

          {/* Foto */}
          <div className="flex-1">
            <div
              className={`relative${fotoFinal ? '' : ' overflow-hidden rounded-xl'}`}
              style={{
                height: 170,
                background: fotoFinal ? 'transparent' : '#f1f5f9',
                border: fotoFinal ? 'none' : `2px solid ${tema.header}`,
                borderRadius: fotoFinal ? 0 : undefined,
              }}
            >
              {fotoMostrada ? (
                <img
                  src={fotoMostrada}
                  alt="Foto"
                  className="w-full h-full object-cover object-center"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                  <Camera size={28} className="text-gray-300"/>
                  <p className="text-[9px] text-gray-400 font-bold uppercase">Sin foto</p>
                </div>
              )}
            </div>

            {/* Botones de foto — solo en modo edición */}
            {showEditUI && (
              <div className="flex gap-1 mt-1.5">
                <button
                  onClick={abrirCamara}
                  className="flex-1 text-[9px] font-bold py-1 rounded-lg text-center uppercase tracking-wide"
                  style={{ color: tema.header, background: `${tema.header}12`, border: `1px solid ${tema.header}30` }}
                >
                  <Camera size={9} className="inline mr-0.5"/>
                  {fotoMostrada ? 'Cambiar' : 'Foto'}
                </button>
                {fotoSrc && (
                  <button
                    onClick={quitarFondo}
                    disabled={quitandoFondo}
                    className="flex-1 text-[9px] font-bold py-1 rounded-lg text-center uppercase tracking-wide disabled:opacity-60"
                    style={{ color: tema.header, background: `${tema.header}12`, border: `1px solid ${tema.header}30` }}
                  >
                    {quitandoFondo
                      ? <><RefreshCw size={9} className="inline animate-spin mr-0.5"/>{progFondo}%</>
                      : <><Sparkles size={9} className="inline mr-0.5"/>Sin fondo</>}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* QR */}
          <div className="flex flex-col items-center gap-1">
            {qrDataUrl ? (
              <div className="p-1.5 rounded-xl" style={{ border: `2px solid ${tema.header}` }}>
                <img src={qrDataUrl} alt="QR" width={100} height={100}/>
              </div>
            ) : (
              <div className="rounded-xl flex items-center justify-center bg-gray-50"
                style={{ width: 108, height: 108, border: '2px solid #e5e7eb' }}>
                <RefreshCw size={18} className="text-gray-300"/>
              </div>
            )}
            <p className="text-[8px] font-bold uppercase tracking-widest text-gray-400">Verificar</p>
          </div>
        </div>

        {/* Banda inferior */}
        <div className="h-2" style={{ background: tema.header }}/>
      </div>

      {/* Selector de tema — siempre visible */}
      <div className="flex items-center gap-2">
        <button onClick={() => setTemaIdx(i => (i - 1 + TEMAS.length) % TEMAS.length)}
          className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white">
          <ChevronLeft size={14}/>
        </button>
        <div className="flex-1 flex gap-2 justify-center">
          {TEMAS.map((t, i) => (
            <button
              key={t.id}
              onClick={() => setTemaIdx(i)}
              className="w-6 h-6 rounded-full border-2 transition-all"
              style={{
                background: t.header,
                borderColor: i === temaIdx ? t.accent : 'transparent',
                transform: i === temaIdx ? 'scale(1.25)' : 'scale(1)',
              }}
              title={t.label}
            />
          ))}
        </div>
        <button onClick={() => setTemaIdx(i => (i + 1) % TEMAS.length)}
          className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white">
          <ChevronRight size={14}/>
        </button>
      </div>
      <p className="text-center text-[9px] text-slate-500 font-bold uppercase tracking-wider -mt-1">
        {TEMAS[temaIdx].label}
      </p>

      {/* Acciones */}
      <div className="flex gap-2">
        {/* Si credencial guardada y no en edición → botón Editar */}
        {credGuardada && !modoEdicion && (
          <button
            onClick={() => setModoEdicion(true)}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm font-bold hover:bg-slate-700 transition-all active:scale-95"
          >
            <Pencil size={14}/> Editar foto
          </button>
        )}

        {/* En modo edición: Guardar si hay blob nuevo */}
        {showEditUI && capturedBlob && (
          <button
            onClick={guardarFoto}
            disabled={guardando}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-black disabled:opacity-50 transition-all active:scale-95 text-white"
            style={{ background: tema.header }}
          >
            {guardando
              ? <RefreshCw size={14} className="animate-spin"/>
              : <ShieldCheck size={14}/>}
            Guardar
          </button>
        )}

        <button
          onClick={descargar}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm font-bold hover:bg-slate-700 transition-all active:scale-95"
        >
          <Download size={14}/> Descargar
        </button>
      </div>

      {/* Canvas oculto */}
      <canvas ref={canvasRef} className="hidden"/>
      <input ref={fileInputRef} type="file" accept="image/*" capture="user" className="hidden" onChange={onFileSelect}/>

      {/* Modal cámara */}
      {showCamera && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 bg-black/90">
            <p className="text-white font-black text-sm">Foto carnet</p>
            <button onClick={cerrarCamara} className="text-slate-400 hover:text-white p-1">
              <X size={22}/>
            </button>
          </div>
          <div className="flex-1 relative flex items-center justify-center bg-black overflow-hidden">
            <video ref={videoRef} playsInline muted
              className="h-full w-full object-cover"
              style={{ transform: 'scaleX(-1)' }}
            />
            <div className="absolute border-[3px] pointer-events-none" style={{
              width: '62vw', maxWidth: 260,
              height: '80vw', maxHeight: 340,
              borderRadius: '50%',
              borderColor: tema.accent,
              boxShadow: `0 0 0 9999px rgba(0,0,0,0.6), inset 0 0 0 2px ${tema.accent}40`,
            }}/>
            <div className="absolute bottom-28 px-4 py-1.5 rounded-full bg-black/50">
              <p className="text-white text-xs font-bold text-center">
                Centrá tu rostro en el óvalo
              </p>
            </div>
          </div>
          <div className="pb-12 pt-4 bg-black/90 flex justify-center">
            <button
              onClick={capturarFoto}
              style={{
                width: 72, height: 72,
                background: '#fff',
                border: `4px solid ${tema.accent}`,
                boxShadow: `0 0 0 6px ${tema.accent}30`,
                borderRadius: '50%',
              }}
              className="active:scale-90 transition-transform"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
