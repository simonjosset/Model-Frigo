import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliser, ajouter, projetExemple } from "../src/core/modele.js";
import { celluleGeo, echellesGeo, EP_CELLULE } from "../src/core/geometrie.js";
import { construireGrille, SOLIDE, cellule } from "../src/core/grille.js";
import { calculerApercu } from "../src/core/apercu.js";
import { analyser } from "../src/core/analyse.js";
import { simuler } from "../src/core/simulation.js";

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || "") + " : " + a + " ≠ " + b + " ± " + tol);
const salle = (cel, extra) => normaliser(Object.assign({
  chambre: { longueur: 9, largeur: 7, H: 3.5 },
  evaps: [{ nom: "E", x: 4.5, y: 6.6, dir: 270, len: 2.4, dep: 0.6, eh: 0.6, nf: 3, dv: 0.5, q: 9000, T: 8 }],
  cellules: [Object.assign({ nom: "Cellule A", x: 4.5, y: 2.5, dir: 90, places: 3 }, cel || {})]
}, extra || {}));

test("cellule : valeurs par défaut, normalisation, anciens projets sans cellules", () => {
  const p = projetExemple(), c = ajouter(p, "cellules", { places: "4", sortie: "n'importe quoi", q: -5 });
  assert.equal(c.places, 4); assert.equal(c.sortie, "arriere"); assert.equal(c.q, 100);
  assert.equal(c.produit.ref, "glace33"); assert.equal(c.etanche, false); assert.equal(c.hauteur, null);
  const ancien = JSON.parse(JSON.stringify(projetExemple())); delete ancien.cellules;
  assert.deepEqual(normaliser(ancien).cellules, []);
});

test("cellule : une place par échelle, échelles au milieu de leur place, caisson à l'arrière", () => {
  const c = salle().cellules[0], g = celluleGeo(c), e = echellesGeo(g.echelles);
  assert.equal(g.places.length, 3); assert.equal(e.total, 3); assert.equal(g.echelles.id, c.id);
  near(g.Wtot, 3 * (c.W + 2 * c.jeu) + 4 * EP_CELLULE, 1e-9, "largeur hors tout");
  near(g.Ltot, c.D + 2 * c.jeu + c.caisson, 1e-9, "profondeur hors tout");
  near(g.Hc, c.H + 0.15, 1e-9, "hauteur intérieure automatique");
  // Passage de l'air vers +y : façade en bas (y petit), caisson en haut ; chaque échelle au centre de sa place
  g.places.forEach(pl => {
    const ch = e.chariots.find(x => Math.abs(x.cx - (c.x + g.b[0] * pl.tc)) < 1e-6);
    assert.ok(ch, "échelle de la place " + pl.k);
    near(ch.cy, c.y + (g.sF + g.sC) / 2, 1e-9);
    assert.ok(pl.caisson.y0 >= ch.y1 - 1e-9, "caisson derrière l'échelle");
    near(pl.sortie.c[1], g.box.y1, 1e-9, "rejet à l'arrière");
  });
  const h = celluleGeo(Object.assign({}, c, { sortie: "haut" }));
  near(h.places[0].sortie.c[2], h.Ht, 1e-9); assert.deepEqual(h.places[0].sortie.n, [0, 0, 1]);
  // Étanchéité : joints sur les côtés de chaque place et sous le toit
  assert.equal(celluleGeo(Object.assign({}, c, { etanche: true })).joints.length, 9);
});

test("cellule : parois et caissons pleins, échelles poreuses dans le maillage", () => {
  const p = salle(), G = construireGrille(p, { h: 0.1 }), g = celluleGeo(p.cellules[0]);
  assert.equal(G.cellules.length, 1); assert.equal(G.echelles.length, 1);
  const so = (x, y, z) => { const [i, j, k] = cellule(G, x, y, z); return G.solide[G.id(i, j, k)]; };
  const pl = g.places[1], m = g.pt((g.sF + g.sC) / 2, pl.tc, 0);
  // Toit et caisson : pleins ; milieu de la place : produits
  assert.equal(so(m[0], m[1], g.Hc + 0.02), SOLIDE.cellule);
  assert.equal(so((pl.caisson.x0 + pl.caisson.x1) / 2, (pl.caisson.y0 + pl.caisson.y1) / 2, 1), SOLIDE.cellule);
  const [i, j, k] = cellule(G, m[0], m[1], 1);
  assert.equal(G.solide[G.id(i, j, k)], 0); assert.equal(G.produit[G.id(i, j, k)], 1);
});

test("cellule : l'air traverse les échelles vers les ventilateurs (aperçu et calcul fin)", () => {
  const p = salle();
  const A = analyser(p, calculerApercu(p));
  assert.equal(A.cellules.length, 1);
  A.cellules[0].places.forEach(pl => assert.ok(pl.v > 0.3, "aperçu, place " + pl.k + " : " + pl.v));
  const F = simuler(p, { cellules: 40000, recalage: false }), R = analyser(p, F), c = R.cellules[0];
  c.places.forEach(pl => {
    assert.ok(pl.v > 0.5, "calcul fin, place " + pl.k + " : " + pl.v + " m/s");
    assert.ok(pl.qMesure > 0.7 * pl.q, "débit à travers la place " + pl.k + " : " + pl.qMesure + " / " + pl.q);
  });
  assert.ok(!(F.info.avert || []).length, (F.info.avert || []).join(" ; "));
  assert.ok(R.alertes.some(a => a.id === p.cellules[0].id && a.niveau === "ok"));
});

test("cellule : alertes de dégagement (rejet contre le mur, façade encombrée)", () => {
  const g = celluleGeo(salle().cellules[0]);
  // Dos de la cellule à 20 cm du mur du fond
  const p = salle({ y: 7 - 0.2 - g.Ltot / 2 }, { evaps: [] });
  const R = analyser(p, calculerApercu(p));
  assert.ok(R.alertes.some(a => /rejet contre une paroi/.test(a.titre)), R.alertes.map(a => a.titre).join(" | "));
  assert.ok(R.alertes.some(a => a.titre === "Aucun évaporateur" && a.niveau === "warn"));
  const q = salle({ y: 0.3 + g.Ltot / 2 });
  assert.ok(analyser(q, calculerApercu(q)).alertes.some(a => /façade encombrée/.test(a.titre)));
});
