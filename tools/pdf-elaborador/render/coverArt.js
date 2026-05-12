/**
 * Ilustración vectorial “IT futurista” para la carátula (sin assets externos).
 * Capas: rejilla perspectiva, red de nodos, anillo central, partículas y brillo.
 */

function fillHex(doc, hex) {
  doc.fillColor(hex);
}

function strokeHex(doc, hex) {
  doc.strokeColor(hex);
}

/**
 * @param {PDFDocument} doc
 * @param {number} pageW
 * @param {number} pageH
 * @param {number} [textReserveRatio=0.5] — parte izquierda reservada para tipografía
 */
export function drawFuturisticCoverArt(doc, pageW, pageH, textReserveRatio = 0.5) {
  const x0 = pageW * textReserveRatio;

  // Panel base derecho (gradiente simulado por franjas verticales)
  const stripes = 18;
  for (let s = 0; s < stripes; s++) {
    const t = s / (stripes - 1);
    const r = Math.round(11 + t * 7);
    const g = Math.round(18 + t * 22);
    const b = Math.round(40 + t * 35);
    fillHex(doc, `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`);
    doc.opacity(0.45 + t * 0.35);
    const sw = (pageW - x0) / stripes + 1;
    doc.rect(x0 + s * sw - 0.5, 0, sw, pageH).fill();
  }
  doc.opacity(1);

  // Rejilla perspectiva (suelo digital)
  strokeHex(doc, "#2DD4BF");
  doc.lineWidth(0.4);
  const horizon = pageH * 0.38;
  const gridBottom = pageH - 24;
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    doc.opacity(0.06 + t * 0.12);
    const y = horizon + (gridBottom - horizon) * (t * t);
    doc.moveTo(x0 + 12, y).lineTo(pageW - 12, y).stroke();
  }
  for (let j = 0; j < 10; j++) {
    const u = j / 9;
    const x = x0 + 24 + u * (pageW - x0 - 48);
    doc.opacity(0.08);
    doc.moveTo(x, horizon).lineTo(x + (pageW - x) * 0.12, gridBottom).stroke();
  }
  doc.opacity(1);

  // Anillo central “portal / procesamiento”
  const cx = x0 + (pageW - x0) * 0.52;
  const cy = pageH * 0.36;
  const rings = [72, 56, 40];
  doc.lineWidth(1.2);
  rings.forEach((radius, idx) => {
    doc.opacity(0.12 + idx * 0.08);
    strokeHex(doc, "#5EEAD4");
    doc.circle(cx, cy, radius).stroke();
  });
  doc.opacity(1);

  fillHex(doc, "#0F766E");
  doc.opacity(0.85);
  doc.circle(cx, cy, 16).fill();
  doc.opacity(1);
  strokeHex(doc, "#CCFBF1");
  doc.lineWidth(1.5);
  doc.circle(cx, cy, 16).stroke();

  // Nodos y conexiones tipo red
  const nodes = [
    { x: cx - 95, y: cy - 40 },
    { x: cx + 100, y: cy - 55 },
    { x: cx + 85, y: cy + 70 },
    { x: cx - 70, y: cy + 55 },
    { x: cx - 110, y: cy + 20 },
    { x: cx + 50, y: cy - 95 }
  ];

  doc.lineWidth(0.7);
  const connections = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],
    [4, 5],
    [5, 0],
    [0, 3],
    [1, 5]
  ];
  connections.forEach(([a, b]) => {
    doc.opacity(0.35);
    strokeHex(doc, "#67E8F9");
    doc.moveTo(nodes[a].x, nodes[a].y).lineTo(nodes[b].x, nodes[b].y).stroke();
  });
  doc.opacity(1);

  nodes.forEach((n) => {
    doc.opacity(0.9);
    fillHex(doc, "#134E4A");
    doc.circle(n.x, n.y, 5).fill();
    strokeHex(doc, "#2DD4BF");
    doc.lineWidth(0.8);
    doc.circle(n.x, n.y, 5).stroke();
  });
  doc.opacity(1);

  // Partículas / puntos de datos
  for (let p = 0; p < 42; p++) {
    const px = x0 + 30 + ((p * 73) % (pageW - x0 - 60));
    const py = 40 + ((p * 113) % (pageH - 100));
    doc.opacity(0.15 + (p % 5) * 0.06);
    fillHex(doc, p % 3 === 0 ? "#5EEAD4" : "#94A3B8");
    doc.circle(px, py, p % 4 === 0 ? 1.6 : 1).fill();
  }
  doc.opacity(1);

  // Líneas de “scan” horizontales sutiles (banda media)
  for (let s = 0; s < 8; s++) {
    doc.opacity(0.04);
    strokeHex(doc, "#E0F2FE");
    doc.lineWidth(0.3);
    const yy = pageH * 0.52 + s * 22;
    doc.moveTo(x0 + 8, yy).lineTo(pageW - 8, yy).stroke();
  }
  doc.opacity(1);

  // Barra luminosa diagonal decorativa
  doc.save();
  doc.opacity(0.08);
  fillHex(doc, "#2DD4BF");
  doc.rotate(-12, { origin: [pageW * 0.7, pageH * 0.2] });
  doc.rect(pageW * 0.55, -80, 24, pageH + 160).fill();
  doc.restore();
  doc.opacity(1);

  doc.lineWidth(1);
}
