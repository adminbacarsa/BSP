import fs from "fs";
import path from "path";

/**
 * Intenta Segoe UI → Calibri → Arial (Windows).
 */
export function resolveFonts() {
  const win = process.env.WINDIR || "C:\\Windows";
  const fontsDir = path.join(win, "Fonts");
  const candidates = {
    regular: ["segoeui.ttf", "calibri.ttf", "arial.ttf"],
    bold: ["seguisb.ttf", "segoeuib.ttf", "calibrib.ttf", "arialbd.ttf"],
    semibold: ["seguisb.ttf", "segoeuib.ttf", "calibrib.ttf"]
  };

  const pick = (list) => {
    for (const name of list) {
      const p = path.join(fontsDir, name);
      if (fs.existsSync(p)) return p;
    }
    return null;
  };

  return {
    regular: pick(candidates.regular),
    bold: pick(candidates.bold),
    semibold: pick(candidates.semibold)
  };
}
