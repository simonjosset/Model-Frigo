import { test } from "node:test";
import assert from "node:assert/strict";
import { dims, dedans, polygone, surface, garderDedans, porteSnap, evapGeo, echellesGeo, COINS } from "../src/core/geometrie.js";
import { normaliser } from "../src/core/modele.js";

const L = { forme: "L", longueur: 10, largeur: 8, coin: "avant-droit", coinLong: 4, coinLarg: 5, H: 3.5 };

test("chambre en L : les quatre coins donnent un contour fermé de 6 murs et la bonne surface", () => {
  for (const coin of Object.keys(COINS)) {
    const ch = Object.assign({}, L, { coin }), pl = polygone(ch);
    assert.equal(pl.length, 6, coin);
    let aire = 0; pl.forEach((q, i) => { const r = pl[(i + 1) % pl.length]; aire += q[0] * r[1] - r[0] * q[1]; });
    assert.ok(Math.abs(aire / 2 - (80 - 20)) < 1e-9, coin + " : sens trigonométrique et surface");
    const e = dims(ch).enc;
    assert.ok(!dedans(ch, (e.x0 + e.x1) / 2, (e.y0 + e.y1) / 2), coin + " : le coin retiré est dehors");
  }
});

test("chambre en L : polygone, surface, intérieur", () => {
  assert.equal(polygone(L).length, 6);
  assert.equal(surface(L), 6 * 8 + 4 * 3);
  assert.ok(dedans(L, 8, 7)); assert.ok(!dedans(L, 8, 2)); assert.ok(dedans(L, 2, 2));
  assert.equal(dims(L).W, 10);
});

test("garderDedans : un objet poussé hors de la chambre ou dans l'encoche du L revient à l'intérieur", () => {
  const p = normaliser({ chambre: L, obstacles: [{ x: 8, y: 1, L: 1, l: 1, h: 1 }] });
  const o = p.obstacles[0];
  garderDedans("obstacles", o, p.chambre);
  assert.ok(dedans(p.chambre, o.x - 0.49, o.y - 0.49) && dedans(p.chambre, o.x + 0.49, o.y + 0.49), JSON.stringify(o));
  o.x = -5; o.y = 50; garderDedans("obstacles", o, p.chambre);
  assert.ok(o.x >= 0.5 - 1e-9 && o.y <= 8 - 0.5 + 1e-9);
});

test("porte accrochée au mur le plus proche", () => {
  const s = porteSnap({ forme: "rect", longueur: 9, largeur: 6, H: 3 }, { x: 3, y: 5.7, w: 1.2 });
  assert.equal(s.y, 6); assert.equal(s.x, 3);
});

test("évaporateur double flux : deux côtés de soufflage opposés, débit partagé", () => {
  const g = evapGeo({ type: "double", x: 4, y: 3, dir: 0, len: 2, dep: 0.9, eh: 0.5, zb: null, nf: 2, dv: 0.4, q: 7200, T: 7 }, { forme: "rect", longueur: 9, largeur: 6, H: 3.5 });
  assert.equal(g.cotes.length, 2);
  assert.deepEqual(g.cotes[0].u.map(Math.abs), g.cotes[1].u.map(Math.abs));
  assert.equal(g.cotes[0].u[0], -g.cotes[1].u[0]);
  assert.ok(Math.abs(g.cotes[0].q - 1) < 1e-9);
  assert.ok(Math.abs(g.z.zt - (3.5 - 0.08)) < 1e-9, "suspendu à 8 cm du plafond");
});

test("groupe d'échelles : nombre et alignement", () => {
  const g = echellesGeo({ x: 5, y: 3, dir: 0, n: 4, rangees: 2, ecart: 0.05, allee: 0.8, H: 1.875, W: 0.626, D: 0.507, etages: 23, produit: { L: 0.36, l: 0.165, h: 0.1, m: 3.3 } });
  assert.equal(g.total, 8);
  const xs = [...new Set(g.chariots.map(c => c.cx.toFixed(4)))];
  assert.equal(xs.length, 4);
  assert.ok(Math.abs((g.box.x0 + g.box.x1) / 2 - 5) < 1e-9);
});
