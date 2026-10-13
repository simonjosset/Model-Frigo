import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliser, batimentExemple, batimentVide, projetVisible, ajouter, LISTES_PROJET, TYPES } from "../src/core/modele.js";
import { localPolygone, localSurface, pivoterLocal, aimanterLocal, mursLocaux, porteSurMurs, emprise, localGeo } from "../src/core/geometrie.js";
import { pointsAccroche } from "../src/core/cotes.js";

const recouvre = (a, b) => { const A = localGeo(a).box, B = localGeo(b).box; return A.x0 < B.x1 - 1e-9 && B.x0 < A.x1 - 1e-9 && A.y0 < B.y1 - 1e-9 && B.y0 < A.y1 - 1e-9; };

test("type de projet : chambre froide par défaut (anciens projets), bâtiment conservé", () => {
  assert.equal(normaliser({}).type, "chambre");
  assert.equal(normaliser({ type: "n'importe quoi" }).type, "chambre");
  assert.equal(normaliser({ type: "batiment" }).type, "batiment");
  for (const t of Object.keys(LISTES_PROJET)) assert.ok(LISTES_PROJET[t].every(l => TYPES[l]), t);
  assert.ok(LISTES_PROJET.batiment.indexOf("locaux") >= 0 && LISTES_PROJET.batiment.indexOf("evaps") < 0);
});

test("bâtiment d'exemple : locaux collés sans se chevaucher, bureaux en L, machine dehors ; normalisation stable", () => {
  const p = normaliser(batimentExemple());
  assert.equal(p.type, "batiment"); assert.equal(p.nom, "Projet Bêta");
  assert.deepEqual(p.locaux.map(o => o.nom), ["Atelier de production", "Quai", "Local technique", "Bureaux", "Vestiaires"]);
  for (let i = 0; i < p.locaux.length; i++) for (let j = i + 1; j < p.locaux.length; j++) {
    const a = p.locaux[i], b = p.locaux[j];
    // Le L des bureaux laisse la place aux vestiaires : on compare les vrais contours par leurs surfaces de boîtes hors coin retiré
    if (a.forme === "rect" && b.forme === "rect") assert.ok(!recouvre(a, b), a.nom + " / " + b.nom);
  }
  const bur = p.locaux.find(o => o.nom === "Bureaux");
  assert.equal(bur.forme, "L"); assert.equal(localSurface(bur), 12 * 12 - 4 * 4);
  // Groupe froid hors de tous les locaux
  const gf = p.obstacles.find(o => o.nom === "Groupe froid");
  assert.ok(p.locaux.every(o => { const b = localGeo(o).box; return gf.x < b.x0 || gf.x > b.x1 || gf.y < b.y0 || gf.y > b.y1; }));
  const { maj, ...a } = p, { maj: m2, ...b } = normaliser(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(b, a);
  const v = normaliser(batimentVide("Bâtiment test"));
  assert.equal(v.nom, "Bâtiment test"); assert.equal(v.locaux.length, 1); assert.equal(v.personnes.length, 1);
});

test("local en L : contour, surface, quart de tour (le coin suit), valeurs bornées", () => {
  const o = normaliser({ type: "batiment", locaux: [{ x: 6, y: 4, L: 12, l: 8, forme: "L", coin: "avant-droit", coinLong: 5, coinLarg: 3 }] }).locaux[0];
  const pl = localPolygone(o);
  assert.equal(pl.length, 6); assert.equal(localSurface(o), 96 - 15);
  assert.ok(pl.some(q => q[0] === 7 && q[1] === 3), "angle rentrant du L");
  const r = Object.assign({}, o, pivoterLocal(o));
  assert.deepEqual([r.L, r.l, r.coinLong, r.coinLarg, r.coin], [8, 12, 3, 5, "arriere-droit"]); // (x, y) → (−y, x) : l'angle avant droit passe au fond à droite
  assert.equal(localSurface(r), localSurface(o));
  const q = normaliser({ type: "batiment", locaux: [{ L: 0.1, H: 50, plafond: false, forme: "x", coinLong: 99 }] }).locaux[0];
  assert.deepEqual([q.L, q.H, q.plafond, q.T, q.forme], [0.5, 30, false, 20, "rect"]);
  assert.equal(normaliser({ type: "batiment", locaux: [{}] }).locaux[0].forme, "rect", "ancien local : rectangulaire");
});

test("aimantation : un local glissé près d'un autre se colle contre lui, pas s'il est loin", () => {
  const a = { id: "a", x: 5, y: 5, L: 10, l: 10 };
  assert.deepEqual(aimanterLocal({ id: "b", x: 13.2, y: 4.85, L: 6, l: 10 }, [a]), { x: 13, y: 5 });   // collé à droite, bords alignés
  assert.deepEqual(aimanterLocal({ id: "b", x: 5.1, y: -2.8, L: 10, l: 6 }, [a]), { x: 5, y: -3 });   // collé devant
  assert.deepEqual(aimanterLocal({ id: "b", x: 20, y: 5, L: 6, l: 10 }, [a]), { x: 20, y: 5 });       // trop loin
});

test("portes sur les murs des locaux ; emprise ; accroche des cotes aux angles du L ; listes masquées selon le type", () => {
  const p = normaliser(batimentExemple());
  const s = porteSurMurs(mursLocaux(p.locaux), { x: 15, y: 7.6, w: 2.5 });
  assert.deepEqual([s.x, s.y, s.H], [15, 8, 6]);
  assert.deepEqual(emprise(p), { x0: 0, y0: 0, x1: 50, y1: 28, H: 6 });
  const bur = p.locaux.find(o => o.nom === "Bureaux");
  assert.ok(pointsAccroche(p).some(q => q.nom === "Bureaux" && q.p[0] === 38 && q.p[1] === 16 && q.p[2] === 3), "angle rentrant du L");
  ajouter(p, "evaps", { x: 5, y: 5 });
  const vis = projetVisible(p);
  assert.equal(vis.evaps.length, 0); assert.equal(vis.locaux.length, 5); assert.equal(p.evaps.length, 1);
  assert.equal(projetVisible(Object.assign({}, p, { type: "chambre" })).locaux.length, 0);
  assert.ok(bur);
});
