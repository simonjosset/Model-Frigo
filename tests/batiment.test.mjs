import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliser, batimentExemple, batimentVide, projetVisible, ajouter, LISTES_PROJET, TYPES } from "../src/core/modele.js";
import { garderDedans, localGeo } from "../src/core/geometrie.js";
import { pointsAccroche } from "../src/core/cotes.js";

test("type de projet : chambre froide par défaut (anciens projets), bâtiment conservé", () => {
  assert.equal(normaliser({}).type, "chambre");
  assert.equal(normaliser({ type: "n'importe quoi" }).type, "chambre");
  assert.equal(normaliser({ type: "batiment" }).type, "batiment");
  for (const t of Object.keys(LISTES_PROJET)) assert.ok(LISTES_PROJET[t].every(l => TYPES[l]), t);
});

test("bâtiment d'exemple : hall agroalimentaire, locaux, lignes, quai ; nom de code ; normalisation stable", () => {
  const p = normaliser(batimentExemple());
  assert.equal(p.type, "batiment"); assert.equal(p.nom, "Projet Bêta");
  assert.deepEqual([p.chambre.longueur, p.chambre.largeur, p.chambre.H], [48, 30, 8]);
  assert.deepEqual(p.locaux.map(o => o.nom), ["Local technique", "Bureaux", "Vestiaires"]);
  assert.equal(p.obstacles.length, 2); assert.equal(p.pieces[0].nom, "Quai");
  // Locaux dans le hall
  p.locaux.forEach(o => { const b = localGeo(o).box; assert.ok(b.x0 >= 0 && b.y0 >= 0 && b.x1 <= 48 && b.y1 <= 30, o.nom); });
  const { maj, ...a } = p, { maj: m2, ...b } = normaliser(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(b, a);
  const v = normaliser(batimentVide("Hall test"));
  assert.equal(v.nom, "Hall test"); assert.equal(v.locaux.length, 0); assert.equal(v.personnes.length, 1);
});

test("local : valeurs bornées, gardé dans le hall, accroche des cotes ; listes masquées selon le type", () => {
  const p = normaliser({ type: "batiment", chambre: { longueur: 20, largeur: 10, H: 6 }, locaux: [{ L: 0.1, H: 50, plafond: false }] });
  const o = p.locaux[0];
  assert.deepEqual([o.L, o.H, o.plafond, o.T], [0.5, 30, false, 20]);
  const l = ajouter(p, "locaux", { x: 19, y: 9, L: 6, l: 4 });
  garderDedans("locaux", l, p.chambre);
  assert.deepEqual([l.x, l.y], [17, 8]);
  assert.ok(pointsAccroche(p).some(q => q.nom === l.nom && q.p[0] === 14 && q.p[1] === 6 && q.p[2] === 3));
  // Un évaporateur gardé d'un ancien type de projet n'est ni dessiné ni accroché en bâtiment
  ajouter(p, "evaps", { x: 5, y: 5 });
  const vis = projetVisible(p);
  assert.equal(vis.evaps.length, 0); assert.equal(vis.locaux.length, 2); assert.equal(p.evaps.length, 1);
  assert.equal(projetVisible(Object.assign({}, p, { type: "chambre" })).locaux.length, 0);
});
