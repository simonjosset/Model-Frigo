/* Géométrie de la chambre et des objets (module pur).
   Chambre rectangulaire (longueur suivant x, largeur suivant y) ou en L : le même rectangle
   dont on retire un coin (coin avant-gauche, avant-droit, arrière-gauche ou arrière-droit).
   « Avant » = côté y = 0 (vue de face), « gauche » = côté x = 0. */
import { echelleInfo, resistanceEchelle } from "./produits.js";

export const COINS = {
  "avant-gauche": { nom: "Avant gauche", cx: 0, cy: 0 },
  "avant-droit": { nom: "Avant droit", cx: 1, cy: 0 },
  "arriere-gauche": { nom: "Fond gauche", cx: 0, cy: 1 },
  "arriere-droit": { nom: "Fond droit", cx: 1, cy: 1 }
};

export function dims(ch) {
  const W = Math.max(0.5, ch.longueur), B = Math.max(0.5, ch.largeur), H = Math.max(1, ch.H);
  let enc = null;
  if (ch.forme === "L") {
    const cl = Math.min(Math.max(0.1, ch.coinLong), W - 0.3), cw = Math.min(Math.max(0.1, ch.coinLarg), B - 0.3), c = COINS[ch.coin] || COINS["arriere-droit"];
    if (cl > 0.05 && cw > 0.05) enc = { x0: c.cx ? W - cl : 0, x1: c.cx ? W : cl, y0: c.cy ? B - cw : 0, y1: c.cy ? B : cw, cl, cw, cx: c.cx, cy: c.cy };
  }
  return { W, B, H, L: !!enc, enc };
}

/* Vrai si le point est dans le coin retiré du L */
export function dansEncoche(k, x, y) {
  const e = k.enc;
  return !!e && x > e.x0 + 1e-9 && x < e.x1 - 1e-9 && y > e.y0 + 1e-9 && y < e.y1 - 1e-9;
}

/* Contour au sol, sens trigonométrique (intérieur à gauche de chaque mur) */
export function polygone(ch) {
  const k = dims(ch), W = k.W, B = k.B, e = k.enc;
  if (!e) return [[0, 0], [W, 0], [W, B], [0, B]];
  if (!e.cx && !e.cy) return [[e.x1, 0], [W, 0], [W, B], [0, B], [0, e.y1], [e.x1, e.y1]];
  if (e.cx && !e.cy) return [[0, 0], [e.x0, 0], [e.x0, e.y1], [W, e.y1], [W, B], [0, B]];
  if (e.cx && e.cy) return [[0, 0], [W, 0], [W, e.y0], [e.x0, e.y0], [e.x0, B], [0, B]];
  return [[0, 0], [W, 0], [W, B], [e.x1, B], [e.x1, e.y0], [0, e.y0]];
}

export function dedans(ch, x, y) {
  const k = dims(ch);
  if (x < 0 || y < 0 || x > k.W || y > k.B) return false;
  return !dansEncoche(k, x, y);
}

export function surface(ch) { const k = dims(ch); return k.W * k.B - (k.enc ? k.enc.cl * k.enc.cw : 0); }
export function volume(ch) { return surface(ch) * dims(ch).H; }

export function dirVec(deg) {
  const r = deg * Math.PI / 180;
  return [Math.round(Math.cos(r)), Math.round(Math.sin(r))];
}

/* Demi-encombrement en plan d'une boîte de longueur `long` suivant u et `larg` suivant la perpendiculaire */
function demi(u, long, larg) {
  return { hx: Math.abs(u[0]) * long / 2 + Math.abs(u[1]) * larg / 2, hy: Math.abs(u[1]) * long / 2 + Math.abs(u[0]) * larg / 2 };
}

/* ---------- Évaporateur ---------- */
export function evapZ(e, ch) {
  const H = dims(ch).H, eh = Math.min(e.eh, H - 0.1), auto = e.zb == null;
  let zb = auto ? H - eh - 0.08 : e.zb;
  zb = Math.min(Math.max(zb, 0), Math.max(0, H - eh - 0.02));
  const drop = H - (zb + eh);
  return { zb, zt: zb + eh, zc: zb + eh / 2, eh, drop, auto, attache: Math.min(1, Math.max(0, 1 - (drop - 0.1) / 0.5)) };
}

export function evapGeo(e, ch) {
  const u = dirVec(e.dir), p = [-u[1], u[0]], z = evapZ(e, ch), dep = e.dep, len = e.len;
  const d = demi(u, dep, len), nf = Math.max(1, Math.round(e.nf));
  const dv = Math.min(e.dv, z.eh * 0.92, len / nf * 0.95);
  const dirs = e.type === "double" ? [u, [-u[0], -u[1]]] : [u];
  const qs = e.q / 3600 / dirs.length; // m³/s par côté
  const cotes = dirs.map((v, s) => {
    const pv = [-v[1], v[0]], O = [e.x + v[0] * dep / 2, e.y + v[1] * dep / 2, z.zc];
    const fans = [];
    for (let f = 0; f < nf; f++) {
      const o = ((f + 0.5) / nf - 0.5) * len;
      fans.push({ o, c: [O[0] + pv[0] * o, O[1] + pv[1] * o, z.zc], q: qs / nf });
    }
    return { s, u: v, p: pv, O, fans, q: qs };
  });
  return {
    u, p, dep, len, dv, z, cotes, q: e.q / 3600,
    box: { x0: e.x - d.hx, x1: e.x + d.hx, y0: e.y - d.hy, y1: e.y + d.hy, z0: z.zb, z1: z.zt },
    aspiration: e.type === "double" ? "dessous" : "arriere"
  };
}

/* ---------- Groupe d'échelles ---------- */
export function echellesGeo(e) {
  const info = echelleInfo(e), res = resistanceEchelle(info);
  const a = dirVec(e.dir), b = [-a[1], a[0]], d = demi(a, info.W, info.D), chariots = [];
  for (let r = 0; r < e.rangees; r++) {
    const ob = (r - (e.rangees - 1) / 2) * (info.D + e.allee);
    for (let i = 0; i < e.n; i++) {
      const oa = (i - (e.n - 1) / 2) * (info.W + e.ecart);
      const cx = e.x + a[0] * oa + b[0] * ob, cy = e.y + a[1] * oa + b[1] * ob;
      chariots.push({ cx, cy, hx: d.hx, hy: d.hy, x0: cx - d.hx, x1: cx + d.hx, y0: cy - d.hy, y1: cy + d.hy, rang: r });
    }
  }
  const bb = chariots.reduce((m, c) => ({ x0: Math.min(m.x0, c.x0), y0: Math.min(m.y0, c.y0), x1: Math.max(m.x1, c.x1), y1: Math.max(m.y1, c.y1) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
  return { info, res, a, b, chariots, box: bb, total: chariots.length };
}

/* ---------- Obstacle (palette, bloc) ---------- */
export function obstacleGeo(o) {
  const u = dirVec(o.dir), d = demi(u, o.L, o.l);
  return { u, box: { x0: o.x - d.hx, x1: o.x + d.hx, y0: o.y - d.hy, y1: o.y + d.hy, z0: o.zb, z1: o.zb + o.h } };
}

/* ---------- Cloison ---------- */
export function cloisonGeo(c, ch) {
  const H = dims(ch).H, zh = c.zh == null ? H : Math.min(H, c.zh), zb = Math.min(c.zb, zh - 0.05);
  const dx = c.x1 - c.x0, dy = c.y1 - c.y0, L = Math.hypot(dx, dy) || 1e-9;
  return { L, ux: dx / L, uy: dy / L, ep: c.ep, zb: Math.max(0, zb), zh, pleine: zb <= 0.01 && zh >= H - 0.01 };
}

/* Distance d'un point au segment d'une cloison (en plan) */
export function distSegment(x, y, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy;
  let t = L2 > 0 ? ((x - x0) * dx + (y - y0) * dy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - x0 - t * dx, y - y0 - t * dy);
}

/* ---------- Porte : accrochée au mur le plus proche ---------- */
export function porteSnap(ch, d) {
  const pl = polygone(ch);
  let best = null;
  for (let i = 0; i < pl.length; i++) {
    const A = pl[i], Bp = pl[(i + 1) % pl.length], dx = Bp[0] - A[0], dy = Bp[1] - A[1], L = Math.hypot(dx, dy);
    if (L < 0.05) continue;
    const ex = dx / L, ey = dy / L, hw = Math.min(d.w / 2, L / 2);
    const t = Math.min(Math.max((d.x - A[0]) * ex + (d.y - A[1]) * ey, hw), L - hw);
    const px = A[0] + ex * t, py = A[1] + ey * t, dist = Math.hypot(d.x - px, d.y - py);
    if (!best || dist < best.dist) best = { x: px, y: py, ex, ey, nx: ey, ny: -ex, dist, w: Math.min(d.w, L), mur: i };
  }
  return best;
}

/* Boîte en plan d'un objet, pour le garder dans la chambre lors d'un déplacement */
export function boiteObjet(liste, o, ch) {
  if (liste === "evaps") return evapGeo(o, ch).box;
  if (liste === "echelles") return echellesGeo(o).box;
  if (liste === "obstacles") return obstacleGeo(o).box;
  return null;
}

/* Ramène un objet dans l'emprise de la chambre (rectangle englobant, puis branche du L) */
export function garderDedans(liste, o, ch) {
  const k = dims(ch);
  if (liste === "cloisons") {
    o.x0 = clamp(o.x0, 0, k.W); o.x1 = clamp(o.x1, 0, k.W); o.y0 = clamp(o.y0, 0, k.B); o.y1 = clamp(o.y1, 0, k.B);
    return;
  }
  if (liste === "portes") { const s = porteSnap(ch, o); o.x = s.x; o.y = s.y; return; }
  const bx = boiteObjet(liste, o, ch); if (!bx) return;
  const hx = (bx.x1 - bx.x0) / 2, hy = (bx.y1 - bx.y0) / 2, ox = o.x - (bx.x0 + bx.x1) / 2, oy = o.y - (bx.y0 + bx.y1) / 2;
  let cx = clamp(o.x - ox, hx, Math.max(hx, k.W - hx)), cy = clamp(o.y - oy, hy, Math.max(hy, k.B - hy));
  const e = k.enc;
  if (e && cx + hx > e.x0 + 1e-6 && cx - hx < e.x1 - 1e-6 && cy + hy > e.y0 + 1e-6 && cy - hy < e.y1 - 1e-6) {
    // Dans le coin retiré du L : on pousse vers la position valide la plus proche
    const xIn = e.cx ? e.x0 - hx : e.x1 + hx, yIn = e.cy ? e.y0 - hy : e.y1 + hy;
    const okX = xIn >= hx - 1e-6 && xIn <= k.W - hx + 1e-6, okY = yIn >= hy - 1e-6 && yIn <= k.B - hy + 1e-6;
    if (okY && (!okX || Math.abs(yIn - cy) < Math.abs(xIn - cx))) cy = yIn; else cx = clamp(xIn, hx, Math.max(hx, k.W - hx));
  }
  o.x = cx + ox; o.y = cy + oy;
}
function clamp(v, a, b) { return Math.min(Math.max(v, a), b); }
