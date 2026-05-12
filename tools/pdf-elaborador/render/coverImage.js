/**
 * Coloca la imagen de portada sin “pisar” píxeles: por defecto no escala por encima del 100 %
 * (evita pixelado al estirar PNGs baja resolución). Modo `cover` rellena toda la página (puede verse pixelado).
 */

export function drawCoverRaster(doc, coverImgPath, pageW, pageH, mode = "containSharp") {
  const image = doc.openImage(coverImgPath);
  const iw = image.width;
  const ih = image.height;
  if (!iw || !ih) {
    doc.image(coverImgPath, 0, 0, { cover: [pageW, pageH], align: "center", valign: "center" });
    return;
  }

  const sw = pageW / iw;
  const sh = pageH / ih;

  if (mode === "cover" || mode === "fill") {
    doc.image(coverImgPath, 0, 0, { cover: [pageW, pageH], align: "center", valign: "center" });
    return;
  }

  if (mode === "contain") {
    doc.image(coverImgPath, 0, 0, { fit: [pageW, pageH], align: "center", valign: "center" });
    return;
  }

  /* containSharp: encaja en la página sin ampliar por encima del tamaño nativo del bitmap */
  const scaleFit = Math.min(sw, sh);
  const scale = Math.min(scaleFit, 1);
  const w = iw * scale;
  const h = ih * scale;
  const x0 = (pageW - w) / 2;
  const y0 = (pageH - h) / 2;
  doc.image(image, x0, y0, { width: w, height: h });
}
