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

// Pièces voisines (décor) : le sas du projet d'exemple, une pièce ajoutée contre le mur libre suivant
check("pièces voisines : sas de l'exemple affiché", await page.evaluate(() => MF.projet().pieces.length === 1) && /Sas · \+5 °C/.test(await page.textContent(".vue3d-etiquettes")));
await page.evaluate(() => { window.__nApercu = 0; const f = MF.calculs.apercu; MF.calculs.apercu = (...a) => { window.__nApercu++; return f(...a); }; });
await page.click('[data-ajout="pieces"]');
const pc = await page.evaluate(() => MF.projet().pieces[1]);
check("pièce ajoutée contre le fond, sur toute la longueur", pc && pc.y > 6.5 && pc.L === 9, JSON.stringify(pc));
await page.fill("#f_T", "-20"); await page.press("#f_T", "Enter");
await page.click('[data-act="coller-gauche"]');
const pc2 = await page.evaluate(() => MF.projet().pieces[1]);
check("pièce : température saisie et collée à gauche (3 m de profondeur)", pc2.T === -20 && pc2.x === -1.5 && pc2.L === 3 && pc2.l === 6.5, JSON.stringify(pc2));
await page.waitForTimeout(300);
check("pièce : décor, l'aperçu n'est pas recalculé", await page.evaluate(() => window.__nApercu === 0), await page.evaluate(() => window.__nApercu));
await page.click('[data-vue="iso"]'); await page.waitForTimeout(600);
await page.screenshot({ path: path.join(SHOTS, "1d-pieces.png") });
await page.uncheck('[data-affchk="pieces"]'); await page.waitForTimeout(200);
check("case à cocher : pièces voisines masquées, bouton du calque synchronisé", await page.evaluate(() => document.querySelector('[data-aff="pieces"]').getAttribute("aria-pressed") === "false"));
check("calque Pièces : masquées", await page.evaluate(() => !document.querySelector(".etq.pc") || getComputedStyle(document.querySelector(".etq.pc")).display === "none"));
await page.click('[data-aff="pieces"]');
check("bouton du calque : pièces réaffichées, case recochée", await page.isChecked('[data-affchk="pieces"]'));
for (let i = 0; i < 3; i++) await page.click("#bAnnuler");
check("annuler : pièce retirée", await page.evaluate(() => MF.projet().pieces.length === 1));

// Personne debout : repère d'échelle
await page.waitForTimeout(300); await page.evaluate(() => { window.__nApercu = 0; });
await page.click('[data-ajout="personnes"]');
check("personne ajoutée (1,75 m), étiquette dans la 3D", await page.evaluate(() => MF.projet().personnes.length === 1 && MF.projet().personnes[0].taille === 1.75) && /Personne 1 · 1,75 m/.test(await page.textContent(".vue3d-etiquettes")));
await page.fill("#f_taille", "1,82"); await page.press("#f_taille", "Enter");
check("personne : taille saisie", await page.evaluate(() => MF.projet().personnes[0].taille === 1.82));
check("personne : décor, l'aperçu n'est pas recalculé", await page.evaluate(() => window.__nApercu === 0), await page.evaluate(() => window.__nApercu));
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(SHOTS, "1e-personne.png") });
await page.click("#bAnnuler"); await page.click("#bAnnuler");
check("annuler : personne retirée", await page.evaluate(() => MF.projet().personnes.length === 0));

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

// Salle en L : coin retiré choisi sur le plan
await page.click('[data-sel="chambre"]');
await page.selectOption("#f_chambre\\.forme", "L");
await page.click('svg [data-coin="avant-gauche"]');
check("salle en L : coin avant gauche retiré", await page.evaluate(() => MF.projet().chambre.forme === "L" && MF.projet().chambre.coin === "avant-gauche"));
await page.fill("#f_chambre\\.coinLong", "2,5"); await page.press("#f_chambre\\.coinLong", "Enter");
check("salle en L : taille du coin saisie", await page.evaluate(() => MF.projet().chambre.coinLong === 2.5));
await page.screenshot({ path: path.join(SHOTS, "1b-salle-en-L.png") });
await page.click("#bAnnuler"); await page.click("#bAnnuler"); await page.click("#bAnnuler");
check("annuler : retour à la salle rectangulaire", await page.evaluate(() => MF.projet().chambre.forme === "rect"));

// Déflecteur d'angle
await page.click('[data-ajout="deflecteurs"]');
check("déflecteur d'angle ajouté", await page.evaluate(() => MF.projet().deflecteurs.length === 1) && await page.isVisible("#f_rayon"));
await page.fill("#f_rayon", "0,8"); await page.press("#f_rayon", "Enter");
check("déflecteur : rayon saisi", await page.evaluate(() => MF.projet().deflecteurs[0].rayon === 0.8));
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(SHOTS, "1c-deflecteur.png") });
await page.click("#bAnnuler"); await page.click("#bAnnuler");
check("annuler : déflecteur retiré", await page.evaluate(() => MF.projet().deflecteurs.length === 0));

// Cellule de refroidissement : une place par échelle, ventilateur à l'arrière de chaque place
await page.click('[data-ajout="cellules"]');
check("cellule ajoutée et sélectionnée", await page.evaluate(() => MF.projet().cellules.length === 1) && await page.isVisible("#f_places") && await page.isVisible(".vgrille, #f_parEtage"));
await page.fill("#f_places", "3"); await page.press("#f_places", "Enter");
check("cellule : 3 places, étiquette dans la 3D", await page.evaluate(() => MF.projet().cellules[0].places === 3) && /Cellule 1 · 3 places/.test(await page.textContent(".vue3d-etiquettes")));
const celOk = await attendre(page, () => { const c = MF.champs.apercu && MF.champs.apercu.R.cellules; return c && c.length === 1 && c[0].places.length === 3 && c[0].places.every(x => x.v > 0.2); }, 15000);
check("cellule : air à travers les échelles de chaque place (aperçu)", celOk, await page.evaluate(() => JSON.stringify(MF.champs.apercu.R.cellules.map(c => c.places.map(x => x.v && +x.v.toFixed(2))))));
await page.click('[data-tab="res"]');
check("cellule : tableau dans les résultats", /Cellules/.test(await page.textContent("#pane-res")) && /contourne/i.test(await page.textContent("#pane-res")));
await page.click('[data-tab="prop"]');
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(SHOTS, "1d-cellule.png") });
await page.click("#bAnnuler"); await page.click("#bAnnuler");
check("annuler : cellule retirée", await page.evaluate(() => MF.projet().cellules.length === 0));

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

// Vitesse de l'air par étage dans les échelles
await page.click('[data-sel="' + idE + '"]');
check("échelles : tableau des vitesses par étage", await page.isVisible(".vgrille") && await page.isVisible('[data-csv]'));
await page.click('.vg-c[data-ech="3,4"]');
const lu = await page.textContent("#sonde");
check("échelles : vitesse lue sur une case (échelle 4, étage 5)", /m\/s au-dessus des produits/.test(lu) && /étage 5/.test(lu), lu.replace(/\s+/g, " ").slice(0, 90));
const csv = await Promise.all([page.waitForEvent("download"), page.click('[data-csv]')]).then(([d]) => d.suggestedFilename());
check("échelles : export CSV des vitesses", /vitesses\.csv$/.test(csv), csv);
await page.screenshot({ path: path.join(SHOTS, "3b-vitesses-produits.png") });

// Coudes vers le bas en sortie des hélices
await page.click('[data-sel="' + await page.evaluate(() => MF.projet().evaps[0].id) + '"]');
await page.check('input[data-k="coude"]');
check("évaporateur : coudes vers le bas activés", await page.evaluate(() => MF.projet().evaps[0].coude === true) && await page.isVisible("#f_coudeDescente"));
await page.fill("#f_coudeAvance", "1"); await page.press("#f_coudeAvance", "Enter");
check("évaporateur : avancée horizontale du coude", await page.evaluate(() => MF.projet().evaps[0].coudeAvance === 1));
await attendre(page, () => MF.champs.apercu && MF.champs.apercu.R.evaps[0].cotes[0].coude);
await page.screenshot({ path: path.join(SHOTS, "3c-coudes.png") });
await page.check('input[data-k="retombee"]');
check("évaporateur : retombée anti-bypass", await page.evaluate(() => MF.projet().evaps[0].retombee === true) && await page.isVisible("#f_retombeeBas"));
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(SHOTS, "3d-retombee.png") });
await page.click("#bAnnuler"); await page.click("#bAnnuler"); await page.click("#bAnnuler");
check("annuler : coudes retirés", await page.evaluate(() => MF.projet().evaps[0].coude === false));

// Retombée réglée à la main : poignée glissée à la souris, l'autre bout ne bouge pas
await page.click('[data-sel="' + await page.evaluate(() => MF.projet().evaps[0].id) + '"]');
await page.check('input[data-k="retombee"]');
await page.waitForTimeout(300);
const poi = await page.evaluate(() => MF.vue.poignees());
check("retombée : deux poignées affichées", poi.length === 2 && poi.every(q => q.q && q.q.retombee === 0), JSON.stringify(poi.map(q => [Math.round(q.x), Math.round(q.y)])));
const avant = await page.evaluate(() => { const e = MF.projet().evaps[0]; return { L: e.retombeeLargeur, d: e.retombeeDecal }; });
const tire = poi.slice().sort((a, b) => b.x - a.x)[0];
await page.mouse.move(tire.x, tire.y); await page.mouse.down();
for (let i = 1; i <= 8; i++) await page.mouse.move(tire.x + i * 12, tire.y + i * 2);
await page.mouse.up();
const apres = await page.evaluate(() => { const e = MF.projet().evaps[0]; return { L: e.retombeeLargeur, d: e.retombeeDecal, m: e.retombeeMurs }; });
const len0 = await page.evaluate(() => MF.projet().evaps[0].len);
check("retombée : longueur changée en tirant une poignée", avant.L == null && apres.L > len0 + 0.2 && apres.m === false, JSON.stringify(apres));
check("retombée : l'autre bout reste en place", Math.abs((apres.d - apres.L / 2) - (0 - len0 / 2)) < 0.03 || Math.abs((apres.d + apres.L / 2) - len0 / 2) < 0.03, JSON.stringify(apres));
check("retombée : champs largeur et décalage mis à jour", await page.inputValue("#f_retombeeLargeur") !== "" && await page.isVisible("#f_retombeeDecal"));
await page.screenshot({ path: path.join(SHOTS, "3e-retombee-main.png") });
await page.click("#bAnnuler"); await page.click("#bAnnuler");
check("annuler : retombée retirée", await page.evaluate(() => MF.projet().evaps[0].retombee === false && MF.projet().evaps[0].retombeeLargeur == null));

// Cotes : mode cote, accroche aux coins de la chambre, suppression
await page.click("#bCote");
check("cote : mode activé", await page.evaluate(() => MF.vue.coter()) && await page.isVisible("#sonde") && /Mode cote/.test(await page.textContent("#sonde")));
const c0 = await page.evaluate(() => MF.vue.ecran([0, 0, 0])), c1 = await page.evaluate(() => { const k = MF.projet().chambre; return MF.vue.ecran([k.longueur, 0, 0]); });
await page.mouse.move(c0.x + 6, c0.y - 5);
check("cote : accroche au coin signalée", /Coin de la chambre/.test(await page.textContent("#sonde")));
await page.mouse.click(c0.x + 6, c0.y - 5);
await page.mouse.move(c1.x - 5, c1.y + 4);
check("cote : longueur affichée pendant la visée", /9,00 m/.test(await page.textContent("#sonde")), (await page.textContent("#sonde")).slice(0, 60));
await page.mouse.click(c1.x - 5, c1.y + 4);
const cote = await page.evaluate(() => MF.projet().cotes);
check("cote : enregistrée entre les deux coins (9,00 m)", cote.length === 1 && cote[0].a.join() === "0,0,0" && cote[0].b.join() === "9,0,0", JSON.stringify(cote));
check("cote : étiquette dans la 3D", (await page.textContent(".etq.cote")).includes("9,00 m"));
// Point libre au sol, puis Échap : premier point abandonné
const mil = await page.evaluate(() => MF.vue.ecran([4.2, 3.1, 0]));
await page.keyboard.down("Shift"); await page.mouse.click(mil.x, mil.y); await page.keyboard.up("Shift");
check("cote : premier point libre posé", /second point/.test(await page.textContent("#sonde")));
await page.keyboard.press("Escape");
check("cote : Échap abandonne le point en cours", await page.evaluate(() => MF.vue.coter() && MF.projet().cotes.length === 1));
await page.screenshot({ path: path.join(SHOTS, "3f-cote.png") });
const png = await Promise.all([page.waitForEvent("download"), page.click("#bPng")]).then(([d]) => d.suggestedFilename());
check("cote : image PNG avec les cotes", /\.png$/.test(png));
await page.click(".etq.cote button");
check("cote : supprimée par sa croix", await page.evaluate(() => MF.projet().cotes.length === 0));
await page.click("#bAnnuler");
check("annuler : cote rétablie", await page.evaluate(() => MF.projet().cotes.length === 1));
await page.keyboard.press("Escape");
check("cote : Échap quitte le mode", await page.evaluate(() => !MF.vue.coter()) && await page.isHidden("#sonde"));
await page.click("#bAnnuler"); await page.click("#bAnnuler");
check("annuler : plus de cote", await page.evaluate(() => MF.projet().cotes.length === 0));

// Porte dans une cloison
await page.click('[data-sel="' + await page.evaluate(() => MF.projet().cloisons[0].id) + '"]');
await page.check('input[data-k="porte"]');
check("cloison : porte ajoutée", await page.evaluate(() => MF.projet().cloisons[0].porte === true) && await page.isVisible("#f_porteLargeur"));
await page.fill("#f_portePos", "1,5"); await page.press("#f_portePos", "Enter");
await page.fill("#f_porteLargeur", "1,2"); await page.press("#f_porteLargeur", "Enter");
check("cloison : position et largeur de la porte", await page.evaluate(() => { const c = MF.projet().cloisons[0]; return c.portePos === 1.5 && c.porteLargeur === 1.2 && c.porteOuverte === true; }));
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(SHOTS, "3g-porte-cloison.png") });
await page.selectOption("#f_porteOuverte", "false");
check("cloison : porte fermée", await page.evaluate(() => MF.projet().cloisons[0].porteOuverte === false) && /porte fermée/.test(await page.textContent("#listes")));
for (let i = 0; i < 4; i++) await page.click("#bAnnuler");
check("annuler : cloison sans porte", await page.evaluate(() => MF.projet().cloisons[0].porte === false));

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

// Bâtiment : exemple agroalimentaire, outils de flux masqués, local ajouté, retour au projet de chambre
const idChambre = await page.evaluate(() => MF.store.idCourant());
await page.click("#bProjets"); await page.click("#projBatimentEx");
check("bâtiment : exemple chargé (5 locaux collés, bureaux en L)", await page.evaluate(() => { const p = MF.projet(); return p.type === "batiment" && p.locaux.length === 5 && p.locaux[3].forme === "L"; }));
check("bâtiment : outils de flux masqués", await page.isHidden("#bCalcul") && await page.isHidden('[data-aff="particules"]') && await page.isHidden(".leg") && await page.isVisible("#bCote"));
check("bâtiment : listes locaux et machines, pas d'évaporateurs ni d'enveloppe", await page.isVisible('[data-ajout="locaux"]') && await page.isHidden('[data-ajout="evaps"]') && /Machines/.test(await page.textContent("#listes")) && /5 locaux/.test(await page.textContent("#chInfo")));
check("bâtiment : étiquettes des locaux", /Bureaux · \+20 °C/.test(await page.textContent(".vue3d-etiquettes")));
await page.screenshot({ path: path.join(SHOTS, "4b-batiment.png") });
// Nouveau local : posé à droite du bâtiment, puis glissé à la souris contre les vestiaires (aimantation)
await page.click('[data-ajout="locaux"]');
const nv = await page.evaluate(() => MF.projet().locaux[5]);
check("bâtiment : local ajouté collé à droite du bâtiment", Math.abs(nv.x - nv.L / 2 - 46) < 1e-6, JSON.stringify([nv.x, nv.y]));
await page.click('[data-vue="dessus"]'); await page.waitForTimeout(700);
const de = await page.evaluate(id => { const o = MF.projet().locaux.find(x => x.id === id); return MF.vue.ecran([o.x, o.y, 0.01]); }, nv.id);
// Sous les bureaux, contre le quai : bord gauche à 0,2 m du quai (x = 30), bord du fond à 0,15 m des bureaux (y = 8)
const vers = await page.evaluate(() => MF.vue.ecran([30.2 + 4, 7.85 - 3, 0.01]));
await page.mouse.move(de.x, de.y); await page.mouse.down();
for (let i = 1; i <= 10; i++) await page.mouse.move(de.x + (vers.x - de.x) * i / 10, de.y + (vers.y - de.y) * i / 10);
await page.mouse.up();
const colle = await page.evaluate(id => MF.projet().locaux.find(x => x.id === id), nv.id);
check("bâtiment : local glissé, collé contre le quai et les bureaux (aimantation)", Math.abs(colle.x - 34) < 1e-6 && Math.abs(colle.y - 5) < 1e-6, JSON.stringify([colle.x, colle.y]));
// En L
await page.selectOption("#f_forme", "L");
check("bâtiment : local passé en L", await page.evaluate(id => MF.projet().locaux.find(x => x.id === id).forme === "L", nv.id) && await page.isVisible("#f_coinLong"));
// Machine hors des locaux
await page.click('[data-ajout="obstacles"]');
const mac = await page.evaluate(() => { const p = MF.projet(), m = p.obstacles[p.obstacles.length - 1];
  return { x: m.x, y: m.y, nom: m.nom, dehors: p.locaux.every(o => Math.abs(m.x - o.x) > o.L / 2 || Math.abs(m.y - o.y) > o.l / 2) }; });
check("bâtiment : machine posée hors des locaux (non ramenée dedans)", mac.dehors && /^Machine/.test(mac.nom), JSON.stringify(mac));
// Porte du quai : suit le quai quand il bouge
const quai = await page.evaluate(() => MF.projet().locaux.find(o => o.nom === "Quai").id);
await page.click('[data-sel="' + quai + '"]');
await page.fill("#f_y", "3"); await page.press("#f_y", "Enter");
check("bâtiment : saisie de la position d'un local", await page.evaluate(id => MF.projet().locaux.find(o => o.id === id).y === 3, quai));
await page.click('[data-tab="res"]');
check("bâtiment : récapitulatif des locaux avec total", /Récapitulatif/.test(await page.textContent("#pane-res")) && /Total/.test(await page.textContent("#pane-res")) && (await page.textContent('[data-tab="res"]')) === "Récapitulatif");
check("bâtiment : pas de calcul des flux lancé", await page.evaluate(() => !MF.calculs.enCours()));
// Traitement d'air : composants de l'exemple, tracé d'une gaine depuis le soufflage de la CTA
check("traitement d'air : CTA, plénum, gaines et bouches de l'exemple", await page.evaluate(() => { const p = MF.projet(); return p.ctas.length === 1 && p.plenums.length === 1 && p.gaines.length === 3 && p.bouches.length === 2; }) && /CTA atelier · 12 000 m³\/h/.test((await page.textContent(".vue3d-etiquettes")).replace(/\s/g, " ")));
await page.click("#bGaine");
check("gaine : mode tracé", await page.evaluate(() => MF.vue.trace()) && /Tracé de gaine/.test(await page.textContent("#sonde")));
const souf = await page.evaluate(() => { const c = MF.projet().ctas[0]; return MF.vue.ecran([c.x - c.L / 2, c.y, c.z + c.h / 2]); });
await page.mouse.move(souf.x + 4, souf.y - 3);
check("gaine : accroche au soufflage de la CTA", /CTA atelier · soufflage/.test(await page.textContent("#sonde")));
await page.mouse.click(souf.x + 4, souf.y - 3);
const p2 = await page.evaluate(() => MF.vue.ecran([31.5, 18.03, 0.9]));
await page.mouse.click(p2.x, p2.y);
await page.keyboard.press("Enter");
const ga = await page.evaluate(() => { const p = MF.projet(); return p.gaines[p.gaines.length - 1]; });
check("gaine tracée : départ au soufflage, tracé à angle droit, débit de la CTA", ga && ga.points.length === 2 && ga.points[0].join() === "31.5,24,0.9" && ga.points[1][0] === 31.5 && Math.abs(ga.points[1][1] - 18) <= 0.051 && ga.q === 12000, JSON.stringify(ga && ga.points));
await page.selectOption("#f_forme", "rect");
check("gaine : section calculée (rectangulaire, 7 m/s)", /Section/.test(await page.textContent("#pane-prop")) && await page.evaluate(() => { const p = MF.projet(); return p.gaines[p.gaines.length - 1].forme === "rect"; }));
const sec7 = await page.textContent("#pane-prop h2 + .sous");
await page.click('[data-tab="regl"]');
await page.fill("#f_reglages\\.vmaxGaine", "5"); await page.press("#f_reglages\\.vmaxGaine", "Enter");
await page.click('[data-tab="prop"]');
const sec5 = await page.textContent("#pane-prop h2 + .sous");
check("gaine : vitesse maxi des réglages prise en compte", sec7 !== sec5, sec7 + " → " + sec5);
await page.click('[data-tab="res"]');
check("récapitulatif : métrés des gaines par type", /Gaines/.test(await page.textContent("#pane-res")) && /Total par type/.test(await page.textContent("#pane-res")) && /Centrales de traitement/.test(await page.textContent("#pane-res")));
await page.click('[data-vue="iso"]'); await page.waitForTimeout(600);
await page.screenshot({ path: path.join(SHOTS, "4c-batiment-locaux.png") });
// Changement de type depuis le panneau du projet, puis annulation
await page.click('[data-sel="chambre"]');
await page.selectOption("#f_projet\\.type", "chambre");
check("type changé en chambre froide : outils de flux revenus", await page.evaluate(() => MF.projet().type === "chambre") && await page.isVisible("#bCalcul") && await page.isHidden('[data-ajout="locaux"]'));
await page.click("#bAnnuler");
check("annuler : retour au bâtiment", await page.evaluate(() => MF.projet().type === "batiment") && await page.isHidden("#bCalcul"));
await page.evaluate(id => MF.store.ouvrir(id), idChambre);
await page.reload();
await attendre(page, () => window.MF && MF.champs.apercu);

// Rechargement : le projet est conservé
await page.waitForTimeout(400);
await page.reload();
await attendre(page, () => window.MF && MF.champs.apercu);
check("projet conservé après rechargement (cloison)", await page.evaluate(() => MF.projet().cloisons.length === 1 && MF.projet().cloisons[0].ep === 0.2));

// Export puis import
const nAvant = await page.evaluate(() => MF.store.liste().length);
const n = await page.evaluate(() => { const t = MF.store.exporter(false); return MF.store.importer(t); });
check("export puis import d'un projet", n === 1 && await page.evaluate(k => MF.store.liste().length === k + 1, nAvant));

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
