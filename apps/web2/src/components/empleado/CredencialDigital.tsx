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
    firstName?: string;
    lastName?: string;
    dni?: string;
    cuil?: string;
    fileNumber?: string;
    category?: string;
    photoUrl?: string;
    empresaId?: string;
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
  const [fotoSrc, setFotoSrc]             = useState<string | null>(empData.photoUrl || null);
  const [fotoFinal, setFotoFinal]         = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl]         = useState<string>('');
  const [temaIdx, setTemaIdx]             = useState(0);
  const [guardando, setGuardando]         = useState(false);
  const [quitandoFondo, setQuitandoFondo] = useState(false);
  const [progFondo, setProgFondo]         = useState(0);
  const [showCamera, setShowCamera]       = useState(false);
  const [stream, setStream]               = useState<MediaStream | null>(null);
  const [capturedBlob, setCapturedBlob]   = useState<Blob | null>(null);
  const [credGuardada, setCredGuardada]   = useState(false);
  const [modoEdicion, setModoEdicion]     = useState(false);
  const [empresaLocal, setEmpresaLocal]   = useState(empresaNombre || '');
  // offset 0-100 para object-position de la foto
  const [photoOff, setPhotoOffState]      = useState({ x: 50, y: 30 });
  const photoOffRef                       = useRef({ x: 50, y: 30 });

  const videoRef        = useRef<HTMLVideoElement>(null);
  const canvasRef       = useRef<HTMLCanvasElement>(null);
  const fileInputRef    = useRef<HTMLInputElement>(null);
  const photoContRef    = useRef<HTMLDivElement>(null);
  const dragRef         = useRef<{ startX: number; startY: number; offX: number; offY: number } | null>(null);

  const tema           = TEMAS[temaIdx];
  const nombre         = [empData.firstName, empData.lastName].filter(Boolean).join(' ');
  const apellidoNombre = [empData.lastName?.toUpperCase(), empData.firstName].filter(Boolean).join(', ');
  const fotoMostrada   = fotoFinal || fotoSrc;
  const showEditUI     = !credGuardada || modoEdicion;
  const empresaDisplay = empresaLocal || empresaNombre || '';

  const setPhotoOff = useCallback((v: { x: number; y: number }) => {
    photoOffRef.current = v;
    setPhotoOffState(v);
  }, []);

  // ── QR → URL pública ────────────────────────────────────────────────────────
  useEffect(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://comtroldata.web.app';
    QRCode.toDataURL(`${origin}/credencial/?id=${empDocId}`, {
      width: 200, margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
    }).then(setQrDataUrl).catch(() => {});
  }, [empDocId]);

  // ── Empresa: prop → credenciales_publicas → empresas directa ────────────────
  useEffect(() => {
    if (empresaNombre) { setEmpresaLocal(empresaNombre); return; }
    const fetchEmpresa = async () => {
      // 1. Ya vino por prop (arriba)
      // 2. Intentar desde credenciales_publicas (lo hace el useEffect de carga)
      // 3. Fetch directo desde 'empresas'
      if (!empData.empresaId) return;
      try {
        const snap = await getDoc(doc(db, 'empresas', empData.empresaId));
        if (snap.exists()) {
          const d = snap.data();
          const n = d.name || d.nombre || d.razonSocial || empData.empresaId;
          if (n) setEmpresaLocal(n);
        }
      } catch { /* ignore */ }
    };
    fetchEmpresa();
  }, [empresaNombre, empData.empresaId]);

  // ── Cargar credencial guardada o crear doc básico ────────────────────────────
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
          // No existe → crear doc básico para que el QR funcione de inmediato
          setDoc(doc(db, 'credenciales_publicas', empDocId), {
            firstName:    empData.firstName  || '',
            lastName:     empData.lastName   || '',
            dni:          empData.dni        || '',
            fileNumber:   empData.fileNumber || '',
            category:     empData.category   || '',
            empresaNombre: empresaLocal,
            updatedAt:    serverTimestamp(),
          }, { merge: true }).catch(() => {});
          // Intentar foto guardada en Storage
          getDownloadURL(storageRef(storage, `credenciales/${empDocId}/foto_sb.png`))
            .then(url => { setFotoFinal(url); setFotoSrc(url); })
            .catch(() => getDownloadURL(storageRef(storage, `credenciales/${empDocId}/foto.png`))
              .then(setFotoSrc).catch(() => {}));
        }
      })
      .catch(() => {});
  }, [empDocId]); // eslint-disable-line

  // Actualizar credencial pública cuando cambia empresaLocal
  useEffect(() => {
    if (!empDocId || !empresaLocal) return;
    setDoc(doc(db, 'credenciales_publicas', empDocId), { empresaNombre: empresaLocal }, { merge: true })
      .catch(() => {});
  }, [empresaLocal, empDocId]);

  // ── Drag táctil para repositionar foto ──────────────────────────────────────
  useEffect(() => {
    const el = photoContRef.current;
    if (!el || !showEditUI || !fotoMostrada || !!fotoFinal) return;

    const onStart = (e: TouchEvent) => {
      e.preventDefault();
      dragRef.current = {
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY,
        offX: photoOffRef.current.x,
        offY: photoOffRef.current.y,
      };
    };
    const onMove = (e: TouchEvent) => {
      if (!dragRef.current) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const dx = e.touches[0].clientX - dragRef.current.startX;
      const dy = e.touches[0].clientY - dragRef.current.startY;
      // Sensitivity: arrastrar 1 contenedor = 100% de rango
      const nx = Math.max(0, Math.min(100, dragRef.current.offX - (dx / rect.width) * 100));
      const ny = Math.max(0, Math.min(100, dragRef.current.offY - (dy / rect.height) * 100));
      setPhotoOff({ x: nx, y: ny });
    };
    const onEnd = () => { dragRef.current = null; };

    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove',  onMove,  { passive: false });
    el.addEventListener('touchend',   onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove',  onMove);
      el.removeEventListener('touchend',   onEnd);
    };
  }, [showEditUI, fotoMostrada, fotoFinal, setPhotoOff]);

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
      setPhotoOff({ x: 50, y: 30 });
      cerrarCamara();
    }, 'image/png');
  };

  const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const src = ev.target?.result as string; if (!src) return;
      setFotoSrc(src); setFotoFinal(null);
      setPhotoOff({ x: 50, y: 30 });
      fetch(src).then(r => r.blob()).then(setCapturedBlob);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // ── Quitar fondo ─────────────────────────────────────────────────────────────
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

  // ── Guardar: Storage (opcional) + siempre Firestore ──────────────────────────
  const guardarFoto = async () => {
    if (!empDocId) return;
    setGuardando(true);
    try {
      let photoUrl = '';

      if (capturedBlob) {
        try {
          const isSF = !!fotoFinal;
          const path = isSF
            ? `credenciales/${empDocId}/foto_sb.png`
            : `credenciales/${empDocId}/foto.png`;
          const r = storageRef(storage, path);
          await uploadBytes(r, capturedBlob, { contentType: 'image/png' });
          photoUrl = await getDownloadURL(r);
          if (isSF) setFotoFinal(photoUrl); else setFotoSrc(photoUrl);
        } catch (storErr) {
          console.warn('Storage no disponible, guardando sin URL permanente', storErr);
        }
        setCapturedBlob(null);
      }

      // Siempre escribir a credenciales_publicas
      const payload: Record<string, unknown> = {
        firstName:    empData.firstName  || '',
        lastName:     empData.lastName   || '',
        dni:          empData.dni        || '',
        fileNumber:   empData.fileNumber || '',
        category:     empData.category   || '',
        empresaNombre: empresaDisplay,
        updatedAt:    serverTimestamp(),
      };
      // Solo guardar photoUrl si es una URL permanente (no blob: ni data:)
      if (photoUrl && !photoUrl.startsWith('blob:') && !photoUrl.startsWith('data:')) {
        payload.photoUrl = photoUrl;
      } else if (fotoSrc && !fotoSrc.startsWith('blob:') && !fotoSrc.startsWith('data:')) {
        payload.photoUrl = fotoSrc;
      }

      await setDoc(doc(db, 'credenciales_publicas', empDocId), payload);
      setCredGuardada(true);
      setModoEdicion(false);
    } catch (err) {
      console.error('Error guardando credencial:', err);
    } finally {
      setGuardando(false);
    }
  };

  // ── Descargar PNG ─────────────────────────────────────────────────────────────
  const descargar = async () => {
    const SC = 2; // retina
    const W = 380, PAD = 20;

    // Calcular H dinámicamente según contenido
    const HH = 110;         // header
    const ACCENT = 4;
    let dataH = 52;         // nombre + cargo
    if (empData.dni)        dataH += 20;
    if (empData.cuil)       dataH += 20;
    if (empData.fileNumber) dataH += 20;
    const PHOTO_W = 145, PHOTO_H = 185;
    const QR_SIZE = 110;
    const photoY = HH + ACCENT + dataH + 18;
    const H = photoY + PHOTO_H + 28;

    const cv = document.createElement('canvas');
    cv.width  = W * SC;
    cv.height = H * SC;
    const ctx = cv.getContext('2d')!;
    ctx.scale(SC, SC);

    // ── Fondo blanco con bordes redondeados ──
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, 0, 0, W, H, 14); ctx.fill();

    // ── Header ──
    ctx.fillStyle = tema.header;
    ctx.beginPath();
    ctx.moveTo(14, 0); ctx.lineTo(W - 14, 0);
    ctx.quadraticCurveTo(W, 0, W, 14);
    ctx.lineTo(W, HH); ctx.lineTo(0, HH); ctx.lineTo(0, 14);
    ctx.quadraticCurveTo(0, 0, 14, 0);
    ctx.closePath(); ctx.fill();

    // Escudo en header
    ctx.fillStyle = tema.accent;
    ctx.font = 'bold 13px Arial';
    ctx.textAlign = 'left';
    ctx.fillText('⬡', PAD, 38); // placeholder shield

    // Nombre empresa
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 17px Arial';
    ctx.fillText((empresaDisplay || 'SEGURIDAD PRIVADA').toUpperCase(), PAD, 55);
    ctx.fillStyle = tema.accent;
    ctx.font = '9px Arial';
    ctx.fillText('Credencial Digital de Identidad', PAD, 72);

    // ── Línea de acento ──
    ctx.fillStyle = tema.accent;
    ctx.fillRect(0, HH, W, ACCENT);

    // ── Nombre + cargo ──
    let ty = HH + ACCENT + 22;
    ctx.fillStyle = '#111827';
    ctx.font = 'bold 15px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(apellidoNombre || nombre || '—', PAD, ty);
    ty += 16;
    ctx.fillStyle = '#6b7280';
    ctx.font = 'bold 9px Arial';
    ctx.fillText((empData.category || 'Vigilador').toUpperCase(), PAD, ty);
    ty += 16;

    // ── Filas de datos ──
    const drawRow = (label: string, value: string) => {
      ctx.fillStyle = '#9ca3af'; ctx.font = '8px Arial'; ctx.textAlign = 'left';
      ctx.fillText(label, PAD, ty);
      ctx.fillStyle = '#1f2937'; ctx.font = 'bold 10px Arial';
      ctx.fillText(value, PAD + 52, ty);
      ty += 20;
    };
    if (empData.dni)        drawRow('DNI',    empData.dni);
    if (empData.cuil)       drawRow('CUIL',   empData.cuil);
    if (empData.fileNumber) drawRow('Legajo', empData.fileNumber);

    // ── Foto ──
    const photoX = PAD;
    const qrX = photoX + PHOTO_W + 15;
    const qrY = photoY + Math.round((PHOTO_H - QR_SIZE) / 2);

    if (fotoMostrada) {
      const img = new Image(); img.crossOrigin = 'anonymous';
      await new Promise<void>(res => { img.onload = () => res(); img.onerror = () => res(); img.src = fotoMostrada; });

      if (fotoFinal) {
        // Sin fondo: dibujar sin clip ni borde
        const scale = Math.max(PHOTO_W / img.naturalWidth, PHOTO_H / img.naturalHeight);
        const rW = img.naturalWidth * scale, rH = img.naturalHeight * scale;
        const exX = rW - PHOTO_W, exY = rH - PHOTO_H;
        const oX = (photoOff.x / 100) * exX, oY = (photoOff.y / 100) * exY;
        ctx.drawImage(img, photoX - oX, photoY - oY, rW, rH);
      } else {
        // Con fondo: clip al rect redondeado
        const scale = Math.max(PHOTO_W / img.naturalWidth, PHOTO_H / img.naturalHeight);
        const rW = img.naturalWidth * scale, rH = img.naturalHeight * scale;
        const exX = rW - PHOTO_W, exY = rH - PHOTO_H;
        const oX = (photoOff.x / 100) * exX, oY = (photoOff.y / 100) * exY;
        ctx.save();
        roundRect(ctx, photoX, photoY, PHOTO_W, PHOTO_H, 8); ctx.clip();
        ctx.drawImage(img, photoX - oX, photoY - oY, rW, rH);
        ctx.restore();
        ctx.strokeStyle = tema.header; ctx.lineWidth = 2;
        roundRect(ctx, photoX, photoY, PHOTO_W, PHOTO_H, 8); ctx.stroke();
      }
    }

    // ── QR ──
    if (qrDataUrl) {
      const qr = new Image();
      await new Promise<void>(res => { qr.onload = () => res(); qr.onerror = () => res(); qr.src = qrDataUrl; });
      ctx.fillStyle = '#ffffff'; ctx.strokeStyle = tema.header; ctx.lineWidth = 2;
      roundRect(ctx, qrX - 5, qrY - 5, QR_SIZE + 10, QR_SIZE + 10, 7);
      ctx.fill(); ctx.stroke();
      ctx.drawImage(qr, qrX, qrY, QR_SIZE, QR_SIZE);
      ctx.fillStyle = '#9ca3af'; ctx.font = '7px Arial'; ctx.textAlign = 'center';
      ctx.fillText('ESCANEAR PARA VERIFICAR', qrX + QR_SIZE / 2, qrY + QR_SIZE + 12);
    }

    // ── Banda inferior ──
    ctx.fillStyle = tema.header;
    ctx.fillRect(0, H - 10, W, 10);

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

        {/* Header */}
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
        <div className="h-1" style={{ background: tema.accent }}/>

        {/* Datos */}
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
        <div className="flex items-center gap-3 px-5 py-4">

          {/* Foto */}
          <div className="flex-1 flex flex-col gap-1.5">
            {/* Contenedor foto */}
            <div
              ref={photoContRef}
              className={fotoFinal ? 'relative' : 'relative overflow-hidden rounded-xl'}
              style={{
                height: 170,
                background: fotoFinal ? 'transparent' : '#f1f5f9',
                border: fotoFinal ? 'none' : `2px solid ${tema.header}`,
                cursor: showEditUI && fotoMostrada && !fotoFinal ? 'grab' : 'default',
              }}
            >
              {fotoMostrada ? (
                <img
                  src={fotoMostrada}
                  alt="Foto"
                  className="w-full h-full object-cover select-none"
                  style={{ objectPosition: `${photoOff.x}% ${photoOff.y}%`, userSelect: 'none', pointerEvents: 'none' }}
                  draggable={false}
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                  <Camera size={28} className="text-gray-300"/>
                  <p className="text-[9px] text-gray-400 font-bold uppercase">Sin foto</p>
                </div>
              )}

              {/* Hint de drag */}
              {showEditUI && fotoMostrada && !fotoFinal && (
                <div className="absolute bottom-1 left-0 right-0 flex justify-center pointer-events-none">
                  <span className="text-[8px] font-bold bg-black/30 text-white px-1.5 py-0.5 rounded-full">
                    Arrastrá para ajustar
                  </span>
                </div>
              )}
            </div>

            {/* Botones de foto + ajuste vertical */}
            {showEditUI && (
              <div className="flex gap-1">
                <button
                  onClick={abrirCamara}
                  className="flex-1 text-[9px] font-bold py-1 rounded-lg text-center uppercase tracking-wide"
                  style={{ color: tema.header, background: `${tema.header}12`, border: `1px solid ${tema.header}30` }}
                >
                  <Camera size={9} className="inline mr-0.5"/>
                  {fotoMostrada ? 'Cambiar' : 'Foto'}
                </button>
                {fotoSrc && !fotoFinal && (
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
                {/* Ajuste vertical con flechas */}
                {fotoMostrada && !fotoFinal && (
                  <div className="flex flex-col gap-0.5">
                    <button
                      onClick={() => setPhotoOff({ x: photoOffRef.current.x, y: Math.max(0, photoOffRef.current.y - 10) })}
                      className="px-1.5 py-0.5 rounded text-[10px]"
                      style={{ color: tema.header, background: `${tema.header}12`, border: `1px solid ${tema.header}30` }}
                    >
                      <ChevronUp size={10}/>
                    </button>
                    <button
                      onClick={() => setPhotoOff({ x: photoOffRef.current.x, y: Math.min(100, photoOffRef.current.y + 10) })}
                      className="px-1.5 py-0.5 rounded text-[10px]"
                      style={{ color: tema.header, background: `${tema.header}12`, border: `1px solid ${tema.header}30` }}
                    >
                      <ChevronDown size={10}/>
                    </button>
                  </div>
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

        <div className="h-2" style={{ background: tema.header }}/>
      </div>

      {/* Selector tema */}
      <div className="flex items-center gap-2">
        <button onClick={() => setTemaIdx(i => (i - 1 + TEMAS.length) % TEMAS.length)}
          className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white">
          <ChevronLeft size={14}/>
        </button>
        <div className="flex-1 flex gap-2 justify-center">
          {TEMAS.map((t, i) => (
            <button key={t.id} onClick={() => setTemaIdx(i)}
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
        {credGuardada && !modoEdicion && (
          <button onClick={() => setModoEdicion(true)}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm font-bold hover:bg-slate-700 transition-all active:scale-95">
            <Pencil size={14}/> Editar foto
          </button>
        )}
        {showEditUI && (capturedBlob || !credGuardada) && (
          <button onClick={guardarFoto} disabled={guardando}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-black disabled:opacity-50 transition-all active:scale-95 text-white"
            style={{ background: tema.header }}>
            {guardando ? <RefreshCw size={14} className="animate-spin"/> : <ShieldCheck size={14}/>}
            {credGuardada ? 'Guardar cambios' : 'Activar credencial'}
          </button>
        )}
        <button onClick={descargar}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm font-bold hover:bg-slate-700 transition-all active:scale-95">
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
            <button onClick={cerrarCamara} className="text-slate-400 hover:text-white p-1"><X size={22}/></button>
          </div>
          <div className="flex-1 relative flex items-center justify-center bg-black overflow-hidden">
            <video ref={videoRef} playsInline muted
              className="h-full w-full object-cover"
              style={{ transform: 'scaleX(-1)' }}/>
            <div className="absolute border-[3px] pointer-events-none" style={{
              width: '62vw', maxWidth: 260,
              height: '80vw', maxHeight: 340,
              borderRadius: '50%',
              borderColor: tema.accent,
              boxShadow: `0 0 0 9999px rgba(0,0,0,0.6), inset 0 0 0 2px ${tema.accent}40`,
            }}/>
            <div className="absolute bottom-28 px-4 py-1.5 rounded-full bg-black/50">
              <p className="text-white text-xs font-bold text-center">Centrá tu rostro en el óvalo</p>
            </div>
          </div>
          <div className="pb-12 pt-4 bg-black/90 flex justify-center">
            <button onClick={capturarFoto} style={{
              width: 72, height: 72, background: '#fff',
              border: `4px solid ${tema.accent}`,
              boxShadow: `0 0 0 6px ${tema.accent}30`,
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
