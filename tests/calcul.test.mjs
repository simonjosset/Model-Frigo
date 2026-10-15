import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliser, projetExemple } from "../src/core/modele.js";
import { construireGrille, SOLIDE } from "../src/core/grille.js";
import { calculerApercu } from "../src/core/apercu.js";
import { preparer, pas, divergence, demarrer } from "../src/core/cfd.js";
import { vitesse } from "../src/core/champ.js";
import { analyser } from "../src/core/analyse.js";
import { evapGeo, retombeesEvap, deflecteurGeo } from "../src/core/geometrie.js";
import { simuler } from "../src/core/simulation.js";

const salle = extra => normaliser(Object.assign({ chambre: { longueur: 10, largeur: 6, H: 3.5 }, evaps: [{ nom: "E", x: 0.6, y: 3, dir: 0, len: 1.8, dep: 0.5, eh: 0.5, nf: 2, dv: 0.45, q: 6000, T: 7 }] }, extra || {}));

test("maillage : évaporateur plein, cloison pleine hauteur étanche, échelles poreuses", () => {
  const p = salle({ cloisons: [{ x0: 5, y0: 0, x1: 5, y1: 6 }], echelles: [{ x: 2.5, y: 3, n: 2, rangees: 1 }] });
  const G = construireGrille(p, { h: 0.2 });
  assert.ok(G.solide.some(s => s === SOLIDE.evap));
  // Aucune cellule d'air de part et d'autre de la cloison n'est reliée par une face
  const i5 = Math.floor(5 / G.dx);
  for (let k = 0; k < G.nz; k++) for (let j = 0; j < G.ny; j++) {
    const a = G.solide[G.id(i5 - 1, j, k)] === 0, b = G.solide[G.id(i5, j, k)] === 0, c = G.solide[G.id(i5 + 1, j, k)] === 0;
    assert.ok(!(a && b && c), "fuite à travers la cloison en j=" + j + " k=" + k);
  }
  assert.ok(G.produit.some(x => x) && G.cH.some(x => x > 0));
});

test("aperçu : jet soufflé dans le bon sens, vitesse nulle dans les cellules pleines", () => {
  const p = salle(), F = calculerApercu(p), o = [0, 0, 0];
  vitesse(F, 2.5, 3, 3.35, o);
  assert.ok(o[0] > 0.5, "vitesse vers +x au plafond : " + o[0]);
  for (let c = 0; c < F.G.n; c++) if (F.G.solide[c]) assert.equal(F.mag[c], 0);
});

test("calcul fin : débit soufflé = débit aspiré, écoulement à divergence nulle", () => {
  const p = salle(), G = construireGrille(p, { h: 0.25 }), S = preparer(G);
  let souffle = 0, aspire = 0;
  const flux = (arr, b, A) => { for (let f = 0; f < arr.length; f++) if (arr[f] && b[f]) { if (b[f] > 0) souffle += b[f] * A; else aspire -= b[f] * A; } };
  flux(S.fu, S.bu, G.dy * G.dz); flux(S.fv, S.bv, G.dx * G.dz); flux(S.fw, S.bw, G.dx * G.dy);
  // Soufflage vers +x et aspiration arrière vers +x : tout le débit est compté positif
  assert.ok(Math.abs(souffle - 2 * 6000 / 3600) < 1e-3, "souffle " + souffle);
  for (let i = 0; i < 20; i++) pas(S);
  assert.ok(divergence(S) < 0.05, "divergence " + divergence(S));
  assert.ok(S.U.every(Number.isFinite) && S.W.every(Number.isFinite));
});

test("calcul fin : le jet porte vers l'avant et l'air revient vers l'appareil", () => {
  const p = salle(), G = construireGrille(p, { h: 0.25 });
  const sim = demarrer(G, { init: calculerApercu(p, { grille: G }), tFin: 25 });
  while (!sim.fini) sim.avancer(50);
  const F = sim.resultat(), o = [0, 0, 0];
  vitesse(F, 3, 3, 3.3, o); assert.ok(o[0] > 0.3, "jet sous plafond " + o[0]);
  let retour = 0; for (let x = 2; x < 8; x += 0.5) { vitesse(F, x, 3, 0.4, o); retour += o[0]; }
  assert.ok(retour < 0, "retour d'air au sol vers l'évaporateur");
  const R = analyser(p, F);
  assert.ok(R.couverture > 0.2 && R.couverture <= 1);
  assert.equal(R.evaps.length, 1);
});

test("simulation complète sur un petit maillage, avec recalage", () => {
  const p = salle({ chambre: { longueur: 14, largeur: 5, H: 3.5 } });
  const F = simuler(p, { cellules: 9000 });
  assert.equal(F.info.methode, "cfd");
  assert.ok(F.info.passes >= 1 && F.info.passes <= 3);
  assert.ok(Array.isArray(F.info.recalage) && F.info.recalage.length === 1);
});

test("analyse : alertes sans évaporateur et chevauchement d'objets", () => {
  const p = normaliser({ chambre: { longueur: 6, largeur: 5, H: 3 }, obstacles: [{ x: 2, y: 2, L: 1, l: 1, h: 1 }, { x: 2.3, y: 2.2, L: 1, l: 1, h: 1 }] });
  const R = analyser(p, calculerApercu(p));
  assert.ok(R.alertes.some(a => a.titre === "Aucun évaporateur"));
  assert.ok(R.alertes.some(a => /se chevauchent/.test(a.texte)));
});

test("projet d'exemple : analyse complète sans erreur", () => {
  const p = projetExemple(), R = analyser(p, calculerApercu(p));
  assert.equal(R.totaux.echelles, 14);
  const ec = R.echelles[0];
  assert.equal(ec.chariots.length, 14);
  assert.equal(ec.chariots[0].etages.length, ec.info.charges, "une vitesse par étage chargé");
  for (const c of ec.chariots) for (const t of c.etages) assert.ok(t.v >= 0 && t.vPassage >= t.v && t.z > 0 && t.z < 1.875);
  assert.ok(R.produits.n > 0 && R.taux > 30);
});

test("coudes vers le bas : l'air sort sous chaque coude, débit conservé, jet descendant", () => {
  const p = salle(); p.evaps[0].coude = true; p.evaps[0].coudeDescente = 0.2;
  const G = construireGrille(p, { h: 0.2 }), S = preparer(G);
  let bas = 0, horiz = 0;
  for (let f = 0; f < S.NW; f++) if (S.fw[f] && S.bw[f] < 0) bas -= S.bw[f] * G.dx * G.dy;
  for (let f = 0; f < S.NU; f++) if (S.fu[f] && S.bu[f] > 0 && f % (G.nx + 1) > 3) horiz += S.bu[f];
  assert.ok(Math.abs(bas - 6000 / 3600) < 1e-3, "débit soufflé vers le bas " + bas);
  assert.equal(horiz, 0, "plus de soufflage horizontal");
  const sim = demarrer(G, { init: calculerApercu(p, { grille: G }), tFin: 20 });
  while (!sim.fini) sim.avancer(50);
  const F = sim.resultat(), so = evapGeo(p.evaps[0], p.chambre).cotes[0].fans[0].coude.sortie, o = [0, 0, 0];
  vitesse(F, so[0], so[1], so[2] - 0.5, o);
  assert.ok(o[2] < -0.5, "jet descendant sous la sortie : " + o[2]);
  const R = analyser(p, F);
  assert.ok(R.evaps[0].cotes[0].coude && R.evaps[0].cotes[0].vArrivee > 0);
  assert.ok(R.alertes.some(a => /soufflage vers le bas/.test(a.titre)));
});

test("coude avec avancée horizontale : sortie déportée vers l'avant, encombrement allongé", () => {
  const p = salle(); p.evaps[0].coude = true; p.evaps[0].coudeAvance = 1.2;
  const g = evapGeo(p.evaps[0], p.chambre), f = g.cotes[0].fans[0], g0 = evapGeo(Object.assign({}, p.evaps[0], { coudeAvance: 0 }), p.chambre).cotes[0].fans[0];
  assert.ok(Math.abs(f.coude.sortie[0] - g0.coude.sortie[0] - 1.2) < 1e-9, "sortie avancée de 1,2 m suivant le soufflage (+x)");
  assert.ok(Math.abs((f.coude.box.x1 - f.coude.box.x0) - (1.2 + g.dv)) < 1e-9);
  const G = construireGrille(p, { h: 0.2 }), S = preparer(G);
  let bas = 0; for (let k = 0; k < S.NW; k++) if (S.fw[k] && S.bw[k] < 0) bas -= S.bw[k] * G.dx * G.dy;
  assert.ok(Math.abs(bas - 6000 / 3600) < 1e-3);
  p.evaps[0].coudeAvance = 20;
  const R = analyser(p, calculerApercu(p));
  assert.ok(R.alertes.some(a => /coude trop long/.test(a.titre)));
});

test("retombée anti-bypass : panneau devant l'évaporateur, du plafond jusqu'au-dessus des échelles", () => {
  const p = salle({ echelles: [{ x: 3.2, y: 3, n: 4, rangees: 1, dir: 90 }] });
  Object.assign(p.evaps[0], { coude: true, retombee: true, retombeeDist: 0.7, retombeeMurs: true });
  const rts = retombeesEvap(p.evaps[0], p.chambre, 1.9);
  assert.equal(rts.length, 1);
  const rt = rts[0];
  assert.ok(Math.abs(rt.x0 - rt.x1) < 1e-9 && Math.abs(Math.min(rt.y0, rt.y1)) < 0.05 && Math.abs(Math.max(rt.y0, rt.y1) - 6) < 0.05, "d'un mur à l'autre suivant y");
  assert.equal(rt.zh, 3.5); assert.equal(rt.zb, 1.9);
  const G = construireGrille(p, { h: 0.2 }), i = Math.floor(rt.x0 / G.dx), j = Math.floor(3 / G.dy);
  assert.ok(G.solide[G.id(i, j, Math.floor(3 / G.dz))] > 0, "plein en haut");
  assert.equal(G.solide[G.id(i, j, Math.floor(1 / G.dz))], 0, "libre sous la retombée");
  const R = analyser(p, calculerApercu(p, { grille: G }));
  const ar = R.retombees[0];
  assert.ok(Math.abs(ar.hEchelles - 1.875) < 1e-9 && Math.abs(ar.jour - 0.02) < 1e-6, "bas auto = haut des échelles + 2 cm : " + JSON.stringify(ar));
  // Retombée trop haute : bypass signalé
  p.evaps[0].retombeeBas = 2.6;
  const R2 = analyser(p, calculerApercu(p));
  assert.ok(R2.alertes.some(a => /bypass au-dessus des échelles/.test(a.titre)));
  // Retombée au-delà des sorties des coudes : signalée comme mal placée
  Object.assign(p.evaps[0], { retombeeDist: 2.5, retombeeBas: null });
  assert.ok(analyser(p, calculerApercu(p)).alertes.some(a => /mal placée/.test(a.titre)));
  Object.assign(p.evaps[0], { coudeAvance: 2.0, retombeeDist: 1.1 });
  assert.ok(!analyser(p, calculerApercu(p)).alertes.some(a => /mal placée/.test(a.titre)), "entre sortie et reprise : pas d'alerte");
});

test("déflecteur d'angle : accroché au mur, coin plafond / mur plein derrière l'arrondi", () => {
  const p = salle({ deflecteurs: [{ x: 9.7, y: 3, longueur: 4, rayon: 0.8, angle: "plafond" }] });
  const g = deflecteurGeo(p.deflecteurs[0], p.chambre);
  assert.equal(g.x, 10); assert.ok(Math.abs(g.ix + 1) < 1e-9, "arrondi tourné vers l'intérieur (−x)");
  const G = construireGrille(p, { h: 0.1 }), cell = (x, y, z) => G.solide[G.id(Math.floor(x / G.dx), Math.floor(y / G.dy), Math.floor(z / G.dz))];
  assert.equal(cell(9.95, 3, 3.45), 5, "tout contre l'angle : plein");
  assert.equal(cell(9.5, 3, 3.0), 0, "devant l'arrondi : air");
  assert.equal(cell(9.95, 0.5, 3.45), 0, "hors de la longueur du déflecteur : air");
  const F = calculerApercu(p, { grille: G });
  assert.ok(F.mag.every(Number.isFinite));
  p.deflecteurs[0].angle = "sol";
  const G2 = construireGrille(p, { h: 0.1 });
  assert.equal(G2.solide[G2.id(Math.floor(9.95 / G2.dx), Math.floor(3 / G2.dy), 0)], 5, "angle sol / mur plein");
});

test("cloison horizontale (faux plafond) : couche pleine sur le rectangle, air au-dessus et autour", () => {
  const p = salle({ cloisons: [{ x0: 3, y0: 1, x1: 8, y1: 5, horizontale: true, zb: 2.6, ep: 0.05 }] });
  assert.equal(p.cloisons[0].horizontale, true);
  const G = construireGrille(p, { h: 0.1 }), so = (x, y, z) => G.solide[G.id(Math.floor(x / G.dx), Math.floor(y / G.dy), Math.floor(z / G.dz))];
  assert.equal(so(5, 3, 2.62), SOLIDE.cloison, "panneau");
  assert.equal(so(5, 3, 3.1), 0, "air au-dessus");
  assert.equal(so(5, 3, 2.0), 0, "air dessous");
  assert.equal(so(9, 3, 2.62), 0, "air à côté du panneau");
  // Pas de fuite verticale à travers le panneau
  const k = Math.floor(2.62 / G.dz);
  for (let j = Math.ceil(1.1 / G.dy); j < Math.floor(4.9 / G.dy); j++) for (let i = Math.ceil(3.1 / G.dx); i < Math.floor(7.9 / G.dx); i++) assert.ok(G.solide[G.id(i, j, k)], "trou en " + i + "," + j);
  // Une cloison verticale reste verticale
  assert.equal(normaliser({ cloisons: [{ x0: 1, y0: 0, x1: 1, y1: 3 }] }).cloisons[0].horizontale, false);
});
