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
  const [credModelo, setCredModelo]       = useState<string>('gradiente');
  const [verCode, setVerCode]             = useState('--- ---');
  const [verRemaining, setVerRemaining]   = useState(60);
  const [verPct, setVerPct]               = useState(100);
  const [countdown, setCountdown]         = useState<number | null>(null);
  const countdownRef                      = useRef<ReturnType<typeof setInterval> | null>(null);

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
          if (d.credencialModelo) setCredModelo(d.credencialModelo);
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
  // Obtiene blob de una URL (fallback canvas para URLs de Firebase Storage)
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
    const SC = 2;
    const CARD_W = 420;
    const isH = orientacion === 'horizontal';
    const CARD_H = isH ? 500 : 620;

    const cv = document.createElement('canvas');
    cv.width = CARD_W * SC; cv.height = CARD_H * SC;
    const ctx = cv.getContext('2d')!;
    ctx.scale(SC, SC);

    // ── helpers canvas ───────────────────────────────────────────────────────
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
        ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 12;
        ctx.drawImage(img, dx, dy, dw, dh);
        ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
        ctx.drawImage(img, dx, dy, dw, dh);
      } else {
        const sc = Math.max(w / img.naturalWidth, h / img.naturalHeight);
        const rW = img.naturalWidth * sc, rH = img.naturalHeight * sc;
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

    const drawVerCode = (x: number, startY: number, textDark = false, compact = false): number => {
      let y = startY;
      ctx.fillStyle = textDark ? '#64748b' : 'rgba(255,255,255,0.4)';
      ctx.font = '700 7px Arial'; ctx.textAlign = 'left';
      ctx.fillText('CÓDIGO DE VERIFICACIÓN', x, y); y += 12;
      if (compact) {
        ctx.fillStyle = textDark ? '#0f172a' : '#ffffff';
        ctx.font = '800 16px monospace'; ctx.fillText(verCode, x, y);
        const barX = x + 105;
        ctx.fillStyle = textDark ? '#e2e8f0' : 'rgba(255,255,255,0.12)';
        rr(barX, y - 10, 42, 2, 1); ctx.fill();
        const fw = 42 * (verPct / 100);
        if (fw > 0) { ctx.fillStyle = textDark ? tema.accent : 'rgba(255,255,255,0.38)'; rr(barX, y - 10, fw, 2, 1); ctx.fill(); }
        ctx.fillStyle = textDark ? '#94a3b8' : 'rgba(255,255,255,0.33)'; ctx.font = '7px Arial';
        ctx.fillText(`0:${verRemaining.toString().padStart(2, '0')}`, barX + 48, y - 4);
        return y + 10;
      }
      ctx.fillStyle = textDark ? '#0f172a' : '#ffffff';
      ctx.font = '800 22px monospace'; ctx.fillText(verCode, x, y); y += 10;
      ctx.fillStyle = textDark ? '#e2e8f0' : 'rgba(255,255,255,0.12)';
      rr(x, y, 52, 2, 1); ctx.fill();
      const fw = 52 * (verPct / 100);
      if (fw > 0) { ctx.fillStyle = textDark ? tema.accent : 'rgba(255,255,255,0.38)'; rr(x, y, fw, 2, 1); ctx.fill(); }
      ctx.fillStyle = textDark ? '#94a3b8' : 'rgba(255,255,255,0.33)'; ctx.font = '7.5px Arial';
      ctx.fillText(`Se actualiza en 0:${verRemaining.toString().padStart(2, '0')}`, x + 58, y + 2);
      return y + 14;
    };

    const drawFields = (x: number, startY: number, maxRight: number, textDark = false): number => {
      const flds: { label: string; val: string }[] = [];
      if (empData.fileNumber) flds.push({ label: 'Legajo', val: `#${empData.fileNumber}` });
      if (empData.dni)        flds.push({ label: 'DNI',    val: empData.dni });
      if (empData.cuil)       flds.push({ label: 'CUIL',   val: empData.cuil });
      if (credPie)            flds.push({ label: 'Sector', val: credPie });
      let fx = x, y = startY;
      for (const f of flds) {
        ctx.fillStyle = textDark ? '#64748b' : 'rgba(255,255,255,0.38)';
        ctx.font = '7px Arial'; ctx.textAlign = 'left'; ctx.fillText(f.label.toUpperCase(), fx, y);
        ctx.fillStyle = textDark ? '#1e293b' : 'rgba(255,255,255,0.82)';
        ctx.font = 'bold 11px monospace'; ctx.fillText(f.val, fx, y + 11);
        fx += 65;
        if (fx + 50 > maxRight) { fx = x; y += 26; }
      }
      return y + (flds.length > 0 ? 20 : 0);
    };

    const drawChip = (x: number, y: number) => {
      const g = ctx.createLinearGradient(x, y, x + 32, y + 23);
      g.addColorStop(0, '#c6901c'); g.addColorStop(0.26, '#efc848');
      g.addColorStop(0.5, '#a67010'); g.addColorStop(0.72, '#f5d86c'); g.addColorStop(1, '#c6901c');
      ctx.fillStyle = g; rr(x, y, 32, 23, 4); ctx.fill();
      ctx.strokeStyle = '#9e6e0e'; ctx.lineWidth = 1; rr(x, y, 32, 23, 4); ctx.stroke();
      ctx.strokeStyle = 'rgba(80,44,0,0.28)'; ctx.lineWidth = 0.8;
      for (const t of [5, 10, 16, 20]) { ctx.beginPath(); ctx.moveTo(x + 3, y + t); ctx.lineTo(x + 29, y + t); ctx.stroke(); }
    };

    // ── TEMPLATE: GRADIENTE ─────────────────────────────────────────────────
    if (credModelo === 'gradiente') {
      ctx.save(); rr(0, 0, CARD_W, CARD_H, 12); ctx.clip();
      const bg = ctx.createLinearGradient(CARD_W * 0.35, 0, 0, CARD_H);
      bg.addColorStop(0, tema.h1); bg.addColorStop(0.55, tema.h2); bg.addColorStop(1, hslToHex(credHue, 50, 28));
      ctx.fillStyle = bg; ctx.fillRect(0, 0, CARD_W, CARD_H);
      ctx.save(); ctx.globalAlpha = 0.018; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
      for (let xi = -CARD_H; xi < CARD_W + CARD_H; xi += 8) { ctx.beginPath(); ctx.moveTo(xi, 0); ctx.lineTo(xi + CARD_H, CARD_H); ctx.stroke(); }
      ctx.restore();

      if (isH) {
        const LC = 130;
        ctx.fillStyle = `${tema.h2}88`; ctx.fillRect(0, 0, LC, CARD_H);
        ctx.strokeStyle = `${tema.accent}30`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(LC, 0); ctx.lineTo(LC, CARD_H); ctx.stroke();
        await drawLogo(LC / 2 - 11, 16, 20);
        await drawPhoto((LC - 90) / 2, (CARD_H - 110) / 2, 90, 110, 6);
        const RX = LC + 18; let y = 16;
        ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.font = '700 7px Arial'; ctx.textAlign = 'left';
        ctx.fillText(credTitulo.toUpperCase(), RX, y); y += 14;
        ctx.fillStyle = '#fff'; ctx.font = '900 17px Arial'; ctx.fillText(apellidoNombre || nombre || '—', RX, y); y += 14;
        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '700 8px Arial';
        ctx.fillText((empData.category || 'Vigilador').toUpperCase(), RX, y); y += 16;
        ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(RX, y); ctx.lineTo(CARD_W - 18, y); ctx.stroke(); y += 10;
        y = drawFields(RX, y, CARD_W - 18);
        ctx.beginPath(); ctx.moveTo(RX, y); ctx.lineTo(CARD_W - 18, y); ctx.stroke(); y += 10;
        drawVerCode(RX, y);
        const FY = CARD_H - 40;
        drawChip(RX, FY);
        ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.font = '7px Arial'; ctx.textAlign = 'right';
        ctx.fillText('Válida 12/2026', CARD_W - 18, FY + 16); ctx.textAlign = 'left';
      } else {
        const PW = 148, PH = 230, PAD = 16;
        const TR = CARD_W - PW - 10;
        let y = 15;
        const lw = await drawLogo(PAD, y, 24);
        ctx.fillStyle = '#fff'; ctx.font = '900 12px Arial'; ctx.textAlign = 'left';
        ctx.fillText((empresaDisplay || 'SEGURIDAD PRIVADA').toUpperCase().substring(0, 22), PAD + lw + 8, y + 11);
        ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.font = '700 7px Arial';
        ctx.fillText(credTitulo.toUpperCase(), PAD + lw + 8, y + 23); y += 40;
        ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(TR, y); ctx.stroke(); y += 14;
        ctx.fillStyle = '#fff'; ctx.font = '900 21px Arial'; ctx.fillText(apellidoNombre || nombre || '—', PAD, y); y += 20;
        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = 'bold 8px Arial';
        ctx.fillText((empData.category || 'Vigilador').toUpperCase(), PAD, y); y += 16;
        y = drawFields(PAD, y, TR);
        ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(TR, y); ctx.stroke(); y += 12;
        drawVerCode(PAD, y, false, true);
        const FOOTER_Y = CARD_H - 40;
        drawChip(PAD, FOOTER_Y);
        ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.font = '7px Arial'; ctx.textAlign = 'right';
        if (empData.fileNumber) ctx.fillText(`BSP-${empData.fileNumber}`, TR, FOOTER_Y + 10);
        ctx.fillText('Válida 12/2026', TR, FOOTER_Y + 20); ctx.textAlign = 'left';
        ctx.save(); rr(0, CARD_H - 4, CARD_W, 4, 0); ctx.clip();
        const bGrad = ctx.createLinearGradient(0, 0, CARD_W, 0);
        bGrad.addColorStop(0, `${tema.accent}70`); bGrad.addColorStop(0.5, 'rgba(255,255,255,0.35)'); bGrad.addColorStop(1, `${tema.accent}70`);
        ctx.fillStyle = bGrad; ctx.fillRect(0, CARD_H - 4, CARD_W, 4); ctx.restore();
        const photoStartY = 65;
        await drawPhoto(CARD_W - PW, photoStartY, PW - 6, Math.min(PH, CARD_H - photoStartY - 45), 7);
      }
      ctx.restore();
    }

    // ── TEMPLATE: CORPORATIVO ────────────────────────────────────────────────
    else if (credModelo === 'corporativo') {
      const hdr1 = '#111827', hdr2 = '#1e3a5f', PAD = 16;
      ctx.save(); rr(0, 0, CARD_W, CARD_H, 12); ctx.clip();
      const HDR_H = isH ? 52 : 58;
      const hdrGrad = ctx.createLinearGradient(0, 0, CARD_W, 0);
      hdrGrad.addColorStop(0, hdr1); hdrGrad.addColorStop(1, hdr2);
      ctx.fillStyle = hdrGrad; ctx.fillRect(0, 0, CARD_W, HDR_H);
      const accGrad = ctx.createLinearGradient(0, 0, CARD_W, 0);
      accGrad.addColorStop(0, tema.accent); accGrad.addColorStop(1, tema.h2);
      ctx.fillStyle = accGrad; ctx.fillRect(0, HDR_H, CARD_W, 3);
      const lw = await drawLogo(PAD, HDR_H / 2 - 13, 26);
      ctx.fillStyle = '#fff'; ctx.font = '900 11px Arial'; ctx.textAlign = 'left';
      ctx.fillText((empresaDisplay || 'SEGURIDAD PRIVADA').toUpperCase(), PAD + lw + 10, HDR_H / 2 - 2);
      ctx.fillStyle = tema.accent; ctx.font = '700 8px Arial';
      ctx.fillText(credTitulo.toUpperCase(), PAD + lw + 10, HDR_H / 2 + 10);
      ctx.fillStyle = '#f8fafc'; ctx.fillRect(0, HDR_H + 3, CARD_W, CARD_H - HDR_H - 3 - 12);

      if (isH) {
        const PW = 112, PH = 140;
        const photoY = HDR_H + 3 + (CARD_H - HDR_H - 3 - 12 - PH) / 2;
        await drawPhoto(PAD, photoY, PW, PH, 8);
        const RX = PAD + PW + 14; let y = HDR_H + 3 + 14;
        ctx.fillStyle = '#0f172a'; ctx.font = '900 17px Arial'; ctx.textAlign = 'left';
        ctx.fillText(apellidoNombre || nombre || '—', RX, y); y += 14;
        ctx.fillStyle = tema.accent; ctx.font = '700 8px Arial';
        ctx.fillText((empData.category || 'Vigilador').toUpperCase(), RX, y); y += 14;
        ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(RX, y); ctx.lineTo(CARD_W - PAD, y); ctx.stroke(); y += 10;
        y = drawFields(RX, y, CARD_W - PAD, true);
        ctx.beginPath(); ctx.moveTo(RX, y); ctx.lineTo(CARD_W - PAD, y); ctx.stroke(); y += 10;
        const vbH = 58;
        ctx.save(); rr(RX, y, CARD_W - RX - PAD, vbH, 8);
        const vbG = ctx.createLinearGradient(RX, 0, CARD_W, 0);
        vbG.addColorStop(0, hdr1); vbG.addColorStop(1, hdr2);
        ctx.fillStyle = vbG; ctx.fill(); ctx.restore();
        drawVerCode(RX + 10, y + 12);
        ctx.fillStyle = '#94a3b8'; ctx.font = '7px Arial'; ctx.textAlign = 'right';
        ctx.fillText('Válida 12/2026', CARD_W - PAD, CARD_H - 18); ctx.textAlign = 'left';
      } else {
        const PW = 118, PH = 152;
        const photoX = PAD, photoY = HDR_H + 3 + 16;
        await drawPhoto(photoX, photoY, PW, PH, 8);
        const NX = photoX + PW + 14;
        let y = HDR_H + 3 + 20;
        ctx.fillStyle = '#0f172a'; ctx.font = '900 20px Arial'; ctx.textAlign = 'left';
        ctx.fillText(apellidoNombre || nombre || '—', NX, y); y += 18;
        ctx.fillStyle = tema.accent; ctx.font = '700 8px Arial';
        ctx.fillText((empData.category || 'Vigilador').toUpperCase(), NX, y); y += 16;
        y = drawFields(NX, y, CARD_W - PAD, true);
        let bodyY = photoY + PH + 14;
        ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(PAD, bodyY); ctx.lineTo(CARD_W - PAD, bodyY); ctx.stroke(); bodyY += 12;
        const vbH = 44;
        ctx.save(); rr(PAD, bodyY, CARD_W - PAD * 2, vbH, 8);
        const vbG = ctx.createLinearGradient(PAD, 0, CARD_W - PAD, 0);
        vbG.addColorStop(0, hdr1); vbG.addColorStop(1, hdr2);
        ctx.fillStyle = vbG; ctx.fill(); ctx.restore();
        drawVerCode(PAD + 10, bodyY + 12, false, true); bodyY += vbH + 12;
        drawChip(PAD, bodyY);
        ctx.fillStyle = '#94a3b8'; ctx.font = '7px Arial'; ctx.textAlign = 'right';
        if (empData.fileNumber) ctx.fillText(`BSP-${empData.fileNumber}`, CARD_W - PAD, bodyY + 10);
        ctx.fillText('Válida 12/2026', CARD_W - PAD, bodyY + 20); ctx.textAlign = 'left';
      }
      const fGrad = ctx.createLinearGradient(0, 0, CARD_W, 0);
      fGrad.addColorStop(0, hdr1); fGrad.addColorStop(1, hdr2);
      ctx.fillStyle = fGrad; ctx.fillRect(0, CARD_H - 12, CARD_W, 12);
      ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.font = '7px Arial'; ctx.textAlign = 'center';
      ctx.fillText('SISTEMA COSP', CARD_W / 2, CARD_H - 4); ctx.textAlign = 'left';
      ctx.restore();
    }

    // ── TEMPLATE: PREMIUM DARK ───────────────────────────────────────────────
    else {
      const purp = '#6366f1', PAD = 16;
      ctx.save(); rr(0, 0, CARD_W, CARD_H, 12); ctx.clip();
      ctx.fillStyle = '#0d1117'; ctx.fillRect(0, 0, CARD_W, CARD_H);
      ctx.save(); ctx.globalAlpha = 0.04;
      for (let gx = 7; gx < CARD_W; gx += 14) {
        for (let gy = 7; gy < CARD_H; gy += 14) { ctx.beginPath(); ctx.arc(gx, gy, 0.8, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); }
      }
      ctx.restore();

      if (isH) {
        const LC = 140;
        const aG = ctx.createLinearGradient(0, 0, CARD_W, 0);
        aG.addColorStop(0, purp); aG.addColorStop(1, tema.accent);
        ctx.fillStyle = aG; ctx.fillRect(0, 0, CARD_W, 3);
        ctx.strokeStyle = `${purp}30`; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(LC, 3); ctx.lineTo(LC, CARD_H); ctx.stroke();
        await drawLogo(LC / 2 - 11, 14, 22);
        const PW = 100, PH = 120;
        const pX = (LC - PW) / 2, pY = (CARD_H - PH) / 2 + 8;
        ctx.save(); ctx.strokeStyle = `${purp}35`; ctx.lineWidth = 0.8;
        const pcx = pX + PW / 2, pcy = pY + PH / 2;
        ctx.translate(pcx, pcy); ctx.rotate(3 * Math.PI / 180); ctx.translate(-pcx, -pcy);
        rr(pX - 4, pY - 4, PW + 8, PH + 8, 8); ctx.stroke(); ctx.restore();
        await drawPhoto(pX, pY, PW, PH, 6);
        ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.font = '7px Arial'; ctx.textAlign = 'center';
        ctx.fillText((empresaDisplay || '').toUpperCase(), LC / 2, CARD_H - 14); ctx.textAlign = 'left';
        const RX = LC + 18; let y = 14;
        ctx.fillStyle = '#fff'; ctx.font = '900 17px Arial'; ctx.fillText(apellidoNombre || nombre || '—', RX, y); y += 14;
        ctx.fillStyle = purp; ctx.font = '700 8px Arial'; ctx.fillText((empData.category || 'Vigilador').toUpperCase(), RX, y); y += 16;
        const dpH = 58;
        ctx.save(); rr(RX, y, CARD_W - RX - PAD, dpH, 8);
        ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fill();
        ctx.strokeStyle = `${purp}25`; ctx.lineWidth = 0.5; ctx.stroke(); ctx.restore();
        drawFields(RX + 8, y + 10, CARD_W - PAD - 8); y += dpH + 8;
        const vpH = 60;
        ctx.save(); rr(RX, y, CARD_W - RX - PAD, vpH, 8);
        ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fill();
        ctx.strokeStyle = `${purp}20`; ctx.lineWidth = 0.5; ctx.stroke(); ctx.restore();
        drawVerCode(RX + 8, y + 12); y += vpH + 10;
        drawChip(RX, y);
        ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.font = '7px Arial'; ctx.textAlign = 'right';
        ctx.fillText('Válida 12/2026', CARD_W - PAD, y + 16); ctx.textAlign = 'left';
      } else {
        const PAD_L = PAD + 4;
        const aG = ctx.createLinearGradient(0, 0, 0, CARD_H);
        aG.addColorStop(0, purp); aG.addColorStop(1, tema.accent);
        ctx.fillStyle = aG; ctx.fillRect(0, 0, 4, CARD_H);
        let y = 14;
        const lw = await drawLogo(PAD_L, y, 24);
        ctx.fillStyle = purp; ctx.font = '900 11px Arial'; ctx.textAlign = 'left';
        ctx.fillText((empresaDisplay || 'SEGURIDAD PRIVADA').toUpperCase(), PAD_L + lw + 8, y + 9);
        ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.font = '7px Arial';
        ctx.fillText(credTitulo, PAD_L + lw + 8, y + 20); y += 40;
        ctx.strokeStyle = `${purp}22`; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(CARD_W - PAD, y); ctx.stroke(); y += 16;
        const PW = 130, PH = 168;
        ctx.save(); ctx.strokeStyle = `${purp}40`; ctx.lineWidth = 0.8;
        const pcx = PAD_L + PW / 2, pcy = y + PH / 2;
        ctx.translate(pcx, pcy); ctx.rotate(4 * Math.PI / 180); ctx.translate(-pcx, -pcy);
        rr(PAD_L - 5, y - 5, PW + 10, PH + 10, 9); ctx.stroke(); ctx.restore();
        await drawPhoto(PAD_L, y, PW, PH, 7);
        const NX = PAD_L + PW + 14;
        ctx.fillStyle = '#fff'; ctx.font = '900 21px Arial'; ctx.textAlign = 'left';
        ctx.fillText(apellidoNombre || nombre || '—', NX, y + 22);
        ctx.fillStyle = purp; ctx.font = '700 8px Arial';
        ctx.fillText((empData.category || 'Vigilador').toUpperCase(), NX, y + 36);
        drawFields(NX, y + 50, CARD_W - PAD); y += PH + 14;
        ctx.strokeStyle = `${purp}22`; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(CARD_W - PAD, y); ctx.stroke(); y += 12;
        y = drawVerCode(PAD_L, y, false, true);
        ctx.beginPath(); ctx.moveTo(PAD_L, y + 4); ctx.lineTo(CARD_W - PAD, y + 4); ctx.stroke(); y += 16;
        drawChip(PAD_L, y);
        ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.font = '7px Arial'; ctx.textAlign = 'right';
        ctx.fillText('Válida 12/2026', CARD_W - PAD, y + 16); ctx.textAlign = 'left';
      }
      ctx.restore();
    }

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

      <div className="relative mx-auto" style={{ maxWidth: 420, width: '100%' }}>

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
                position: 'relative', width: '100%', height: orientacion === 'horizontal' ? 500 : 620,
                transformStyle: 'preserve-3d',
                transition: 'transform 0.75s cubic-bezier(0.4, 0, 0.2, 1)',
                transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
                borderRadius: 12,
              }}
            >

              {/* ══ FRENTE ══ */}
              {(() => {
                // ── helpers compartidos ──────────────────────────────────────
                const logoEl = (h: number) => logoEmpresa ? (
                  <img src={logoEmpresa} alt="Logo" style={{ height: h, maxWidth: h * 3.5, objectFit: 'contain', filter: 'brightness(0) invert(1)', opacity: 0.9 }} onError={() => setLogoEmpresa(null)}/>
                ) : (
                  <div style={{ width: h, height: h, borderRadius: 4, background: `${tema.accent}25`, border: `1.5px solid ${tema.accent}50`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <ShieldCheck size={h * 0.55} strokeWidth={1.5} style={{ color: tema.accent }}/>
                  </div>
                );
                const dataFields = (dark = false, accent = tema.accent) => (
                  <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                    {empData.fileNumber && <div><p style={{ color: dark ? '#64748b' : 'rgba(255,255,255,0.38)', fontSize: 7, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Legajo</p><p style={{ color: dark ? '#1e293b' : 'rgba(255,255,255,0.82)', fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>#{empData.fileNumber}</p></div>}
                    {empData.dni && <div><p style={{ color: dark ? '#64748b' : 'rgba(255,255,255,0.38)', fontSize: 7, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>DNI</p><p style={{ color: dark ? '#1e293b' : 'rgba(255,255,255,0.82)', fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>{empData.dni}</p></div>}
                    {empData.cuil && <div><p style={{ color: dark ? '#64748b' : 'rgba(255,255,255,0.38)', fontSize: 7, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>CUIL</p><p style={{ color: dark ? '#1e293b' : 'rgba(255,255,255,0.82)', fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>{empData.cuil}</p></div>}
                    {credPie && <div><p style={{ color: dark ? '#64748b' : 'rgba(255,255,255,0.38)', fontSize: 7, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Sector</p><p style={{ color: dark ? '#1e293b' : 'rgba(255,255,255,0.82)', fontSize: 11, fontWeight: 700 }}>{credPie}</p></div>}
                  </div>
                );
                const verSection = (textDark = false, compact = false) => (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: compact ? 3 : 4 }}>
                      <svg width="9" height="9" viewBox="0 0 10 10" fill="none"><circle cx="5" cy="5" r="4" stroke={textDark ? '#64748b' : 'rgba(255,255,255,0.4)'} strokeWidth="1"/><path d="M5 3v2.5l1.5 1" stroke={textDark ? '#64748b' : 'rgba(255,255,255,0.4)'} strokeWidth="1" strokeLinecap="round"/></svg>
                      <p style={{ color: textDark ? '#64748b' : 'rgba(255,255,255,0.4)', fontSize: 7, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Código de verificación</p>
                    </div>
                    {compact ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <p style={{ color: textDark ? '#0f172a' : '#fff', fontSize: 16, fontWeight: 800, letterSpacing: '0.25em', fontFamily: 'monospace', lineHeight: 1 }}>{verCode}</p>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <div style={{ width: 42, height: 2, background: textDark ? '#e2e8f0' : 'rgba(255,255,255,0.12)', borderRadius: 1, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${verPct}%`, background: textDark ? tema.accent : 'rgba(255,255,255,0.38)', borderRadius: 1, transition: 'width 1s linear' }}/>
                          </div>
                          <p style={{ color: textDark ? '#94a3b8' : 'rgba(255,255,255,0.33)', fontSize: 7 }}>0:{verRemaining.toString().padStart(2, '0')}</p>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p style={{ color: textDark ? '#0f172a' : '#fff', fontSize: 22, fontWeight: 800, letterSpacing: '0.28em', fontFamily: 'monospace', lineHeight: 1, marginBottom: 5 }}>{verCode}</p>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <p style={{ color: textDark ? '#94a3b8' : 'rgba(255,255,255,0.33)', fontSize: 7.5 }}>Se actualiza en <span style={{ color: textDark ? '#475569' : 'rgba(255,255,255,0.62)', fontWeight: 700 }}>0:{verRemaining.toString().padStart(2, '0')}</span></p>
                          <div style={{ flex: 1, maxWidth: 52, height: 2, background: textDark ? '#e2e8f0' : 'rgba(255,255,255,0.12)', borderRadius: 1, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${verPct}%`, background: textDark ? tema.accent : 'rgba(255,255,255,0.38)', borderRadius: 1, transition: 'width 1s linear' }}/>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                );
                const chipEl = () => (
                  <div style={{ width: 32, height: 23, borderRadius: 4, flexShrink: 0, background: 'linear-gradient(135deg,#c6901c 0%,#efc848 26%,#a67010 50%,#f5d86c 72%,#c6901c 100%)', border: '1px solid #9e6e0e', boxShadow: '0 2px 5px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.28)', position: 'relative' }}>
                    {[5, 10, 16, 20].map((t, i) => <div key={i} style={{ position: 'absolute', top: t, left: 3, right: 3, height: 1, background: 'rgba(80,44,0,0.28)' }}/>)}
                  </div>
                );
                const qrBtn = (dark = false) => (
                  <button onClick={() => setFlipped(true)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 20, background: dark ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.1)', border: `1px solid ${dark ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.22)'}`, cursor: 'pointer' }}>
                    {qrDataUrl && <img src={qrDataUrl} alt="" style={{ width: 14, height: 14, opacity: 0.65, borderRadius: 2 }}/>}
                    <p style={{ color: dark ? '#475569' : 'rgba(255,255,255,0.65)', fontSize: 6.5, fontWeight: 900, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Ver QR</p>
                  </button>
                );
                const photoArea = (width: number, height: number, borderRadius = 6) => (
                  <div ref={photoContRef} style={{ width, height, borderRadius, overflow: 'hidden', flexShrink: 0, position: 'relative', pointerEvents: showEditUI ? 'auto' : 'none' }}>
                    {quitandoFondo && (
                      <div style={{ position: 'absolute', inset: 0, zIndex: 2, background: 'rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
                        <RefreshCw size={16} className="animate-spin" style={{ color: tema.accent }}/><p style={{ color: '#fff', fontSize: 9, fontWeight: 900 }}>{progFondo}%</p>
                      </div>
                    )}
                    {fotoMostrada ? (
                      <img src={fotoMostrada} alt="Foto" draggable={false} style={{ width: '100%', height: '100%', objectFit: esCutout ? 'contain' : 'cover', objectPosition: esCutout ? 'bottom center' : `${photoOff.x}% ${photoOff.y}%`, filter: esCutout ? 'drop-shadow(0 4px 14px rgba(0,0,0,0.6))' : 'none', pointerEvents: 'none', userSelect: 'none' }}/>
                    ) : (
                      <div style={{ width: '100%', height: '100%', background: `${tema.h2}80`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg viewBox="0 0 60 80" width={width * 0.55} height={height * 0.55}><circle cx="30" cy="22" r="14" fill="rgba(255,255,255,0.25)"/><path d="M 4 80 Q 4 52 30 48 Q 56 52 56 80 Z" fill="rgba(255,255,255,0.25)"/></svg>
                      </div>
                    )}
                  </div>
                );
                const holoOverlay = () => (
                  <>
                    <div style={{ position: 'absolute', inset: 0, borderRadius: 12, pointerEvents: 'none', overflow: 'hidden', backgroundImage: `repeating-linear-gradient(45deg,rgba(255,255,255,0.018) 0px,rgba(255,255,255,0.018) 1px,transparent 1px,transparent 8px)` }}/>
                    <div style={{ position: 'absolute', inset: 0, borderRadius: 12, pointerEvents: 'none', overflow: 'hidden', background: `radial-gradient(ellipse at ${holoPos.x}% ${holoPos.y}%, rgba(255,255,255,0.13) 0%, transparent 55%)`, transition: 'background 0.08s' }}/>
                    <div style={{ position: 'absolute', inset: 0, borderRadius: 12, pointerEvents: 'none', zIndex: 8, overflow: 'hidden', backgroundImage: `conic-gradient(from ${holoPos.x * 3.6}deg at ${holoPos.x}% ${holoPos.y}%, rgba(255,60,60,0.025),rgba(255,180,40,0.025),rgba(50,255,100,0.025),rgba(40,160,255,0.025),rgba(180,50,255,0.025),rgba(255,60,60,0.025))`, mixBlendMode: 'overlay' as React.CSSProperties['mixBlendMode'] }}/>
                  </>
                );

                // ── TEMPLATE: GRADIENTE ──────────────────────────────────────
                if (credModelo === 'gradiente') {
                  const isH = orientacion === 'horizontal';
                  const cardStyle: React.CSSProperties = {
                    position: 'absolute', inset: 0, backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden',
                    borderRadius: 12, overflow: 'hidden',
                    background: `linear-gradient(${isH ? '135deg' : '160deg'}, ${tema.h1} 0%, ${tema.h2} 55%, ${hslToHex(credHue, 50, 28)} 100%)`,
                  };
                  if (isH) return (
                    <div style={cardStyle as React.CSSProperties}>
                      {holoOverlay()}
                      <div style={{ display: 'flex', height: '100%' }}>
                        {/* Col izq: logo + foto */}
                        <div style={{ width: 130, background: `${tema.h2}88`, borderRight: `1px solid ${tema.accent}30`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '16px 12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{logoEl(20)}</div>
                          {photoArea(90, 110, 6)}
                        </div>
                        {/* Col der: datos */}
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '16px 18px' }}>
                          <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 7, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 2 }}>{credTitulo}</p>
                          <p style={{ color: '#fff', fontSize: 18, fontWeight: 900, lineHeight: 1.2, marginBottom: 2 }}>{apellidoNombre || nombre || '—'}</p>
                          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>{empData.category || 'Vigilador'}</p>
                          <div style={{ height: 0.5, background: 'rgba(255,255,255,0.15)', marginBottom: 10 }}/>
                          {dataFields()}
                          <div style={{ height: 0.5, background: 'rgba(255,255,255,0.15)', margin: '10px 0' }}/>
                          {verSection()}
                          <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10 }}>
                            {chipEl()}{qrBtn()}<p style={{ color: 'rgba(255,255,255,0.28)', fontSize: 7 }}>Válida 12/2026</p>
                          </div>
                        </div>
                      </div>
                      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 4, background: `linear-gradient(90deg,${tema.accent}70,rgba(255,255,255,0.35),${tema.accent}70)` }}/>
                    </div>
                  );
                  // vertical gradiente
                  const PHOTO_W = 148, PHOTO_H = 230;
                  return (
                    <div style={cardStyle as React.CSSProperties}>
                      {holoOverlay()}
                      {/* Header */}
                      <div style={{ padding: '15px 16px 12px', paddingRight: PHOTO_W + 10, borderBottom: '0.5px solid rgba(255,255,255,0.18)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {logoEl(24)}
                          <div style={{ minWidth: 0 }}>
                            <p style={{ color: '#fff', fontSize: 12, fontWeight: 900, letterSpacing: '0.03em', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{(empresaDisplay || 'SEGURIDAD PRIVADA').toUpperCase()}</p>
                            <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 7, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em' }}>{credTitulo}</p>
                          </div>
                        </div>
                      </div>
                      {/* Datos empleado */}
                      <div style={{ padding: '14px 16px 12px', paddingRight: PHOTO_W + 10, borderBottom: '0.5px solid rgba(255,255,255,0.14)' }}>
                        <p style={{ color: '#fff', fontSize: 21, fontWeight: 900, lineHeight: 1.2, marginBottom: 5 }}>{apellidoNombre || nombre || '—'}</p>
                        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 14 }}>{empData.category || 'Vigilador'}</p>
                        {dataFields()}
                      </div>
                      {/* Código verificación */}
                      <div style={{ padding: '12px 16px', paddingRight: PHOTO_W + 10, borderBottom: '0.5px solid rgba(255,255,255,0.14)' }}>
                        {verSection(false, true)}
                      </div>
                      {/* Pie */}
                      <div style={{ padding: '14px 16px', paddingRight: PHOTO_W + 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto' }}>
                        {chipEl()}{qrBtn()}<p style={{ color: 'rgba(255,255,255,0.28)', fontSize: 7, textAlign: 'right', lineHeight: 1.5 }}>{empData.fileNumber ? `BSP-${empData.fileNumber}` : ''}<br/>Válida 12/2026</p>
                      </div>
                      {/* Banda inferior */}
                      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 4, borderRadius: '0 0 12px 12px', background: `linear-gradient(90deg,${tema.accent}70,rgba(255,255,255,0.35),${tema.accent}70)` }}/>
                      {/* Foto zona derecha - vertical completa */}
                      <div style={{ position: 'absolute', top: 0, right: 0, width: PHOTO_W, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px 10px 12px 0', pointerEvents: 'none', zIndex: 20 }}>
                        {photoArea(PHOTO_W - 10, PHOTO_H, 7)}
                      </div>
                    </div>
                  );
                }

                // ── TEMPLATE: CORPORATIVO ────────────────────────────────────
                if (credModelo === 'corporativo') {
                  const isH = orientacion === 'horizontal';
                  const hdrBg = `linear-gradient(90deg,#111827,#1e3a5f)`;
                  const baseCard: React.CSSProperties = {
                    position: 'absolute', inset: 0, backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden',
                    borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column',
                  };
                  if (isH) return (
                    <div style={baseCard as React.CSSProperties}>
                      {/* Header strip */}
                      <div style={{ background: hdrBg, padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 10 }}>
                        {logoEl(24)}<div><p style={{ color: '#fff', fontSize: 12, fontWeight: 900 }}>{(empresaDisplay || 'SEGURIDAD PRIVADA').toUpperCase()}</p><p style={{ color: tema.accent, fontSize: 8, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{credTitulo}</p></div>
                      </div>
                      <div style={{ height: 3, background: `linear-gradient(90deg,${tema.accent},${tema.h2})` }}/>
                      {/* Body */}
                      <div style={{ flex: 1, background: '#f8fafc', display: 'flex', overflow: 'hidden' }}>
                        <div style={{ width: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }}>
                          {photoArea(112, 140, 8)}
                        </div>
                        <div style={{ flex: 1, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <div>
                            <p style={{ color: '#0f172a', fontSize: 18, fontWeight: 900, lineHeight: 1.2 }}>{apellidoNombre || nombre || '—'}</p>
                            <p style={{ color: tema.accent, fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 2 }}>{empData.category || 'Vigilador'}</p>
                          </div>
                          <div style={{ height: 0.5, background: '#e2e8f0' }}/>
                          {dataFields(true)}
                          <div style={{ height: 0.5, background: '#e2e8f0' }}/>
                          <div style={{ background: hdrBg, borderRadius: 8, padding: '8px 12px' }}>{verSection()}</div>
                        </div>
                        <div style={{ padding: '14px 14px 14px 6px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                          {qrBtn()}<p style={{ color: '#94a3b8', fontSize: 7 }}>Válida 12/2026</p>
                        </div>
                      </div>
                      {/* Footer */}
                      <div style={{ background: hdrBg, height: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 7, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Sistema COSP</p>
                      </div>
                    </div>
                  );
                  return (
                    <div style={baseCard as React.CSSProperties}>
                      {/* Header */}
                      <div style={{ background: hdrBg, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                        {logoEl(26)}<div><p style={{ color: '#fff', fontSize: 12, fontWeight: 900 }}>{(empresaDisplay || 'SEGURIDAD PRIVADA').toUpperCase()}</p><p style={{ color: tema.accent, fontSize: 7, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{credTitulo}</p></div>
                      </div>
                      <div style={{ height: 3, background: `linear-gradient(90deg,${tema.accent},${tema.h2})` }}/>
                      {/* Body */}
                      <div style={{ flex: 1, background: '#f8fafc', padding: '16px 16px 14px', display: 'flex', flexDirection: 'column', gap: 12, overflow: 'hidden' }}>
                        {/* Foto + nombre en fila */}
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                          {photoArea(118, 152, 8)}
                          <div style={{ flex: 1, paddingTop: 4 }}>
                            <p style={{ color: '#0f172a', fontSize: 20, fontWeight: 900, lineHeight: 1.2, marginBottom: 5 }}>{apellidoNombre || nombre || '—'}</p>
                            <p style={{ color: tema.accent, fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>{empData.category || 'Vigilador'}</p>
                            {dataFields(true)}
                          </div>
                        </div>
                        <div style={{ height: 0.5, background: '#e2e8f0' }}/>
                        <div style={{ background: hdrBg, borderRadius: 8, padding: '9px 12px' }}>{verSection(false, true)}</div>
                        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 }}>
                          {chipEl()}{qrBtn()}<p style={{ color: '#94a3b8', fontSize: 7, textAlign: 'right' }}>{empData.fileNumber ? `BSP-${empData.fileNumber}` : ''}<br/>Válida 12/2026</p>
                        </div>
                      </div>
                      <div style={{ background: hdrBg, height: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 7, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Sistema COSP</p>
                      </div>
                    </div>
                  );
                }

                // ── TEMPLATE: PREMIUM DARK ───────────────────────────────────
                {
                  const purp = '#6366f1';
                  const isH = orientacion === 'horizontal';
                  const baseCard: React.CSSProperties = {
                    position: 'absolute', inset: 0, backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden',
                    borderRadius: 12, overflow: 'hidden', background: '#0d1117', display: 'flex', flexDirection: isH ? 'row' : 'column',
                  };
                  if (isH) return (
                    <div style={baseCard as React.CSSProperties}>
                      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg,${purp},${tema.accent})`, zIndex: 1 }}/>
                      <div style={{ position: 'absolute', inset: 0, opacity: 0.04, backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '14px 14px' }}/>
                      {/* Foto izq */}
                      <div style={{ width: 140, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '16px 12px', borderRight: `0.5px solid ${purp}30` }}>
                        {logoEl(22)}
                        <div style={{ position: 'relative', width: 100, height: 120 }}>
                          <div style={{ position: 'absolute', inset: -4, border: `0.8px solid ${purp}35`, borderRadius: 8, transform: 'rotate(3deg)' }}/>
                          {photoArea(100, 120, 6)}
                        </div>
                        <p style={{ color: 'rgba(255,255,255,0.22)', fontSize: 7, textAlign: 'center', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{empresaDisplay}</p>
                      </div>
                      {/* Datos der */}
                      <div style={{ flex: 1, padding: '18px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div>
                          <p style={{ color: '#fff', fontSize: 17, fontWeight: 900, lineHeight: 1.2 }}>{apellidoNombre || nombre || '—'}</p>
                          <p style={{ color: purp, fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 2 }}>{empData.category || 'Vigilador'}</p>
                        </div>
                        <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: '10px 12px', border: `0.5px solid ${purp}25` }}>
                          {dataFields()}
                        </div>
                        <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '10px 12px', border: `0.5px solid ${purp}20` }}>
                          {verSection()}
                        </div>
                        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          {chipEl()}
                          <p style={{ color: 'rgba(255,255,255,0.22)', fontSize: 7 }}>Válida 12/2026</p>
                          {qrBtn()}
                        </div>
                      </div>
                    </div>
                  );
                  return (
                    <div style={baseCard as React.CSSProperties}>
                      {/* Acento izq */}
                      <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: 4, background: `linear-gradient(180deg,${purp},${tema.accent})`, zIndex: 1 }}/>
                      <div style={{ position: 'absolute', inset: 0, opacity: 0.04, backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '12px 12px' }}/>
                      {/* Header */}
                      <div style={{ padding: '14px 14px 12px 18px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: `0.5px solid ${purp}22` }}>
                        {logoEl(24)}<div style={{ flex: 1 }}><p style={{ color: purp, fontSize: 11, fontWeight: 900, letterSpacing: '0.04em' }}>{(empresaDisplay || 'SEGURIDAD PRIVADA').toUpperCase()}</p><p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 7 }}>{credTitulo}</p></div>
                        <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 8px #22c55e' }}/>
                      </div>
                      {/* Foto + nombre */}
                      <div style={{ padding: '16px 14px 14px 18px', display: 'flex', alignItems: 'flex-start', gap: 14, borderBottom: `0.5px solid ${purp}22` }}>
                        <div style={{ position: 'relative', flexShrink: 0 }}>
                          <div style={{ position: 'absolute', inset: -5, border: `0.8px solid ${purp}40`, borderRadius: 9, transform: 'rotate(4deg)' }}/>
                          {photoArea(130, 168, 7)}
                        </div>
                        <div style={{ flex: 1, paddingTop: 4 }}>
                          <p style={{ color: '#fff', fontSize: 21, fontWeight: 900, lineHeight: 1.2, marginBottom: 6 }}>{apellidoNombre || nombre || '—'}</p>
                          <p style={{ color: purp, fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14 }}>{empData.category || 'Vigilador'}</p>
                          {dataFields()}
                        </div>
                      </div>
                      {/* Verificación compacta */}
                      <div style={{ padding: '12px 14px 11px 18px', borderBottom: `0.5px solid ${purp}22` }}>
                        {verSection(false, true)}
                      </div>
                      {/* Pie */}
                      <div style={{ padding: '14px 14px 14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto' }}>
                        {chipEl()}{qrBtn()}<p style={{ color: 'rgba(255,255,255,0.22)', fontSize: 7 }}>Válida 12/2026</p>
                      </div>
                    </div>
                  );
                }
              })()}
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
