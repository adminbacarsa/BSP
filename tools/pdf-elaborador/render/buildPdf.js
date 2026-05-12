import path from "path";
import PDFDocument from "pdfkit";
import fs from "fs";
import { theme } from "../design/theme.js";
import { resolveFonts } from "../design/fonts.js";
import { drawFuturisticCoverArt } from "./coverArt.js";
import { drawCoverRaster } from "./coverImage.js";

const T = theme.layout;

/**
 * Altura estimada SIN usar `heightOfString` (en PDFKit eso **vuelca texto al PDF** y rompe
 * saltos de página, dejando hojas en blanco o trazas fantasma).
 */
function wrapLinesApprox(text, widthPt, fontSize) {
  const cpl = Math.max(6, Math.floor(widthPt / Math.max(3, fontSize * 0.52)));
  const words = String(text ?? "")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return 1;
  let lines = 1;
  let len = 0;
  for (const w of words) {
    const add = w.length + (len > 0 ? 1 : 0);
    if (len + add > cpl && len > 0) {
      lines++;
      len = w.length;
    } else len += add;
  }
  return lines;
}

/** Altura en puntos para un bloque con salto de línea a ancho fijo. */
function estimateTextHeight(text, widthPt, fontSize, lineGap = 2) {
  const lineH = fontSize * 1.22 + lineGap;
  const chunks = String(text ?? "").split(/\n/);
  let h = 0;
  for (const chunk of chunks) {
    const n = wrapLinesApprox(chunk, widthPt, fontSize);
    h += Math.max(1, n) * lineH;
  }
  return Math.max(lineH, h);
}

/**
 * PDFKit solo acepta color como string hex (#RRGGBB) o array [R,G,B] en 0–255.
 * NO usar tres floats 0–1 ni fillColor(r,g,b) — el 2.º argumento es opacidad y rompe el color.
 */
function fillHex(doc, hex) {
  doc.fillColor(hex);
}

function strokeHex(doc, hex) {
  doc.strokeColor(hex);
}

function resolveRelPath(rel, roots) {
  if (!rel || typeof rel !== "string") return null;
  if (path.isAbsolute(rel)) return fs.existsSync(rel) ? rel : null;
  for (const root of roots) {
    if (!root) continue;
    const abs = path.resolve(root, rel);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

function resolveCoverImagePath(meta, roots) {
  const tryList = [meta?.coverImage, meta?.coverHero, "assets/cover-hero.png"].filter((x) => typeof x === "string" && x.length);
  for (const rel of tryList) {
    const p = resolveRelPath(rel, roots);
    if (p) return p;
  }
  return null;
}

/**
 * Portada: imagen a página completa (estilo “hero”) + títulos abajo a la derecha.
 * Si no hay imagen, fallback vectorial futurista.
 */
function drawCover(doc, data, fonts, pageW, pageH, assetRoots) {
  const { meta } = data;
  const logoPath = meta?.logo ? resolveRelPath(meta.logo, assetRoots) : null;
  const coverImgPath = resolveCoverImagePath(meta, assetRoots);

  fillHex(doc, "#020617");
  doc.rect(0, 0, pageW, pageH).fill();

  const coverMode = meta.coverImageMode || "containSharp";

  if (coverImgPath) {
    try {
      drawCoverRaster(doc, coverImgPath, pageW, pageH, coverMode);
    } catch {
      drawFuturisticCoverArt(doc, pageW, pageH, 0.35);
    }
  } else {
    drawFuturisticCoverArt(doc, pageW, pageH, 0.35);
  }

  const veilW = pageW * 0.78;
  const veilH = pageH * 0.55;
  fillHex(doc, "#020617");
  for (let i = 0; i < 14; i++) {
    doc.opacity(0.045 + i * 0.038);
    const slice = veilH / 14;
    doc.rect(pageW - veilW, pageH - veilH + i * slice - 2, veilW + 4, slice + 4).fill();
  }
  doc.opacity(1);
  fillHex(doc, "#020617");
  doc.opacity(0.38);
  doc.rect(pageW - veilW * 0.92, pageH - veilH, veilW * 0.92, veilH).fill();
  doc.opacity(1);

  if (logoPath) {
    try {
      doc.image(logoPath, T.marginX, T.marginY, { fit: [100, 44] });
    } catch {
      /* */
    }
  }

  const zoneW = Math.min(pageW * 0.52, 360);
  const x = pageW - T.marginX - zoneW;
  const chips = meta.coverChips || ["ERP · APIs", "Roadmap 2026–2027", "BI corporativo"];
  const g = { xs: 6, sm: 10, md: 14 };

  const kicker = (meta.coverKicker || "Informe ejecutivo · Sistemas IT").toUpperCase();
  const org = meta.org || "";
  const tit = meta.title || "Informe";
  const sub = meta.subtitle || "";
  const dateStr = meta.date || "";
  const tag = meta.tagline || "Confidencial — uso interno";

  if (fonts.semibold || fonts.bold) doc.font(fonts.semibold || fonts.bold);
  fillHex(doc, "#5EEAD4");
  doc.fontSize(8);
  const hKick = estimateTextHeight(kicker, zoneW, 8, 2);

  if (fonts.regular) doc.font(fonts.regular);
  fillHex(doc, "#CBD5E1");
  doc.fontSize(10);
  const hOrg = estimateTextHeight(org, zoneW, 10, 2);

  if (fonts.bold) doc.font(fonts.bold);
  fillHex(doc, "#F8FAFC");
  doc.fontSize(28);
  const hTit = estimateTextHeight(tit, zoneW, 28, 3);

  if (fonts.regular) doc.font(fonts.regular);
  fillHex(doc, "#E2E8F0");
  doc.fontSize(11);
  const hSub = estimateTextHeight(sub, zoneW, 11, 4);

  if (fonts.semibold || fonts.bold) doc.font(fonts.semibold || fonts.bold);
  doc.fontSize(7.5);
  const chipH = 18;
  const chipPad = 6;
  const widths = chips.map((lab) => doc.widthOfString(lab) + 14);
  const line1W = widths.reduce((a, w, i) => a + w + (i > 0 ? chipPad : 0), 0);
  const chipRows = line1W > zoneW ? 2 : 1;
  const hChips = chipRows * chipH + (chipRows - 1) * 5;

  if (fonts.regular) doc.font(fonts.regular);
  fillHex(doc, "#CBD5E1");
  doc.fontSize(10);
  const hDate = estimateTextHeight(dateStr, zoneW, 10, 2);

  fillHex(doc, "#94A3B8");
  doc.fontSize(8);
  const hTag = estimateTextHeight(tag, zoneW, 8, 2);

  const totalH =
    hKick +
    g.sm +
    hOrg +
    g.sm +
    hTit +
    g.md +
    hSub +
    g.md +
    hChips +
    g.md +
    hDate +
    g.sm +
    hTag;

  const bottomPad = T.marginBottom + 12;
  let y = pageH - bottomPad - totalH;

  if (fonts.semibold || fonts.bold) doc.font(fonts.semibold || fonts.bold);
  fillHex(doc, "#5EEAD4");
  doc.fontSize(8);
  doc.text(kicker, x, y, { width: zoneW, align: "right", lineGap: 2 });
  y += hKick + g.sm;

  if (fonts.regular) doc.font(fonts.regular);
  fillHex(doc, "#CBD5E1");
  doc.fontSize(10);
  doc.text(org, x, y, { width: zoneW, align: "right" });
  y += hOrg + g.sm;

  if (fonts.bold) doc.font(fonts.bold);
  fillHex(doc, "#F8FAFC");
  doc.fontSize(28);
  doc.text(tit, x, y, { width: zoneW, align: "right", lineGap: 3 });
  y += hTit + g.md;

  if (fonts.regular) doc.font(fonts.regular);
  fillHex(doc, "#E2E8F0");
  doc.fontSize(11);
  doc.text(sub, x, y, { width: zoneW, align: "right", lineGap: 4 });
  y += hSub + g.md;

  if (fonts.semibold || fonts.bold) doc.font(fonts.semibold || fonts.bold);
  doc.fontSize(7.5);
  const chipY0 = y;
  if (line1W <= zoneW) {
    let rx = x + zoneW - line1W;
    chips.forEach((label, i) => {
      const w = widths[i];
      fillHex(doc, "#134E4A");
      doc.opacity(0.9);
      doc.roundedRect(rx, chipY0, w, chipH, 4).fill();
      doc.opacity(1);
      fillHex(doc, "#CCFBF1");
      doc.text(label, rx + 7, chipY0 + 4, { width: w - 14 });
      rx += w + chipPad;
    });
  } else {
    const mid = Math.ceil(chips.length / 2);
    [chips.slice(0, mid), chips.slice(mid)].forEach((rowLabs, rowIdx) => {
      const rowWidths = rowLabs.map((lab) => doc.widthOfString(lab) + 14);
      const tw = rowWidths.reduce((a, w, i) => a + w + (i > 0 ? chipPad : 0), 0);
      let rx = x + zoneW - tw;
      const cy = chipY0 + rowIdx * (chipH + 5);
      rowLabs.forEach((label, i) => {
        const w = rowWidths[i];
        fillHex(doc, "#134E4A");
        doc.opacity(0.9);
        doc.roundedRect(rx, cy, w, chipH, 4).fill();
        doc.opacity(1);
        fillHex(doc, "#CCFBF1");
        doc.text(label, rx + 7, cy + 4, { width: w - 14 });
        rx += w + chipPad;
      });
    });
  }
  y += hChips + g.md;

  if (fonts.regular) doc.font(fonts.regular);
  fillHex(doc, "#CBD5E1");
  doc.fontSize(10);
  doc.text(dateStr, x, y, { width: zoneW, align: "right" });
  y += hDate + g.sm;

  fillHex(doc, "#94A3B8");
  doc.fontSize(8);
  doc.text(tag, x, y, { width: zoneW, align: "right", lineGap: 2 });

  doc.lineWidth(1);
  doc.opacity(1);
}

function sectionHeader(doc, num, title, fonts, x, y, maxW) {
  const h = 22;
  fillHex(doc, theme.accentSoft);
  doc.roundedRect(x, y, maxW, h, 6).fill();
  fillHex(doc, theme.accentDark);
  doc.roundedRect(x, y, 5, h, 2).fill();

  if (fonts.semibold || fonts.bold) doc.font(fonts.semibold || fonts.bold);
  fillHex(doc, theme.textPrimary);
  doc.fontSize(T.h1Size);
  const label = num != null ? `${String(num).padStart(2, "0")} · ${title}` : title;
  doc.text(label, x + 16, y + 5, { width: maxW - 24 });
  return y + h + 14;
}

function kpiRow(doc, kpis, fonts, x, y, maxW) {
  const n = kpis.length;
  const gap = 12;
  const cellW = (maxW - gap * (n - 1)) / n;
  let cy = y;
  kpis.forEach((k, i) => {
    const cx = x + i * (cellW + gap);
    fillHex(doc, theme.rowAlt);
    doc.roundedRect(cx, cy, cellW, 52, 8).fill();
    strokeHex(doc, theme.border);
    doc.roundedRect(cx, cy, cellW, 52, 8).stroke();

    if (fonts.bold) doc.font(fonts.bold);
    fillHex(doc, theme.accentDark);
    doc.fontSize(20).text(String(k.value), cx + 14, cy + 10, { width: cellW - 28 });
    if (fonts.regular) doc.font(fonts.regular);
    fillHex(doc, theme.textSecondary);
    doc.fontSize(T.smallSize).text(k.label, cx + 14, cy + 32, { width: cellW - 28 });
  });
  return cy + 60;
}

function pillarCards(doc, pillars, fonts, x, y, maxW, pageH, marginBottom) {
  const gap = 8;
  const cols = 3;
  const colW = (maxW - gap * (cols - 1)) / cols;
  let rowY = y;
  let bottom = y;

  pillars.forEach((p, i) => {
    const col = i % cols;
    if (col === 0 && i > 0) rowY += 96;
    rowY = ensureSpace(doc, rowY, 100, pageH, marginBottom);

    const cx = x + col * (colW + gap);
    fillHex(doc, "#FFFFFF");
    doc.roundedRect(cx, rowY, colW, 88, 6).fill();
    strokeHex(doc, theme.border);
    doc.roundedRect(cx, rowY, colW, 88, 6).stroke();
    fillHex(doc, theme.accent);
    doc.rect(cx, rowY + 6, 3, 76).fill();

    if (fonts.semibold || fonts.bold) doc.font(fonts.semibold || fonts.bold);
    fillHex(doc, theme.textPrimary);
    doc.fontSize(10).text(p.title, cx + 12, rowY + 12, { width: colW - 20 });
    if (fonts.regular) doc.font(fonts.regular);
    fillHex(doc, theme.textSecondary);
    doc.fontSize(T.smallSize).text(p.body, cx + 12, rowY + 30, {
      width: colW - 20,
      lineGap: 2
    });
    bottom = Math.max(bottom, rowY + 92);
  });
  return bottom + 12;
}

function ensureSpace(doc, y, needed, pageH, marginBottom) {
  if (y + needed > pageH - marginBottom) {
    doc.addPage();
    return T.marginY;
  }
  return y;
}

function drawTable(doc, units, fonts, x, y, maxW, pageW, pageH) {
  const cols = [
    { key: "area", title: "Área / sector", w: 0.28 },
    { key: "systems", title: "Sistemas / herramientas", w: 0.3 },
    { key: "status", title: "Estado", w: 0.14 },
    { key: "next", title: "Próximo paso", w: 0.28 }
  ];

  const headerH = 22;
  if (fonts.semibold || fonts.bold) doc.font(fonts.semibold || fonts.bold);
  doc.fontSize(T.smallSize);

  let cx = x;
  cols.forEach((c) => {
    const cw = maxW * c.w;
    fillHex(doc, "#F1F5F9");
    doc.rect(cx, y, cw, headerH).fill();
    fillHex(doc, theme.textPrimary);
    doc.text(c.title, cx + 6, y + 6, { width: cw - 12 });
    cx += cw;
  });

  let rowY = y + headerH;
  const rowPad = 6;

  units.forEach((u, idx) => {
    if (fonts.regular) doc.font(fonts.regular);
    doc.fontSize(T.smallSize);
    const fs = T.smallSize;
    const estLines = Math.max(
      estimateTextHeight(u.area || "", maxW * cols[0].w - 12, fs, 1),
      estimateTextHeight(u.systems || "", maxW * cols[1].w - 12, fs, 1),
      estimateTextHeight(u.status || "", maxW * cols[2].w - 12, fs, 1),
      estimateTextHeight(u.next || "", maxW * cols[3].w - 12, fs, 1)
    );
    const rowH = Math.max(28, estLines + rowPad * 2);

    rowY = ensureSpace(doc, rowY, rowH + 8, pageH, T.marginBottom);

    cx = x;
    if (idx % 2 === 0) {
      fillHex(doc, theme.rowAlt);
      doc.rect(x, rowY, maxW, rowH).fill();
    }
    strokeHex(doc, theme.border);
    doc.moveTo(x, rowY).lineTo(x + maxW, rowY).stroke();

    if (fonts.regular) doc.font(fonts.regular);
    fillHex(doc, theme.textPrimary);
    doc.fontSize(T.smallSize);

    cols.forEach((c) => {
      const cw = maxW * c.w;
      const text = u[c.key] || "";
      doc.text(text, cx + 6, rowY + rowPad, { width: cw - 12, lineGap: 1 });
      cx += cw;
    });

    rowY += rowH;
  });

  strokeHex(doc, theme.border);
  doc.moveTo(x, rowY).lineTo(x + maxW, rowY).stroke();

  return rowY + 16;
}

function milestoneStack(doc, items, fonts, x, y, maxW, pageH) {
  let rowY = y;
  items.forEach((m) => {
    if (fonts.regular) doc.font(fonts.regular);
    doc.fontSize(T.smallSize);
    const bodyH = estimateTextHeight(m.body || "", maxW - 24, T.smallSize, 2);
    const boxH = 52 + bodyH + 12;

    rowY = ensureSpace(doc, rowY, boxH + 16, pageH, T.marginBottom);

    fillHex(doc, "#FFFFFF");
    doc.roundedRect(x, rowY, maxW, boxH, 8).fill();
    strokeHex(doc, theme.border);
    doc.roundedRect(x, rowY, maxW, boxH, 8).stroke();

    fillHex(doc, theme.accentSoft);
    doc.roundedRect(x + 10, rowY + 10, maxW - 20, 18, 4).fill();
    fillHex(doc, theme.accentDark);
    doc.fontSize(7.5).text(m.badge, x + 14, rowY + 14, { width: maxW - 28 });

    if (fonts.bold) doc.font(fonts.bold);
    fillHex(doc, theme.textPrimary);
    doc.fontSize(10).text(m.title, x + 12, rowY + 34, { width: maxW - 24 });
    if (fonts.regular) doc.font(fonts.regular);
    fillHex(doc, theme.textSecondary);
    doc.fontSize(T.smallSize).text(m.body, x + 12, rowY + 52, {
      width: maxW - 24,
      lineGap: 2
    });
    rowY += boxH + 12;
  });
  return rowY + 4;
}

function drawComparison3Col(doc, rows, fonts, x, y, maxW, pageH) {
  const cols = [
    { key: "axis", title: "Eje de gestión", w: 0.22 },
    { key: "before", title: "Estado inicial", w: 0.38 },
    { key: "after", title: "Estado actual", w: 0.4 }
  ];
  const headerH = 22;
  if (fonts.semibold || fonts.bold) doc.font(fonts.semibold || fonts.bold);
  doc.fontSize(7.5);
  let cx = x;
  cols.forEach((c) => {
    const cw = maxW * c.w;
    fillHex(doc, "#F1F5F9");
    doc.rect(cx, y, cw, headerH).fill();
    fillHex(doc, theme.textPrimary);
    doc.text(c.title, cx + 4, y + 6, { width: cw - 8 });
    cx += cw;
  });
  let rowY = y + headerH;
  rows.forEach((row, idx) => {
    if (fonts.regular) doc.font(fonts.regular);
    doc.fontSize(7.5);
    const fs = 7.5;
    const est = Math.max(
      estimateTextHeight(row.axis || "", maxW * cols[0].w - 8, fs, 1),
      estimateTextHeight(row.before || "", maxW * cols[1].w - 8, fs, 1),
      estimateTextHeight(row.after || "", maxW * cols[2].w - 8, fs, 1)
    );
    const rowH = Math.max(26, est + 8);
    rowY = ensureSpace(doc, rowY, rowH + 6, pageH, T.marginBottom);
    if (idx % 2 === 0) {
      fillHex(doc, theme.rowAlt);
      doc.rect(x, rowY, maxW, rowH).fill();
    }
    strokeHex(doc, theme.border);
    doc.moveTo(x, rowY).lineTo(x + maxW, rowY).stroke();
    if (fonts.regular) doc.font(fonts.regular);
    fillHex(doc, theme.textPrimary);
    doc.fontSize(7.5);
    cx = x;
    cols.forEach((c) => {
      const cw = maxW * c.w;
      doc.text(row[c.key] || "", cx + 4, rowY + 4, { width: cw - 8, lineGap: 1 });
      cx += cw;
    });
    rowY += rowH;
  });
  strokeHex(doc, theme.border);
  doc.moveTo(x, rowY).lineTo(x + maxW, rowY).stroke();
  return rowY + 14;
}

function drawSimpleTable(doc, title, cols, rows, fonts, x, y, maxW, pageH) {
  if (title) {
    if (fonts.bold) doc.font(fonts.bold);
    fillHex(doc, theme.textPrimary);
    doc.fontSize(10).text(title, x, y, { width: maxW });
    y += 16;
  }
  const headerH = 20;
  if (fonts.semibold || fonts.bold) doc.font(fonts.semibold || fonts.bold);
  doc.fontSize(7.5);
  let wsum = 0;
  cols.forEach((c, i) => {
    const cw = maxW * c.w;
    fillHex(doc, "#F1F5F9");
    doc.rect(x + wsum, y, cw, headerH).fill();
    fillHex(doc, theme.textPrimary);
    doc.text(c.title, x + wsum + 4, y + 5, { width: cw - 8 });
    wsum += cw;
  });
  let rowY = y + headerH;
  rows.forEach((row, idx) => {
    const fs = 7.5;
    const h0 = Math.max(
      ...cols.map((c) => estimateTextHeight(String(row[c.key] ?? ""), maxW * c.w - 8, fs, 1))
    );
    const rowH = Math.max(24, h0 + 8);
    rowY = ensureSpace(doc, rowY, rowH + 6, pageH, T.marginBottom);
    if (idx % 2 === 0) {
      fillHex(doc, theme.rowAlt);
      doc.rect(x, rowY, maxW, rowH).fill();
    }
    strokeHex(doc, theme.border);
    doc.moveTo(x, rowY).lineTo(x + maxW, rowY).stroke();
    if (fonts.regular) doc.font(fonts.regular);
    fillHex(doc, theme.textPrimary);
    doc.fontSize(7.5);
    wsum = 0;
    cols.forEach((c) => {
      const cw = maxW * c.w;
      doc.text(String(row[c.key] ?? ""), x + wsum + 4, rowY + 4, { width: cw - 8, lineGap: 1 });
      wsum += cw;
    });
    rowY += rowH;
  });
  strokeHex(doc, theme.border);
  doc.moveTo(x, rowY).lineTo(x + maxW, rowY).stroke();
  return rowY + 18;
}

function drawAnnex(doc, data, fonts, x, y, maxW, pageW, pageH) {
  const annex = data.annex;
  if (!annex) return y;

  y = sectionHeader(doc, annex.sectionNumber ?? 6, annex.title || "Anexo", fonts, x, y, maxW);
  if (fonts.regular) doc.font(fonts.regular);
  fillHex(doc, theme.textSecondary);
  doc.fontSize(T.bodySize);
  if (annex.intro) {
    y = ensureSpace(doc, y, 48, pageH, T.marginBottom);
    const hi = estimateTextHeight(annex.intro, maxW, T.bodySize, 3);
    doc.text(annex.intro, x, y, { width: maxW, lineGap: 3 });
    y += hi + 14;
  }

  if (annex.comparisonTitle) {
    if (fonts.bold) doc.font(fonts.bold);
    fillHex(doc, theme.textPrimary);
    doc.fontSize(10).text(annex.comparisonTitle, x, y, { width: maxW });
    y += 16;
  }
  if (annex.comparisonRows?.length) {
    if (fonts.regular) doc.font(fonts.regular);
    y = drawComparison3Col(doc, annex.comparisonRows, fonts, x, y, maxW, pageH);
  }

  if (annex.implementationTitle) {
    if (fonts.bold) doc.font(fonts.bold);
    fillHex(doc, theme.textPrimary);
    doc.fontSize(10).text(annex.implementationTitle, x, y, { width: maxW });
    y += 18;
  }
  for (const block of annex.implementationBlocks || []) {
    y = ensureSpace(doc, y, 48, pageH, T.marginBottom);
    if (fonts.bold) doc.font(fonts.bold);
    fillHex(doc, theme.accentDark);
    doc.fontSize(9).text(block.title, x, y, { width: maxW });
    y += 14;
    if (fonts.regular) doc.font(fonts.regular);
    fillHex(doc, theme.textSecondary);
    doc.fontSize(T.smallSize);
    for (const line of block.lines || []) {
      y = ensureSpace(doc, y, 24, pageH, T.marginBottom);
      const t = `→ ${line}`;
      const hl = estimateTextHeight(t, maxW - 8, T.smallSize, 2);
      doc.text(t, x + 4, y, { width: maxW - 8, lineGap: 2 });
      y += hl + 3;
    }
    y += 8;
  }

  if (annex.adoptionTable) {
    y = ensureSpace(doc, y, 48, pageH, T.marginBottom);
    y = drawSimpleTable(
      doc,
      annex.adoptionTable.title,
      annex.adoptionTable.columns,
      annex.adoptionTable.rows,
      fonts,
      x,
      y,
      maxW,
      pageH
    );
  }

  if (annex.analysisTable) {
    y = ensureSpace(doc, y, 48, pageH, T.marginBottom);
    y = drawSimpleTable(
      doc,
      annex.analysisTable.title,
      annex.analysisTable.columns,
      annex.analysisTable.rows,
      fonts,
      x,
      y,
      maxW,
      pageH
    );
  }

  return y;
}

function drawRoadmap(doc, data, fonts, x, y, maxW, pageH) {
  const buckets = data.timelineBuckets || [];
  const n = buckets.length;
  const headerH = 22;
  const rowH = 22;
  const labelW = maxW * 0.36;
  const chartW = maxW - labelW - 8;
  const bucketW = chartW / n;

  fillHex(doc, "#E2E8F0");
  doc.rect(x + labelW, y, chartW, headerH).fill();
  if (fonts.regular) doc.font(fonts.regular);
  fillHex(doc, theme.textSecondary);
  doc.fontSize(7);
  buckets.forEach((b, i) => {
    doc.text(b, x + labelW + i * bucketW + 2, y + 6, { width: bucketW - 4, align: "center" });
  });

  let rowY = y + headerH;
  const st = theme.status;

  (data.roadmap || []).forEach((row) => {
    rowY = ensureSpace(doc, rowY, rowH + 14, pageH, T.marginBottom);

    if (fonts.regular) doc.font(fonts.regular);
    fillHex(doc, theme.textPrimary);
    doc.fontSize(T.smallSize).text(row.label, x, rowY + 4, { width: labelW - 6 });
    fillHex(doc, theme.textMuted);
    doc.fontSize(7.5).text(row.owner, x, rowY + 14, { width: labelW - 6 });

    const from = Math.max(0, Math.min(n - 1, row.fromBucket ?? 0));
    const to = Math.max(from, Math.min(n - 1, row.toBucket ?? from));
    const trackKey = row.track in st ? row.track : "planned";
    const track = st[trackKey] || st.planned;
    const barX = x + labelW + from * bucketW + 2;
    const barW = (to - from + 1) * bucketW - 4;

    fillHex(doc, theme.rowAlt);
    doc.rect(x + labelW, rowY, chartW, rowH).fill();
    fillHex(doc, track.fill);
    doc.roundedRect(barX, rowY + 4, barW, rowH - 8, 3).fill();

    const prog = Math.min(1, Math.max(0, row.progress ?? 0));
    if (prog > 0) {
      fillHex(doc, theme.coverBgTop);
      doc.opacity(0.25);
      doc.rect(barX, rowY + 4, barW * prog, rowH - 8).fill();
      doc.opacity(1);
    }

    strokeHex(doc, theme.border);
    doc.moveTo(x + labelW, rowY).lineTo(x + labelW + chartW, rowY).stroke();

    rowY += rowH;
  });

  return rowY + 20;
}

function pageFooter(doc, text, fonts, pageW, pageH, pageNum, opts = {}) {
  const { isCover = false } = opts;
  if (fonts.regular) doc.font(fonts.regular);
  fillHex(doc, theme.textMuted);
  doc.fontSize(7.5);
  if (!isCover && text) doc.text(text, T.marginX, pageH - 28, { width: pageW - T.marginX * 2 - 50 });
  if (!isCover)
    doc.text(`Página ${pageNum}`, pageW - T.marginX - 52, pageH - 28, { width: 48, align: "right" });
}

/**
 * @param {object} data — estructura informe-sample.json
 * @param {string} outPath — ruta PDF salida
 * @param {{ assetRoots?: string[]; assetsDir?: string }} [options] — carpetas para resolver imágenes (logo, coverImage). `assetsDir` queda como compatibilidad (un solo root).
 */
export function buildPdf(data, outPath, options = {}) {
  const assetRoots =
    options.assetRoots ||
    (options.assetsDir ? [options.assetsDir] : []).filter(Boolean);
  const fonts = resolveFonts();
  const doc = new PDFDocument({
    bufferPages: true,
    size: "A4",
    margins: { top: T.marginY, bottom: T.marginBottom, left: T.marginX, right: T.marginX },
    info: {
      Title: data.meta?.title || "Informe",
      Author: data.meta?.org || "",
      CreationDate: new Date()
    }
  });

  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const contentW = pageW - T.marginX * 2;

  drawCover(doc, data, fonts, pageW, pageH, assetRoots);

  doc.addPage();

  if (!fonts.regular) doc.font("Helvetica");
  else doc.font(fonts.regular);

  let y = T.marginY;

  y = sectionHeader(doc, 1, data.vision?.sectionTitle || "Visión", fonts, T.marginX, y, contentW);
  const quote = `“${data.vision?.quote || ""}”`;
  if (fonts.bold) doc.font(fonts.bold);
  fillHex(doc, theme.textPrimary);
  doc.fontSize(11);
  const hq = estimateTextHeight(quote, contentW, 11, 4);
  doc.text(quote, T.marginX, y, { width: contentW, lineGap: 4 });
  y += hq + 12;

  if (fonts.regular) doc.font(fonts.regular);
  fillHex(doc, theme.textSecondary);
  doc.fontSize(T.bodySize);
  (data.vision?.paragraphs || []).forEach((p) => {
    y = ensureSpace(doc, y, 48, pageH, T.marginBottom);
    const hp = estimateTextHeight(p, contentW, T.bodySize, 3);
    doc.text(p, T.marginX, y, { width: contentW, lineGap: 3 });
    y += hp + 12;
  });

  y = ensureSpace(doc, y, 140, pageH, T.marginBottom);
  y = kpiRow(doc, data.kpis || [], fonts, T.marginX, y, contentW);

  y += 8;
  y = sectionHeader(doc, 2, data.pillarsSectionTitle || "Misión", fonts, T.marginX, y, contentW);

  if (data.missionIntro) {
    if (fonts.regular) doc.font(fonts.regular);
    fillHex(doc, theme.textSecondary);
    doc.fontSize(T.bodySize);
    y = ensureSpace(doc, y, 40, pageH, T.marginBottom);
    const hm = estimateTextHeight(data.missionIntro, contentW, T.bodySize, 3);
    doc.text(data.missionIntro, T.marginX, y, { width: contentW, lineGap: 3 });
    y += hm + 12;
  }

  y = pillarCards(doc, data.pillars || [], fonts, T.marginX, y, contentW, pageH, T.marginBottom);

  if (data.missionClosing) {
    if (fonts.regular) doc.font(fonts.regular);
    fillHex(doc, theme.textSecondary);
    doc.fontSize(T.bodySize);
    y = ensureSpace(doc, y, 36, pageH, T.marginBottom);
    const hc = estimateTextHeight(data.missionClosing, contentW, T.bodySize, 3);
    doc.text(data.missionClosing, T.marginX, y, { width: contentW, lineGap: 3 });
    y += hc + 14;
  }

  y += 8;
  y = sectionHeader(doc, 3, data.unitsSectionTitle || "Unidades", fonts, T.marginX, y, contentW);
  if (data.unitsIntro) {
    if (fonts.regular) doc.font(fonts.regular);
    fillHex(doc, theme.textSecondary);
    doc.fontSize(T.bodySize);
    y = ensureSpace(doc, y, 36, pageH, T.marginBottom);
    const hu = estimateTextHeight(data.unitsIntro, contentW, T.bodySize, 3);
    doc.text(data.unitsIntro, T.marginX, y, { width: contentW, lineGap: 3 });
    y += hu + 12;
  }
  y = drawTable(doc, data.units || [], fonts, T.marginX, y, contentW, pageW, pageH);

  y = ensureSpace(doc, y, 160, pageH, T.marginBottom);
  y = sectionHeader(doc, 4, data.milestonesSectionTitle || "Hitos", fonts, T.marginX, y, contentW);
  if (data.milestonesIntro) {
    if (fonts.regular) doc.font(fonts.regular);
    fillHex(doc, theme.textSecondary);
    doc.fontSize(T.bodySize);
    y = ensureSpace(doc, y, 36, pageH, T.marginBottom);
    const hz = estimateTextHeight(data.milestonesIntro, contentW, T.bodySize, 3);
    doc.text(data.milestonesIntro, T.marginX, y, { width: contentW, lineGap: 3 });
    y += hz + 12;
  }
  if (data.milestonesLeadIn) {
    if (fonts.regular) doc.font(fonts.regular);
    fillHex(doc, theme.textSecondary);
    doc.fontSize(T.smallSize);
    y = ensureSpace(doc, y, 24, pageH, T.marginBottom);
    const hl = estimateTextHeight(data.milestonesLeadIn, contentW, T.smallSize, 2);
    doc.text(data.milestonesLeadIn, T.marginX, y, { width: contentW, lineGap: 2 });
    y += hl + 10;
  }
  y = milestoneStack(doc, data.milestones || [], fonts, T.marginX, y, contentW, pageH);

  doc.addPage();
  y = T.marginY;

  y = sectionHeader(doc, 5, data.roadmapSectionTitle || "Roadmap", fonts, T.marginX, y, contentW);
  if (fonts.regular) doc.font(fonts.regular);
  fillHex(doc, theme.textSecondary);
  doc.fontSize(T.smallSize).text(data.roadmapIntro || "", T.marginX, y, { width: contentW });
  y += 22;

  y = drawRoadmap(doc, data, fonts, T.marginX, y, contentW, pageH);

  y = ensureSpace(doc, y, 80, pageH, T.marginBottom);
  fillHex(doc, theme.accentSoft);
  doc.roundedRect(T.marginX, y, contentW, 72, 8).fill();
  if (fonts.regular) doc.font(fonts.regular);
  fillHex(doc, theme.accentDark);
  doc.fontSize(10).text(`“${data.closingQuote || ""}”`, T.marginX + 16, y + 16, {
    width: contentW - 32,
    lineGap: 3
  });

  if (data.annex) {
    doc.addPage();
    y = T.marginY;
    drawAnnex(doc, data, fonts, T.marginX, y, contentW, pageW, pageH);
  }

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    pageFooter(doc, data.footerNote || "", fonts, pageW, pageH, i + 1, { isCover: i === 0 });
  }

  doc.end();

  return new Promise((resolve, reject) => {
    stream.on("finish", () => resolve(outPath));
    stream.on("error", reject);
  });
}
