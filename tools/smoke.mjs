/* Test de bout en bout dans Chromium sur le fichier construit dist/modele-frigo.html, hors ligne.
   Usage : npm run build && npm run test:e2e
   Captures d'écran : dossier indiqué par SHOTS (par défaut, dossier temporaire du système). */
import { chromium, devices } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = process.env.SHOTS || path.join(tmpdir(), "modele-frigo-captures");
await mkdir(SHOTS, { recursive: true });
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml" };
const server = createServer(async (req, res) => {
  const f = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  try { const body = await readFile(f); res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const URL0 = "http://localhost:" + server.address().port + "/" + (process.env.PAGE || "dist/modele-frigo.html");

let failed = 0;
function check(name, ok, info) { console.log((ok ? "ok    " : "ÉCHEC ") + name + (info !== undefined ? " — " + info : "")); if (!ok) failed++; }
const attendre = async (page, fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 10000)) { if (await page.evaluate(fn)) return true; await page.waitForTimeout(150); } return false; };

const lancement = { args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] };
if (process.env.PW_CHROMIUM) lancement.executablePath = process.env.PW_CHROMIUM;
const browser = await chromium.launch(lancement);

/* ---------- Format pc ---------- */
const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, serviceWorkers: "block" });
await ctx.route(/^https?:\/\/(?!localhost)/, r => r.abort());
const page = await ctx.newPage();
const errors = []; page.on("pageerror", e => errors.push(process.env.PAGE ? e.stack : e.message));
await page.goto(URL0);

const font = await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].some(f => f.family.replace(/["']/g, "") === "Mona Sans" && f.status === "loaded"); });
check("police Mona Sans chargée sans réseau", font);
check("vue 3D (WebGL) affichée", await page.evaluate(() => !!document.querySelector("#vue3d canvas") && document.getElementById("msg3d").hidden));
check("aperçu des flux calculé dans le worker", await attendre(page, () => window.MF && MF.champs.apercu && !MF.calculs.local), await page.evaluate(() => MF.champs.apercu && MF.champs.apercu.F.info.ms + " ms"));
check("projet d'exemple : 14 échelles chargées", (await page.textContent("#resume")).includes("14"));
await page.screenshot({ path: path.join(SHOTS, "1-exemple.png") });

// Cloison ajoutée puis modifiée par le panneau
await page.click('[data-ajout="cloisons"]');
check("cloison ajoutée et sélectionnée", await page.evaluate(() => MF.projet().cloisons.length === 1) && (await page.inputValue('#pane-prop h2 input')) === "Cloison 1");
await page.fill("#f_ep", "20"); await page.press("#f_ep", "Enter");
check("épaisseur saisie en cm enregistrée en m", await page.evaluate(() => Math.abs(MF.projet().cloisons[0].ep - 0.2) < 1e-9));

// Échelles : produit et chargement
const idE = await page.evaluate(() => MF.projet().echelles[0].id);
await page.click('[data-sel="' + idE + '"]');
await page.selectOption("#f_produit\\.ref", "gn11");
check("produit changé : bac GN 1/1", await page.evaluate(() => MF.projet().echelles[0].produit.ref === "gn11"));
await page.fill("#f_etagesCharges", "6"); await page.press("#f_etagesCharges", "Enter");
const info = await page.evaluate(() => { const e = MF.projet().echelles[0]; return e.etagesCharges; });
check("étages chargés saisis", info === 6, info);
await page.click("#bAnnuler"); await page.click("#bAnnuler");
check("annuler : retour au pot de glace", await page.evaluate(() => MF.projet().echelles[0].produit.ref === "glace33" && MF.projet().echelles[0].etagesCharges == null));
await page.click("#bRetablir");
check("rétablir", await page.evaluate(() => MF.projet().echelles[0].produit.ref === "gn11"));
await page.click("#bAnnuler");

// Calques
for (const c of ["lignes", "coupe", "mortes", "couleurProduits"]) await page.click('[data-aff="' + c + '"]');
check("coupe : barre de réglage affichée", await page.isVisible("#coupeBar"));
await page.click('[data-axe="y"]');
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(SHOTS, "2-calques.png") });
for (const c of ["lignes", "mortes"]) await page.click('[data-aff="' + c + '"]');

// Calcul fin (maillage rapide)
await page.click('[data-tab="regl"]');
await page.selectOption("#f_reglages\\.maille", "rapide");
await page.click("#bCalcul");
check("calcul fin lancé (barre de progression)", await page.isVisible("#prog"));
const fini = await attendre(page, () => MF.champs.cfd && MF.mode() === "cfd", 240000);
check("calcul fin terminé et affiché", fini, await page.evaluate(() => MF.champs.cfd && Math.round(MF.champs.cfd.F.info.ms / 1000) + " s, " + MF.champs.cfd.F.info.passes + " passe(s)"));
await page.click('[data-tab="res"]');
const res = await page.textContent("#pane-res");
check("résultats : volume bien brassé et contrôles", /Volume bien brassé/.test(res) && /Contrôles/.test(res) && /Calcul fin/.test(res));
await page.screenshot({ path: path.join(SHOTS, "3-calcul-fin.png") });

// Modification après calcul : résultat signalé à relancer
const idEv = await page.evaluate(() => MF.projet().evaps[0].id);
await page.click('[data-sel="' + idEv + '"]');
await page.click('[data-dir="dir"][data-v="0"]');
check("modification : calcul fin à relancer", await page.isVisible("#perime") && await page.evaluate(() => MF.mode() === "apercu"));

// Sélection dans la 3D et déplacement au clavier
const x0 = await page.evaluate(() => MF.projet().evaps[0].x);
await page.locator("#vue3d canvas").focus().catch(() => {});
await page.keyboard.press("ArrowLeft");
check("déplacement au clavier", await page.evaluate(x => Math.abs(MF.projet().evaps[0].x - (x - 0.1)) < 1e-6, x0));

// Rechargement : le projet est conservé
await page.waitForTimeout(400);
await page.reload();
await attendre(page, () => window.MF && MF.champs.apercu);
check("projet conservé après rechargement (cloison)", await page.evaluate(() => MF.projet().cloisons.length === 1 && MF.projet().cloisons[0].ep === 0.2));

// Export puis import
const n = await page.evaluate(() => { const t = MF.store.exporter(false); return MF.store.importer(t); });
check("export puis import d'un projet", n === 1 && await page.evaluate(() => MF.store.liste().length === 2));

// Thème clair
await page.click("#bTheme"); await page.waitForTimeout(300);
check("thème clair", await page.evaluate(() => document.documentElement.getAttribute("data-theme") === "light"));
await page.screenshot({ path: path.join(SHOTS, "4-clair.png") });
check("aucune erreur JavaScript (pc)", errors.length === 0, errors.join(" | "));
await ctx.close();

/* ---------- Format iPhone : l'application reste utilisable ---------- */
const ctx2 = await browser.newContext({ ...devices["iPhone 13"], serviceWorkers: "block" });
await ctx2.route(/^https?:\/\/(?!localhost)/, r => r.abort());
const ph = await ctx2.newPage();
const err2 = []; ph.on("pageerror", e => err2.push(e.message));
await ph.goto(URL0);
check("iPhone : aperçu calculé", await attendre(ph, () => window.MF && MF.champs.apercu));
check("iPhone : pas de défilement horizontal", await ph.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await ph.screenshot({ path: path.join(SHOTS, "5-iphone.png") });
check("aucune erreur JavaScript (iPhone)", err2.length === 0, err2.join(" | "));
await ctx2.close();

await browser.close(); server.close();
console.log("Captures : " + SHOTS);
if (failed) { console.error(failed + " échec(s)"); process.exit(1); }
console.log("Tout est bon.");
