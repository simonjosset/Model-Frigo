import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliser, projetExemple, ajouter, dupliquer, trouver, LISTES } from "../src/core/modele.js";

test("projet d'exemple : nom de code, objets valides, normalisation stable", () => {
  const p = projetExemple();
  assert.equal(p.nom, "Projet Alpha");
  assert.ok(p.evaps.length && p.echelles.length && p.portes.length);
  const n = normaliser(JSON.parse(JSON.stringify(p)));
  n.maj = p.maj;
  assert.deepEqual(n, p);
});

test("normaliser : fichier vide ou abîmé → projet utilisable", () => {
  const p = normaliser({ chambre: { longueur: "7,5", H: -3 }, evaps: [null, { q: "abc", dir: 47 }], echelles: "x", reglages: { maille: "inconnue" } });
  assert.equal(p.chambre.longueur, 7.5);
  assert.equal(p.chambre.H, 1.2);
  assert.equal(p.evaps.length, 1);
  assert.equal(p.evaps[0].dir, 90);
  assert.equal(p.evaps[0].q, 12000);
  assert.deepEqual(p.echelles, []);
  assert.equal(p.reglages.maille, "normal");
  for (const l of LISTES) assert.ok(Array.isArray(p[l]));
});

test("ajouter, dupliquer, trouver : identifiants uniques, noms numérotés", () => {
  const p = normaliser({});
  const a = ajouter(p, "cloisons"), b = ajouter(p, "cloisons"), c = dupliquer(p, "cloisons", a.id);
  assert.notEqual(a.id, b.id); assert.notEqual(a.id, c.id);
  assert.equal(a.nom, "Cloison 1"); assert.equal(b.nom, "Cloison 2"); assert.match(c.nom, /copie/);
  assert.equal(trouver(p, b.id).liste, "cloisons");
  assert.equal(trouver(p, "absent"), null);
});

test("ancien format de chambre en L (branches a, B, c, b) : converti en rectangle moins le coin avant droit", () => {
  const p = normaliser({ chambre: { forme: "L", a: 6, B: 8, c: 4, b: 3, H: 3.5 } });
  assert.equal(p.chambre.longueur, 10); assert.equal(p.chambre.largeur, 8);
  assert.equal(p.chambre.coin, "avant-droit"); assert.equal(p.chambre.coinLong, 4); assert.equal(p.chambre.coinLarg, 5);
  assert.equal(p.chambre.a, undefined);
  const r = normaliser({ chambre: { forme: "rect", a: 7, B: 5 } });
  assert.equal(r.chambre.longueur, 7); assert.equal(r.chambre.largeur, 5);
});
