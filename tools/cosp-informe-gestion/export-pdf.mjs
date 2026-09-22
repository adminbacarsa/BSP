import { chromium } from "playwright";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const dir = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(dir, "index.html");
const outPath =
  process.argv[2] ||
  join(process.env.USERPROFILE || process.env.HOME || dir, "Downloads", "COSP-Informe-Gestion.pdf");

const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const browser = await chromium.launch({ executablePath: chrome });
const page = await browser.newPage({
  viewport: { width: 1920, height: 1080 },
});
await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
const height = await page.evaluate(() =>
  Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
);
await page.pdf({
  path: outPath,
  width: "1920px",
  height: `${height}px`,
  printBackground: true,
  margin: { top: "0", right: "0", bottom: "0", left: "0" },
  pageRanges: "1",
});
await browser.close();
console.log(`${outPath} · ${height}px`);
