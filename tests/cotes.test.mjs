import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliser } from "../src/core/modele.js";
import { retombeesEvap, basRetombeeAuto, etirerRetombee, porteCloison, cloisonGeo } from "../src/core/geometrie.js";
import { construireGrille, SOLIDE } from "../src/core/grille.js";
import { pointsAccroche, mesure } from "../src/core/cotes.js";

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || "") + " : " + a + " ≠ " + b + " ± " + tol);
const ch = { longueur: 9, largeur: 6.5, H: 3.6 };
// Évaporateur au fond, soufflant vers l'avant (-y) : longueur de l'appareil suivant x
const projet = extra => normaliser(Object.assign({ chambre: ch, evaps: [Object.assign({ x: 4.5, y: 5.8, dir: 270, len: 2.4, retombee: true, retombeeBas: 2 }, extra || {})] }, {}));
const bouts = (p, s) => { const r = retombeesEvap(p.evaps[0], p.chambre, basRetombeeAuto(p)).find(x => x.s === (s || 0)); return [[r.x0, r.y0], [r.x1, r.y1]].sort((a, b) => a[0] - b[0]); };

test("retombée : un ancien projet garde sa retombée centrée (décalage 0 par défaut)", () => {
  const p = projet();
  assert.equal(p.evaps[0].retombeeDecal, 0);
  const [a, b] = bouts(p);
  near(a[0], 3.3, 1e-9); near(b[0], 5.7, 1e-9);
});

test("retombée étirée à la main : le bout tiré suit le pointeur, l'autre reste en place", () => {
  const p = projet(), e = p.evaps[0], bas = basRetombeeAuto(p);
  const r = retombeesEvap(e, p.chambre, bas)[0];
  const droite = r.x1 > r.x0 ? 1 : 0, fixe = droite ? [r.x0, r.y0] : [r.x1, r.y1];
  // Tirer le bout de droite à x = 7,03 (pas de 5 cm → 7,05)
  const v = etirerRetombee(e, p.chambre, bas, 0, droite, 7.03, 4.2, 0.05);
  assert.equal(v.retombeeMurs, false);
  Object.assign(e, v);
  const [a, b] = bouts(p);
  near(a[0], fixe[0], 1e-6, "bout gauche immobile"); near(b[0], 7.05, 1e-6, "bout droit tiré");
  near(e.retombeeLargeur, 3.75, 1e-6); near(e.retombeeDecal, 0.675, 1e-6);
  // Au-delà du mur : arrêtée au mur ; trop courte : largeur minimale de 20 cm
  Object.assign(e, etirerRetombee(e, p.chambre, bas, 0, droite, 50, 4.2, 0.05));
  near(bouts(p)[1][0], 9, 0.011, "bornée au mur");
  Object.assign(e, etirerRetombee(e, p.chambre, bas, 0, droite, 3.3, 4.2, 0.05));
  near(e.retombeeLargeur, 0.2, 1e-6);
});

test("retombée d'un appareil double flux : le même réglage s'applique des deux côtés", () => {
  const p = projet({ type: "double", dir: 90, y: 3.2, dep: 1 }), e = p.evaps[0], bas = basRetombeeAuto(p);
  Object.assign(e, { retombeeLargeur: 2, retombeeDecal: 1 });
  const g0 = bouts(p, 0), g1 = bouts(p, 1);
  // Soufflage vers +y : l'axe de l'appareil pointe vers -x, un décalage de +1 m décale donc vers x = 3,5
  near(g0[0][0], 2.5, 1e-9); near(g0[1][0], 4.5, 1e-9);
  near(g1[0][0], 2.5, 1e-9); near(g1[1][0], 4.5, 1e-9);
  // Mur à mur : le glissé repasse en largeur choisie
  e.retombeeMurs = true;
  const v = etirerRetombee(e, p.chambre, bas, 1, 0, 2, 3, 0.05);
  assert.equal(v.retombeeMurs, false); assert.ok(v.retombeeLargeur > 0.2);
});

test("porte dans une cloison : ouverture laissée libre au maillage si elle est ouverte", () => {
  const cl = { x0: 6, y0: 0, x1: 6, y1: 6.5, porte: true, porteLargeur: 1, porteHauteur: 2, portePos: 3 };
  const p = normaliser({ chambre: ch, cloisons: [cl] }), c = p.cloisons[0];
  const po = porteCloison(c, p.chambre);
  near(po.t0, 2.5, 1e-9); near(po.t1, 3.5, 1e-9); near(po.zh, 2, 1e-9); assert.equal(po.ouverte, true);
  const G = construireGrille(p, { h: 0.1 }), cel = (x, y, z) => G.solide[G.id(Math.floor(x / G.dx), Math.floor(y / G.dy), Math.floor(z / G.dz))];
  assert.equal(cel(6, 3, 1), SOLIDE.fluide, "passage par la porte");
  assert.equal(cel(6, 3, 2.6), SOLIDE.cloison, "imposte au-dessus de la porte");
  assert.equal(cel(6, 1, 1), SOLIDE.cloison, "cloison à côté de la porte");
  c.porteOuverte = false;
  assert.equal(construireGrille(p, { h: 0.1 }).solide[G.id(Math.floor(6 / G.dx), Math.floor(3 / G.dy), Math.floor(1 / G.dz))], SOLIDE.cloison, "porte fermée");
  // Porte plus large que la cloison ou poussée au bout : elle reste dans la cloison
  const q = porteCloison(Object.assign({}, c, { porteLargeur: 9, portePos: 0 }), p.chambre);
  near(q.t0, 0, 1e-9); near(q.t1, cloisonGeo(c, p.chambre).L, 1e-9);
  // Valeur « false » venue d'une liste déroulante, ancien projet sans porte
  assert.equal(normaliser({ chambre: ch, cloisons: [Object.assign({}, cl, { porteOuverte: "false" })] }).cloisons[0].porteOuverte, false);
  assert.equal(porteCloison(normaliser({ chambre: ch, cloisons: [{ x0: 1, y0: 0, x1: 1, y1: 3 }] }).cloisons[0], p.chambre), null);
});

test("cotes : points d'accroche (chambre, objets, retombée, porte de cloison) et mesure", () => {
  const p = normaliser({ chambre: ch, evaps: [{ x: 4.5, y: 5.8, dir: 270, retombee: true }], cloisons: [{ x0: 6, y0: 0, x1: 6, y1: 6.5, porte: true }],
    echelles: [{ x: 3, y: 3, n: 2, rangees: 1 }] });
  const pts = pointsAccroche(p), a = (x, y, z) => pts.some(q => Math.abs(q.p[0] - x) < 1e-6 && Math.abs(q.p[1] - y) < 1e-6 && Math.abs(q.p[2] - z) < 1e-6);
  assert.ok(a(0, 0, 0) && a(9, 6.5, 3.6) && a(4.5, 0, 0), "coins et milieux des murs");
  assert.ok(pts.some(q => /retombée/.test(q.nom)), "bouts de la retombée");
  assert.ok(a(6, 2.8, 0) && a(6, 3.7, 2), "coins de la porte de la cloison");
  assert.ok(pts.every(q => q.p.every(isFinite)));
  const m = mesure([0, 0, 0], [3, 4, 12]);
  assert.equal(m.L, 13); assert.equal(m.plan, 5); assert.equal(m.dz, 12);
});

test("cotes enregistrées dans le projet : normalisées, les illisibles écartées", () => {
  const p = normaliser({ chambre: ch, cotes: [{ a: [0, 0, 0], b: ["1,5", 2, 0.12345] }, { a: [0, 0] }, null, { a: [0, 0, 0], b: [NaN, 0, 0] }] });
  assert.equal(p.cotes.length, 1);
  assert.deepEqual(p.cotes[0].b, [1.5, 2, 0.123]);
  assert.ok(p.cotes[0].id);
  assert.deepEqual(normaliser({ chambre: ch }).cotes, []);
  // Stable : renormaliser ne change rien
  assert.deepEqual(normaliser(JSON.parse(JSON.stringify(p))), p);
});
