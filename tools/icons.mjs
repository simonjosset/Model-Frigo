/* Génère les icônes PNG de l'application à partir de icons/icon.svg (Chromium de Playwright).
   Usage : npm run icons */
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const svg = await readFile(path.join(root, "icons/icon.svg"), "utf8");
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
for (const [nom, t] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]]) {
  const page = await browser.newPage({ viewport: { width: t, height: t } });
  await page.setContent('<html><body style="margin:0">' + svg.replace(/width="512" height="512"/, 'width="' + t + '" height="' + t + '"') + "</body></html>");
  await page.screenshot({ path: path.join(root, "icons", nom), omitBackground: false });
  await page.close();
  console.log("icons/" + nom);
}
await browser.close();
