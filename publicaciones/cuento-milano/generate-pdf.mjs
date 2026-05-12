/**
 * Genera "El Gran Equipo de Milano en Boxes.pdf" (A4 apaisado).
 * Cada capítulo: una página con texto centrado; alterna texto+imagen arriba/abajo o al revés.
 * Uso: node generate-pdf.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import PDFDocument from "pdfkit";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_NAME = "El_Gran_Equipo_de_Milano_en_Boxes.pdf";

/** Si un bloque no tiene imagen propia, se usa esta para mantener la maquetación. */
const FALLBACK_ILLUSTRATION = "cuento-milano-portada.png";

function candidatesFor(filename) {
  const homedir = process.env.USERPROFILE || process.env.HOME || "";
  return [
    path.join(__dirname, "ilustraciones", filename),
    path.join(__dirname, filename),
    path.join(homedir, ".cursor", "projects", "c-APP-cronoapp", "assets", filename),
  ];
}

function resolveImage(filename) {
  for (const p of candidatesFor(filename)) {
    if (fs.existsSync(p)) return p;
  }
  console.warn(`[aviso] No se encontró ${filename}; esa página puede quedar solo con texto.`);
  return null;
}

/**
 * Títulos: Comic Sans (infantil, legible).
 * Párrafos: Georgia (serifa, buena para lectura en papel).
 */
function resolveFonts() {
  const win = process.env.WINDIR || "C:\\Windows";
  const fonts = path.join(win, "Fonts");
  const title = path.join(fonts, "comicbd.ttf");
  const titlePlain = path.join(fonts, "comic.ttf");
  const body = path.join(fonts, "georgia.ttf");
  const bodyBold = path.join(fonts, "georgiab.ttf");
  const fallbackBody = path.join(fonts, "arial.ttf");

  const out = {
    title: fs.existsSync(title) ? title : titlePlain,
    body: fs.existsSync(body) ? body : fallbackBody,
    bodyBold: fs.existsSync(bodyBold) ? bodyBold : null,
  };
  if (!out.title || !fs.existsSync(out.title)) out.title = null;
  if (!fs.existsSync(out.body)) out.body = null;
  return out;
}

const story = [
  {
    heading: "El jardín que pedía una pista",
    body: `Había una vez, en una ciudad llena de caminos de arena y pistas de carreras, un niño llamado Milano. Él no era un niño común: era un experto en motores. Tenía un Mercedes que brillaba como el sol y un Jeep capaz de subir hasta las montañas más altas.

Un día, mientras Milano jugaba en su cuarto, escuchó un ruido extraño: ¡Crunsh, crunsh! Al asomarse a la ventana, descubrió un gran desafío en su jardín: había que construir una pista de carreras nueva para su amigo Franco Colapinto.

Pero el camino estaba lleno de piedras gigantes. Milano, muy valiente y capaz, se puso su gorra de director y exclamó:

— "¡Toma control, pone!"`,
    image: "cuento-milano-portada.png",
  },
  {
    heading: "La llegada de las máquinas",
    body: `Primero llegó la Excavadora Amarilla. Con su pala gigante empezó a sacar las piedras. ¡Siuuu, pac!, las movía de un lado a otro. Milano la miraba con mucha atención, porque es un gran observador, y le indicaba exactamente dónde excavar con su dedito.`,
    image: "cuento-milano-excavadora.png",
  },
  {
    heading: "El tractor que dejó todo planito",
    body: `Después llegó el Tractor Verde. Era tan fuerte que sus ruedas eran más grandes que las de un camión. El Tractor pasó por encima de la tierra y la dejó bien planita. Milano se reía y decía: "¡Rico, am-am!", como si el tractor se comiera piedritas de chocolate en lugar de tierra.`,
    image: "cuento-milano-tractor.png",
  },
  {
    heading: "Un descanso en los boxes",
    body: `De repente, apareció el coche rojo de carreras, veloz y decidido. Estaba listo para correr, pero sus ruedas estaban sucias y se sentía cansado. Milano, con mucha paciencia, lo llevó a los "boxes" (que, curiosamente, se parecían mucho a su colchón calentito). Allí descansó para recuperar toda su energía.

— "Mami, te amo", susurró Milano mientras le daba un beso de buenas noches al coche. El auto, de la emoción, hizo rugir su motor: ¡Brum, brum!`,
    image: "cuento-milano-boxes.png",
  },
  {
    heading: "¡Gran final de carrera!",
    body: `Cuando la pista estuvo lista, todos los autos hicieron una fila perfecta. Estaba el Mercedes, el Jeep, las excavadoras y los tractores. Milano dio la señal de largada y… ¡ZUM! Todos corrieron súper rápido por la pista nueva.

Pero cuando el sol empezó a esconderse y el cielo se puso naranja, Milano supo que hasta los pilotos más valientes necesitan entrar a boxes para recargar combustible. Guardó sus tractores, estacionó su excavadora y se acomodó en su colchón.`,
    image: "cuento-milano-gran-final.png",
  },
  {
    heading: "Hasta mañana, campeón",
    body: `Cerró sus ojitos y, mientras soñaba con una camioneta blanca (¡igualita a la de Pablo!), Milano se quedó profundamente dormido. Sabía que mañana, al despertar, habría una nueva carrera por ganar.

Y colorín colorado, este cuento de motores se ha terminado.`,
    image: "cuento-milano-sueno.png",
  },
];

function illustrationFor(block) {
  return block.image || FALLBACK_ILLUSTRATION;
}

/** Escala y dibuja la imagen dentro de una banda (anchura × alto máx.), centrada en la banda. */
function drawIllustrationInBand(doc, imagePath, bandLeft, bandTop, bandW, bandH) {
  const ip = resolveImage(imagePath);
  if (!ip) return;

  const img = doc.openImage(ip);
  const pad = 10;
  const maxW = bandW - pad * 2;
  const maxH = bandH - pad * 2;
  const scale = Math.min(maxW / img.width, maxH / img.height, 1);
  const w = img.width * scale;
  const h = img.height * scale;
  const x = bandLeft + (bandW - w) / 2;
  const y = bandTop + (bandH - h) / 2;
  doc.image(ip, x, y, { width: w });
}

/** Título y cuerpo centrados en el ancho del texto (no recorta párrafos). */
function drawTextBlockCentered(doc, block, fonts, textX, textW, startY) {
  doc.fillColor("#1a3720");
  doc.font(fonts.titleName).fontSize(19).lineGap(2);
  doc.text(block.heading, textX, startY, { width: textW, align: "center" });
  doc.fillColor("#2a2a2a");
  doc.font(fonts.bodyName).fontSize(10.9).lineGap(3.5);
  doc.text(block.body, textX, doc.y + 10, { width: textW, align: "center" });
}

/**
 * Página interior: bloque centrado en horizontal; alterna orden texto/imagen.
 * @param {boolean} imageOnTop - true: ilustración arriba, texto abajo. false: texto arriba, ilustración abajo.
 */
function drawChapterPage(doc, block, fonts, layout, imageOnTop) {
  const { marginL, innerW, topY, bottomY } = layout;
  const textW = Math.min(innerW * 0.86, 720);
  const textX = marginL + (innerW - textW) / 2;
  const gap = 18;
  const illPath = illustrationFor(block);
  const areaH = bottomY - topY;

  if (!imageOnTop) {
    drawTextBlockCentered(doc, block, fonts, textX, textW, topY);
    const imgTop = doc.y + gap;
    const imgH = Math.max(72, bottomY - imgTop);
    if (imgTop + 40 < bottomY) {
      drawIllustrationInBand(doc, illPath, marginL, imgTop, innerW, imgH);
    }
  } else {
    const imgBandH = Math.max(120, areaH * 0.52 - gap / 2);
    drawIllustrationInBand(doc, illPath, marginL, topY, innerW, imgBandH);
    const textStart = topY + imgBandH + gap;
    drawTextBlockCentered(doc, block, fonts, textX, textW, textStart);
  }
}

function drawCoverPage(doc, fonts, layout, coverImagePath) {
  const { pageW, marginL, marginR, topY, areaHeight } = layout;
  const innerW = pageW - marginL - marginR;

  doc.fillColor("#2c4a32");
  doc.font(fonts.titleName).fontSize(28).text("El Gran Equipo de Milano en Boxes", marginL, topY + 8, {
    width: innerW,
    align: "center",
  });
  doc.moveDown(0.35);
  doc.font(fonts.bodyName).fontSize(13).fillColor("#5c5c5c").text("Cuento para leer antes de dormir", {
    width: innerW,
    align: "center",
  });

  const imgY = doc.y + 20;
  const dedication =
    "Una Historia de valentina Garcia, la mejor mamá del mundo.";
  const dedicationSpace = 52;
  const imgMaxH = topY + areaHeight - imgY - dedicationSpace;
  const ip = resolveImage(coverImagePath);
  let belowY = imgY;
  if (ip) {
    const img = doc.openImage(ip);
    const maxW = innerW * 0.72;
    const scale = Math.min(maxW / img.width, imgMaxH / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    const x = marginL + (innerW - w) / 2;
    doc.image(ip, x, imgY, { width: w });
    belowY = imgY + h + 14;
  } else {
    belowY = doc.y + 8;
  }

  doc.font(fonts.bodyName).fontSize(12).fillColor("#4a5568").text(dedication, marginL, belowY, {
    width: innerW,
    align: "center",
  });
}

async function main() {
  const fontPaths = resolveFonts();
  const outPath = path.join(__dirname, OUT_NAME);

  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margins: { top: 44, bottom: 44, left: 48, right: 48 },
    info: {
      Title: "El Gran Equipo de Milano en Boxes",
      Author: "Valentina & familia",
      Subject: "Cuento infantil",
    },
  });

  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  const titleName = "FontTitle";
  const bodyName = "FontBody";

  if (fontPaths.title && fs.existsSync(fontPaths.title)) {
    doc.registerFont(titleName, fontPaths.title);
  }
  if (fontPaths.body && fs.existsSync(fontPaths.body)) {
    doc.registerFont(bodyName, fontPaths.body);
  }

  const fonts = {
    titleName: fontPaths.title && fs.existsSync(fontPaths.title) ? titleName : "Helvetica-Bold",
    bodyName: fontPaths.body && fs.existsSync(fontPaths.body) ? bodyName : "Helvetica",
  };

  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const m = doc.page.margins;
  const innerW = pageW - m.left - m.right;
  const topY = m.top;
  const bottomY = pageH - m.bottom;
  const areaHeight = bottomY - topY;

  const layout = {
    pageW,
    marginL: m.left,
    marginR: m.right,
    innerW,
    topY,
    bottomY,
    areaHeight,
  };

  drawCoverPage(doc, fonts, layout, "cuento-milano-jardin.png");

  story.forEach((block, index) => {
    doc.addPage();
    /** Alterna: pares = texto arriba e imagen abajo; impares = imagen arriba y texto abajo. */
    const imageOnTop = index % 2 === 1;
    drawChapterPage(doc, block, fonts, layout, imageOnTop);
  });

  doc.end();

  await new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });

  console.log(`Listo: ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
