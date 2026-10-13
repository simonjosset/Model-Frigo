import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliser, batimentExemple, ajouter } from "../src/core/modele.js";
import { ctaGeo, boucheGeo, gaineTrace, gaineSection, gaineMetres, metresGaines, routeOrtho, texteSection, SECTIONS_CTA, gaineEnveloppe, raccordBout } from "../src/core/composants.js";
import { pointsAccroche } from "../src/core/cotes.js";
import { construireGrille } from "../src/core/grille.js";

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || "") + " : " + a + " ≠ " + b + " ± " + tol);

test("gaine : section automatique identique à l'onglet Gaines de Frigobilan", () => {
  const r = { vmaxGaine: 7, ratioGaine: 4 };
  assert.deepEqual([gaineSection({ forme: "rect", auto: true, q: 5000 }, r).a, gaineSection({ forme: "rect", auto: true, q: 5000 }, r).b], [500, 400]);
  assert.equal(gaineSection({ forme: "rect", auto: true, q: 5000, hmax: 250 }, r).a, 800);
  assert.equal(gaineSection({ forme: "rond", auto: true, q: 5000 }, r).d, 560);
  assert.equal(gaineSection({ forme: "textile", auto: true, q: 8000 }, r).d, 710);
  assert.equal(gaineSection({ forme: "rond", auto: true, q: 5000 }, { vmaxGaine: 4 }).d, 710, "vitesse maxi des réglages");
  // Section imposée : vitesse et Pa/m recalculées (Ø 400 à 3 000 m³/h : 6,63 m/s, 1,22 Pa/m)
  const s = gaineSection({ forme: "rond", auto: false, q: 3000, d: 400 }, r);
  near(s.v, 6.63, 0.01); near(s.pam, 1.22, 0.05);
  assert.equal(gaineSection({ forme: "textile", auto: false, q: 3000, d: 400 }, r).pam, null, "pas de Pa/m pour le textile");
  assert.match(gaineSection({ forme: "rect", auto: true, q: 0 }, r).erreur, /Débit/);
  assert.equal(texteSection({ forme: "rect", a: 500, b: 400 }), "500 × 400"); assert.equal(texteSection({ forme: "rond", d: 560 }), "Ø 560");
});

test("gaine : tracé, coudes, métrés (longueur, surface de tôle ou de tissu, perte de charge)", () => {
  const t = gaineTrace([[0, 0, 3], [10, 0, 3], [10, 0, 3], [10, 5, 3], [10, 5, 1], [10, 5, 0]]);
  assert.equal(t.seg.length, 4, "point double ignoré"); assert.equal(t.L, 18); assert.equal(t.coudes, 2, "deux changements de direction");
  const m = gaineMetres({ forme: "rect", auto: true, q: 5000, points: [[0, 0, 3], [10, 0, 3], [10, 5, 3]] }, { vmaxGaine: 7 });
  assert.equal(m.L, 15); assert.equal(m.coudes, 1); near(m.surface, 2 * (0.5 + 0.4) * 15, 1e-9); near(m.pdc, m.section.pam * 15, 1e-9);
  const tx = gaineMetres({ forme: "textile", auto: true, q: 8000, points: [[0, 0, 4], [12, 0, 4]] }, {});
  near(tx.surface, Math.PI * 0.71 * 12, 1e-9); assert.equal(tx.pdc, null);
  const tot = metresGaines([{ forme: "rect", auto: true, q: 5000, points: [[0, 0, 3], [10, 0, 3]] }, { forme: "rect", auto: true, q: 2000, points: [[0, 0, 3], [0, 4, 3]] }, { forme: "textile", auto: true, q: 8000, points: [[0, 0, 4], [12, 0, 4]] }], {});
  assert.deepEqual(tot.map(x => [x.forme, x.L, x.n]), [["rect", 14, 2], ["textile", 12, 1]]);
});

test("tracé orthogonal vers une accroche : x, puis y, puis z", () => {
  assert.deepEqual(routeOrtho([0, 0, 3], [4, 2, 1]), [[4, 0, 3], [4, 2, 3], [4, 2, 1]]);
  assert.deepEqual(routeOrtho([0, 0, 3], [4, 0, 3]), [[4, 0, 3]]);
  assert.deepEqual(routeOrtho([1, 1, 1], [1, 1, 1]), []);
});

test("CTA : sections de la reprise au soufflage, piquages avant et arrière suivant le sens de soufflage", () => {
  const c = ctaGeo({ x: 10, y: 5, z: 0, dir: 180, L: 5, l: 1.6, h: 1.8 });
  assert.deepEqual(c.soufflage.c, [7.5, 5, 0.9]); assert.deepEqual(c.reprise.c, [12.5, 5, 0.9]);
  near(c.sections[c.sections.length - 1].t1, 2.5, 1e-9); assert.equal(c.sections.length, SECTIONS_CTA.length);
  near(SECTIONS_CTA.reduce((s, x) => s + x.part, 0), 1, 1e-9);
  assert.deepEqual(boucheGeo({ x: 1, y: 2, z: 3, pose: "plafond", w: 0.6, h: 0.6 }).n, [0, 0, -1]);
  assert.deepEqual(boucheGeo({ x: 1, y: 2, z: 3, pose: "murale", dir: 90, w: 0.6, h: 0.6 }).n, [0, 1, 0]);
});

test("bâtiment d'exemple : CTA, plénum, gaines raccordées, bouches ; accroches ; hors maillage ; normalisation", () => {
  const p = normaliser(batimentExemple());
  assert.equal(p.ctas.length, 1); assert.equal(p.plenums.length, 1); assert.equal(p.gaines.length, 3); assert.equal(p.bouches.length, 2);
  const acc = pointsAccroche(p), cta = ctaGeo(p.ctas[0]);
  assert.ok(acc.some(q => q.ref && q.ref.quoi === "soufflage" && q.p.join() === cta.soufflage.c.join()));
  assert.deepEqual(p.gaines[0].points[0], cta.soufflage.c, "la gaine de départ part du soufflage de la CTA");
  assert.ok(acc.some(q => /Plénum de soufflage · face/.test(q.nom) && q.p.join() === p.gaines[0].points[2].join()), "et arrive sous le plénum");
  // Gaines, points, bornes
  const g = normaliser({ type: "batiment", gaines: [{ points: [[0, 0, 0], ["1,5", 2, 3]], forme: "x", a: 10, hmax: "" }, { points: [[0, 0]] }] }).gaines;
  assert.deepEqual(g[0].points[1], [1.5, 2, 3]); assert.equal(g[0].forme, "rect"); assert.equal(g[0].a, 50); assert.equal(g[0].hmax, null);
  assert.equal(g[1].points.length, 2, "gaine illisible : tracé par défaut");
  assert.equal(normaliser({}).reglages.vmaxGaine, 7);
  // Le traitement d'air n'entre pas dans le maillage (pas de calcul des flux en bâtiment)
  const q = normaliser({ chambre: { longueur: 9, largeur: 6.5, H: 3.6 } }), sans = construireGrille(q, { h: 0.25 }).solide;
  ajouter(q, "ctas", { x: 4, y: 3 }); ajouter(q, "gaines", {});
  assert.deepEqual(construireGrille(q, { h: 0.25 }).solide, sans);
});

/* Deux anneaux identiques à l'ordre près (raccord sans décalage) */
function memesSommets(a, b) {
  assert.equal(a.length, b.length);
  a.forEach(p => assert.ok(b.some(q => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 1e-9), "sommet sans vis-à-vis : " + p));
}
test("gaine rectangulaire : coudes coupés d'onglet, raccords sans décalage, largeur horizontale", () => {
  const sec = { forme: "rect", a: 600, b: 300 };
  const env = gaineEnveloppe([[0, 0, 3], [4, 0, 3], [6, 0, 3], [6, 5, 3], [6, 5, 1]], sec);
  assert.equal(env.rond, false);
  assert.equal(env.troncons.length, 3, "points alignés fusionnés");
  const [t0, t1, t2] = env.troncons;
  memesSommets(t0.b, t1.a); memesSommets(t1.b, t2.a);
  // Tronçon horizontal : 0,30 m de haut, 0,60 m de large en travers
  const zs = t0.a.map(p => p[2]), ys = t0.a.map(p => p[1]);
  near(Math.max(...zs) - Math.min(...zs), 0.3, 1e-9); near(Math.max(...ys) - Math.min(...ys), 0.6, 1e-9);
  // Coude horizontal à 90° : angle extérieur au point (6,3 ; -0,3), intérieur à (5,7 ; 0,3)
  assert.ok(t0.b.some(p => Math.abs(p[0] - 6.3) < 1e-9 && Math.abs(p[1] + 0.3) < 1e-9));
  assert.ok(t0.b.some(p => Math.abs(p[0] - 5.7) < 1e-9 && Math.abs(p[1] - 0.3) < 1e-9));
  // Descente : garde l'orientation du tronçon précédent (0,60 en x, 0,30 en y), bout bas coupé droit à z = 1
  const xs = t2.b.map(p => p[0]), y2 = t2.b.map(p => p[1]);
  near(Math.max(...xs) - Math.min(...xs), 0.6, 1e-9); near(Math.max(...y2) - Math.min(...y2), 0.3, 1e-9);
  t2.b.forEach(p => near(p[2], 1, 1e-9));
  // Gaine ronde : anneaux raccordés aussi
  const r = gaineEnveloppe([[0, 0, 3], [4, 0, 3], [4, 0, 1]], { forme: "rond", d: 400 });
  assert.equal(r.rond, true); memesSommets(r.troncons[0].b, r.troncons[1].a);
});
test("gaine : raccord bout à bout avec une autre gaine, onglet ou botte", () => {
  const A = { id: "a", forme: "rect", a: 400, b: 200, points: [[0, 0, 3], [4, 0, 3]] }, B = { id: "b", forme: "rect", a: 400, b: 200, points: [[4, 0, 3], [4, 3, 3]] };
  const C = { id: "c", forme: "rect", a: 400, b: 200, points: [[2, 0, 3], [2, -3, 3]] };
  const d = raccordBout([A, B, C], "b", B.points[0]);
  assert.deepEqual(d.u, [1, 0, 0]);
  const fin = raccordBout([A, B, C], "a", A.points[1]);
  assert.deepEqual(fin.u, [0, -1, 0]);
  const ea = gaineEnveloppe(A.points, A, null, { u: fin.u.map(x => -x), r: fin.r }), eb = gaineEnveloppe(B.points, B, d, null);
  memesSommets(ea.troncons[0].b, eb.troncons[0].a);
  assert.equal(ea.troncons[0].capB, false); assert.equal(ea.troncons[0].capA, true);
  assert.equal(raccordBout([A, B, C], "c", C.points[0]), null, "départ au milieu d'une gaine : pas d'onglet");
  // Descente (orientée sur le tronçon en y) puis départ en x : sections tournées, raccord en botte
  const sec = { forme: "rect", a: 800, b: 300 };
  const env = gaineEnveloppe([[4, 0, 2.5], [4, 4, 2.5], [4, 4, 0.8], [1.5, 4, 0.8]], sec);
  const bas = env.troncons[1], dep = env.troncons[2];
  assert.equal(bas.capB, true); assert.equal(dep.capA, true);
  bas.b.forEach(p => near(p[2], 0.65, 1e-9, "descente jusqu'au dessous du départ"));
  dep.a.forEach(p => near(p[0], 4.4, 1e-9, "départ au ras de la paroi arrière de la descente"));
});
