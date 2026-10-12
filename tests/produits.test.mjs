import { test } from "node:test";
import assert from "node:assert/strict";
import { echelleInfo, produitsLocaux, rangement, resistanceEchelle, produitDuCatalogue, CATALOGUE } from "../src/core/produits.js";

const echelle = (o) => Object.assign({ H: 1.875, W: 0.626, D: 0.507, etages: 23, etagesCharges: null, parEtage: null, produit: produitDuCatalogue("glace33") }, o || {});

test("pot de glace 3,3 kg dans une échelle de 23 glissières : 3 par étage, une glissière sur 2", () => {
  const i = echelleInfo(echelle());
  assert.equal(i.pack.n, 3);
  assert.equal(i.pas, 2);
  assert.ok(Math.abs(i.pitch - (1.875 - 0.12 - 0.08) / 23) < 1e-9);
  assert.equal(i.charges, i.maxNiveaux);
  assert.equal(i.nb, 3 * i.charges);
  assert.ok(Math.abs(i.masse - i.nb * 3.3) < 1e-9);
  assert.ok(i.zHaut <= 1.875 - 0.02 + 1e-9, "les produits restent sous le cadre haut");
  assert.ok(i.alertes.some(t => /une glissière sur 2/.test(t)));
});

test("produits par étage et étages chargés : saisie bornée au maximum", () => {
  const i = echelleInfo(echelle({ parEtage: 2, etagesCharges: 5 }));
  assert.equal(i.parEtage, 2); assert.equal(i.charges, 5); assert.equal(i.nb, 10);
  const j = echelleInfo(echelle({ parEtage: 50, etagesCharges: 500 }));
  assert.equal(j.parEtage, j.pack.n); assert.equal(j.charges, j.maxNiveaux);
  assert.equal(j.alertes.filter(t => /Au plus/.test(t)).length, 2);
});

test("rangement : meilleure des deux orientations", () => {
  assert.equal(rangement(0.6, 0.4, 0.3, 0.2).n, 4);
  assert.equal(rangement(0.4, 0.6, 0.3, 0.2).n, 4);
  assert.equal(rangement(0.1, 0.1, 0.3, 0.2).n, 0);
});

test("positions des produits : dans l'emprise de l'échelle, une boîte par produit", () => {
  const i = echelleInfo(echelle()), b = produitsLocaux(i);
  assert.equal(b.length, i.nb);
  for (const p of b) {
    assert.ok(Math.abs(p.x) + p.sx / 2 <= i.W / 2 + 1e-9 && Math.abs(p.y) + p.sy / 2 <= i.D / 2 + 1e-9);
    assert.ok(p.z >= 0.12 && p.z + p.sz <= i.H);
  }
});

test("résistance à l'air : nulle à vide, plus forte quand l'échelle est pleine", () => {
  assert.equal(resistanceEchelle(echelleInfo(echelle({ parEtage: 0 }))).cH, 0);
  const a = resistanceEchelle(echelleInfo(echelle({ parEtage: 1 }))), b = resistanceEchelle(echelleInfo(echelle()));
  assert.ok(b.cH > a.cH && a.cH > 0 && b.phiH < a.phiH);
});

test("catalogue : produits complets", () => {
  for (const c of CATALOGUE) for (const k of ["L", "l", "h", "m"]) assert.ok(c[k] > 0, c.ref + "." + k);
});
