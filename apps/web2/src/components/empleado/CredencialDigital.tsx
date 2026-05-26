import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera, Download, RefreshCw, ShieldCheck, X,
  Sparkles, Pencil,
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
  const [photoOff, setPhotoOffState]      = useState({ x: 50, y: 20 });
  const photoOffRef                       = useRef({ x: 50, y: 20 });
  const [flipped, setFlipped]             = useState(false);
  const [holoPos, setHoloPos]             = useState({ x: 50, y: 50 });
  const [verCode, setVerCode]             = useState('--- ---');
  const [verRemaining, setVerRemaining]   = useState(30);
  const [verPct, setVerPct]               = useState(100);

  const videoRef     = useRef<HTMLVideoElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoContRef = useRef<HTMLDivElement>(null);
  const dragRef      = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  const tema           = colorsFromHue(credHue);
  const nombre         = [empData.firstName, empData.lastName].filter(Boolean).join(' ');
  const apellidoNombre = [empData.lastName?.toUpperCase(), empData.firstName].filter(Boolean).join(', ');
  const fotoMostrada   = fotoFinal || fotoSrc;
  const showEditUI     = !viewOnly && (!credGuardada || modoEdicion);
  const empresaDisplay = empresaLocal || empresaNombre || '';

  const setPhotoOff = useCallback((v: { x: number; y: number }) => {
    photoOffRef.current = v;
    setPhotoOffState(v);
  }, []);

  const onCardMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHoloPos({
      x: Math.round(((e.clientX - rect.left) / rect.width) * 100),
      y: Math.round(((e.clientY - rect.top) / rect.height) * 100),
    });
  };

  // Código de verificación TOTP-like (rota cada 30s)
  useEffect(() => {
    const tick = () => {
      const now = Math.floor(Date.now() / 1000);
      const w   = Math.floor(now / 30);
      const rem = 30 - (now % 30);
      let h = 5381;
      const s = empDocId + ':' + w;
      for (let i = 0; i < s.length; i++) { h = ((h << 5) + h) ^ s.charCodeAt(i); }
      const n = (Math.abs(h) % 1000000).toString().padStart(6, '0');
      setVerCode(n.slice(0, 3) + ' ' + n.slice(3));
      setVerRemaining(rem);
      setVerPct((rem / 30) * 100);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [empDocId]);

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
          if (d.credencialTitulo) setCredTitulo(d.credencialTitulo);
          if (d.credencialPie) setCredPie(d.credencialPie);
          if (d.credencialOrientacion && !orientation)
            setOrientacion(d.credencialOrientacion as 'vertical' | 'horizontal');
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

  // Sync empresa
  useEffect(() => {
    if (!empDocId || !empresaLocal) return;
    setDoc(doc(db, 'credenciales_publicas', empDocId), { empresaNombre: empresaLocal }, { merge: true }).catch(() => {});
  }, [empresaLocal, empDocId]);

  // Drag táctil foto
  useEffect(() => {
    const el = photoContRef.current;
    if (!el || !showEditUI || !fotoMostrada) return;
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
  }, [showEditUI, fotoMostrada, setPhotoOff]);

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
      setPhotoOff({ x: 50, y: 20 }); cerrarCamara();
      setTimeout(() => {
        setQuitandoFondo(true); setProgFondo(0);
        import('@imgly/background-removal').then(({ removeBackground }) =>
          removeBackground(blob, { model: 'isnet_quint8', output: { format: 'image/png' },
            progress: (_k: string, c: number, t: number) => { if (t > 0) setProgFondo(Math.round((c / t) * 100)); } })
          .then(rb => { setFotoFinal(URL.createObjectURL(rb)); setCapturedBlob(rb); })
          .catch(console.error)
          .finally(() => { setQuitandoFondo(false); setProgFondo(0); })
        );
      }, 200);
    }, 'image/png');
  };
  const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const src = ev.target?.result as string; if (!src) return;
      setFotoSrc(src); setFotoFinal(null); setPhotoOff({ x: 50, y: 20 });
      fetch(src).then(r => r.blob()).then(blob => {
        setCapturedBlob(blob);
        setQuitandoFondo(true); setProgFondo(0);
        import('@imgly/background-removal').then(({ removeBackground }) =>
          removeBackground(blob, { model: 'isnet_quint8', output: { format: 'image/png' },
            progress: (_k: string, c: number, t: number) => { if (t > 0) setProgFondo(Math.round((c / t) * 100)); } })
          .then(rb => { setFotoFinal(URL.createObjectURL(rb)); setCapturedBlob(rb); })
          .catch(console.error)
          .finally(() => { setQuitandoFondo(false); setProgFondo(0); })
        );
      });
    };
    reader.readAsDataURL(file); e.target.value = '';
  };
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
  const descargar = async () => {
    const SC = 2, W = 340, PAD = 20;
    const HH = 155, PHOTO_D = 112, PHOTO_X = Math.round((W - PHOTO_D) / 2), PHOTO_Y = 100;
    let dataY = PHOTO_Y + PHOTO_D + 18;
    const QR = 80;
    let dataLines = 2;
    if (empData.dni) dataLines++;
    if (empData.cuil) dataLines++;
    if (empData.fileNumber) dataLines++;
    const H = dataY + (dataLines * 22) + 20 + QR + 28 + 10;
    const cv = document.createElement('canvas');
    cv.width = W * SC; cv.height = H * SC;
    const ctx = cv.getContext('2d')!;
    ctx.scale(SC, SC);
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, 0, 0, W, H, 14); ctx.fill();
    const hg = ctx.createLinearGradient(0, 0, W, HH);
    hg.addColorStop(0, tema.h1); hg.addColorStop(1, tema.h2);
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.moveTo(14, 0); ctx.lineTo(W - 14, 0); ctx.quadraticCurveTo(W, 0, W, 14);
    ctx.lineTo(W, HH); ctx.lineTo(0, HH); ctx.lineTo(0, 14); ctx.quadraticCurveTo(0, 0, 14, 0);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = tema.accent; ctx.fillRect(0, HH, W, 3);
    // Logo area
    ctx.fillStyle = tema.accent;
    ctx.beginPath();
    ctx.moveTo(PAD + 12, 16); ctx.lineTo(PAD + 24, 22); ctx.lineTo(PAD + 24, 32);
    ctx.quadraticCurveTo(PAD + 24, 42, PAD + 12, 48); ctx.quadraticCurveTo(PAD, 42, PAD, 32);
    ctx.lineTo(PAD, 22); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = tema.h1; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(PAD + 6, 33); ctx.lineTo(PAD + 11, 38); ctx.lineTo(PAD + 20, 29); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 12px Arial'; ctx.textAlign = 'left';
    ctx.fillText((empresaDisplay || 'SEGURIDAD PRIVADA').toUpperCase(), PAD + 30, 30);
    ctx.fillStyle = `${tema.accent}cc`; ctx.font = '7px Arial';
    ctx.fillText(credTitulo, PAD + 30, 42);
    // Foto circular
    if (fotoMostrada) {
      const img = new Image(); img.crossOrigin = 'anonymous';
      await new Promise<void>(res => { img.onload = () => res(); img.onerror = () => res(); img.src = fotoMostrada; });
      ctx.save();
      ctx.beginPath(); ctx.arc(PHOTO_X + PHOTO_D / 2, PHOTO_Y + PHOTO_D / 2, PHOTO_D / 2, 0, Math.PI * 2); ctx.clip();
      const sc = Math.max(PHOTO_D / img.naturalWidth, PHOTO_D / img.naturalHeight);
      const rW = img.naturalWidth * sc, rH = img.naturalHeight * sc;
      const oX = (photoOff.x / 100) * Math.max(0, rW - PHOTO_D);
      const oY = (photoOff.y / 100) * Math.max(0, rH - PHOTO_D);
      ctx.drawImage(img, PHOTO_X - oX, PHOTO_Y - oY, rW, rH);
      ctx.restore();
    }
    ctx.strokeStyle = tema.accent; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(PHOTO_X + PHOTO_D / 2, PHOTO_Y + PHOTO_D / 2, PHOTO_D / 2 + 2, 0, Math.PI * 2); ctx.stroke();
    // Nombre + cargo
    ctx.textAlign = 'center'; ctx.fillStyle = '#111827'; ctx.font = 'bold 15px Arial';
    ctx.fillText(apellidoNombre || nombre || '—', W / 2, dataY);
    dataY += 16;
    ctx.fillStyle = tema.accent; ctx.font = 'bold 8px Arial';
    ctx.fillText((empData.category || 'Vigilador').toUpperCase(), W / 2, dataY);
    dataY += 16;
    ctx.textAlign = 'left';
    const drawRow = (label: string, val: string) => {
      ctx.fillStyle = tema.accent; ctx.font = 'bold 7px Arial'; ctx.fillText(label, PAD, dataY);
      ctx.fillStyle = '#1f2937'; ctx.font = 'bold 11px Arial'; ctx.fillText(val, PAD + 44, dataY + 1);
      ctx.strokeStyle = '#f1f5f9'; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(PAD, dataY + 6); ctx.lineTo(W - PAD, dataY + 6); ctx.stroke();
      dataY += 22;
    };
    if (empData.dni)        drawRow('DNI', empData.dni);
    if (empData.cuil)       drawRow('CUIL', empData.cuil);
    if (empData.fileNumber) drawRow('Legajo', empData.fileNumber);
    if (qrDataUrl) {
      const qr = new Image();
      await new Promise<void>(res => { qr.onload = () => res(); qr.onerror = () => res(); qr.src = qrDataUrl; });
      const qrX = Math.round((W - QR) / 2), qrY = dataY + 8;
      ctx.fillStyle = '#ffffff'; ctx.strokeStyle = `${tema.accent}60`; ctx.lineWidth = 1.5;
      roundRect(ctx, qrX - 5, qrY - 5, QR + 10, QR + 10, 8); ctx.fill(); ctx.stroke();
      ctx.drawImage(qr, qrX, qrY, QR, QR);
      ctx.fillStyle = '#9ca3af'; ctx.font = '6.5px Arial'; ctx.textAlign = 'center';
      ctx.fillText('ESCANEAR PARA VERIFICAR', W / 2, qrY + QR + 13);
    }
    const hg2 = ctx.createLinearGradient(0, 0, W, 0);
    hg2.addColorStop(0, tema.h1); hg2.addColorStop(1, tema.h2);
    ctx.fillStyle = hg2; ctx.fillRect(0, H - 8, W, 8);
    const link = document.createElement('a');
    link.download = `credencial_${empData.fileNumber || empDocId}.png`;
    link.href = cv.toDataURL('image/png');
    link.click();
  };

  // ── RENDER ───────────────────────────────────────────────────────────────
  // foto recortada sin fondo → mostrar como cutout flotante
  const esCutout = !!fotoFinal;

  return (
    <div className="flex flex-col gap-3">

      {/* Gancho superior */}
      <div className="flex justify-center mb-0.5">
        <div style={{
          width: 46, height: 18, borderRadius: '7px 7px 0 0', position: 'relative',
          background: 'linear-gradient(180deg, #c8d0da 0%, #a0aab6 45%, #7a8698 100%)',
          boxShadow: '0 3px 8px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.45)',
        }}>
          <div style={{
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            width: 13, height: 9, borderRadius: 5,
            background: 'linear-gradient(180deg, #505a66 0%, #3a424e 100%)',
            boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.6)',
          }}/>
        </div>
      </div>

      <div className="relative mx-auto" style={{ maxWidth: 334, width: '100%' }}>

        {/* Marco porta-credencial */}
        <div style={{
          borderRadius: 18,
          background: 'linear-gradient(90deg, #7e8c9c 0%, #aab4c0 6%, #c8d0d8 13%, #dce2e8 28%, #e8edf2 50%, #dce2e8 72%, #c8d0d8 87%, #aab4c0 94%, #7e8c9c 100%)',
          padding: '8px 14px 11px',
          boxShadow: '0 28px 64px rgba(0,0,0,0.48), 0 4px 16px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.80), inset 0 -2px 0 rgba(0,0,0,0.12)',
          position: 'relative',
        }}>
          {[{ top: 4, left: 5 }, { top: 4, right: 5 }, { bottom: 4, left: 5 }, { bottom: 4, right: 5 }].map((pos, i) => (
            <div key={i} style={{
              position: 'absolute', ...pos, width: 7, height: 7, borderRadius: '50%',
              background: 'radial-gradient(circle at 35% 35%, #ccd4dc, #8090a0)',
              boxShadow: '0 1px 2px rgba(0,0,0,0.4)',
            }}/>
          ))}

          {/* Perspectiva 3D */}
          <div style={{ perspective: '1200px' }}>
            <div
              onMouseMove={onCardMouseMove}
              style={{
                position: 'relative', width: '100%', height: 420,
                transformStyle: 'preserve-3d',
                transition: 'transform 0.75s cubic-bezier(0.4, 0, 0.2, 1)',
                transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
                borderRadius: 12,
              }}
            >

              {/* ══ FRENTE ══ */}
              <div style={{
                position: 'absolute', inset: 0,
                backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden',
                borderRadius: 12, overflow: 'visible',
                background: `linear-gradient(160deg, ${tema.h1} 0%, ${tema.h2} 55%, ${hslToHex(credHue, 50, 28)} 100%)`,
              } as React.CSSProperties}>

                {/* Textura sutil */}
                <div style={{ position: 'absolute', inset: 0, borderRadius: 12, pointerEvents: 'none', overflow: 'hidden',
                  backgroundImage: `repeating-linear-gradient(45deg,rgba(255,255,255,0.018) 0px,rgba(255,255,255,0.018) 1px,transparent 1px,transparent 8px)` }}/>

                {/* Shimmer holográfico */}
                <div style={{ position: 'absolute', inset: 0, borderRadius: 12, pointerEvents: 'none', overflow: 'hidden',
                  background: `radial-gradient(ellipse at ${holoPos.x}% ${holoPos.y}%, rgba(255,255,255,0.13) 0%, transparent 55%)`,
                  transition: 'background 0.08s' }}/>

                {/* HEADER: logo + empresa */}
                <div style={{ padding: '15px 16px 12px', paddingRight: 130, borderBottom: '0.5px solid rgba(255,255,255,0.18)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {logoEmpresa ? (
                      <img src={logoEmpresa} alt="Logo" style={{ height: 22, maxWidth: 56, objectFit: 'contain', filter: 'brightness(0) invert(1)', opacity: 0.9 }} onError={() => setLogoEmpresa(null)}/>
                    ) : (
                      <div style={{ width: 22, height: 22, borderRadius: 5, background: `${tema.accent}25`, border: `1.5px solid ${tema.accent}50`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <ShieldCheck size={12} strokeWidth={1.5} style={{ color: tema.accent }}/>
                      </div>
                    )}
                    <div style={{ minWidth: 0 }}>
                      <p style={{ color: '#fff', fontSize: 11, fontWeight: 900, letterSpacing: '0.03em', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {(empresaDisplay || 'SEGURIDAD PRIVADA').toUpperCase()}
                      </p>
                      <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 7, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                        {credTitulo}
                      </p>
                    </div>
                  </div>
                </div>

                {/* DATOS EMPLEADO */}
                <div style={{ padding: '12px 16px 10px', paddingRight: 130, borderBottom: '0.5px solid rgba(255,255,255,0.14)' }}>
                  <p style={{ color: '#fff', fontSize: 17, fontWeight: 800, lineHeight: 1.25, marginBottom: 3 }}>
                    {apellidoNombre || nombre || '—'}
                  </p>
                  <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 10 }}>
                    {empData.category || 'Vigilador'}
                  </p>
                  <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                    {empData.fileNumber && (
                      <div>
                        <p style={{ color: 'rgba(255,255,255,0.38)', fontSize: 7, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Legajo</p>
                        <p style={{ color: 'rgba(255,255,255,0.82)', fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>#{empData.fileNumber}</p>
                      </div>
                    )}
                    {empData.dni && (
                      <div>
                        <p style={{ color: 'rgba(255,255,255,0.38)', fontSize: 7, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>DNI</p>
                        <p style={{ color: 'rgba(255,255,255,0.82)', fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>{empData.dni}</p>
                      </div>
                    )}
                    {empData.cuil && (
                      <div>
                        <p style={{ color: 'rgba(255,255,255,0.38)', fontSize: 7, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>CUIL</p>
                        <p style={{ color: 'rgba(255,255,255,0.82)', fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>{empData.cuil}</p>
                      </div>
                    )}
                    {credPie && (
                      <div>
                        <p style={{ color: 'rgba(255,255,255,0.38)', fontSize: 7, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Sector</p>
                        <p style={{ color: 'rgba(255,255,255,0.82)', fontSize: 11, fontWeight: 700 }}>{credPie}</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* CÓDIGO DE VERIFICACIÓN */}
                <div style={{ padding: '10px 16px', paddingRight: 130, borderBottom: '0.5px solid rgba(255,255,255,0.14)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 5 }}>
                    <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                      <circle cx="5" cy="5" r="4" stroke="rgba(255,255,255,0.4)" strokeWidth="1"/>
                      <path d="M5 3v2.5l1.5 1" stroke="rgba(255,255,255,0.4)" strokeWidth="1" strokeLinecap="round"/>
                    </svg>
                    <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 7, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                      Código de verificación
                    </p>
                  </div>
                  <p style={{ color: '#fff', fontSize: 24, fontWeight: 800, letterSpacing: '0.28em', fontFamily: 'monospace', lineHeight: 1, marginBottom: 6 }}>
                    {verCode}
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <p style={{ color: 'rgba(255,255,255,0.33)', fontSize: 7.5 }}>
                      Se actualiza en{' '}
                      <span style={{ color: 'rgba(255,255,255,0.62)', fontWeight: 700 }}>0:{verRemaining.toString().padStart(2, '0')}</span>
                    </p>
                    <div style={{ flex: 1, maxWidth: 52, height: 2, background: 'rgba(255,255,255,0.12)', borderRadius: 1, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${verPct}%`, background: 'rgba(255,255,255,0.38)', borderRadius: 1, transition: 'width 1s linear' }}/>
                    </div>
                  </div>
                </div>

                {/* PIE: chip + QR + validez */}
                <div style={{ padding: '10px 16px', paddingRight: 130, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{
                    width: 32, height: 23, borderRadius: 4, flexShrink: 0,
                    background: 'linear-gradient(135deg,#c6901c 0%,#efc848 26%,#a67010 50%,#f5d86c 72%,#c6901c 100%)',
                    border: '1px solid #9e6e0e',
                    boxShadow: '0 2px 5px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.28)',
                    position: 'relative',
                  }}>
                    {[5, 10, 16, 20].map((t, i) => <div key={i} style={{ position: 'absolute', top: t, left: 3, right: 3, height: 1, background: 'rgba(80,44,0,0.28)' }}/>)}
                  </div>
                  <button
                    onClick={() => setFlipped(true)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      padding: '5px 11px', borderRadius: 20,
                      background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.22)',
                      cursor: 'pointer',
                    }}
                  >
                    {qrDataUrl && <img src={qrDataUrl} alt="" style={{ width: 14, height: 14, opacity: 0.65, borderRadius: 2 }}/>}
                    <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: 6.5, fontWeight: 900, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Ver QR</p>
                  </button>
                  <p style={{ color: 'rgba(255,255,255,0.28)', fontSize: 7, textAlign: 'right', lineHeight: 1.5 }}>
                    {empData.fileNumber ? `BSP-${empData.fileNumber}` : ''}<br/>Válida 12/2026
                  </p>
                </div>

                {/* Banda inferior decorativa */}
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 4, borderRadius: '0 0 12px 12px',
                  background: `linear-gradient(90deg,${tema.accent}70,rgba(255,255,255,0.35),${tema.accent}70)` }}/>

                {/* FOTO — sin marco ni círculo, desborda borde derecho */}
                <div style={{ position: 'absolute', bottom: 0, right: -14, zIndex: 20, width: 128, height: 320, pointerEvents: 'none' }}>
                  {quitandoFondo && (
                    <div style={{ position: 'absolute', inset: 0, zIndex: 21, background: 'rgba(0,0,0,0.45)',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                      <RefreshCw size={18} className="animate-spin" style={{ color: tema.accent }}/>
                      <p style={{ color: '#fff', fontSize: 9, fontWeight: 900 }}>{progFondo}%</p>
                    </div>
                  )}
                  {fotoMostrada ? (
                    <div
                      ref={photoContRef}
                      style={{ width: '100%', height: '100%', overflow: 'hidden', pointerEvents: showEditUI ? 'auto' : 'none' }}
                    >
                      <img
                        src={fotoMostrada}
                        alt="Foto"
                        style={{
                          width: '100%', height: '100%',
                          objectFit: esCutout ? 'contain' : 'cover',
                          objectPosition: esCutout ? 'bottom center' : `${photoOff.x}% ${photoOff.y}%`,
                          filter: esCutout ? 'drop-shadow(0 6px 22px rgba(0,0,0,0.7)) drop-shadow(0 2px 8px rgba(0,0,0,0.45))' : 'none',
                          pointerEvents: 'none', userSelect: 'none',
                        }}
                        draggable={false}
                      />
                    </div>
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 10, opacity: 0.18 }}>
                      <svg viewBox="0 0 60 80" width={72} height={96}>
                        <circle cx="30" cy="22" r="14" fill="rgba(255,255,255,0.9)"/>
                        <path d="M 4 80 Q 4 52 30 48 Q 56 52 56 80 Z" fill="rgba(255,255,255,0.9)"/>
                      </svg>
                    </div>
                  )}
                </div>

                {/* Overlay holográfico */}
                <div style={{ position: 'absolute', inset: 0, borderRadius: 12, pointerEvents: 'none', zIndex: 8, overflow: 'hidden',
                  backgroundImage: `conic-gradient(from ${holoPos.x * 3.6}deg at ${holoPos.x}% ${holoPos.y}%, rgba(255,60,60,0.025),rgba(255,180,40,0.025),rgba(50,255,100,0.025),rgba(40,160,255,0.025),rgba(180,50,255,0.025),rgba(255,60,60,0.025))`,
                  mixBlendMode: 'overlay' as React.CSSProperties['mixBlendMode'] }}/>
              </div>
              {/* ── FIN FRENTE ── */}

              {/* ══ DORSO ══ */}
              <div style={{
                position: 'absolute', inset: 0,
                backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden',
                transform: 'rotateY(180deg)', borderRadius: 12, overflow: 'hidden',
                background: `linear-gradient(158deg, ${tema.h1} 0%, #0c1a28 42%, ${tema.h2}bb 100%)`,
              } as React.CSSProperties}>
                <div style={{ position: 'absolute', inset: 0, opacity: 0.05, pointerEvents: 'none', backgroundImage: `repeating-linear-gradient(45deg, ${tema.accent} 0px, ${tema.accent} 1px, transparent 1px, transparent 10px)` }}/>
                <div style={{ marginTop: 32, height: 44, background: 'linear-gradient(180deg, #050505 0%, #121212 50%, #050505 100%)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.07)' }}/>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '18px 24px 0', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {logoEmpresa ? (
                      <img src={logoEmpresa} alt="Logo" style={{ height: 20, maxWidth: 60, objectFit: 'contain', filter: 'brightness(0) invert(1)', opacity: 0.85 }} onError={() => setLogoEmpresa(null)}/>
                    ) : <ShieldCheck size={16} strokeWidth={1.5} style={{ color: tema.accent }}/>}
                    <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: 9.5, fontWeight: 900, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                      {(empresaDisplay || 'SEGURIDAD PRIVADA').toUpperCase()}
                    </p>
                  </div>
                  {qrDataUrl ? (
                    <div style={{ padding: 8, borderRadius: 12, background: '#fff', boxShadow: `0 0 0 2.5px ${tema.accent}55, 0 10px 30px rgba(0,0,0,0.65)` }}>
                      <img src={qrDataUrl} alt="QR" width={124} height={124}/>
                    </div>
                  ) : (
                    <div style={{ width: 140, height: 140, borderRadius: 12, background: '#1a2940', border: `1px solid ${tema.accent}30`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <RefreshCw size={20} className="animate-spin" style={{ color: tema.accent, opacity: 0.5 }}/>
                    </div>
                  )}
                  <p style={{ color: tema.accent, fontSize: 7, fontWeight: 900, letterSpacing: '0.15em', textTransform: 'uppercase' }}>Escanear para verificar identidad</p>
                  <div style={{ width: '100%', height: 1, background: `${tema.accent}28` }}/>
                  <div style={{ textAlign: 'center' }}>
                    <p style={{ color: 'rgba(255,255,255,0.95)', fontSize: 14, fontWeight: 900, lineHeight: 1.2 }}>{apellidoNombre || nombre || '—'}</p>
                    <p style={{ color: tema.accent, fontSize: 7.5, fontWeight: 900, letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 3 }}>{empData.category || 'Vigilador'}</p>
                  </div>
                  <p style={{ color: 'rgba(255,255,255,0.22)', fontSize: 6.5, lineHeight: 1.7, textAlign: 'center', padding: '0 6px' }}>
                    Esta credencial es propiedad de {empresaDisplay || 'la empresa'}. En caso de encontrarla, devolver a su titular.
                  </p>
                </div>
                <button onClick={() => setFlipped(false)} style={{ position: 'absolute', bottom: 16, right: 14, display: 'flex', alignItems: 'center', gap: 4, padding: '4px 12px', borderRadius: 20, background: `${tema.accent}18`, border: `1px solid ${tema.accent}45`, color: tema.accent, fontSize: 7, fontWeight: 900, letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer' }}>← Frente</button>
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 7, background: `linear-gradient(90deg, ${tema.h2}, ${tema.accent}80, ${tema.h2})` }}/>
              </div>
              {/* ── FIN DORSO ── */}

            </div>{/* flipper */}
          </div>{/* perspectiva */}
        </div>{/* marco */}

        {/* Botones de foto */}
        {showEditUI && (
          <div className="flex gap-2 mt-3 px-1">
            <button
              onClick={abrirCamara}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wide transition-all active:scale-95"
              style={{ color: '#fff', background: `linear-gradient(135deg, ${tema.h1}, ${tema.h2})`, boxShadow: `0 4px 14px ${tema.h2}65` }}
            >
              <Camera size={13}/> {fotoMostrada ? 'Cambiar foto' : 'Sacar foto'}
            </button>
            {fotoMostrada && !fotoFinal && !quitandoFondo && (
              <button onClick={quitarFondo} className="flex items-center justify-center gap-1 px-3 py-2.5 rounded-xl text-xs font-black uppercase transition-all active:scale-95" style={{ color: tema.accent, background: `${tema.h1}20`, border: `1px solid ${tema.accent}40` }}>
                <Sparkles size={12}/> Sin fondo
              </button>
            )}
            {quitandoFondo && (
              <div className="flex items-center gap-1 px-3 py-2.5 rounded-xl text-xs font-black" style={{ color: tema.accent, background: `${tema.h1}20` }}>
                <RefreshCw size={12} className="animate-spin"/> {progFondo}%
              </div>
            )}
          </div>
        )}
      </div>

      {/* Acciones */}
      <div className="flex gap-2">
        {credGuardada && !modoEdicion && !viewOnly && (
          <button onClick={() => setModoEdicion(true)} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm font-bold hover:bg-slate-700 transition-all active:scale-95">
            <Pencil size={14}/> Editar foto
          </button>
        )}
        {showEditUI && (capturedBlob || !credGuardada) && (
          <button onClick={guardarFoto} disabled={guardando} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-black disabled:opacity-50 transition-all active:scale-95 text-white" style={{ background: `linear-gradient(135deg, ${tema.h1}, ${tema.h2})` }}>
            {guardando ? <RefreshCw size={14} className="animate-spin"/> : <ShieldCheck size={14}/>}
            {credGuardada ? 'Guardar' : 'Activar QR'}
          </button>
        )}
        {!viewOnly && (
          <button onClick={descargar} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm font-bold hover:bg-slate-700 transition-all active:scale-95">
            <Download size={14}/> Descargar
          </button>
        )}
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
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
              {/* Overlay oscuro — 4 rectángulos alrededor del área guía */}
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 'calc(50% - 190px)', background: 'rgba(0,0,0,0.72)' }}/>
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 'calc(50% - 110px)', background: 'rgba(0,0,0,0.72)' }}/>
              <div style={{ position: 'absolute', top: 'calc(50% - 190px)', bottom: 'calc(50% - 110px)', left: 0, width: 'calc(50% - 118px)', background: 'rgba(0,0,0,0.72)' }}/>
              <div style={{ position: 'absolute', top: 'calc(50% - 190px)', bottom: 'calc(50% - 110px)', right: 0, width: 'calc(50% - 118px)', background: 'rgba(0,0,0,0.72)' }}/>
              {/* Guía silueta: cabeza + hombros + busto */}
              <svg
                style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}
                width="236" height="300" viewBox="0 0 236 300"
              >
                {/* Óvalo cabeza */}
                <ellipse cx="118" cy="82" rx="54" ry="66" fill="none" stroke={tema.accent} strokeWidth="2" strokeDasharray="8 4" opacity="0.9"/>
                {/* Cuello */}
                <line x1="94" y1="143" x2="90" y2="166" stroke={tema.accent} strokeWidth="1.5" strokeDasharray="5 4" opacity="0.65"/>
                <line x1="142" y1="143" x2="146" y2="166" stroke={tema.accent} strokeWidth="1.5" strokeDasharray="5 4" opacity="0.65"/>
                {/* Hombros */}
                <path d="M 90 166 Q 44 178 18 220" fill="none" stroke={tema.accent} strokeWidth="2" strokeDasharray="8 4" opacity="0.9"/>
                <path d="M 146 166 Q 192 178 218 220" fill="none" stroke={tema.accent} strokeWidth="2" strokeDasharray="8 4" opacity="0.9"/>
                {/* Línea base busto */}
                <line x1="18" y1="220" x2="218" y2="220" stroke={tema.accent} strokeWidth="1.5" strokeDasharray="6 4" opacity="0.45"/>
                {/* Esquinas de encuadre */}
                <path d="M 0 32 L 0 10 L 26 10" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2.5" strokeLinecap="round"/>
                <path d="M 236 32 L 236 10 L 210 10" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2.5" strokeLinecap="round"/>
                <path d="M 0 268 L 0 290 L 26 290" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2.5" strokeLinecap="round"/>
                <path d="M 236 268 L 236 290 L 210 290" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2.5" strokeLinecap="round"/>
              </svg>
              <div style={{ position: 'absolute', bottom: 152, left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
                <div style={{ background: `${tema.h1}dd`, borderRadius: 20, padding: '6px 16px' }}>
                  <p className="text-white text-[11px] font-bold text-center">Encuadrá hombros y rostro · Mirá a cámara</p>
                </div>
              </div>
            </div>
          </div>
          <div className="pb-12 pt-5 flex justify-center" style={{ background: tema.h1 }}>
            <button onClick={capturarFoto} style={{ width: 76, height: 76, background: '#ffffff', border: `4px solid ${tema.accent}`, boxShadow: `0 0 0 8px ${tema.accent}30`, borderRadius: '50%' }} className="active:scale-90 transition-transform"/>
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
