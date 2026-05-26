import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera, Download, RefreshCw, ShieldCheck, X,
  Sparkles, ChevronLeft, ChevronRight, Pencil,
  ChevronUp, ChevronDown,
} from 'lucide-react';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { storage, db } from '@/lib/firebase';
import QRCode from 'qrcode';

interface Props {
  empDocId: string;
  empData: {
    firstName?: string; lastName?: string;
    dni?: string; cuil?: string;
    fileNumber?: string; category?: string;
    photoUrl?: string; empresaId?: string;
  };
  empresaNombre?: string;
  empresaLogoUrl?: string;
  templateId?: string;
  orientation?: 'vertical' | 'horizontal';
  viewOnly?: boolean;
}

// Derivar paleta desde hue HSL
function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
function colorsFromHue(h: number) {
  return {
    h1: hslToHex(h, 65, 10),
    h2: hslToHex(h, 55, 20),
    accent: hslToHex(h, 80, 62),
  };
}

export default function CredencialDigital({ empDocId, empData, empresaNombre, empresaLogoUrl, templateId, orientation, viewOnly }: Props) {
  const [fotoSrc, setFotoSrc]             = useState<string | null>(empData.photoUrl || null);
  const [fotoFinal, setFotoFinal]         = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl]         = useState<string>('');
  const [logoEmpresa, setLogoEmpresa]     = useState<string | null>(empresaLogoUrl || null);
  const [credHue, setCredHue]             = useState<number>(215);
  const [credTitulo, setCredTitulo]       = useState<string>('CREDENCIAL DE ACCESO');
  const [credSubtitulo, setCredSubtitulo] = useState<string>('Personal Autorizado');
  const [credPie, setCredPie]             = useState<string>('');
  const [orientacion, setOrientacion]     = useState<'vertical' | 'horizontal'>(orientation || 'vertical');
  const [guardando, setGuardando]         = useState(false);
  const [quitandoFondo, setQuitandoFondo] = useState(false);
  const [progFondo, setProgFondo]         = useState(0);
  const [showCamera, setShowCamera]       = useState(false);
  const [stream, setStream]               = useState<MediaStream | null>(null);
  const [capturedBlob, setCapturedBlob]   = useState<Blob | null>(null);
  const [credGuardada, setCredGuardada]   = useState(false);
  const [modoEdicion, setModoEdicion]     = useState(false);
  const [empresaLocal, setEmpresaLocal]   = useState(empresaNombre || '');
  const [photoOff, setPhotoOffState]      = useState({ x: 50, y: 25 });
  const photoOffRef                       = useRef({ x: 50, y: 25 });

  const videoRef     = useRef<HTMLVideoElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoContRef = useRef<HTMLDivElement>(null);
  const dragRef      = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  const tema           = colorsFromHue(credHue);
  const headerBg       = `linear-gradient(160deg, ${tema.h1} 0%, ${tema.h2} 100%)`;
  const nombre         = [empData.firstName, empData.lastName].filter(Boolean).join(' ');
  const apellidoNombre = [empData.lastName?.toUpperCase(), empData.firstName].filter(Boolean).join(', ');
  const fotoMostrada   = fotoFinal || fotoSrc;
  const showEditUI     = !viewOnly && (!credGuardada || modoEdicion);
  const empresaDisplay = empresaLocal || empresaNombre || '';

  const setPhotoOff = useCallback((v: { x: number; y: number }) => {
    photoOffRef.current = v;
    setPhotoOffState(v);
  }, []);

  // QR
  useEffect(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://comtroldata.web.app';
    QRCode.toDataURL(`${origin}/credencial/?id=${empDocId}`, {
      width: 180, margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
    }).then(setQrDataUrl).catch(() => {});
  }, [empDocId]);

  // Empresa
  useEffect(() => {
    if (!empData.empresaId) return;
    getDoc(doc(db, 'empresas', empData.empresaId))
      .then(snap => {
        if (snap.exists()) {
          const d = snap.data();
          const n = d.name || d.nombre || d.razonSocial || empData.empresaId;
          if (n && !empresaNombre) setEmpresaLocal(n);
          if (d.logoUrl && !empresaLogoUrl) setLogoEmpresa(d.logoUrl);
          if (typeof d.credencialHue === 'number') setCredHue(d.credencialHue);
          if (d.credencialTitulo)    setCredTitulo(d.credencialTitulo);
          if (d.credencialSubtitulo) setCredSubtitulo(d.credencialSubtitulo);
          if (d.credencialPie)       setCredPie(d.credencialPie);
          if (d.credencialOrientacion && !orientation) {
            setOrientacion(d.credencialOrientacion as 'vertical' | 'horizontal');
          }
        }
      }).catch(() => {});
    if (empresaNombre) setEmpresaLocal(empresaNombre);
  }, [empresaNombre, empData.empresaId, empresaLogoUrl, templateId]);

  // Cargar / crear credencial pública
  useEffect(() => {
    if (!empDocId) return;
    getDoc(doc(db, 'credenciales_publicas', empDocId))
      .then(snap => {
        if (snap.exists()) {
          setCredGuardada(true);
          const d = snap.data();
          if (d.photoUrl) setFotoSrc(d.photoUrl);
          if (d.empresaNombre) setEmpresaLocal(prev => prev || d.empresaNombre);
        } else {
          setDoc(doc(db, 'credenciales_publicas', empDocId), {
            firstName: empData.firstName || '', lastName: empData.lastName || '',
            dni: empData.dni || '', fileNumber: empData.fileNumber || '',
            category: empData.category || '', empresaNombre: empresaLocal,
            updatedAt: serverTimestamp(),
          }, { merge: true }).catch(() => {});
          getDownloadURL(storageRef(storage, `credenciales/${empDocId}/foto_sb.png`))
            .then(url => { setFotoFinal(url); setFotoSrc(url); })
            .catch(() => getDownloadURL(storageRef(storage, `credenciales/${empDocId}/foto.png`))
              .then(setFotoSrc).catch(() => {}));
        }
      }).catch(() => {});
  }, [empDocId]); // eslint-disable-line

  // Sync empresa a credencial pública
  useEffect(() => {
    if (!empDocId || !empresaLocal) return;
    setDoc(doc(db, 'credenciales_publicas', empDocId), { empresaNombre: empresaLocal }, { merge: true })
      .catch(() => {});
  }, [empresaLocal, empDocId]);

  // Drag táctil para ajustar foto
  useEffect(() => {
    const el = photoContRef.current;
    if (!el || !showEditUI || !fotoMostrada || !!fotoFinal) return;
    const onStart = (e: TouchEvent) => {
      e.preventDefault();
      dragRef.current = { sx: e.touches[0].clientX, sy: e.touches[0].clientY, ox: photoOffRef.current.x, oy: photoOffRef.current.y };
    };
    const onMove = (e: TouchEvent) => {
      if (!dragRef.current) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const dx = e.touches[0].clientX - dragRef.current.sx;
      const dy = e.touches[0].clientY - dragRef.current.sy;
      setPhotoOff({
        x: Math.max(0, Math.min(100, dragRef.current.ox - (dx / rect.width) * 100)),
        y: Math.max(0, Math.min(100, dragRef.current.oy - (dy / rect.height) * 100)),
      });
    };
    const onEnd = () => { dragRef.current = null; };
    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
    };
  }, [showEditUI, fotoMostrada, fotoFinal, setPhotoOff]);

  // Cámara
  const abrirCamara = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false });
      setStream(s); setShowCamera(true);
      setTimeout(() => { if (videoRef.current) { videoRef.current.srcObject = s; videoRef.current.play(); } }, 150);
    } catch { fileInputRef.current?.click(); }
  };
  const cerrarCamara = () => { stream?.getTracks().forEach(t => t.stop()); setStream(null); setShowCamera(false); };
  const capturarFoto = () => {
    const video = videoRef.current, canvas = canvasRef.current; if (!video || !canvas) return;
    const side = Math.min(video.videoWidth, video.videoHeight);
    canvas.width = side; canvas.height = side;
    const ctx = canvas.getContext('2d')!;
    ctx.save(); ctx.translate(side, 0); ctx.scale(-1, 1);
    ctx.drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side, 0, 0, side, side);
    ctx.restore();
    canvas.toBlob(blob => {
      if (!blob) return;
      setCapturedBlob(blob); setFotoSrc(canvas.toDataURL('image/png')); setFotoFinal(null);
      setPhotoOff({ x: 50, y: 25 }); cerrarCamara();
    }, 'image/png');
  };
  const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const src = ev.target?.result as string; if (!src) return;
      setFotoSrc(src); setFotoFinal(null); setPhotoOff({ x: 50, y: 25 });
      fetch(src).then(r => r.blob()).then(setCapturedBlob);
    };
    reader.readAsDataURL(file); e.target.value = '';
  };

  // Quitar fondo
  const quitarFondo = async () => {
    const blob = capturedBlob || (fotoSrc ? await fetch(fotoSrc).then(r => r.blob()) : null);
    if (!blob) return;
    setQuitandoFondo(true); setProgFondo(0);
    try {
      const { removeBackground } = await import('@imgly/background-removal');
      const rb = await removeBackground(blob, {
        model: 'isnet_quint8', output: { format: 'image/png' },
        progress: (_k: string, c: number, t: number) => { if (t > 0) setProgFondo(Math.round((c / t) * 100)); },
      });
      setFotoFinal(URL.createObjectURL(rb)); setCapturedBlob(rb);
    } catch (e) { console.error(e); }
    finally { setQuitandoFondo(false); setProgFondo(0); }
  };

  // Guardar
  const guardarFoto = async () => {
    if (!empDocId) return;
    setGuardando(true);
    try {
      let photoUrl = '';
      if (capturedBlob) {
        try {
          const isSF = !!fotoFinal;
          const r = storageRef(storage, `credenciales/${empDocId}/${isSF ? 'foto_sb' : 'foto'}.png`);
          await uploadBytes(r, capturedBlob, { contentType: 'image/png' });
          photoUrl = await getDownloadURL(r);
          if (isSF) setFotoFinal(photoUrl); else setFotoSrc(photoUrl);
        } catch { /* Storage opcional */ }
        setCapturedBlob(null);
      }
      const payload: Record<string, unknown> = {
        firstName: empData.firstName || '', lastName: empData.lastName || '',
        dni: empData.dni || '', fileNumber: empData.fileNumber || '',
        category: empData.category || '', empresaNombre: empresaDisplay,
        updatedAt: serverTimestamp(),
      };
      const url = photoUrl || (fotoSrc && !fotoSrc.startsWith('blob:') && !fotoSrc.startsWith('data:') ? fotoSrc : '');
      if (url) payload.photoUrl = url;
      await setDoc(doc(db, 'credenciales_publicas', empDocId), payload);
      setCredGuardada(true); setModoEdicion(false);
    } catch (err) { console.error(err); }
    finally { setGuardando(false); }
  };

  // Descargar
  const descargar = async () => {
    const SC = 2, W = 380, PAD = 22;
    const HH = 100, ACC = 5;
    const PH = 210, PW = 155; // foto portrait
    const photoX = Math.round((W - PW) / 2);
    const photoY = HH + ACC + 18;
    let dataY = photoY + PH + 20;
    const QR = 80;

    // Calcular altura total
    let dataLines = 2; // nombre + cargo
    if (empData.dni) dataLines++;
    if (empData.cuil) dataLines++;
    if (empData.fileNumber) dataLines++;
    const H = dataY + (dataLines * 19) + 20 + QR + 20 + 10;

    const cv = document.createElement('canvas');
    cv.width = W * SC; cv.height = H * SC;
    const ctx = cv.getContext('2d')!;
    ctx.scale(SC, SC);

    // Fondo blanco redondeado
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, 0, 0, W, H, 16); ctx.fill();

    // Header gradiente
    const hg = ctx.createLinearGradient(0, 0, W, HH);
    hg.addColorStop(0, tema.h1); hg.addColorStop(1, tema.h2);
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.moveTo(16, 0); ctx.lineTo(W - 16, 0);
    ctx.quadraticCurveTo(W, 0, W, 16);
    ctx.lineTo(W, HH); ctx.lineTo(0, HH); ctx.lineTo(0, 16);
    ctx.quadraticCurveTo(0, 0, 16, 0);
    ctx.closePath(); ctx.fill();

    // Patrón diagonal sutil en header
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(16, 0); ctx.lineTo(W - 16, 0);
    ctx.quadraticCurveTo(W, 0, W, 16);
    ctx.lineTo(W, HH); ctx.lineTo(0, HH); ctx.lineTo(0, 16);
    ctx.quadraticCurveTo(0, 0, 16, 0);
    ctx.closePath(); ctx.clip();
    ctx.strokeStyle = `${tema.accent}15`;
    ctx.lineWidth = 1;
    for (let i = -HH; i < W + HH; i += 12) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + HH, HH); ctx.stroke();
    }
    ctx.restore();

    // Escudo (canvas shapes)
    const sx = PAD + 2, sy = 18;
    ctx.fillStyle = tema.accent;
    ctx.beginPath();
    ctx.moveTo(sx + 14, sy); ctx.lineTo(sx + 28, sy + 6);
    ctx.lineTo(sx + 28, sy + 16); ctx.quadraticCurveTo(sx + 28, sy + 26, sx + 14, sy + 32);
    ctx.quadraticCurveTo(sx, sy + 26, sx, sy + 16);
    ctx.lineTo(sx, sy + 6); ctx.closePath(); ctx.fill();
    // check en escudo
    ctx.strokeStyle = tema.h1; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(sx + 8, sy + 17); ctx.lineTo(sx + 13, sy + 22); ctx.lineTo(sx + 22, sy + 13); ctx.stroke();

    // Texto empresa
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 15px Arial';
    ctx.textAlign = 'left';
    const empText = (empresaDisplay || 'SEGURIDAD PRIVADA').toUpperCase();
    ctx.fillText(empText, PAD + 36, sy + 18);
    ctx.fillStyle = tema.accent;
    ctx.font = '8.5px Arial';
    ctx.fillText('CREDENCIAL DIGITAL DE IDENTIDAD', PAD + 36, sy + 32);

    // Línea de acento
    ctx.fillStyle = tema.accent;
    ctx.fillRect(0, HH, W, ACC);

    // Foto
    if (fotoMostrada) {
      const img = new Image(); img.crossOrigin = 'anonymous';
      await new Promise<void>(res => { img.onload = () => res(); img.onerror = () => res(); img.src = fotoMostrada; });
      if (fotoFinal) {
        // Sin fondo: sin clip
        const sc = Math.max(PW / img.naturalWidth, PH / img.naturalHeight);
        const rW = img.naturalWidth * sc, rH = img.naturalHeight * sc;
        const oX = ((photoOff.x / 100) * (rW - PW)) || 0;
        const oY = ((photoOff.y / 100) * (rH - PH)) || 0;
        ctx.drawImage(img, photoX - oX, photoY - oY, rW, rH);
      } else {
        const sc = Math.max(PW / img.naturalWidth, PH / img.naturalHeight);
        const rW = img.naturalWidth * sc, rH = img.naturalHeight * sc;
        const oX = ((photoOff.x / 100) * Math.max(0, rW - PW));
        const oY = ((photoOff.y / 100) * Math.max(0, rH - PH));
        ctx.save();
        roundRect(ctx, photoX, photoY, PW, PH, 10); ctx.clip();
        ctx.drawImage(img, photoX - oX, photoY - oY, rW, rH);
        ctx.restore();
        // Borde foto
        ctx.strokeStyle = tema.accent; ctx.lineWidth = 2.5;
        roundRect(ctx, photoX, photoY, PW, PH, 10); ctx.stroke();
      }
    } else {
      ctx.fillStyle = '#f3f4f6';
      roundRect(ctx, photoX, photoY, PW, PH, 10); ctx.fill();
    }

    // Separador
    ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD, dataY - 8); ctx.lineTo(W - PAD, dataY - 8); ctx.stroke();

    // Datos
    ctx.textAlign = 'left';
    ctx.fillStyle = '#111827'; ctx.font = 'bold 14px Arial';
    ctx.fillText(apellidoNombre || nombre || '—', PAD, dataY + 2);
    dataY += 16;
    ctx.fillStyle = '#9ca3af'; ctx.font = 'bold 8.5px Arial';
    ctx.fillText((empData.category || 'Vigilador').toUpperCase(), PAD, dataY);
    dataY += 18;

    // Grid de datos 2 columnas
    const col2 = W / 2 + 5;
    let col1Y = dataY, col2Y = dataY;
    const drawField = (label: string, val: string, col: 'l' | 'r') => {
      const x = col === 'l' ? PAD : col2;
      const y = col === 'l' ? col1Y : col2Y;
      ctx.fillStyle = '#9ca3af'; ctx.font = '7.5px Arial';
      ctx.fillText(label, x, y);
      ctx.fillStyle = '#1f2937'; ctx.font = 'bold 10px Arial';
      ctx.fillText(val, x, y + 13);
      if (col === 'l') col1Y += 30; else col2Y += 30;
    };
    if (empData.dni)        drawField('DNI',    empData.dni, 'l');
    if (empData.cuil)       drawField('CUIL',   empData.cuil, 'r');
    if (empData.fileNumber) drawField('Legajo', empData.fileNumber, 'l');

    dataY = Math.max(col1Y, col2Y) + 5;

    // QR centrado
    if (qrDataUrl) {
      const qr = new Image();
      await new Promise<void>(res => { qr.onload = () => res(); qr.onerror = () => res(); qr.src = qrDataUrl; });
      const qrX = Math.round((W - QR) / 2), qrY = dataY + 5;
      ctx.fillStyle = '#ffffff'; ctx.strokeStyle = tema.accent; ctx.lineWidth = 1.5;
      roundRect(ctx, qrX - 4, qrY - 4, QR + 8, QR + 8, 6); ctx.fill(); ctx.stroke();
      ctx.drawImage(qr, qrX, qrY, QR, QR);
      ctx.fillStyle = '#9ca3af'; ctx.font = '7px Arial'; ctx.textAlign = 'center';
      ctx.fillText('ESCANEAR PARA VERIFICAR', W / 2, qrY + QR + 12);
    }

    // Banda inferior
    const hg2 = ctx.createLinearGradient(0, 0, W, 0);
    hg2.addColorStop(0, tema.h1); hg2.addColorStop(1, tema.h2);
    ctx.fillStyle = hg2;
    ctx.fillRect(0, H - 10, W, 10);

    const link = document.createElement('a');
    link.download = `credencial_${empData.fileNumber || empDocId}.png`;
    link.href = cv.toDataURL('image/png');
    link.click();
  };

  // ── RENDER ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-3">

      {/* ── Tarjeta ─────────────────────────────────────────────────────── */}
      <div
        className="relative rounded-3xl overflow-hidden shadow-2xl mx-auto w-full"
        style={{ maxWidth: 340, background: '#ffffff' }}
      >
        {/* Header gradiente */}
        <div
          className="px-5 pt-5 pb-6 relative overflow-hidden"
          style={{ background: headerBg }}
        >
          {/* Patrón diagonal sutil */}
          <div className="absolute inset-0 pointer-events-none" style={{
            backgroundImage: `repeating-linear-gradient(135deg, ${tema.accent}10 0px, ${tema.accent}10 1px, transparent 1px, transparent 12px)`,
          }}/>
          <div className="relative flex items-center gap-3">
            <div className="relative flex-shrink-0">
              {logoEmpresa ? (
                <img
                  src={logoEmpresa}
                  alt="Logo empresa"
                  className="h-9 object-contain"
                  style={{ maxWidth: 110, filter: 'brightness(0) invert(1)' }}
                  onError={() => setLogoEmpresa(null)}
                />
              ) : (
                <div className="flex items-center gap-2">
                  <ShieldCheck size={28} strokeWidth={1.5} style={{ color: tema.accent }}/>
                  <p className="text-white font-black text-sm tracking-wide leading-tight">
                    {(empresaDisplay || 'SEGURIDAD PRIVADA').toUpperCase()}
                  </p>
                </div>
              )}
            </div>
            <div className="ml-auto text-right">
              <p className="text-[8px] tracking-widest uppercase font-bold" style={{ color: `${tema.accent}cc` }}>
                {credTitulo}
              </p>
              <p className="text-[7px] text-white/50 uppercase tracking-wider mt-0.5">
                {credSubtitulo}
              </p>
            </div>
          </div>
        </div>

        {/* Línea acento */}
        <div className="h-1.5" style={{ background: `linear-gradient(90deg, ${tema.h2}, ${tema.accent}, ${tema.h2})` }}/>

        {/* Foto grande centrada con efecto pop-out */}
        <div className="relative flex flex-col items-center py-5"
          style={{ background: `linear-gradient(180deg, ${tema.h1}08 0%, transparent 100%)` }}>

          {/* Contenedor pop-out: círculo de color + foto encima */}
          <div className="relative" style={{ width: 170, height: fotoFinal ? 220 : 215 }}>
            {/* Fondo círculo/elipse cuando hay foto sin fondo */}
            {fotoFinal && (
              <div style={{
                position: 'absolute',
                bottom: 0, left: '50%', transform: 'translateX(-50%)',
                width: 140, height: 140,
                borderRadius: '50%',
                background: `radial-gradient(ellipse at center, ${tema.h2} 0%, ${tema.h1} 100%)`,
                border: `3px solid ${tema.accent}`,
              }}/>
            )}
            <div
              ref={photoContRef}
              className={`absolute left-1/2 -translate-x-1/2 ${fotoFinal ? '' : 'overflow-hidden rounded-2xl'}`}
              style={{
                width: 160,
                height: fotoFinal ? 220 : 210,
                bottom: 0,
                border: fotoFinal ? 'none' : `2.5px solid ${tema.accent}`,
                borderRadius: fotoFinal ? 0 : 16,
                background: fotoFinal ? 'transparent' : '#e2e8f0',
                cursor: showEditUI && fotoMostrada && !fotoFinal ? 'grab' : 'default',
              }}
            >
            {fotoMostrada ? (
              <img
                src={fotoMostrada}
                alt="Foto"
                className="w-full h-full object-cover select-none"
                style={{
                  objectPosition: fotoFinal ? 'center bottom' : `${photoOff.x}% ${photoOff.y}%`,
                  objectFit: fotoFinal ? 'contain' : 'cover',
                  pointerEvents: 'none',
                }}
                draggable={false}
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center gap-2 rounded-2xl">
                <Camera size={32} className="text-slate-400"/>
                <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Sin foto</p>
              </div>
            )}

            {showEditUI && fotoMostrada && !fotoFinal && (
              <div className="absolute bottom-1.5 left-0 right-0 flex justify-center pointer-events-none">
                <span className="text-[8px] font-bold bg-black/40 text-white px-2 py-0.5 rounded-full backdrop-blur-sm">
                  ↕ Arrastrá para ajustar
                </span>
              </div>
            )}
            </div>{/* cierra div foto inner */}
          </div>{/* cierra div pop-out container */}

          {/* Botones en modo edición */}
          {showEditUI && (
            <div className="flex gap-1.5 mt-3 px-5 w-full">
              <button
                onClick={abrirCamara}
                className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-wide transition-all active:scale-95"
                style={{ color: tema.accent, background: `${tema.h1}15`, border: `1px solid ${tema.accent}40` }}
              >
                <Camera size={10}/>{fotoMostrada ? 'Cambiar foto' : 'Sacar foto'}
              </button>

              {fotoSrc && !fotoFinal && (
                <button
                  onClick={quitarFondo}
                  disabled={quitandoFondo}
                  className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-wide disabled:opacity-60"
                  style={{ color: tema.accent, background: `${tema.h1}15`, border: `1px solid ${tema.accent}40` }}
                >
                  {quitandoFondo
                    ? <><RefreshCw size={9} className="animate-spin"/>{progFondo}%</>
                    : <><Sparkles size={9}/>Sin fondo</>}
                </button>
              )}

              {fotoMostrada && !fotoFinal && (
                <div className="flex flex-col gap-0.5">
                  <button
                    onClick={() => setPhotoOff({ x: photoOffRef.current.x, y: Math.max(0, photoOffRef.current.y - 8) })}
                    className="px-2 py-1 rounded-lg"
                    style={{ color: tema.accent, background: `${tema.h1}15`, border: `1px solid ${tema.accent}40` }}
                  ><ChevronUp size={10}/></button>
                  <button
                    onClick={() => setPhotoOff({ x: photoOffRef.current.x, y: Math.min(100, photoOffRef.current.y + 8) })}
                    className="px-2 py-1 rounded-lg"
                    style={{ color: tema.accent, background: `${tema.h1}15`, border: `1px solid ${tema.accent}40` }}
                  ><ChevronDown size={10}/></button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Separador */}
        <div className="mx-5 border-t border-gray-100"/>

        {/* Datos */}
        <div className="px-5 py-3">
          <p className="font-black text-gray-900 text-[15px] leading-tight">
            {apellidoNombre || nombre || '—'}
          </p>
          <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mt-0.5">
            {empData.category || 'Vigilador'}
          </p>
          <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2">
            {empData.dni && (
              <div>
                <p className="text-[8px] font-bold text-gray-400 uppercase tracking-wider">DNI</p>
                <p className="text-sm font-black font-mono text-gray-800">{empData.dni}</p>
              </div>
            )}
            {empData.cuil && (
              <div>
                <p className="text-[8px] font-bold text-gray-400 uppercase tracking-wider">CUIL</p>
                <p className="text-sm font-black font-mono text-gray-800">{empData.cuil}</p>
              </div>
            )}
            {empData.fileNumber && (
              <div>
                <p className="text-[8px] font-bold text-gray-400 uppercase tracking-wider">Legajo</p>
                <p className="text-sm font-black font-mono text-gray-800">{empData.fileNumber}</p>
              </div>
            )}
          </div>
        </div>

        {/* QR centrado pequeño */}
        <div className="flex flex-col items-center pb-4">
          {qrDataUrl ? (
            <div className="p-1.5 rounded-xl" style={{ border: `1.5px solid ${tema.accent}60` }}>
              <img src={qrDataUrl} alt="QR" width={72} height={72}/>
            </div>
          ) : (
            <div className="w-20 h-20 rounded-xl bg-gray-50 flex items-center justify-center border border-gray-200">
              <RefreshCw size={16} className="text-gray-300"/>
            </div>
          )}
          <p className="text-[7px] font-bold uppercase tracking-widest text-gray-300 mt-1">
            Escanear para verificar
          </p>
        </div>

        {/* Pie de página configurable */}
        {credPie && (
          <div className="px-5 pb-2">
            <p className="text-[8px] text-center font-medium" style={{ color: `${tema.accent}80` }}>
              {credPie}
            </p>
          </div>
        )}

        {/* Banda inferior */}
        <div className="h-2" style={{ background: `linear-gradient(90deg, ${tema.h1}, ${tema.h2})` }}/>
      </div>

      {/* ── Acciones ────────────────────────────────────────────────────── */}
      <div className="flex gap-2">
        {credGuardada && !modoEdicion && (
          <button onClick={() => setModoEdicion(true)}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm font-bold hover:bg-slate-700 transition-all active:scale-95">
            <Pencil size={14}/> Editar foto
          </button>
        )}
        {showEditUI && (capturedBlob || !credGuardada) && (
          <button onClick={guardarFoto} disabled={guardando}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-black disabled:opacity-50 transition-all active:scale-95 text-white"
            style={{ background: `linear-gradient(135deg, ${tema.h1}, ${tema.h2})` }}>
            {guardando ? <RefreshCw size={14} className="animate-spin"/> : <ShieldCheck size={14}/>}
            {credGuardada ? 'Guardar' : 'Activar QR'}
          </button>
        )}
        <button onClick={descargar}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm font-bold hover:bg-slate-700 transition-all active:scale-95">
          <Download size={14}/> Descargar
        </button>
      </div>

      <canvas ref={canvasRef} className="hidden"/>
      <input ref={fileInputRef} type="file" accept="image/*" capture="user" className="hidden" onChange={onFileSelect}/>

      {/* Modal cámara */}
      {showCamera && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          <div className="flex items-center justify-between px-4 py-3" style={{ background: tema.h1 }}>
            <p className="text-white font-black text-sm">Foto carnet</p>
            <button onClick={cerrarCamara} className="text-slate-400 hover:text-white p-1"><X size={22}/></button>
          </div>
          <div className="flex-1 relative flex items-center justify-center bg-black overflow-hidden">
            <video ref={videoRef} playsInline muted className="h-full w-full object-cover" style={{ transform: 'scaleX(-1)' }}/>
            <div className="absolute border-[3px] pointer-events-none" style={{
              width: '60vw', maxWidth: 240, height: '78vw', maxHeight: 320,
              borderRadius: 16, borderColor: tema.accent,
              boxShadow: `0 0 0 9999px rgba(0,0,0,0.65)`,
            }}/>
            <div className="absolute bottom-28 px-4 py-1.5 rounded-full" style={{ background: `${tema.h1}cc` }}>
              <p className="text-white text-xs font-bold text-center">Centrá tu rostro · Buena iluminación</p>
            </div>
          </div>
          <div className="pb-12 pt-5 flex justify-center" style={{ background: tema.h1 }}>
            <button onClick={capturarFoto} style={{
              width: 76, height: 76, background: '#ffffff',
              border: `4px solid ${tema.accent}`,
              boxShadow: `0 0 0 8px ${tema.accent}30`,
              borderRadius: '50%',
            }} className="active:scale-90 transition-transform"/>
          </div>
        </div>
      )}
    </div>
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
