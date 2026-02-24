/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { format } = require('date-fns');

const OUTPUT_SPEC_PATH = path.resolve(__dirname, '..', 'docs', 'NVR_AI_Alert_System_Firebase.pdf');
const OUTPUT_DECK_PATH = path.resolve(__dirname, '..', 'docs', 'NVR_AI_Alert_System_Firebase_PRESENTACION.pdf');

const FALLBACK_DASHBOARD_SCREENSHOT_PATH =
  'C:/Users/Soporte/.cursor/projects/d-APP-cronoapp/assets/c__Users_Soporte_AppData_Roaming_Cursor_User_workspaceStorage_f1aa913d1980e0da8bf451f071ef0f56_images_image-61cd2281-058d-4497-84f5-578c3d284088.png';

function ensureDirExists(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function mm(n) {
  // PDFKit uses points (pt). 1 inch = 72pt. 1mm = 2.834645669pt
  return (n * 72) / 25.4;
}

function drawTitle(doc, title, subtitle) {
  doc
    .fontSize(22)
    .fillColor('#0f172a')
    .text(title, { align: 'left' })
    .moveDown(0.4);

  if (subtitle) {
    doc
      .fontSize(12)
      .fillColor('#475569')
      .text(subtitle, { align: 'left' })
      .moveDown(1.2);
  }
}

function drawH2(doc, text) {
  doc
    .moveDown(0.6)
    .fontSize(14)
    .fillColor('#0f172a')
    .text(text, { align: 'left' })
    .moveDown(0.3);
}

function drawP(doc, text) {
  doc
    .fontSize(10.5)
    .fillColor('#0f172a')
    .text(text, { align: 'left', lineGap: 2 });
}

function drawH1Slide(doc, title, subtitle) {
  const left = doc.page.margins.left;
  const top = doc.page.margins.top;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  doc.save();
  doc
    .fillColor('#0b1220')
    .roundedRect(left, top - mm(8), w, mm(22), 14)
    .fill();

  doc
    .fillColor('#e2e8f0')
    .fontSize(22)
    .text(title, left + mm(6), top - mm(2), { width: w - mm(12) });

  if (subtitle) {
    doc
      .fillColor('#94a3b8')
      .fontSize(12)
      .text(subtitle, left + mm(6), top + mm(8), { width: w - mm(12) });
  }
  doc.restore();

  doc.y = top + mm(22);
}

function drawCallout(doc, { title, body, color = '#4f46e5', fill = '#eef2ff' }) {
  const left = doc.page.margins.left;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const x = left;
  const y = doc.y;

  const padding = mm(5);
  const titleH = mm(6.5);
  const bodyFont = 10.5;
  const titleFont = 11.5;

  // Estimar alto por líneas (aprox). Suficiente para una “presentación”.
  const bodyLines = Math.max(2, Math.ceil((body.length || 0) / 95));
  const h = padding + titleH + padding + bodyLines * mm(5) + padding;

  drawBox(doc, { x, y, w, h, title, lines: [], color, fill });
  doc
    .fillColor('#0f172a')
    .fontSize(titleFont)
    .text(title, x + padding, y + padding, { width: w - padding * 2 });
  doc
    .fillColor('#334155')
    .fontSize(bodyFont)
    .text(body, x + padding, y + padding + titleH, { width: w - padding * 2, lineGap: 2 });

  doc.y = y + h + mm(4);
}

function drawBulletList(doc, items) {
  doc.fontSize(10.5).fillColor('#0f172a');
  const indent = mm(4);
  const bulletGap = mm(2.5);
  items.forEach((t) => {
    const x = doc.x;
    const y = doc.y;
    doc.circle(x + mm(1.2), y + mm(1.2), 1.5).fill('#334155');
    doc.fillColor('#0f172a').text(t, x + indent + bulletGap, y, {
      width: doc.page.width - doc.page.margins.left - doc.page.margins.right - (indent + bulletGap),
      lineGap: 2,
    });
    doc.moveDown(0.2);
  });
  doc.moveDown(0.4);
}

function drawBox(doc, { x, y, w, h, title, lines, color = '#4f46e5', fill = '#eef2ff' }) {
  doc
    .save()
    .lineWidth(1)
    .fillColor(fill)
    .strokeColor(color)
    .roundedRect(x, y, w, h, 10)
    .fillAndStroke();

  doc.fillColor('#0f172a').fontSize(10.5).text(title, x + mm(3), y + mm(2.5), {
    width: w - mm(6),
    align: 'left',
  });

  if (Array.isArray(lines) && lines.length > 0) {
    doc.fillColor('#334155').fontSize(8.8);
    const bodyY = y + mm(8);
    const bodyText = lines.join('\n');
    doc.text(bodyText, x + mm(3), bodyY, { width: w - mm(6), lineGap: 1.5 });
  }

  doc.restore();
}

function drawArrow(doc, { x1, y1, x2, y2, color = '#334155' }) {
  doc.save().strokeColor(color).lineWidth(1.2);
  doc.moveTo(x1, y1).lineTo(x2, y2).stroke();

  const angle = Math.atan2(y2 - y1, x2 - x1);
  const headLen = 8;
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

function drawFlowDiagram(doc) {
  drawH2(doc, 'Diagrama de Flujo: NVR → Firebase → Centro de Control / Guardias');

  const pageLeft = doc.page.margins.left;
  const pageTop = doc.y + mm(2);
  const usableW = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  const colW = (usableW - mm(8)) / 2;
  const boxH = mm(26);
  const gapY = mm(10);
  const gapX = mm(8);

  const leftX = pageLeft;
  const rightX = pageLeft + colW + gapX;

  const y1 = pageTop;
  const y2 = y1 + boxH + gapY;
  const y3 = y2 + boxH + gapY;
  const y4 = y3 + boxH + gapY;

  drawBox(doc, {
    x: leftX,
    y: y1,
    w: colW,
    h: boxH,
    title: '1) Dahua NVR (IVS)',
    lines: ['Detecta humano/vehículo', 'HTTP POST multipart/form-data', 'Snapshot + metadata'],
    color: '#0ea5e9',
    fill: '#ecfeff',
  });

  drawBox(doc, {
    x: rightX,
    y: y1,
    w: colW,
    h: boxH,
    title: '2) Cloud Function HTTP (Webhook)',
    lines: ['Parse multipart', 'Valida secreto (recomendado)', 'Resuelve objective/post por cámara'],
    color: '#4f46e5',
    fill: '#eef2ff',
  });

  drawBox(doc, {
    x: leftX,
    y: y2,
    w: colW,
    h: boxH,
    title: '3) Storage',
    lines: ["alerts/YYYY-MM-DD/<alertId>.jpg", 'Guarda imagen', 'Genera image_url'],
    color: '#16a34a',
    fill: '#ecfdf5',
  });

  drawBox(doc, {
    x: rightX,
    y: y2,
    w: colW,
    h: boxH,
    title: '4) Firestore (alerts)',
    lines: ['Doc: status=pending', 'timestamp=serverTimestamp', 'objective_id + post_id'],
    color: '#f59e0b',
    fill: '#fffbeb',
  });

  drawBox(doc, {
    x: leftX,
    y: y3,
    w: colW,
    h: boxH,
    title: '5) Router de Notificaciones (Trigger)',
    lines: ['onCreate(alert)', 'Encuentra guardias "en servicio"', 'Fallback si nadie activo'],
    color: '#7c3aed',
    fill: '#f5f3ff',
  });

  drawBox(doc, {
    x: rightX,
    y: y3,
    w: colW,
    h: boxH,
    title: '6) FCM High Priority',
    lines: ['Channel: critical_alerts', 'Sound: alarm', 'Envía a guard_tokens activos'],
    color: '#ef4444',
    fill: '#fef2f2',
  });

  drawBox(doc, {
    x: leftX,
    y: y4,
    w: colW,
    h: boxH,
    title: '7) App Guardia',
    lines: ['Modal crítico + imagen', 'Tomar (assigned_guard)', 'Resolver / Falsa alarma'],
    color: '#0f766e',
    fill: '#f0fdfa',
  });

  drawBox(doc, {
    x: rightX,
    y: y4,
    w: colW,
    h: boxH,
    title: '8) Centro de Control (Operador)',
    lines: ['Dashboard en tiempo real', 'MapView + overlay de alertas', 'Asignación opcional'],
    color: '#334155',
    fill: '#f8fafc',
  });

  // Arrows
  drawArrow(doc, { x1: leftX + colW, y1: y1 + boxH / 2, x2: rightX, y2: y1 + boxH / 2 });
  drawArrow(doc, { x1: rightX + colW / 2, y1: y1 + boxH, x2: rightX + colW / 2, y2: y2 });
  drawArrow(doc, { x1: rightX + colW / 2, y1: y2 + boxH, x2: leftX + colW / 2, y2: y3 });
  drawArrow(doc, { x1: leftX + colW, y1: y2 + boxH / 2, x2: rightX, y2: y2 + boxH / 2 });
  drawArrow(doc, { x1: leftX + colW, y1: y3 + boxH / 2, x2: rightX, y2: y3 + boxH / 2 });
  drawArrow(doc, { x1: rightX + colW / 2, y1: y3 + boxH, x2: leftX + colW / 2, y2: y4 });
  drawArrow(doc, { x1: rightX + colW / 2, y1: y3 + boxH, x2: rightX + colW / 2, y2: y4 });

  doc.moveDown(0.6);
  doc.y = y4 + boxH + mm(6);
}

function drawStateDiagram(doc) {
  drawH2(doc, 'Diagrama de Estados: ciclo de vida de una alerta');

  const left = doc.page.margins.left;
  const top = doc.y + mm(6);
  const usableW = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  const nodeW = mm(40);
  const nodeH = mm(18);
  const gapX = (usableW - nodeW * 2) / 3;
  const x1 = left + gapX;
  const x2 = left + gapX * 2 + nodeW;

  const yPending = top;
  const yViewed = yPending + mm(28);
  const yEnd = yViewed + mm(28);

  const node = (x, y, label, color, fill) => {
    drawBox(doc, { x, y, w: nodeW, h: nodeH, title: label, lines: [], color, fill });
  };

  node(x1, yPending, 'pending', '#f59e0b', '#fffbeb');
  node(x2, yViewed, 'viewed', '#4f46e5', '#eef2ff');
  node(x1, yEnd, 'resolved', '#16a34a', '#ecfdf5');
  node(x2, yEnd, 'false_alarm', '#ef4444', '#fef2f2');

  // arrows
  drawArrow(doc, { x1: x1 + nodeW / 2, y1: yPending + nodeH, x2: x2 + nodeW / 2, y2: yViewed, color: '#334155' });
  drawArrow(doc, { x1: x2 + nodeW / 2, y1: yViewed + nodeH, x2: x1 + nodeW / 2, y2: yEnd, color: '#334155' });
  drawArrow(doc, { x1: x2 + nodeW / 2, y1: yViewed + nodeH, x2: x2 + nodeW / 2, y2: yEnd, color: '#334155' });
  drawArrow(doc, { x1: x1 + nodeW / 2, y1: yPending + nodeH, x2: x1 + nodeW / 2, y2: yEnd, color: '#334155' });
  drawArrow(doc, { x1: x1 + nodeW / 2, y1: yPending + nodeH, x2: x2 + nodeW / 2, y2: yEnd, color: '#334155' });

  // labels
  doc.fillColor('#334155').fontSize(9);
  doc.text('Tomar / Asignar', x1 + nodeW / 2 + mm(2), yPending + nodeH + mm(2), { width: mm(40) });
  doc.text('Resolver', x2 + nodeW / 2 + mm(2), yViewed + nodeH + mm(2), { width: mm(22) });
  doc.text('Falsa alarma', x1 + nodeW / 2 + mm(2), yViewed + nodeH + mm(10), { width: mm(26) });

  doc.y = yEnd + nodeH + mm(10);

  drawP(
    doc,
    'Regla recomendada de asignación: broadcast a guardias del objetivo/puesto + "first accept wins" (transacción). El Centro de Control siempre ve el estado y puede intervenir como fallback.'
  );
}

function generateSpecPdf() {
  ensureDirExists(OUTPUT_SPEC_PATH);

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 50, left: 50, right: 50, bottom: 50 },
    info: { Title: 'NVR AI Alert System a Firebase', Author: 'CronoApp' },
  });

  const out = fs.createWriteStream(OUTPUT_SPEC_PATH);
  doc.pipe(out);

  const today = format(new Date(), 'yyyy-MM-dd');
  drawTitle(doc, 'NVR AI Alert System → Firebase', `Especificación de proceso y diagramas (generado: ${today})`);

  drawH2(doc, '1) Objetivo del sistema');
  drawP(
    doc,
    'Sistema de seguridad para barrio cerrado que captura alertas IVS (detección humano/vehículo) desde un NVR Dahua, las procesa en Firebase (Cloud Functions), almacena evidencia en Storage/Firestore y distribuye alertas críticas vía FCM a guardias y al Centro de Control.'
  );

  drawH2(doc, '2) Requisitos funcionales');
  drawBulletList(doc, [
    'Recepción de webhook HTTP desde Dahua (multipart/form-data) con imagen + metadata.',
    "Subida de imagen a Storage en carpeta 'alerts/YYYY-MM-DD/'.",
    "Creación de documento en Firestore 'alerts' con status inicial 'pending'.",
    'Notificación FCM High Priority a guardias activos del objetivo/puesto y al Centro de Control.',
    'Acciones de resolución: resolved / false_alarm + guard_notes + cálculo de resolución.',
  ]);

  drawH2(doc, '3) Esquema de datos (Firestore)');
  drawP(doc, 'Colección: alerts');
  drawBulletList(doc, [
    'timestamp (serverTimestamp)',
    'camera_name (string)',
    'channel_id (number)',
    'event_type (string)',
    'object_type ("human" | "vehicle")',
    'image_url (string)',
    'status ("pending" | "viewed" | "resolved" | "false_alarm")',
    'assigned_guard (string | null)',
    'resolution_time (number, segundos)',
    'guard_notes (string)',
    'objective_id (string) y post_id (string) (ruteo recomendado)',
  ]);
  drawP(doc, 'Colección: guard_tokens');
  drawBulletList(doc, ['guard_id (string)', 'fcm_token (string)', 'platform ("android" | "ios")', 'is_active (boolean)']);

  drawH2(doc, '4) Ruteo por objetivo/puesto (config recomendado)');
  drawP(
    doc,
    'Para que funcione solo en ciertos objetivos y para saber a quién notificar, se recomienda una tabla de ruteo por cámara (channel/camera → objective_id/post_id) con flags enable/notify.'
  );
  drawBulletList(doc, [
    'Colección sugerida: camera_routes (o ivs_sources)',
    'Campos: nvr_id, channel_id, camera_name, objective_id, post_id, enabled, notify_operator, notify_guards',
  ]);

  drawFlowDiagram(doc);

  doc.addPage();
  drawTitle(doc, 'Estados y operación (Operador / Guardia)', `Continuación (generado: ${today})`);
  drawStateDiagram(doc);

  drawH2(doc, '5) Integración en UI (CronoApp)');
  drawP(doc, 'Centro de Control (Operador): integrarlo dentro de MapView con un módulo de alertas.');
  drawBulletList(doc, [
    'Overlay/panel lateral: lista de alertas pending/viewed filtrable por objetivo.',
    'Detalle: imagen, metadata, ubicación (si aplica) y acciones.',
    'Acciones opcionales: asignar guardia, marcar falsa alarma, escalar.',
  ]);
  drawP(doc, 'Empleado/Guardia: como módulo extra desde el dashboard y/o tab dedicado.');
  drawBulletList(doc, [
    'Pantalla principal de alertas del objetivo/puesto en tiempo real.',
    'Modal crítico al recibir FCM (importance max + channel critical_alerts).',
    'Botones: Tomar, Resolver, Falsa alarma + notas.',
  ]);

  drawH2(doc, '6) Recomendaciones de operación');
  drawBulletList(doc, [
    'Webhook protegido con secreto (query param o header) + logging de payload raw.',
    'Asignación broadcast + transacción "first accept wins" para evitar duplicados.',
    'Fallback: si no hay guardias activos, notificar operador/supervisor/retén.',
    'Deduplicación/cooldown por cámara si Dahua dispara múltiples snapshots.',
  ]);

  doc.end();

  return new Promise((resolve, reject) => {
    out.on('finish', resolve);
    out.on('error', reject);
  });
}

function resolveDashboardScreenshotPath() {
  const candidateRepo = path.resolve(__dirname, '..', 'assets', 'centro_control_dashboard.png');
  if (fs.existsSync(candidateRepo)) return candidateRepo;
  if (fs.existsSync(FALLBACK_DASHBOARD_SCREENSHOT_PATH)) return FALLBACK_DASHBOARD_SCREENSHOT_PATH;
  return null;
}

function generatePresentationDeckPdf() {
  ensureDirExists(OUTPUT_DECK_PATH);

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 42, left: 46, right: 46, bottom: 42 },
    info: { Title: 'NVR AI Alert System (Presentación)', Author: 'CronoApp' },
  });
  const out = fs.createWriteStream(OUTPUT_DECK_PATH);
  doc.pipe(out);

  const today = format(new Date(), 'yyyy-MM-dd');
  const subtitleBase = `CronoApp · Firebase (Functions/Firestore/Storage/FCM) · ${today}`;

  const footer = (slideNo) => {
    const left = doc.page.margins.left;
    const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const y = doc.page.height - doc.page.margins.bottom + mm(8);
    doc.save();
    doc.fillColor('#94a3b8').fontSize(8.5);
    doc.text('NVR AI Alert System → Firebase', left, y, { width: w, align: 'left' });
    doc.text(`Slide ${slideNo}`, left, y, { width: w, align: 'right' });
    doc.restore();
  };

  let slideNo = 1;
  const newSlide = (title, subtitle) => {
    if (slideNo > 1) doc.addPage();
    drawH1Slide(doc, title, subtitle);
    footer(slideNo);
    slideNo += 1;
  };

  // Slide 1 - Portada
  newSlide('NVR AI Alert System → Firebase', 'Proceso completo, ruteo por objetivo/puesto y operación (Centro de Control + Guardias)');
  drawCallout(doc, {
    title: 'Resumen ejecutivo',
    body:
      'Cuando el NVR detecta un evento IVS (humano/vehículo), envía una foto por webhook. Firebase la recibe, guarda evidencia, crea una alerta “pending” y distribuye una notificación crítica al Centro de Control y a los guardias en servicio del objetivo/puesto correspondiente. El guardia toma la alerta y la resuelve (o marca falsa alarma) quedando auditado en Firestore.',
  });
  drawBulletList(doc, [
    'Aporta evidencia inmediata (foto) + trazabilidad (estado/tiempo/notas).',
    'Ruteo: solo notifica donde corresponde (objetivos con NVR habilitado).',
    'Centro de Control siempre visible (fallback operativo).',
  ]);

  // Slide 2 - Problema y objetivo
  newSlide('Problema y objetivo', subtitleBase);
  drawCallout(doc, {
    title: 'Problema',
    body:
      'Los eventos críticos requieren reacción inmediata, pero sin un flujo unificado se pierde tiempo (llamados), se duplica esfuerzo (varios responden a la misma alerta) y se pierde evidencia/registro operativo.',
    color: '#ef4444',
    fill: '#fef2f2',
  });
  drawCallout(doc, {
    title: 'Objetivo',
    body:
      'Unificar el circuito: evento IVS → evidencia → alerta en tiempo real → despacho a guardias correctos → resolución con trazabilidad. Integrado en Centro de Control (MapView) y módulo de guardia.',
    color: '#16a34a',
    fill: '#ecfdf5',
  });

  // Slide 3 - Actores
  newSlide('Actores y responsabilidades', subtitleBase);
  drawBulletList(doc, [
    'NVR Dahua: detecta IVS y dispara webhook con snapshot.',
    'Cloud Function Webhook: valida, parsea multipart, sube imagen, crea alerta.',
    'Firestore: almacena alertas (estado + metadata + asignación).',
    'Router de notificaciones: decide destinatarios (guardias activos + operador).',
    'Guardia (App): recibe alerta crítica, toma y resuelve con notas.',
    'Operador (Centro de Control): monitorea, asigna/escala y actúa como fallback.',
  ]);
  drawCallout(doc, {
    title: 'Principio operativo',
    body:
      'El Centro de Control “ve todo siempre”. Los guardias reciben solo lo que corresponde a su objetivo/puesto y lo toman con una regla anti-duplicación.',
    color: '#0ea5e9',
    fill: '#ecfeff',
  });

  // Slide 4 - Flujo E2E (diagrama dedicado)
  newSlide('Flujo end-to-end (E2E)', subtitleBase);
  drawP(
    doc,
    'Este diagrama muestra el recorrido completo: desde el evento IVS en el NVR hasta la visualización/acción en Centro de Control y en la app del guardia.'
  );
  doc.moveDown(0.4);
  drawFlowDiagram(doc);
  drawCallout(doc, {
    title: 'Puntos clave',
    body:
      '1) Evidencia primero (Storage). 2) Alerta “pending” en Firestore como fuente de verdad. 3) Notificación crítica (FCM) para despertar al guardia. 4) UI en tiempo real por onSnapshot.',
    color: '#334155',
    fill: '#f8fafc',
  });

  // Slide 5 - Ruteo por objetivo/puesto
  newSlide('Ruteo por objetivo/puesto (qué cámaras activan el sistema)', subtitleBase);
  drawP(
    doc,
    'Para que funcione en ciertos objetivos y no en todos, y para saber a quién notificar, se usa una tabla de “ruteo” (cámara → objetivo/puesto).'
  );
  drawCallout(doc, {
    title: 'Colección recomendada: camera_routes (o ivs_sources)',
    body:
      'channel_id + nvr_id + camera_name → objective_id + post_id\nFlags: enabled, notify_operator, notify_guards\nEsto permite habilitar/deshabilitar cámaras sin tocar código.',
    color: '#7c3aed',
    fill: '#f5f3ff',
  });
  drawBulletList(doc, [
    'Si enabled=false: el webhook puede guardar evidencia pero NO generar alertas (o registrar como “disabled”).',
    'Si notify_guards=false: solo Centro de Control (modo monitoreo).',
    'Se pueden definir severidades/sonidos por cámara (opcional).',
  ]);

  // Slide 6 - ¿A qué guardias se les manda?
  newSlide('Destinatarios: ¿a qué guardias se les manda?', subtitleBase);
  drawP(
    doc,
    'El envío se calcula por “guardias en servicio” del objetivo/puesto. Esto evita notificar a personal fuera de turno o de otra ubicación.'
  );
  drawCallout(doc, {
    title: 'Estrategia A (base): derivar desde turnos',
    body:
      'Se consulta Firestore/turnos por objective_id/post_id y ventana horaria actual.\nSe filtra por status operativo (por ej. PRESENT/ON_DUTY).',
    color: '#f59e0b',
    fill: '#fffbeb',
  });
  drawCallout(doc, {
    title: 'Estrategia B (recomendada para precisión): presencia en tiempo real',
    body:
      'active_assignments/{guardId} con objective_id/post_id + is_on_duty + last_seen.\nIdeal para reemplazos, rotaciones y confirmación de disponibilidad.',
    color: '#0ea5e9',
    fill: '#ecfeff',
  });
  drawCallout(doc, {
    title: 'Fallback',
    body: 'Si no hay guardias activos: notificar solo Centro de Control + supervisor/retén.',
    color: '#334155',
    fill: '#f8fafc',
  });

  // Slide 7 - Modelo de datos
  newSlide('Modelo de datos (Firestore)', subtitleBase);
  drawCallout(doc, {
    title: 'alerts/{alertId} (fuente de verdad)',
    body:
      'timestamp, status, objective_id, post_id\ncamera_name, channel_id, event_type, object_type\nimage_url, assigned_guard, resolution_time, guard_notes',
    color: '#4f46e5',
    fill: '#eef2ff',
  });
  drawCallout(doc, {
    title: 'guard_tokens (dispositivos habilitados)',
    body: 'guard_id, fcm_token, platform, is_active',
    color: '#16a34a',
    fill: '#ecfdf5',
  });
  drawBulletList(doc, [
    'El status permite priorizar y filtrar en UI: pending/viewed/resolved/false_alarm.',
    'assigned_guard define “quién se hizo cargo”.',
    'resolution_time + notes permiten auditoría y mejora continua.',
  ]);

  // Slide 8 - Notificación crítica (FCM)
  newSlide('Notificación crítica (FCM): comportamiento esperado', subtitleBase);
  drawBulletList(doc, [
    'Android: canal critical_alerts con Importance.max (lo define la app).',
    'Sonido: “alarm” (nombre que la app registra en el canal).',
    'Payload data: alertId + objective_id/post_id + camera_name (para deep-link).',
    'Alta prioridad: prioridad alta para despertar/disparar UI.',
  ]);
  drawCallout(doc, {
    title: 'Regla de oro',
    body:
      'La notificación despierta y dirige; la “fuente de verdad” siempre es Firestore. La app debe abrir el detalle leyendo alerts/{alertId}.',
    color: '#334155',
    fill: '#f8fafc',
  });

  // Slide 9 - UI Centro de Control (con captura si existe)
  newSlide('Centro de Control (Operador): integración en MapView', subtitleBase);
  drawP(
    doc,
    'Recomendación de UX: el operador debe ver las alertas en contexto geográfico. El MapView suma un panel/overlay de alertas y un detalle con imagen y acciones.'
  );

  const screenshot = resolveDashboardScreenshotPath();
  if (screenshot) {
    const left = doc.page.margins.left;
    const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const y = doc.y + mm(4);
    const maxH = mm(85);
    try {
      doc.image(screenshot, left, y, { fit: [w, maxH], align: 'center' });
      doc.y = y + maxH + mm(4);
    } catch (e) {
      drawCallout(doc, {
        title: 'Captura no disponible',
        body:
          'No se pudo incrustar la imagen del dashboard en el PDF. (No afecta el diseño; se puede agregar luego exportando una captura a assets/centro_control_dashboard.png).',
        color: '#ef4444',
        fill: '#fef2f2',
      });
    }
  } else {
    drawCallout(doc, {
      title: 'Captura opcional',
      body:
        'Si querés incluir una captura del Centro de Control en el PDF, guardala como assets/centro_control_dashboard.png y regenerá el PDF.',
      color: '#0ea5e9',
      fill: '#ecfeff',
    });
  }

  drawBulletList(doc, [
    'Overlay: lista de alertas (pending/viewed) + filtros por objetivo/cámara.',
    'Detalle: imagen grande + metadata + acciones (asignar/escalar/falsa alarma).',
    'Indicador en mapa: pin/halo para alertas activas (si hay geolocalización).',
  ]);

  // Slide 10 - UI Guardia
  newSlide('Guardia (Empleado): módulo extra en dashboard', subtitleBase);
  drawP(
    doc,
    'Recomendación: un módulo “Alertas” dentro del dashboard del empleado, con acceso rápido y un modal crítico al recibir FCM.'
  );
  drawBulletList(doc, [
    'Modal crítico: muestra foto, cámara, objetivo/puesto, timestamp y botones.',
    'Acción “Tomar”: transacción para asignar (first accept wins).',
    'Acción “Resolver” o “Falsa alarma”: cierra el ciclo con notas.',
    'Historial: lista de alertas resueltas por ese guardia (para auditoría).',
  ]);
  drawCallout(doc, {
    title: 'Anti-duplicación',
    body:
      'Si la alerta ya tiene assigned_guard, otros guardias ven “Ya tomada” (solo lectura). Evita múltiples respuestas al mismo evento.',
    color: '#7c3aed',
    fill: '#f5f3ff',
  });

  // Slide 11 - Estados
  newSlide('Estados de la alerta (operación)', subtitleBase);
  drawP(
    doc,
    'La alerta atraviesa estados simples. Esto habilita un tablero claro para el operador y un flujo claro para el guardia.'
  );
  drawStateDiagram(doc);
  drawBulletList(doc, [
    'pending: recién creada (sin dueño).',
    'viewed: tomada/asignada (assigned_guard).',
    'resolved: resuelta con tiempo y notas.',
    'false_alarm: descartada con notas (auditable).',
  ]);

  // Slide 12 - Seguridad y resiliencia
  newSlide('Seguridad y resiliencia', subtitleBase);
  drawBulletList(doc, [
    'Webhook: secreto obligatorio (header/query) y logs de auditoría.',
    'Idempotencia: evitar duplicados por burst (cooldown por cámara + hash simple).',
    'Cuotas: FCM por lotes (hasta 500 tokens por batch).',
    'Monitoreo: métricas de resolución y tasa de falsas alarmas por cámara/objetivo.',
  ]);
  drawCallout(doc, {
    title: 'Criterio de calidad',
    body:
      'Si Firestore tiene la alerta y Storage tiene la imagen, el sistema se considera “consistente”. Notificaciones pueden reintentarse sin romper el estado.',
    color: '#334155',
    fill: '#f8fafc',
  });

  // Slide 13 - Plan de implementación
  newSlide('Plan de implementación (alto nivel)', subtitleBase);
  drawBulletList(doc, [
    '1) Crear camera_routes y cargar cámaras habilitadas (objective/post).',
    '2) Implementar Cloud Function webhook multipart → Storage → alerts.',
    '3) Implementar Router onCreate(alert) → resolve recipients → FCM.',
    '4) Integrar UI Operador (MapView) + UI Guardia (módulo alertas).',
    '5) Reglas Firestore + hardening (secret + dedupe + logging).',
  ]);
  drawCallout(doc, {
    title: 'Prueba de punta a punta',
    body:
      'Simular POST multipart con snapshot, verificar: Storage (archivo), Firestore (doc), FCM (llega), UI (onSnapshot), transacción “tomar” y cierre resolved/false_alarm.',
    color: '#16a34a',
    fill: '#ecfdf5',
  });

  doc.end();

  return new Promise((resolve, reject) => {
    out.on('finish', resolve);
    out.on('error', reject);
  });
}

async function main() {
  // Generamos primero el PDF de presentación (lo que se comparte).
  // El PDF "spec" puede estar abierto/bloqueado en Windows; si falla, se saltea.
  await generatePresentationDeckPdf();
  console.log(`PDF (presentación) generado en: ${OUTPUT_DECK_PATH}`);

  try {
    await generateSpecPdf();
    console.log(`PDF (spec) generado en: ${OUTPUT_SPEC_PATH}`);
  } catch (e) {
    const err = e || {};
    const code = err.code || '';
    if (code === 'EBUSY') {
      console.warn(`PDF (spec) NO regenerado (archivo en uso): ${OUTPUT_SPEC_PATH}`);
    } else {
      console.warn(`PDF (spec) NO regenerado: ${OUTPUT_SPEC_PATH}`);
      console.warn(e);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

