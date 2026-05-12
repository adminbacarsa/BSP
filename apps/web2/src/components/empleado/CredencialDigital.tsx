import { useEffect, useRef, useState } from 'react';
import {
  Camera, Download, RefreshCw, ShieldCheck, X,
  Sparkles, Palette, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '@/lib/firebase';
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

// ── Temas de fondo disponibles ────────────────────────────────────────────────
const TEMAS = [
  { id: 'navy',    label: 'Marino',  bg: 'linear-gradient(170deg,#0a1628 0%,#1a3a6b 100%)', accent: '#c8a84b', text: '#e2e8f0' },
  { id: 'verde',   label: 'Verde',   bg: 'linear-gradient(170deg,#052e16 0%,#166534 100%)', accent: '#86efac', text: '#dcfce7' },
  { id: 'negro',   label: 'Negro',   bg: 'linear-gradient(170deg,#000000 0%,#1c1c1c 100%)', accent: '#d4d4d4', text: '#e5e5e5' },
  { id: 'burdeos', label: 'Burdeos', bg: 'linear-gradient(170deg,#3b0b0b 0%,#991b1b 100%)', accent: '#fca5a5', text: '#fee2e2' },
  { id: 'acero',   label: 'Acero',   bg: 'linear-gradient(170deg,#111827 0%,#4b5563 100%)', accent: '#9ca3af', text: '#f3f4f6' },
  { id: 'royal',   label: 'Royal',   bg: 'linear-gradient(170deg,#1e0050 0%,#5b21b6 100%)', accent: '#c084fc', text: '#ede9fe' },
];

export default function CredencialDigital({ empDocId, empData, empresaNombre }: Props) {
  const [fotoSrc, setFotoSrc]       = useState<string | null>(empData.photoUrl || null);
  const [fotoFinal, setFotoFinal]   = useState<string | null>(null); // foto sin fondo
  const [qrDataUrl, setQrDataUrl]   = useState<string>('');
  const [temaIdx, setTemaIdx]       = useState(0);
  const [guardando, setGuardando]   = useState(false);
  const [quitandoFondo, setQuitandoFondo] = useState(false);
  const [progFondo, setProgFondo]   = useState(0);
  const [showCamera, setShowCamera] = useState(false);
  const [stream, setStream]         = useState<MediaStream | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [showTemas, setShowTemas]   = useState(false);
  const videoRef    = useRef<HTMLVideoElement>(null);
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const cardRef     = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const tema   = TEMAS[temaIdx];
  const nombre = [empData.firstName, empData.lastName].filter(Boolean).join(' ');
  const apellidoNombre = [empData.lastName?.toUpperCase(), empData.firstName].filter(Boolean).join(', ');
  const fotoMostrada = fotoFinal || fotoSrc;

  // ── QR ──────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const payload = JSON.stringify({
      id:      empDocId,
      nombre,
      dni:     empData.dni    || '',
      cuil:    empData.cuil   || '',
      legajo:  empData.fileNumber || '',
      cargo:   empData.category  || '',
    });
    QRCode.toDataURL(payload, {
      width: 160, margin: 1,
      color: { dark: '#0f172a', light: '#ffffff' },
    }).then(setQrDataUrl).catch(() => {});
  }, [empDocId, empData]);

  // ── Cargar foto guardada desde Storage ──────────────────────────────────────
  useEffect(() => {
    if (fotoMostrada || !empDocId) return;
    // Primero intentar foto sin fondo
    getDownloadURL(storageRef(storage, `credenciales/${empDocId}/foto_sb.png`))
      .then(url => { setFotoFinal(url); setFotoSrc(url); })
      .catch(() => {
        getDownloadURL(storageRef(storage, `credenciales/${empDocId}/foto.png`))
          .then(setFotoSrc).catch(() => {});
      });
  }, [empDocId]);

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
    } catch {
      fileInputRef.current?.click();
    }
  };

  const cerrarCamara = () => {
    stream?.getTracks().forEach(t => t.stop());
    setStream(null);
    setShowCamera(false);
  };

  const capturarFoto = () => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const side = Math.min(video.videoWidth, video.videoHeight);
    canvas.width  = side;
    canvas.height = side;
    const ctx = canvas.getContext('2d')!;
    const ox = (video.videoWidth  - side) / 2;
    const oy = (video.videoHeight - side) / 2;
    ctx.save();
    ctx.translate(side, 0); ctx.scale(-1, 1); // espejo frontal
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
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const src = ev.target?.result as string;
      if (!src) return;
      setFotoSrc(src);
      setFotoFinal(null);
      fetch(src).then(r => r.blob()).then(setCapturedBlob);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // ── Quitar fondo con IA ─────────────────────────────────────────────────────
  const quitarFondo = async () => {
    const blob = capturedBlob || (fotoSrc ? await fetch(fotoSrc).then(r => r.blob()) : null);
    if (!blob) return;
    setQuitandoFondo(true);
    setProgFondo(0);
    try {
      const { removeBackground } = await import('@imgly/background-removal');
      const resultBlob = await removeBackground(blob, {
        model: 'isnet_quint8',
        output: { format: 'image/png' },
        progress: (_key: string, cur: number, tot: number) => {
          if (tot > 0) setProgFondo(Math.round((cur / tot) * 100));
        },
      });
      const url = URL.createObjectURL(resultBlob);
      setFotoFinal(url);
      setCapturedBlob(resultBlob);
    } catch (err) {
      console.error('Error al quitar fondo:', err);
    } finally {
      setQuitandoFondo(false);
      setProgFondo(0);
    }
  };

  // ── Guardar foto en Storage ──────────────────────────────────────────────────
  const guardarFoto = async () => {
    if (!capturedBlob || !empDocId) return;
    setGuardando(true);
    try {
      const path = fotoFinal
        ? `credenciales/${empDocId}/foto_sb.png`
        : `credenciales/${empDocId}/foto.png`;
      const r = storageRef(storage, path);
      await uploadBytes(r, capturedBlob, { contentType: 'image/png' });
      const url = await getDownloadURL(r);
      if (fotoFinal) setFotoFinal(url); else setFotoSrc(url);
      setCapturedBlob(null);
    } catch {
      // mantener en memoria si falla storage
    } finally {
      setGuardando(false);
    }
  };

  // ── Descargar credencial ─────────────────────────────────────────────────────
  const descargar = async () => {
    const W = 400, H = 650;
    const cv = document.createElement('canvas');
    cv.width = W * 2; cv.height = H * 2;
    const ctx = cv.getContext('2d')!;
    ctx.scale(2, 2);

    // Fondo
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    const [c1, c2] = tema.bg.match(/#[0-9a-f]{6}/gi) || ['#0a1628', '#1a3a6b'];
    grad.addColorStop(0, c1);
    grad.addColorStop(1, c2);
    ctx.fillStyle = grad;
    roundRect(ctx, 0, 0, W, H, 20); ctx.fill();

    // Banda superior de color de acento
    ctx.fillStyle = tema.accent;
    ctx.fillRect(0, 0, W, 5);

    // Nombre empresa
    ctx.fillStyle = tema.accent;
    ctx.font = 'bold 11px Arial';
    ctx.textAlign = 'center';
    ctx.fillText((empresaNombre || 'SEGURIDAD PRIVADA').toUpperCase(), W / 2, 40);

    // Ícono escudo
    ctx.font = '28px Arial';
    ctx.fillText('🛡', W / 2, 75);

    // Foto oval centrada
    if (fotoMostrada) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise<void>(res => { img.onload = () => res(); img.onerror = () => res(); img.src = fotoMostrada; });
      const pw = 160, ph = 200, px = (W - pw) / 2, py = 100;
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(px + pw / 2, py + ph / 2, pw / 2, ph / 2, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, px, py, pw, ph);
      ctx.restore();
      ctx.strokeStyle = tema.accent;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(px + pw / 2, py + ph / 2, pw / 2, ph / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Nombre completo
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px Arial';
    ctx.fillText(apellidoNombre || nombre, W / 2, 335);

    // Cargo
    ctx.fillStyle = tema.accent;
    ctx.font = 'bold 11px Arial';
    ctx.fillText((empData.category || 'Vigilador').toUpperCase(), W / 2, 355);

    // Línea separadora
    ctx.strokeStyle = tema.accent + '55';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(40, 370); ctx.lineTo(W - 40, 370); ctx.stroke();

    // Datos
    ctx.textAlign = 'left';
    ctx.fillStyle = tema.text + 'aa';
    ctx.font = '10px Arial';
    let y = 390;
    if (empData.dni)        { ctx.fillStyle = '#64748b'; ctx.fillText('DNI',    50, y); ctx.fillStyle = '#e2e8f0'; ctx.fillText(empData.dni, 110, y); y += 18; }
    if (empData.cuil)       { ctx.fillStyle = '#64748b'; ctx.fillText('CUIL',   50, y); ctx.fillStyle = '#e2e8f0'; ctx.fillText(empData.cuil, 110, y); y += 18; }
    if (empData.fileNumber) { ctx.fillStyle = '#64748b'; ctx.fillText('Legajo', 50, y); ctx.fillStyle = '#e2e8f0'; ctx.fillText(empData.fileNumber, 110, y); y += 18; }

    // QR
    if (qrDataUrl) {
      const qr = new Image();
      await new Promise<void>(res => { qr.onload = () => res(); qr.onerror = () => res(); qr.src = qrDataUrl; });
      const qrX = (W - 100) / 2, qrY = H - 130;
      ctx.fillStyle = '#ffffff';
      roundRect(ctx, qrX - 4, qrY - 4, 108, 108, 6); ctx.fill();
      ctx.drawImage(qr, qrX, qrY, 100, 100);
    }

    // Footer
    ctx.fillStyle = '#475569';
    ctx.font = '8px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('CREDENCIAL DIGITAL · ' + new Date().getFullYear(), W / 2, H - 10);

    // Banda inferior
    ctx.fillStyle = tema.accent;
    ctx.fillRect(0, H - 5, W, 5);

    const link = document.createElement('a');
    link.download = `credencial_${empData.fileNumber || empDocId}.png`;
    link.href = cv.toDataURL('image/png');
    link.click();
  };

  // ────────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-3">

      {/* ── Tarjeta vertical ─────────────────────────────────────────────── */}
      <div
        ref={cardRef}
        className="relative rounded-3xl overflow-hidden shadow-2xl mx-auto w-full"
        style={{
          background: tema.bg,
          maxWidth: 340,
          minHeight: 520,
        }}
      >
        {/* Banda superior */}
        <div className="h-1.5 w-full" style={{ background: tema.accent }}/>

        {/* Patrón de fondo sutil */}
        <div className="absolute inset-0 opacity-5 pointer-events-none"
          style={{
            backgroundImage: 'repeating-linear-gradient(45deg,#fff 0,#fff 1px,transparent 0,transparent 50%)',
            backgroundSize: '20px 20px',
          }}
        />

        {/* Encabezado empresa */}
        <div className="relative flex flex-col items-center pt-5 pb-3 px-4">
          <ShieldCheck size={32} style={{ color: tema.accent }} strokeWidth={1.5}/>
          <p className="mt-1.5 text-[11px] font-black tracking-widest uppercase text-center"
            style={{ color: tema.accent }}>
            {empresaNombre || 'Seguridad Privada'}
          </p>
          <p className="text-[8px] tracking-widest uppercase mt-0.5"
            style={{ color: tema.accent + '80' }}>
            Credencial Digital
          </p>
        </div>

        {/* Foto oval */}
        <div className="flex flex-col items-center pb-4">
          <div
            className="relative overflow-hidden border-[3px]"
            style={{
              width: 150, height: 186,
              borderRadius: '50%',
              borderColor: tema.accent,
              background: fotoFinal ? 'transparent' : '#1e293b',
            }}
          >
            {fotoMostrada ? (
              <img src={fotoMostrada} alt="Foto" className="w-full h-full object-cover"/>
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Camera size={36} style={{ color: tema.accent + '60' }}/>
              </div>
            )}
          </div>

          {/* Botones de foto */}
          <div className="flex gap-2 mt-2">
            <button
              onClick={abrirCamara}
              className="flex items-center gap-1 px-3 py-1 rounded-full text-[9px] font-bold transition-all active:scale-95"
              style={{ background: tema.accent + '20', color: tema.accent, border: `1px solid ${tema.accent}40` }}
            >
              <Camera size={10}/> {fotoMostrada ? 'Cambiar foto' : 'Sacar foto'}
            </button>
            {fotoSrc && !quitandoFondo && (
              <button
                onClick={quitarFondo}
                className="flex items-center gap-1 px-3 py-1 rounded-full text-[9px] font-bold transition-all active:scale-95"
                style={{ background: tema.accent + '20', color: tema.accent, border: `1px solid ${tema.accent}40` }}
              >
                <Sparkles size={10}/> Quitar fondo
              </button>
            )}
            {quitandoFondo && (
              <div className="flex items-center gap-1 px-3 py-1 rounded-full text-[9px] font-bold"
                style={{ background: tema.accent + '20', color: tema.accent }}>
                <RefreshCw size={10} className="animate-spin"/>
                {progFondo > 0 ? `${progFondo}%` : 'Cargando IA…'}
              </div>
            )}
          </div>
        </div>

        {/* Línea separadora */}
        <div className="mx-6 mb-4 h-px" style={{ background: `linear-gradient(90deg, transparent, ${tema.accent}60, transparent)` }}/>

        {/* Datos del empleado */}
        <div className="px-6 pb-4 text-center">
          <p className="font-black text-white text-base leading-tight">
            {apellidoNombre || nombre || '—'}
          </p>
          <p className="text-[10px] font-bold uppercase mt-0.5 tracking-wider"
            style={{ color: tema.accent }}>
            {empData.category || 'Vigilador'}
          </p>

          <div className="mt-3 space-y-1 text-left">
            {empData.dni && (
              <div className="flex justify-between text-[11px]">
                <span style={{ color: tema.text + '60' }} className="font-bold">DNI</span>
                <span className="text-white font-mono">{empData.dni}</span>
              </div>
            )}
            {empData.cuil && (
              <div className="flex justify-between text-[11px]">
                <span style={{ color: tema.text + '60' }} className="font-bold">CUIL</span>
                <span className="text-white font-mono">{empData.cuil}</span>
              </div>
            )}
            {empData.fileNumber && (
              <div className="flex justify-between text-[11px]">
                <span style={{ color: tema.text + '60' }} className="font-bold">Legajo</span>
                <span className="text-white font-mono">{empData.fileNumber}</span>
              </div>
            )}
          </div>
        </div>

        {/* QR code */}
        {qrDataUrl && (
          <div className="flex flex-col items-center pb-5">
            <div className="p-2 rounded-xl" style={{ background: '#ffffff' }}>
              <img src={qrDataUrl} alt="QR" width={90} height={90}/>
            </div>
            <p className="text-[7px] font-bold uppercase mt-1 tracking-widest"
              style={{ color: tema.accent + '80' }}>Escanear para verificar</p>
          </div>
        )}

        {/* Banda inferior */}
        <div className="h-1.5 w-full" style={{ background: tema.accent }}/>
      </div>

      {/* ── Controles bajo la tarjeta ────────────────────────────────────── */}
      <div className="flex flex-col gap-2">

        {/* Selector de tema */}
        <div className="flex items-center gap-2">
          <button onClick={() => setTemaIdx(i => (i - 1 + TEMAS.length) % TEMAS.length)}
            className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white">
            <ChevronLeft size={14}/>
          </button>
          <div className="flex-1 flex gap-1.5 justify-center">
            {TEMAS.map((t, i) => (
              <button
                key={t.id}
                onClick={() => setTemaIdx(i)}
                className="w-6 h-6 rounded-full border-2 transition-all"
                style={{
                  background: t.bg,
                  borderColor: i === temaIdx ? t.accent : 'transparent',
                  transform: i === temaIdx ? 'scale(1.2)' : 'scale(1)',
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
        <p className="text-center text-[9px] text-slate-500 font-bold uppercase tracking-wider">
          <Palette size={8} className="inline mr-1"/>{TEMAS[temaIdx].label}
        </p>

        {/* Guardar / Descargar */}
        <div className="flex gap-2">
          {capturedBlob && (
            <button
              onClick={guardarFoto}
              disabled={guardando}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-black disabled:opacity-50 transition-all active:scale-95"
              style={{ background: tema.accent, color: '#0f172a' }}
            >
              {guardando ? <RefreshCw size={14} className="animate-spin"/> : <ShieldCheck size={14}/>}
              Guardar foto
            </button>
          )}
          <button
            onClick={descargar}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm font-bold hover:bg-slate-700 transition-all active:scale-95"
          >
            <Download size={14}/> Descargar
          </button>
        </div>
      </div>

      {/* Canvas oculto para captura */}
      <canvas ref={canvasRef} className="hidden"/>
      <input ref={fileInputRef} type="file" accept="image/*" capture="user" className="hidden" onChange={onFileSelect}/>

      {/* ── Modal cámara ─────────────────────────────────────────────────── */}
      {showCamera && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 bg-black/90 safe-top">
            <p className="text-white font-black text-sm">Foto carnet</p>
            <button onClick={cerrarCamara} className="text-slate-400 hover:text-white p-1">
              <X size={22}/>
            </button>
          </div>

          <div className="flex-1 relative flex items-center justify-center bg-black overflow-hidden">
            <video
              ref={videoRef}
              playsInline
              muted
              className="h-full w-full object-cover"
              style={{ transform: 'scaleX(-1)' }}
            />
            {/* Guía oval */}
            <div
              className="absolute border-[3px] pointer-events-none"
              style={{
                width: '62vw', maxWidth: 260,
                height: '80vw', maxHeight: 340,
                borderRadius: '50%',
                borderColor: tema.accent,
                boxShadow: `0 0 0 9999px rgba(0,0,0,0.6), inset 0 0 0 2px ${tema.accent}40`,
              }}
            />
            <div className="absolute bottom-28 px-4 py-1.5 rounded-full bg-black/50">
              <p className="text-white text-xs font-bold text-center">
                Centrá tu rostro en el óvalo · Buena iluminación
              </p>
            </div>
          </div>

          {/* Botón captura */}
          <div className="pb-12 pt-4 bg-black/90 flex justify-center">
            <button
              onClick={capturarFoto}
              className="w-18 h-18 rounded-full flex items-center justify-center active:scale-90 transition-transform"
              style={{
                width: 72, height: 72,
                background: '#fff',
                border: `4px solid ${tema.accent}`,
                boxShadow: `0 0 0 6px ${tema.accent}30`,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
