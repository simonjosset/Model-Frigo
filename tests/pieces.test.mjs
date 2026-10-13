import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliser, projetExemple, ajouter } from "../src/core/modele.js";
import { collerPiece, murLibre, garderDedans, pieceGeo } from "../src/core/geometrie.js";
import { construireGrille } from "../src/core/grille.js";
import { pointsAccroche } from "../src/core/cotes.js";

const ch = { longueur: 9, largeur: 6.5, H: 3.6 };

test("pièce voisine : valeurs par défaut, bornes, anciens projets sans pièces", () => {
  const p = normaliser({ chambre: ch, pieces: [{ nom: "Quai", x: "4,5", y: -2, L: 0.1, l: 4, T: "-30", H: 99 }] }), o = p.pieces[0];
  assert.deepEqual([o.x, o.y, o.L, o.l, o.T, o.H], [4.5, -2, 0.5, 4, -30, 30]);
  assert.deepEqual(normaliser({ chambre: ch }).pieces, []);
  const ex = normaliser(projetExemple());
  assert.equal(ex.pieces.length, 1); assert.equal(ex.pieces[0].nom, "Sas");
});

test("pièce collée contre un mur : toute la longueur du mur, profondeur = petit côté, premier mur libre", () => {
  const o = { x: 0, y: 0, L: 2, l: 3 };
  assert.deepEqual(collerPiece(o, ch, "avant"), { x: 4.5, y: -1, L: 9, l: 2 });
  assert.deepEqual(collerPiece(o, ch, "fond"), { x: 4.5, y: 7.5, L: 9, l: 2 });
  // Pièce du fond (9 × 3) recollée à gauche : 3 m de profondeur, pas 9
  assert.deepEqual(collerPiece({ L: 9, l: 3 }, ch, "gauche"), { x: -1.5, y: 3.25, L: 3, l: 6.5 });
  assert.deepEqual(collerPiece(o, ch, "gauche"), { x: -1, y: 3.25, L: 2, l: 6.5 });
  assert.deepEqual(collerPiece(o, ch, "droite"), { x: 10, y: 3.25, L: 2, l: 6.5 });
  const p = normaliser({ chambre: ch });
  assert.equal(murLibre(p.pieces, p.chambre), "avant");
  ajouter(p, "pieces", collerPiece(o, ch, "avant"));
  assert.equal(murLibre(p.pieces, p.chambre), "fond");
  ajouter(p, "pieces", collerPiece(o, ch, "fond")); ajouter(p, "pieces", collerPiece(o, ch, "gauche"));
  assert.equal(murLibre(p.pieces, p.chambre), "droite");
});

test("pièce voisine : décor hors de la chambre, sans effet sur le maillage ; accroche des cotes", () => {
  const p = normaliser({ chambre: ch, evaps: [{ x: 4.5, y: 5.8, dir: 270 }] });
  const sans = construireGrille(p, { h: 0.25 }).solide;
  ajouter(p, "pieces", { x: 4.5, y: -1.5, L: 9, l: 3 });
  const o = p.pieces[0];
  garderDedans("pieces", o, p.chambre);
  assert.deepEqual([o.x, o.y], [4.5, -1.5], "la pièce reste dehors");
  assert.deepEqual(construireGrille(p, { h: 0.25 }).solide, sans, "maillage inchangé");
  assert.deepEqual(pieceGeo(o).box, { x0: 0, x1: 9, y0: -3, y1: 0, z0: 0, z1: 3.6 });
  assert.ok(pointsAccroche(p).some(q => q.nom === o.nom && q.p[0] === 0 && q.p[1] === -3 && q.p[2] === 0));
});
