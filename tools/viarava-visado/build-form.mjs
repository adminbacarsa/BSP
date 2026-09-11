import { readFileSync, writeFileSync } from "fs";
import { PDFDocument, PDFBool, PDFName, rgb, StandardFonts } from "pdf-lib";

const src =
  process.argv[2] ||
  "C:\\Users\\Mauro\\Downloads\\Viarava_ARQ_Nota de Visado de Planos.pdf";
const out =
  process.argv[3] ||
  "C:\\Users\\Mauro\\Downloads\\Viarava_ARQ_Nota de Visado de Planos_EDITABLE.pdf";

const GOLD = rgb(0.45, 0.35, 0.22);
const WHITE = rgb(1, 1, 1);
const INK = rgb(0.12, 0.1, 0.08);

const bytes = readFileSync(src);
const pdf = await PDFDocument.load(bytes);
const page = pdf.getPages()[0];
const font = await pdf.embedFont(StandardFonts.Helvetica);
const form = pdf.getForm();

function cover(x, y, w, h) {
  page.drawRectangle({ x, y, width: w, height: h, color: WHITE, borderWidth: 0 });
}

function field(name, { x, y, w, h, size = 10, align = "left", multiline = false }) {
  const f = form.createTextField(name);
  f.addToPage(page, {
    x,
    y,
    width: w,
    height: h,
    textColor: INK,
    backgroundColor: WHITE,
    borderColor: GOLD,
    borderWidth: 0.5,
    font,
  });
  f.setFontSize(size);
  f.setAlignment(align === "center" ? 1 : 0);
  if (multiline) f.enableMultiline();
  return f;
}

const sz = 9.99999975;
const propLine = "___________________ y cuyo profesional responsable es ____________________.";
const sBody = 467.2981644225001 / font.widthOfTextAtSize(propLine, sz);
const propW = font.widthOfTextAtSize("_".repeat(19), sz) * sBody;
const midW = font.widthOfTextAtSize(" y cuyo profesional responsable es ", sz) * sBody;
const profW = font.widthOfTextAtSize("_".repeat(20), sz) * sBody;
const profX = 72 + propW + midW;

cover(213.5, 521, 61, 18);
field("lote", { x: 214.9, y: 524.2, w: 56, h: 13, size: 10, align: "center" });

cover(348.8, 521, 58.5, 18);
field("manzana", { x: 349.6, y: 524.2, w: 54, h: 13, size: 10, align: "center" });

cover(71, 506.2, propW + 18, 18);
field("propietario", { x: 72, y: 509.2, w: propW + 12, h: 13, size: 9 });
cover(profX - 3, 506.2, profW + 8, 18);
field("profesional", { x: profX, y: 509.2, w: profW, h: 13, size: 9 });

const dateLine = "de Arquitectura y Control de Obras con fecha ___/___/_____.";
const dateOrig = 322.23377139749994;
const sDate = dateOrig / font.widthOfTextAtSize(dateLine, sz);
const dateX =
  72 +
  font.widthOfTextAtSize("de Arquitectura y Control de Obras con fecha ", sz) * sDate -
  14;
cover(dateX - 4, 476.2, 100, 18);
page.drawText("/", { x: dateX + 24, y: 481.6, size: 11, font, color: INK });
page.drawText("/", { x: dateX + 50, y: 481.6, size: 11, font, color: INK });
field("fecha_dia", { x: dateX, y: 479.2, w: 22, h: 13, size: 9, align: "center" });
field("fecha_mes", { x: dateX + 28, y: 479.2, w: 20, h: 13, size: 9, align: "center" });
field("fecha_anio", { x: dateX + 54, y: 479.2, w: 28, h: 13, size: 9, align: "center" });

field("firma", { x: 76, y: 298, w: 340, h: 50, size: 10 });
field("fecha_cuadro", { x: 428, y: 298, w: 108, h: 50, size: 11, align: "center" });
field("aclaracion", { x: 76, y: 250, w: 460, h: 28, size: 9, multiline: true });
field("sello", { x: 76, y: 92, w: 236, h: 136, size: 10 });
field("lote_cuadro", { x: 318, y: 92, w: 106, h: 136, size: 14, align: "center" });
field("manzana_cuadro", { x: 428, y: 92, w: 108, h: 136, size: 14, align: "center" });

form.acroForm.dict.set(PDFName.of("NeedAppearances"), PDFBool.True);
form.updateFieldAppearances(font);

writeFileSync(out, await pdf.save({ updateFieldAppearances: true }));
console.log(out);
