import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera, Download, RefreshCw, ShieldCheck, X,
  Sparkles, Pencil,
} from 'lucide-react';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
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
  const [photoOff, setPhotoOffState]      = useState({ x: 50, y: 30 });
  const photoOffRef                       = useRef({ x: 50, y: 20 });
  const [flipped, setFlipped]             = useState(false);
  const [credModelo, setCredModelo]       = useState<string>('gradiente');
  const [verCode, setVerCode]             = useState('--- ---');
  const [verRemaining, setVerRemaining]   = useState(60);
  const [verPct, setVerPct]               = useState(100);
  const [countdown, setCountdown]         = useState<number | null>(null);
  const countdownRef                      = useRef<ReturnType<typeof setInterval> | null>(null);

  const [photoScale, setPhotoScaleState]   = useState(1);
  const photoScaleRef                      = useRef(1);

  const setPhotoScale = useCallback((v: number) => {
    const clamped = Math.max(0.4, Math.min(4, v));
    photoScaleRef.current = clamped;
    setPhotoScaleState(clamped);
  }, []);

  const videoRef     = useRef<HTMLVideoElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoContRef = useRef<HTMLDivElement>(null);
  const dragRef      = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const pinchRef     = useRef<{ d: number; s: number } | null>(null);

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
    void rect; // usado por holoPos en versiones anteriores — mantener por compatibilidad
  };

  // Código de verificación TOTP-like (rota cada 60s)
  useEffect(() => {
    const tick = () => {
      const now = Math.floor(Date.now() / 1000);
      const w   = Math.floor(now / 60);
      const rem = 60 - (now % 60);
      let h = 5381;
      const s = empDocId + ':' + w;
      for (let i = 0; i < s.length; i++) { h = ((h << 5) + h) ^ s.charCodeAt(i); }
      const n = (Math.abs(h) % 1000000).toString().padStart(6, '0');
      setVerCode(n.slice(0, 3) + ' ' + n.slice(3));
      setVerRemaining(rem);
      setVerPct((rem / 60) * 100);
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

  // Empresa — Firestore es fuente de verdad; empresaNombre prop es solo fallback inicial
  useEffect(() => {
    if (!empData.empresaId) {
      if (empresaNombre) setEmpresaLocal(empresaNombre);
      return;
    }
    getDoc(doc(db, 'empresas', empData.empresaId))
      .then(snap => {
        if (snap.exists()) {
          const d = snap.data();
          const n = d.name || d.nombre || d.razonSocial || '';
          if (n) setEmpresaLocal(n);
          if (d.logoUrl && !empresaLogoUrl) setLogoEmpresa(d.logoUrl);
          if (typeof d.credencialHue === 'number') setCredHue(d.credencialHue);
          if (d.credencialTitulo) setCredTitulo(d.credencialTitulo);
          if (d.credencialPie) setCredPie(d.credencialPie);
          if (d.credencialOrientacion && !orientation)
            setOrientacion(d.credencialOrientacion as 'vertical' | 'horizontal');
          if (d.credencialModelo) setCredModelo(d.credencialModelo);
        } else if (empresaNombre) {
          setEmpresaLocal(empresaNombre);
        }
      }).catch(() => {
        if (empresaNombre) setEmpresaLocal(empresaNombre);
      });
  }, [empData.empresaId, empresaLogoUrl, templateId]); // empresaNombre intencionalmente excluido

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
          if (typeof d.photoScale === 'number') setPhotoScale(d.photoScale);
          if (typeof d.photoOffX === 'number' && typeof d.photoOffY === 'number')
            setPhotoOff({ x: d.photoOffX, y: d.photoOffY });
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

  // Drag (1 dedo) + Pinch zoom (2 dedos) — deshabilitado en viewOnly
  useEffect(() => {
    const el = photoContRef.current;
    if (!el || !fotoMostrada || viewOnly) return;

    const pinchDist = (t: TouchList) =>
      Math.hypot(t[1].clientX - t[0].clientX, t[1].clientY - t[0].clientY);

    const onStart = (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 2) {
        pinchRef.current = { d: pinchDist(e.touches), s: photoScaleRef.current };
        dragRef.current = null;
      } else {
        pinchRef.current = null;
        dragRef.current = { sx: e.touches[0].clientX, sy: e.touches[0].clientY, ox: photoOffRef.current.x, oy: photoOffRef.current.y };
      }
    };
    const onMove = (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 2 && pinchRef.current) {
        const newScale = pinchRef.current.s * (pinchDist(e.touches) / pinchRef.current.d);
        setPhotoScale(newScale);
      } else if (e.touches.length === 1 && dragRef.current) {
        const rect = el.getBoundingClientRect();
        const dx = e.touches[0].clientX - dragRef.current.sx;
        const dy = e.touches[0].clientY - dragRef.current.sy;
        const sens = Math.max(1, photoScaleRef.current);
        setPhotoOff({
          x: Math.max(0, Math.min(100, dragRef.current.ox - (dx / rect.width) * 100 * sens)),
          y: Math.max(0, Math.min(100, dragRef.current.oy - (dy / rect.height) * 100 * sens)),
        });
      }
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinchRef.current = null;
      if (e.touches.length === 0) dragRef.current = null;
    };
    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
    };
  }, [fotoMostrada, setPhotoOff, setPhotoScale]);

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
  const getBlobFromUrl = async (url: string): Promise<Blob | null> => {
    try {
      const r = await fetch(url, { mode: 'cors' });
      if (r.ok) return await r.blob();
    } catch { /* intentamos con canvas */ }
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(); img.src = url; });
      const cv = document.createElement('canvas');
      cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      cv.getContext('2d')!.drawImage(img, 0, 0);
      return await new Promise<Blob | null>(res => cv.toBlob(b => res(b), 'image/png'));
    } catch { return null; }
  };
  const quitarFondo = async () => {
    let blob = capturedBlob;
    if (!blob) {
      const src = fotoFinal || fotoSrc;
      if (!src) return;
      blob = await getBlobFromUrl(src);
    }
    if (!blob) return;
    setQuitandoFondo(true); setProgFondo(0);
    try {
      const { removeBackground } = await import('@imgly/background-removal');
      const rb = await removeBackground(blob, {
        model: 'isnet_quint8', output: { format: 'image/png' },
        progress: (_k: string, c: number, t: number) => { if (t > 0) setProgFondo(Math.round((c / t) * 100)); },
      });
      setFotoFinal(URL.createObjectURL(rb)); setCapturedBlob(rb);
    } catch (e) { console.error('BG removal error:', e); }
    finally { setQuitandoFondo(false); setProgFondo(0); }
  };
  const iniciarContador = () => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    setCountdown(3);
    let c = 3;
    countdownRef.current = setInterval(() => {
      c--;
      if (c > 0) {
        setCountdown(c);
      } else {
        clearInterval(countdownRef.current!);
        countdownRef.current = null;
        setCountdown(null);
        capturarFoto();
      }
    }, 1000);
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
        photoScale: photoScaleRef.current,
        photoOffX: photoOffRef.current.x,
        photoOffY: photoOffRef.current.y,
        updatedAt: serverTimestamp(),
      };
      const url = photoUrl || (fotoSrc && !fotoSrc.startsWith('blob:') && !fotoSrc.startsWith('data:') ? fotoSrc : '');
      if (url) payload.photoUrl = url;
      await setDoc(doc(db, 'credenciales_publicas', empDocId), payload);
      // Sincronizar photoUrl al legajo para que el portal cargue la foto sin esperar
      if (url) updateDoc(doc(db, 'empleados', empDocId), { photoUrl: url }).catch(() => {});
      setCredGuardada(true); setModoEdicion(false);
    } catch (err) { console.error(err); }
    finally { setGuardando(false); }
  };
  const descargar = async () => {
    const SC = 2;
    const CARD_W = 420;
    const isH = orientacion === 'horizontal';
    const CARD_H = isH ? 500 : 720;

    const cv = document.createElement('canvas');
    cv.width = CARD_W * SC; cv.height = CARD_H * SC;
    const ctx = cv.getContext('2d')!;
    ctx.scale(SC, SC);

    const rr = (x: number, y: number, w: number, h: number, r: number) =>
      roundRect(ctx, x, y, w, h, r);

    const loadImg = (src: string) => new Promise<HTMLImageElement>(res => {
      const img = new Image(); img.crossOrigin = 'anonymous';
      img.onload = () => res(img); img.onerror = () => res(img); img.src = src;
    });

    const drawPhoto = async (x: number, y: number, w: number, h: number, rad = 6) => {
      if (!fotoMostrada) return;
      const img = await loadImg(fotoMostrada);
      ctx.save(); rr(x, y, w, h, rad); ctx.clip();
      if (!!fotoFinal) {
        const aspect = img.naturalWidth / img.naturalHeight;
        let dw = w, dh = h;
        if (aspect > w / h) dh = w / aspect; else dw = h * aspect;
        const dx = x + (w - dw) / 2, dy = y + (h - dh) / 2;
        ctx.drawImage(img, dx, dy, dw, dh);
      } else {
        // Reproduce exactamente: objectFit cover + scale(photoScale) + objectPosition
        const coverSc = Math.max(w / img.naturalWidth, h / img.naturalHeight);
        const totalSc = coverSc * photoScaleRef.current;
        const rW = img.naturalWidth * totalSc, rH = img.naturalHeight * totalSc;
        const oX = (photoOff.x / 100) * Math.max(0, rW - w);
        const oY = (photoOff.y / 100) * Math.max(0, rH - h);
        ctx.drawImage(img, x - oX, y - oY, rW, rH);
      }
      ctx.restore();
    };

    const drawLogo = async (x: number, y: number, h: number): Promise<number> => {
      if (logoEmpresa) {
        const img = await loadImg(logoEmpresa);
        const lw = Math.min(h * 3.5, img.naturalWidth * (h / img.naturalHeight));
        ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = 0.9;
        ctx.drawImage(img, x, y, lw, h); ctx.restore();
        return lw;
      }
      ctx.fillStyle = `${tema.accent}25`; rr(x, y, h, h, 4); ctx.fill();
      ctx.strokeStyle = tema.accent; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + h * 0.5, y + 2); ctx.lineTo(x + h - 2, y + h * 0.25);
      ctx.lineTo(x + h - 2, y + h * 0.65);
      ctx.quadraticCurveTo(x + h * 0.5, y + h - 1, x + h * 0.5, y + h - 1);
      ctx.quadraticCurveTo(x + 2, y + h * 0.65, x + 2, y + h * 0.65);
      ctx.lineTo(x + 2, y + h * 0.25); ctx.closePath(); ctx.stroke();
      return h;
    };

    const drawVerCode = (x: number, startY: number, compact = false): number => {
      let y = startY;
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '700 7px Arial'; ctx.textAlign = 'left';
      ctx.fillText('CÓDIGO DE VERIFICACIÓN', x, y); y += 12;
      if (compact) {
        ctx.fillStyle = '#ffffff';
        ctx.font = '800 16px monospace'; ctx.fillText(verCode, x, y);
        const barX = x + 105;
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        rr(barX, y - 10, 42, 2, 1); ctx.fill();
        const fw = 42 * (verPct / 100);
        if (fw > 0) { ctx.fillStyle = 'rgba(255,255,255,0.38)'; rr(barX, y - 10, fw, 2, 1); ctx.fill(); }
        return y + 10;
      }
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 22px monospace'; ctx.fillText(verCode, x, y); y += 10;
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      rr(x, y, 52, 2, 1); ctx.fill();
      const fw = 52 * (verPct / 100);
      if (fw > 0) { ctx.fillStyle = 'rgba(255,255,255,0.38)'; rr(x, y, fw, 2, 1); ctx.fill(); }
      return y + 14;
    };

    const drawFields = (x: number, startY: number, maxRight: number): number => {
      const flds: { label: string; val: string }[] = [];
      if (empData.fileNumber) flds.push({ label: 'Legajo', val: `#${empData.fileNumber}` });
      if (empData.dni)        flds.push({ label: 'DNI',    val: empData.dni });
      if (empData.cuil)       flds.push({ label: 'CUIL',   val: empData.cuil });
      if (credPie)            flds.push({ label: 'Sector', val: credPie });
      let fx = x, y = startY;
      for (const f of flds) {
        ctx.fillStyle = 'rgba(255,255,255,0.38)';
        ctx.font = '7px Arial'; ctx.textAlign = 'left'; ctx.fillText(f.label.toUpperCase(), fx, y);
        ctx.fillStyle = 'rgba(255,255,255,0.82)';
        ctx.font = 'bold 11px monospace'; ctx.fillText(f.val, fx, y + 11);
        fx += 65;
        if (fx + 50 > maxRight) { fx = x; y += 26; }
      }
      return y + (flds.length > 0 ? 20 : 0);
    };

    // Canvas render — template único
    const PAD = 16;
    ctx.save(); rr(0, 0, CARD_W, CARD_H, 12); ctx.clip();
    ctx.fillStyle = '#0b1120'; ctx.fillRect(0, 0, CARD_W, CARD_H);

    if (isH) {
      // Horizontal: foto izq 40%, datos der
      const photoW = Math.round(CARD_W * 0.4);
      await drawPhoto(0, 0, photoW, CARD_H, 0);
      // gradient overlay right edge
      const gR = ctx.createLinearGradient(photoW * 0.55, 0, photoW, 0);
      gR.addColorStop(0, 'rgba(11,17,32,0)'); gR.addColorStop(1, '#0b1120');
      ctx.fillStyle = gR; ctx.fillRect(photoW * 0.55, 0, photoW * 0.45, CARD_H);
      // logo + empresa abajo de la foto
      const lw = await drawLogo(photoW / 2 - 9, CARD_H - 38, 18);
      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '700 6.5px Arial'; ctx.textAlign = 'center';
      ctx.fillText((empresaDisplay || '').toUpperCase().substring(0, 20), photoW / 2 + lw / 2, CARD_H - 16);
      ctx.textAlign = 'left';
      // datos
      const RX = photoW + PAD; let y = 20;
      ctx.fillStyle = tema.accent; ctx.font = '700 7px Arial';
      ctx.fillText(credTitulo.toUpperCase(), RX, y); y += 16;
      ctx.fillStyle = '#fff'; ctx.font = '800 19px Arial';
      ctx.fillText(apellidoNombre || nombre || '—', RX, y); y += 16;
      ctx.fillStyle = `${tema.accent}cc`; ctx.font = '700 8px Arial';
      ctx.fillText((empData.category || 'Vigilador').toUpperCase(), RX, y); y += 16;
      ctx.strokeStyle = `${tema.accent}22`; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(RX, y); ctx.lineTo(CARD_W - PAD, y); ctx.stroke(); y += 12;
      y = drawFields(RX, y, CARD_W - PAD);
      ctx.beginPath(); ctx.moveTo(RX, y); ctx.lineTo(CARD_W - PAD, y); ctx.stroke(); y += 12;
      drawVerCode(RX, y, true);
      ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.font = '7px Arial'; ctx.textAlign = 'right';
      ctx.fillText('Válida 12/2026', CARD_W - PAD, CARD_H - 14); ctx.textAlign = 'left';
    } else {
      // Vertical: header | foto 58% | datos
      const photoH = Math.round(CARD_H * 0.58);
      const headerH = 50;
      // Header
      const lw = await drawLogo(PAD, headerH / 2 - 13, 26);
      ctx.fillStyle = '#fff'; ctx.font = '800 15px Arial'; ctx.textAlign = 'left';
      ctx.fillText((empresaDisplay || 'SEGURIDAD PRIVADA').toUpperCase().substring(0, 22), PAD + lw + 10, headerH / 2 + 2);
      ctx.fillStyle = `${tema.accent}bb`; ctx.font = '700 7.5px Arial';
      ctx.fillText(credTitulo.toUpperCase(), PAD + lw + 10, headerH / 2 + 14);
      // Foto
      await drawPhoto(0, headerH, CARD_W, photoH, 0);
      // gradient overlay bottom of photo
      const gB = ctx.createLinearGradient(0, headerH + photoH * 0.55, 0, headerH + photoH);
      gB.addColorStop(0, 'rgba(11,17,32,0)'); gB.addColorStop(1, '#0b1120');
      ctx.fillStyle = gB; ctx.fillRect(0, headerH + photoH * 0.55, CARD_W, photoH * 0.45);
      // nombre sobre foto
      ctx.fillStyle = '#fff'; ctx.font = '800 22px Arial'; ctx.textAlign = 'left';
      ctx.fillText(apellidoNombre || nombre || '—', PAD, headerH + photoH - 18);
      ctx.fillStyle = tema.accent; ctx.font = '700 8px Arial';
      ctx.fillText((empData.category || 'Vigilador').toUpperCase(), PAD, headerH + photoH - 6);
      // ── datos: layout por filas igual al JSX ──
      let y = headerH + photoH + 14;
      // Fila 1: Legajo + DNI grandes
      const hasLegajo = !!empData.fileNumber;
      const hasDni = !!empData.dni;
      if (hasLegajo || hasDni) {
        if (hasLegajo) {
          ctx.fillStyle = 'rgba(255,255,255,0.38)'; ctx.font = '700 7px Arial'; ctx.textAlign = 'left';
          ctx.fillText('LEGAJO', PAD, y);
          ctx.fillStyle = '#fff'; ctx.font = '800 19px monospace';
          ctx.fillText(`#${empData.fileNumber}`, PAD, y + 17);
        }
        if (hasDni) {
          const dniX = hasLegajo ? PAD + 100 : PAD;
          ctx.fillStyle = 'rgba(255,255,255,0.38)'; ctx.font = '700 7px Arial'; ctx.textAlign = 'left';
          ctx.fillText('DNI', dniX, y);
          ctx.fillStyle = '#fff'; ctx.font = '800 19px monospace';
          ctx.fillText(empData.dni!, dniX, y + 17);
        }
        y += 26;
      }
      // Fila 2: CUIL
      if (empData.cuil) {
        ctx.fillStyle = 'rgba(255,255,255,0.38)'; ctx.font = '700 7px Arial'; ctx.textAlign = 'left';
        ctx.fillText('CUIL', PAD, y);
        ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '700 13px monospace';
        ctx.fillText(empData.cuil, PAD, y + 14);
        y += 22;
      }
      // Divider
      ctx.strokeStyle = `${tema.accent}22`; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(CARD_W - PAD, y); ctx.stroke(); y += 10;
      // Código de verificación
      drawVerCode(PAD, y, true);
      // Sector abajo a la izquierda
      if (credPie) {
        ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.font = '700 6.5px Arial'; ctx.textAlign = 'left';
        ctx.fillText('SECTOR', PAD, CARD_H - 18);
        ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '700 9px Arial';
        ctx.fillText(credPie, PAD, CARD_H - 7);
      }
      ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.font = '7px Arial'; ctx.textAlign = 'right';
      ctx.fillText('Válida 12/2026', CARD_W - PAD, CARD_H - 10); ctx.textAlign = 'left';
    }
    // stripes
    const sG = ctx.createLinearGradient(0, 0, CARD_W, 0);
    sG.addColorStop(0, tema.h2); sG.addColorStop(0.5, tema.accent); sG.addColorStop(1, tema.h2);
    ctx.fillStyle = sG; ctx.fillRect(0, 0, CARD_W, 3);
    ctx.fillRect(0, CARD_H - 4, CARD_W, 4);
    ctx.restore();

    const link = document.createElement('a');
    link.download = `credencial_${empData.fileNumber || empDocId}.png`;
    link.href = cv.toDataURL('image/png');
    link.click();
  };

  // ── RENDER ───────────────────────────────────────────────────────────────
  const esCutout = !!fotoFinal;
  const isH = orientacion === 'horizontal';
  const bg = '#0b1120';

  // Helpers compartidos
  const logoEl = (h: number) => logoEmpresa ? (
    <img src={logoEmpresa} alt="Logo" style={{ height: h, maxWidth: h * 3.5, objectFit: 'contain', filter: 'brightness(0) invert(1)', opacity: 0.9 }} onError={() => setLogoEmpresa(null)}/>
  ) : (
    <div style={{ width: h, height: h, borderRadius: 4, background: `${tema.accent}25`, border: `1.5px solid ${tema.accent}50`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <ShieldCheck size={h * 0.55} strokeWidth={1.5} style={{ color: tema.accent }}/>
    </div>
  );

  const dataFields = () => (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
      {empData.fileNumber && <div><p style={{ color: 'rgba(255,255,255,0.38)', fontSize: 7, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Legajo</p><p style={{ color: 'rgba(255,255,255,0.9)', fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>#{empData.fileNumber}</p></div>}
      {empData.dni && <div><p style={{ color: 'rgba(255,255,255,0.38)', fontSize: 7, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>DNI</p><p style={{ color: 'rgba(255,255,255,0.9)', fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>{empData.dni}</p></div>}
      {empData.cuil && <div><p style={{ color: 'rgba(255,255,255,0.38)', fontSize: 7, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>CUIL</p><p style={{ color: 'rgba(255,255,255,0.9)', fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>{empData.cuil}</p></div>}
      {credPie && <div><p style={{ color: 'rgba(255,255,255,0.38)', fontSize: 7, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Sector</p><p style={{ color: 'rgba(255,255,255,0.9)', fontSize: 11, fontWeight: 700 }}>{credPie}</p></div>}
    </div>
  );

  const verSection = () => (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
        <svg width="9" height="9" viewBox="0 0 10 10" fill="none"><circle cx="5" cy="5" r="4" stroke="rgba(255,255,255,0.4)" strokeWidth="1"/><path d="M5 3v2.5l1.5 1" stroke="rgba(255,255,255,0.4)" strokeWidth="1" strokeLinecap="round"/></svg>
        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 7, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Código de verificación</p>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <p style={{ color: '#fff', fontSize: 16, fontWeight: 800, letterSpacing: '0.25em', fontFamily: 'monospace', lineHeight: 1 }}>{verCode}</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 42, height: 2, background: 'rgba(255,255,255,0.12)', borderRadius: 1, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${verPct}%`, background: tema.accent, borderRadius: 1, transition: 'width 1s linear' }}/>
          </div>
          <p style={{ color: 'rgba(255,255,255,0.33)', fontSize: 7 }}>0:{verRemaining.toString().padStart(2, '0')}</p>
        </div>
      </div>
    </div>
  );

  const qrBtn = () => (
    <button onClick={() => setFlipped(true)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 20, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.18)', cursor: 'pointer' }}>
      {qrDataUrl && <img src={qrDataUrl} alt="" style={{ width: 14, height: 14, opacity: 0.65, borderRadius: 2 }}/>}
      <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: 6.5, fontWeight: 900, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Ver QR</p>
    </button>
  );

  // Zona de foto — ref para drag/pinch
  const photoZoneH = (
    // Horizontal: columna izquierda 40%
    <div ref={photoContRef} style={{ width: '40%', position: 'relative', flexShrink: 0, overflow: 'hidden', pointerEvents: (fotoMostrada && !viewOnly) ? 'auto' : 'none', touchAction: viewOnly ? 'auto' : 'none' }}>
      {quitandoFondo && <div style={{ position: 'absolute', inset: 0, zIndex: 5, background: 'rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3 }}><RefreshCw size={16} className="animate-spin" style={{ color: tema.accent }}/><p style={{ color: '#fff', fontSize: 9, fontWeight: 900 }}>{progFondo}%</p></div>}
      {fotoMostrada ? (
        <img src={fotoMostrada} alt="Foto" draggable={false} style={{ width: '100%', height: '100%', objectFit: esCutout ? 'contain' : 'cover', objectPosition: esCutout ? 'bottom center' : `${photoOff.x}% ${photoOff.y}%`, transform: esCutout ? 'none' : `scale(${photoScale})`, transformOrigin: `${photoOff.x}% ${photoOff.y}%`, filter: esCutout ? 'drop-shadow(0 4px 14px rgba(0,0,0,0.6))' : 'none', willChange: 'transform', pointerEvents: 'none', userSelect: 'none' }}/>
      ) : (
        <div style={{ width: '100%', height: '100%', background: `${tema.h2}80`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg viewBox="0 0 60 80" width="50%" height="50%"><circle cx="30" cy="22" r="14" fill="rgba(255,255,255,0.2)"/><path d="M 4 80 Q 4 52 30 48 Q 56 52 56 80 Z" fill="rgba(255,255,255,0.2)"/></svg></div>
      )}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, transparent 55%, #0b1120 100%)', pointerEvents: 'none' }}/>
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '45%', background: 'linear-gradient(0deg, rgba(11,17,32,0.92) 0%, transparent 100%)', pointerEvents: 'none' }}/>
      <div style={{ position: 'absolute', bottom: 10, left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, pointerEvents: 'none' }}>
        {logoEl(18)}
        <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: 6.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'center', padding: '0 6px' }}>{(empresaDisplay || '').toUpperCase()}</p>
      </div>
      {!viewOnly && fotoMostrada && <div style={{ position: 'absolute', top: 6, right: 6, width: 18, height: 18, borderRadius: '50%', background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}><svg width="10" height="10" viewBox="0 0 11 11" fill="none"><path d="M5.5 1v9M1 5.5h9M3 3l-2 2.5 2 2.5M8 3l2 2.5-2 2.5" stroke="rgba(255,255,255,0.75)" strokeWidth="1.2" strokeLinecap="round"/></svg></div>}
    </div>
  );

  const photoZoneV = (
    // Vertical: columna lateral izquierda 38%, sin overlay de nombre
    <div ref={photoContRef} style={{ width: '38%', flexShrink: 0, position: 'relative', overflow: 'hidden', pointerEvents: (fotoMostrada && !viewOnly) ? 'auto' : 'none', touchAction: viewOnly ? 'auto' : 'none' }}>
      {quitandoFondo && <div style={{ position: 'absolute', inset: 0, zIndex: 5, background: 'rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3 }}><RefreshCw size={16} className="animate-spin" style={{ color: tema.accent }}/><p style={{ color: '#fff', fontSize: 9, fontWeight: 900 }}>{progFondo}%</p></div>}
      {fotoMostrada ? (
        <img src={fotoMostrada} alt="Foto" draggable={false} style={{ width: '100%', height: '100%', objectFit: esCutout ? 'contain' : 'cover', objectPosition: esCutout ? 'bottom center' : `${photoOff.x}% ${photoOff.y}%`, transform: esCutout ? 'none' : `scale(${photoScale})`, transformOrigin: `${photoOff.x}% ${photoOff.y}%`, filter: esCutout ? 'drop-shadow(0 4px 14px rgba(0,0,0,0.6))' : 'none', willChange: 'transform', pointerEvents: 'none', userSelect: 'none' }}/>
      ) : (
        <div style={{ width: '100%', height: '100%', background: `linear-gradient(180deg, ${tema.h2}60, ${tema.h1}90)`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <svg viewBox="0 0 60 80" width="55%" height="auto"><circle cx="30" cy="22" r="14" fill="rgba(255,255,255,0.18)"/><path d="M 4 80 Q 4 52 30 48 Q 56 52 56 80 Z" fill="rgba(255,255,255,0.18)"/></svg>
          {!viewOnly && <p style={{ color: 'rgba(255,255,255,0.25)', fontSize: 7, fontWeight: 700, textTransform: 'uppercase', textAlign: 'center', padding: '0 6px', letterSpacing: '0.1em' }}>Sin foto</p>}
        </div>
      )}
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 24, background: `linear-gradient(90deg, transparent, ${bg})`, pointerEvents: 'none' }}/>
      {!viewOnly && fotoMostrada && <div style={{ position: 'absolute', top: 6, left: 6, width: 18, height: 18, borderRadius: '50%', background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}><svg width="10" height="10" viewBox="0 0 11 11" fill="none"><path d="M5.5 1v9M1 5.5h9M3 3l-2 2.5 2 2.5M8 3l2 2.5-2 2.5" stroke="rgba(255,255,255,0.75)" strokeWidth="1.2" strokeLinecap="round"/></svg></div>}
    </div>
  );

  // Stripes decorativas
  const stripeTop = <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${tema.h2}, ${tema.accent}, ${tema.h2})`, pointerEvents: 'none' }}/>;
  const stripeBot = <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 4, background: `linear-gradient(90deg, ${tema.h2}, ${tema.accent}80, ${tema.h2})`, pointerEvents: 'none' }}/>;

  return (
    <div className="flex flex-col gap-3">

      <div className="relative" style={{ width: '100%' }}>

        {/* Perspectiva 3D */}
        <div style={{ perspective: '1200px' }}>
          <div
            onMouseMove={onCardMouseMove}
            style={{
              position: 'relative', width: '100%',
              height: isH ? 'min(500px, calc(100svw * 1.19))' : 'min(calc(100svh - 180px), 480px)',
              transformStyle: 'preserve-3d',
              transition: 'transform 0.75s cubic-bezier(0.4, 0, 0.2, 1)',
              transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
              touchAction: 'none',
              borderRadius: 12,
            }}
          >

            {/* ══ FRENTE — template único ══ */}
            {isH ? (
              // Horizontal: foto izq | datos der
              <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden', borderRadius: 12, overflow: 'hidden', background: bg, display: 'flex' } as React.CSSProperties}>
                {photoZoneH}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '18px 16px 14px' }}>
                  <p style={{ color: tema.accent, fontSize: 7, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 4 }}>{credTitulo}</p>
                  <p style={{ color: '#fff', fontSize: 19, fontWeight: 800, lineHeight: 1.2, marginBottom: 2 }}>{apellidoNombre || nombre || '—'}</p>
                  <p style={{ color: `${tema.accent}cc`, fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>{empData.category || 'Vigilador'}</p>
                  <div style={{ height: 0.5, background: `${tema.accent}22`, marginBottom: 10 }}/>
                  {dataFields()}
                  <div style={{ height: 0.5, background: `${tema.accent}22`, margin: '10px 0' }}/>
                  {verSection()}
                  <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10 }}>
                    {qrBtn()}
                    <p style={{ color: 'rgba(255,255,255,0.22)', fontSize: 7 }}>Válida 12/2026</p>
                  </div>
                </div>
                {stripeTop}
              </div>
            ) : (
              // Vertical: header compacto + [foto | datos] side-by-side + footer QR
              <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden', borderRadius: 12, overflow: 'hidden', background: bg, display: 'flex', flexDirection: 'column' } as React.CSSProperties}>
                {/* Header */}
                <div style={{ padding: '11px 14px 9px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, borderBottom: `1px solid ${tema.accent}20` }}>
                  {logoEl(24)}
                  <div style={{ minWidth: 0 }}>
                    <p style={{ color: '#fff', fontSize: 14, fontWeight: 900, letterSpacing: '0.02em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{(empresaDisplay || 'SEGURIDAD PRIVADA').toUpperCase()}</p>
                    <p style={{ color: `${tema.accent}bb`, fontSize: 7, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{credTitulo}</p>
                  </div>
                </div>
                {/* Cuerpo: foto izq + datos der */}
                <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
                  {photoZoneV}
                  {/* Columna de datos */}
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '14px 14px 10px 10px', minWidth: 0 }}>
                    <div style={{ marginBottom: 10 }}>
                      <p style={{ color: '#fff', fontSize: 15, fontWeight: 900, lineHeight: 1.25, wordBreak: 'break-word' }}>{apellidoNombre || nombre || '—'}</p>
                      <p style={{ color: tema.accent, fontSize: 7.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 3 }}>{empData.category || 'Vigilador'}</p>
                    </div>
                    <div style={{ height: 0.5, background: `${tema.accent}22`, marginBottom: 10 }}/>
                    {empData.fileNumber && (
                      <div style={{ marginBottom: 7 }}>
                        <p style={{ color: 'rgba(255,255,255,0.38)', fontSize: 7, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 1 }}>Legajo</p>
                        <p style={{ color: '#fff', fontSize: 17, fontWeight: 800, fontFamily: 'monospace', lineHeight: 1 }}>#{empData.fileNumber}</p>
                      </div>
                    )}
                    {empData.dni && (
                      <div style={{ marginBottom: 7 }}>
                        <p style={{ color: 'rgba(255,255,255,0.38)', fontSize: 7, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 1 }}>DNI</p>
                        <p style={{ color: '#fff', fontSize: 17, fontWeight: 800, fontFamily: 'monospace', lineHeight: 1 }}>{empData.dni}</p>
                      </div>
                    )}
                    {empData.cuil && (
                      <div style={{ marginBottom: 6 }}>
                        <p style={{ color: 'rgba(255,255,255,0.38)', fontSize: 7, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 1 }}>CUIL</p>
                        <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>{empData.cuil}</p>
                      </div>
                    )}
                    <div style={{ marginTop: 'auto' }}>
                      <div style={{ height: 0.5, background: `${tema.accent}22`, marginBottom: 8 }}/>
                      {verSection()}
                    </div>
                  </div>
                </div>
                {/* Footer */}
                <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 14px 9px', borderTop: `1px solid ${tema.accent}18` }}>
                  {credPie ? (
                    <div>
                      <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 6.5, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 1 }}>Sector</p>
                      <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 9, fontWeight: 700 }}>{credPie}</p>
                    </div>
                  ) : <div/>}
                  {qrBtn()}
                </div>
                {stripeTop}
                {stripeBot}
              </div>
            )}

            {/* ══ DORSO — QR ══ */}
            <div style={{
              position: 'absolute', inset: 0,
              backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden',
              transform: 'rotateY(180deg)', borderRadius: 12, overflow: 'hidden',
              background: `linear-gradient(158deg, ${tema.h1} 0%, #0c1a28 42%, ${tema.h2}bb 100%)`,
              pointerEvents: flipped ? 'auto' : 'none',
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

          </div>{/* flipper */}
        </div>{/* perspectiva */}

        {/* Controles foto — solo en modo edición (no viewOnly) */}
        {!viewOnly && (
          <div className="flex gap-2 mt-3 px-1">
            {fotoMostrada && (
              <div className="flex items-center gap-1 rounded-xl px-2 py-1.5 shrink-0" style={{ background: '#1e293b', border: '1px solid #334155' }}>
                <button
                  onClick={() => setPhotoScale(photoScaleRef.current - 0.15)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-white font-black text-base active:scale-90 transition-all"
                  style={{ background: '#334155' }}
                >−</button>
                <span className="text-slate-400 text-xs font-bold w-10 text-center tabular-nums">
                  {Math.round(photoScale * 100)}%
                </span>
                <button
                  onClick={() => setPhotoScale(photoScaleRef.current + 0.15)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-white font-black text-base active:scale-90 transition-all"
                  style={{ background: '#334155' }}
                >+</button>
              </div>
            )}

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
        {(capturedBlob || (!credGuardada && !viewOnly)) && (
          <button onClick={guardarFoto} disabled={guardando} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-black disabled:opacity-50 transition-all active:scale-95 text-white" style={{ background: `linear-gradient(135deg, ${tema.h1}, ${tema.h2})` }}>
            {guardando ? <RefreshCw size={14} className="animate-spin"/> : <ShieldCheck size={14}/>}
            {credGuardada ? 'Guardar foto' : 'Activar QR'}
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
              <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} viewBox="0 0 100 100" preserveAspectRatio="none">
                <defs>
                  <mask id="carnet-mask">
                    <rect x="0" y="0" width="100" height="100" fill="white"/>
                    <ellipse cx="50" cy="46" rx="36" ry="44" fill="black"/>
                  </mask>
                </defs>
                <rect x="0" y="0" width="100" height="100" fill="rgba(0,0,0,0.72)" mask="url(#carnet-mask)"/>
              </svg>
              <svg style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -54%)', pointerEvents: 'none' }} width="230" height="280" viewBox="0 0 230 280">
                <ellipse cx="115" cy="128" rx="112" ry="125" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="2" strokeDasharray="12 6"/>
                <line x1="0" y1="85" x2="40" y2="85" stroke="rgba(255,255,255,0.45)" strokeWidth="1.5" strokeDasharray="5 4"/>
                <line x1="190" y1="85" x2="230" y2="85" stroke="rgba(255,255,255,0.45)" strokeWidth="1.5" strokeDasharray="5 4"/>
                <path d="M 0 36 L 0 8 L 30 8" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M 230 36 L 230 8 L 200 8" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M 0 244 L 0 272 L 30 272" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M 230 244 L 230 272 L 200 272" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              {countdown === null && (
                <div style={{ position: 'absolute', bottom: 148, left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
                  <div style={{ background: `${tema.h1}ee`, borderRadius: 20, padding: '7px 18px' }}>
                    <p className="text-white text-[11px] font-bold text-center">Encuadrá el rostro · Mirá a cámara</p>
                  </div>
                </div>
              )}
              {countdown !== null && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.35)' }}>
                  <p style={{ fontSize: 140, fontWeight: 900, color: '#fff', lineHeight: 1, textShadow: `0 0 40px ${tema.accent}, 0 4px 16px rgba(0,0,0,0.8)` }}>
                    {countdown}
                  </p>
                </div>
              )}
            </div>
          </div>
          <div className="pb-12 pt-5 flex justify-center" style={{ background: tema.h1 }}>
            <button
              onClick={countdown === null ? iniciarContador : undefined}
              disabled={countdown !== null}
              style={{ width: 76, height: 76, background: '#ffffff', border: `4px solid ${tema.accent}`, boxShadow: `0 0 0 8px ${tema.accent}30`, borderRadius: '50%', opacity: countdown !== null ? 0.5 : 1 }}
              className="active:scale-90 transition-transform"
            />
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
