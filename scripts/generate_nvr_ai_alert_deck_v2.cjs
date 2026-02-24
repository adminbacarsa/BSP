/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { format } = require('date-fns');

// Deck 16:9 (pt). 960x540pt ≈ presentación.
const DECK_SIZE = [960, 540];

const OUTPUT_PATH = path.resolve(__dirname, '..', 'docs', 'NVR_AI_Alert_System_PRESENTACION_V2.pdf');

const FALLBACK_DASHBOARD_SCREENSHOT_PATH =
  'C:/Users/Soporte/.cursor/projects/d-APP-cronoapp/assets/c__Users_Soporte_AppData_Roaming_Cursor_User_workspaceStorage_f1aa913d1980e0da8bf451f071ef0f56_images_image-61cd2281-058d-4497-84f5-578c3d284088.png';

function ensureDirExists(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function resolveDashboardScreenshotPath() {
  const candidateRepo = path.resolve(__dirname, '..', 'assets', 'centro_control_dashboard.png');
  if (fs.existsSync(candidateRepo)) return candidateRepo;
  if (fs.existsSync(FALLBACK_DASHBOARD_SCREENSHOT_PATH)) return FALLBACK_DASHBOARD_SCREENSHOT_PATH;
  return null;
}

function withOpacity(doc, opacity, fn) {
  doc.save();
  doc.fillOpacity(opacity);
  doc.strokeOpacity(opacity);
  fn();
  doc.restore();
}

function drawBackground(doc) {
  const { width, height } = doc.page;

  // Base
  doc.save();
  doc.rect(0, 0, width, height).fill('#0b1220');

  // Subtle layered panels (fake gradient)
  withOpacity(doc, 0.15, () => {
    doc.roundedRect(-120, -60, width + 240, height * 0.55, 40).fill('#1e293b');
  });
  withOpacity(doc, 0.10, () => {
    doc.roundedRect(-80, height * 0.38, width + 160, height * 0.75, 60).fill('#111827');
  });

  // Accent blobs
  withOpacity(doc, 0.22, () => {
    doc.circle(width * 0.88, height * 0.20, 120).fill('#4f46e5'); // indigo
  });
  withOpacity(doc, 0.18, () => {
    doc.circle(width * 0.12, height * 0.78, 140).fill('#10b981'); // emerald
  });

  // Top brand bar
  withOpacity(doc, 0.85, () => {
    doc.roundedRect(28, 22, width - 56, 44, 16).fill('#0f172a');
  });
  doc.restore();
}

function drawBrand(doc, { title, subtitle, slideNo, totalSlides }) {
  const { width } = doc.page;
  const left = 44;
  const top = 30;

  doc.save();
  doc.fillColor('#e2e8f0').fontSize(12).text('CronoApp · Centro de Control', left, top + 2, { width: width - 120 });
  doc.fillColor('#94a3b8').fontSize(10).text(subtitle || '', left, top + 20, { width: width - 120 });

  doc.fillColor('#cbd5e1').fontSize(10).text(`${slideNo}/${totalSlides}`, width - 90, top + 14, {
    width: 60,
    align: 'right',
  });

  // Divider line
  withOpacity(doc, 0.35, () => {
    doc.moveTo(44, 82).lineTo(width - 44, 82).lineWidth(1).stroke('#334155');
  });
  doc.restore();

  // Slide title
  doc.save();
  doc.fillColor('#e2e8f0').fontSize(34).text(title, 44, 104, { width: width - 88, lineGap: 2 });
  doc.restore();
}

function card(doc, { x, y, w, h, fill = '#0f172a', stroke = '#334155', shadow = true }) {
  doc.save();
  if (shadow) {
    withOpacity(doc, 0.25, () => {
      doc.roundedRect(x + 6, y + 8, w, h, 18).fill('#000000');
    });
  }
  withOpacity(doc, 0.92, () => {
    doc.lineWidth(1.2).strokeColor(stroke).fillColor(fill).roundedRect(x, y, w, h, 18).fillAndStroke();
  });
  doc.restore();
}

function cardTitle(doc, text, x, y, w) {
  doc.save();
  doc.fillColor('#e2e8f0').fontSize(16).text(text, x, y, { width: w });
  doc.restore();
}

function cardText(doc, text, x, y, w, size = 12, color = '#cbd5e1') {
  doc.save();
  doc.fillColor(color).fontSize(size).text(text, x, y, { width: w, lineGap: 3 });
  doc.restore();
}

function bulletList(doc, items, x, y, w) {
  const bulletX = x + 10;
  let cy = y;
  doc.save();
  doc.fillColor('#cbd5e1').fontSize(12);
  items.forEach((t) => {
    doc.circle(bulletX, cy + 7, 2.2).fill('#60a5fa');
    doc.fillColor('#cbd5e1').text(t, bulletX + 10, cy, { width: w - 20, lineGap: 3 });
    cy += 22;
  });
  doc.restore();
  return cy;
}

function pill(doc, { x, y, w, h, label, fill, stroke }) {
  doc.save();
  withOpacity(doc, 0.95, () => {
    doc.lineWidth(1.1).strokeColor(stroke).fillColor(fill).roundedRect(x, y, w, h, 999).fillAndStroke();
  });
  doc.fillColor('#0b1220').fontSize(12).text(label, x, y + 8, { width: w, align: 'center' });
  doc.restore();
}

function arrow(doc, { x1, y1, x2, y2, color = '#94a3b8' }) {
  doc.save();
  doc.strokeColor(color).lineWidth(2);
  doc.moveTo(x1, y1).lineTo(x2, y2).stroke();

  const angle = Math.atan2(y2 - y1, x2 - x1);
  const headLen = 10;
  const a1 = angle + Math.PI * 0.85;
  const a2 = angle - Math.PI * 0.85;
  doc
    .moveTo(x2, y2)
    .lineTo(x2 + headLen * Math.cos(a1), y2 + headLen * Math.sin(a1))
    .moveTo(x2, y2)
    .lineTo(x2 + headLen * Math.cos(a2), y2 + headLen * Math.sin(a2))
    .stroke();
  doc.restore();
}

function flowTimeline(doc, x, y, w) {
  // 6 steps timeline
  const steps = [
    { t: 'NVR IVS', c: '#38bdf8', s: '#0ea5e9', d: 'Detecta humano/vehículo\nPOST multipart con snapshot' },
    { t: 'Webhook', c: '#a78bfa', s: '#7c3aed', d: 'Parse multipart\nValida secreto\nResuelve objetivo/puesto' },
    { t: 'Storage', c: '#34d399', s: '#10b981', d: 'Guarda imagen\nalerts/YYYY-MM-DD/\nGenera image_url' },
    { t: 'Firestore', c: '#fbbf24', s: '#f59e0b', d: 'Crea alerts/{id}\nstatus=pending\nFuente de verdad' },
    { t: 'Router', c: '#fb7185', s: '#ef4444', d: 'Decide destinatarios\nGuardias en servicio\nFallback operador' },
    { t: 'Apps', c: '#22c55e', s: '#16a34a', d: 'Operador (MapView)\nGuardia (módulo)\nAcciones en tiempo real' },
  ];

  const stepW = w / steps.length;
  const nodeY = y + 28;
  const nodeR = 10;

  // line
  withOpacity(doc, 0.65, () => {
    doc.save();
    doc.strokeColor('#64748b').lineWidth(3);
    doc.moveTo(x + stepW / 2, nodeY).lineTo(x + w - stepW / 2, nodeY).stroke();
    doc.restore();
  });

  steps.forEach((s, i) => {
    const cx = x + stepW * i + stepW / 2;
    // node
    doc.save();
    withOpacity(doc, 0.95, () => doc.circle(cx, nodeY, nodeR).fill(s.c));
    withOpacity(doc, 0.75, () => doc.circle(cx, nodeY, nodeR + 6).stroke(s.s));
    doc.restore();

    // title
    doc.save();
    doc.fillColor('#e2e8f0').fontSize(12).text(s.t, cx - stepW / 2 + 8, nodeY - 34, {
      width: stepW - 16,
      align: 'center',
    });
    doc.restore();

    // description
    doc.save();
    doc.fillColor('#cbd5e1').fontSize(10).text(s.d, cx - stepW / 2 + 8, nodeY + 18, {
      width: stepW - 16,
      align: 'center',
      lineGap: 2,
    });
    doc.restore();

    if (i < steps.length - 1) {
      arrow(doc, { x1: cx + nodeR + 10, y1: nodeY, x2: cx + stepW - (nodeR + 10), y2: nodeY, color: '#94a3b8' });
    }
  });
}

function statePills(doc, x, y, w) {
  const items = [
    { label: 'pending', fill: '#fde68a', stroke: '#f59e0b' },
    { label: 'viewed (asignada)', fill: '#c7d2fe', stroke: '#4f46e5' },
    { label: 'resolved', fill: '#bbf7d0', stroke: '#16a34a' },
    { label: 'false_alarm', fill: '#fecaca', stroke: '#ef4444' },
  ];

  const gap = 16;
  const pillW = (w - gap * (items.length - 1)) / items.length;
  const h = 34;

  items.forEach((it, idx) => {
    const px = x + idx * (pillW + gap);
    pill(doc, { x: px, y, w: pillW, h, label: it.label, fill: it.fill, stroke: it.stroke });
    if (idx < items.length - 1) {
      arrow(doc, { x1: px + pillW + 4, y1: y + h / 2, x2: px + pillW + gap - 4, y2: y + h / 2, color: '#94a3b8' });
    }
  });
}

function slide(doc, ctx, render) {
  drawBackground(doc);
  drawBrand(doc, ctx);
  render();
}

function main() {
  ensureDirExists(OUTPUT_PATH);

  const doc = new PDFDocument({
    size: DECK_SIZE,
    margins: { top: 0, left: 0, right: 0, bottom: 0 },
    info: { Title: 'NVR AI Alert System (Presentación V2)', Author: 'CronoApp' },
  });
  const out = fs.createWriteStream(OUTPUT_PATH);
  doc.pipe(out);

  const today = format(new Date(), 'yyyy-MM-dd');
  const subtitle = `Firebase · Functions/Firestore/Storage/FCM · ${today}`;

  const totalSlides = 9;
  let n = 1;

  // Slide 1 - Portada
  slide(
    doc,
    { title: 'NVR AI Alert System → Firebase', subtitle, slideNo: n++, totalSlides },
    () => {
      const { width } = doc.page;
      card(doc, { x: 44, y: 190, w: width - 88, h: 250, fill: '#0f172a', stroke: '#334155' });
      cardTitle(doc, 'Resumen', 70, 214, width - 140);
      cardText(
        doc,
        'Cuando el NVR detecta un evento IVS (humano/vehículo), envía una foto por webhook. Firebase guarda la evidencia, crea una alerta "pending" y notifica en alta prioridad al Centro de Control y a los guardias en servicio del objetivo/puesto correspondiente. El guardia toma la alerta y la resuelve (o marca falsa alarma), quedando todo auditado.',
        70,
        246,
        width - 140,
        13,
        '#cbd5e1'
      );
      bulletList(doc, ['Evidencia (foto) + trazabilidad (estado/tiempo/notas).', 'Ruteo: notifica solo donde corresponde.', 'Centro de Control siempre visible (fallback).'], 70, 356, width - 140);
    }
  );

  doc.addPage();

  // Slide 2 - Flujo E2E
  slide(
    doc,
    { title: 'Flujo end-to-end (E2E)', subtitle, slideNo: n++, totalSlides },
    () => {
      const { width } = doc.page;
      card(doc, { x: 44, y: 190, w: width - 88, h: 290, fill: '#0f172a', stroke: '#334155' });
      cardTitle(doc, 'De evento IVS a acción en segundos', 70, 212, width - 140);
      flowTimeline(doc, 70, 236, width - 140);
    }
  );

  doc.addPage();

  // Slide 3 - Ruteo por objetivo/puesto
  slide(
    doc,
    { title: 'Ruteo por objetivo/puesto', subtitle, slideNo: n++, totalSlides },
    () => {
      const { width } = doc.page;
      const left = 44;
      const top = 188;
      const colW = (width - 88 - 24) / 2;

      card(doc, { x: left, y: top, w: colW, h: 292, fill: '#0f172a', stroke: '#4f46e5' });
      cardTitle(doc, '¿Qué objetivo es esta cámara?', left + 24, top + 22, colW - 48);
      cardText(
        doc,
        'Se configura una tabla de mapeo cámara → negocio para que el sistema funcione solo en objetivos habilitados y sepa a quién notificar.',
        left + 24,
        top + 54,
        colW - 48,
        12,
        '#cbd5e1'
      );
      bulletList(
        doc,
        ['Colección: camera_routes (o ivs_sources)', 'Clave: nvr_id + channel_id', 'Salida: objective_id + post_id', 'Flags: enabled / notify_operator / notify_guards'],
        left + 24,
        top + 132,
        colW - 48
      );

      card(doc, { x: left + colW + 24, y: top, w: colW, h: 292, fill: '#0f172a', stroke: '#10b981' });
      cardTitle(doc, 'Ejemplo de regla', left + colW + 48, top + 22, colW - 48);
      cardText(
        doc,
        'nvr_id: "NVR-ENTRADA"\nchannel_id: 2\ncamera_name: "Entrada Principal"\nobjective_id: "OBJ-001"\npost_id: "PUESTO-ENTRADA"\nenabled: true\nnotify_operator: true\nnotify_guards: true',
        left + colW + 48,
        top + 62,
        colW - 72,
        12,
        '#e2e8f0'
      );
    }
  );

  doc.addPage();

  // Slide 4 - Destinatarios (guardias en servicio)
  slide(
    doc,
    { title: 'Destinatarios: guardias “en servicio”', subtitle, slideNo: n++, totalSlides },
    () => {
      const { width } = doc.page;
      const left = 44;
      const top = 188;
      const colW = (width - 88 - 24) / 2;

      card(doc, { x: left, y: top, w: colW, h: 292, fill: '#0f172a', stroke: '#f59e0b' });
      cardTitle(doc, 'Estrategia A (base)', left + 24, top + 22, colW - 48);
      cardText(
        doc,
        'Derivar desde turnos: se consulta Firestore/turnos por objective_id/post_id y ventana horaria actual, filtrando por estado operativo (ej: PRESENT/ON_DUTY).',
        left + 24,
        top + 54,
        colW - 48,
        12,
        '#cbd5e1'
      );
      bulletList(doc, ['No requiere estructura nueva.', 'Depende de estado/horarios consistentes.', 'Bueno para primera versión.'], left + 24, top + 160, colW - 48);

      card(doc, { x: left + colW + 24, y: top, w: colW, h: 292, fill: '#0f172a', stroke: '#0ea5e9' });
      cardTitle(doc, 'Estrategia B (precisa)', left + colW + 48, top + 22, colW - 48);
      cardText(
        doc,
        'Presencia en tiempo real: active_assignments/{guardId} con objective_id/post_id + is_on_duty + last_seen. Ideal para reemplazos, rotaciones y disponibilidad.',
        left + colW + 48,
        top + 54,
        colW - 72,
        12,
        '#cbd5e1'
      );
      bulletList(
        doc,
        ['Más precisa y rápida.', 'Mejor para operación real.', 'Permite fallback inteligente por retén/supervisor.'],
        left + colW + 48,
        top + 160,
        colW - 72
      );
    }
  );

  doc.addPage();

  // Slide 5 - Estados
  slide(
    doc,
    { title: 'Estados de alerta (ciclo operativo)', subtitle, slideNo: n++, totalSlides },
    () => {
      const { width } = doc.page;
      card(doc, { x: 44, y: 190, w: width - 88, h: 290, fill: '#0f172a', stroke: '#334155' });
      cardTitle(doc, 'Modelo simple, tablero claro', 70, 212, width - 140);
      statePills(doc, 70, 262, width - 140);
      cardText(
        doc,
        'Regla recomendada: broadcast a guardias del objetivo/puesto + “first accept wins” (transacción). Si ya está asignada, el resto queda en solo lectura (“ya tomada”).',
        70,
        320,
        width - 140,
        13,
        '#cbd5e1'
      );
      bulletList(doc, ['pending: recién creada', 'viewed: tomada/asignada', 'resolved: resuelta con notas/tiempo', 'false_alarm: descartada auditable'], 70, 388, width - 140);
    }
  );

  doc.addPage();

  // Slide 6 - Notificación crítica
  slide(
    doc,
    { title: 'Notificación crítica (FCM)', subtitle, slideNo: n++, totalSlides },
    () => {
      const { width } = doc.page;
      const left = 44;
      const top = 188;
      const colW = (width - 88 - 24) / 2;

      card(doc, { x: left, y: top, w: colW, h: 292, fill: '#0f172a', stroke: '#ef4444' });
      cardTitle(doc, 'Comportamiento esperado', left + 24, top + 22, colW - 48);
      bulletList(
        doc,
        [
          'Alta prioridad: despierta y muestra UI.',
          'Android: channel critical_alerts (Importance.max).',
          'Sound: “alarm” (definido por el canal en app).',
          'Data: alertId + objective/post para deep-link.',
        ],
        left + 24,
        top + 70,
        colW - 48
      );

      card(doc, { x: left + colW + 24, y: top, w: colW, h: 292, fill: '#0f172a', stroke: '#334155' });
      cardTitle(doc, 'Fuente de verdad', left + colW + 48, top + 22, colW - 48);
      cardText(
        doc,
        'La notificación “dirige”, pero Firestore “manda”. La app siempre abre el detalle leyendo alerts/{alertId}. Esto permite reintentos sin romper estado.',
        left + colW + 48,
        top + 60,
        colW - 72,
        13,
        '#cbd5e1'
      );
      bulletList(doc, ['Si falla FCM, la alerta igual existe.', 'El operador la ve por onSnapshot.', 'Se puede reintentar el envío.'], left + colW + 48, top + 150, colW - 72);
    }
  );

  doc.addPage();

  // Slide 7 - Centro de Control (MapView) con captura
  slide(
    doc,
    { title: 'Centro de Control (Operador): MapView', subtitle, slideNo: n++, totalSlides },
    () => {
      const { width } = doc.page;
      const screenshot = resolveDashboardScreenshotPath();

      card(doc, { x: 44, y: 190, w: width - 88, h: 290, fill: '#0f172a', stroke: '#334155' });
      cardTitle(doc, 'Overlay de alertas + detalle con evidencia', 70, 212, width - 140);
      cardText(
        doc,
        'Recomendación: panel lateral (pending/viewed) + detalle con foto y acciones. El mapa aporta contexto por objetivo/ubicación (si existe).',
        70,
        242,
        width - 140,
        12,
        '#cbd5e1'
      );

      if (screenshot) {
        const imgX = 70;
        const imgY = 276;
        const imgW = width - 140;
        const imgH = 180;
        try {
          withOpacity(doc, 0.85, () => doc.roundedRect(imgX, imgY, imgW, imgH, 14).fill('#0b1220'));
          doc.image(screenshot, imgX + 8, imgY + 8, { fit: [imgW - 16, imgH - 16] });
          withOpacity(doc, 0.45, () => doc.roundedRect(imgX, imgY, imgW, imgH, 14).stroke('#334155'));
        } catch (e) {
          cardText(doc, 'No se pudo incrustar la captura. Guardala como assets/centro_control_dashboard.png y regenerá.', 70, 300, width - 140, 12, '#fca5a5');
        }
      } else {
        cardText(doc, 'Captura no encontrada. Guardala como assets/centro_control_dashboard.png y regenerá.', 70, 300, width - 140, 12, '#fca5a5');
      }
    }
  );

  doc.addPage();

  // Slide 8 - Guardia (módulo extra)
  slide(
    doc,
    { title: 'Guardia (Empleado): módulo de Alertas', subtitle, slideNo: n++, totalSlides },
    () => {
      const { width } = doc.page;
      const left = 44;
      const top = 188;
      const colW = (width - 88 - 24) / 2;

      card(doc, { x: left, y: top, w: colW, h: 292, fill: '#0f172a', stroke: '#10b981' });
      cardTitle(doc, 'Experiencia de usuario', left + 24, top + 22, colW - 48);
      bulletList(
        doc,
        ['Modal crítico con foto + datos.', 'Botón “Tomar” (asigna).', 'Resolver / Falsa alarma + notas.', 'Historial por guardia/objetivo.'],
        left + 24,
        top + 70,
        colW - 48
      );

      card(doc, { x: left + colW + 24, y: top, w: colW, h: 292, fill: '#0f172a', stroke: '#4f46e5' });
      cardTitle(doc, 'Regla anti-duplicación', left + colW + 48, top + 22, colW - 48);
      cardText(
        doc,
        'First accept wins: al tocar “Tomar”, la app ejecuta una transacción. Si assigned_guard está vacío, asigna; si ya existe, informa “ya tomada”.',
        left + colW + 48,
        top + 60,
        colW - 72,
        13,
        '#cbd5e1'
      );
      bulletList(doc, ['Evita 2 respuestas al mismo evento.', 'Permite broadcast a todos los guardias del puesto.', 'Operador siempre monitorea.'], left + colW + 48, top + 160, colW - 72);
    }
  );

  doc.addPage();

  // Slide 9 - Plan y próximos pasos
  slide(
    doc,
    { title: 'Próximos pasos (implementación)', subtitle, slideNo: n++, totalSlides },
    () => {
      const { width } = doc.page;
      card(doc, { x: 44, y: 190, w: width - 88, h: 290, fill: '#0f172a', stroke: '#334155' });
      cardTitle(doc, 'Checklist', 70, 212, width - 140);
      bulletList(
        doc,
        [
          '1) Crear camera_routes y cargar cámaras habilitadas (objective/post).',
          '2) Webhook HTTP multipart → Storage → Firestore (alerts).',
          '3) Router onCreate(alert) → resolver destinatarios → FCM.',
          '4) UI Operador: overlay en MapView + detalle de alerta.',
          '5) UI Guardia: módulo “Alertas” + modal crítico + acciones.',
          '6) Reglas Firestore + secreto webhook + dedupe/cooldown.',
        ],
        70,
        252,
        width - 140
      );
      cardText(doc, 'Siguiente deliverable recomendado: demo E2E con un POST simulado + una cámara real en modo piloto.', 70, 438, width - 140, 13, '#e2e8f0');
    }
  );

  doc.end();

  out.on('finish', () => console.log(`PDF V2 generado en: ${OUTPUT_PATH}`));
  out.on('error', (e) => {
    console.error('Error al escribir PDF:', e);
    process.exitCode = 1;
  });
}

main();

