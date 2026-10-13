/* Composants de traitement d'air d'un bâtiment : CTA, plénums, bouches, gaines (module pur).
   Implantation et métrés seulement : pas de calcul des flux d'air dans le bâtiment.
   Les sections de gaines sont choisies comme dans l'onglet Gaines de Frigobilan (gaines.js). */
import { dirVec } from "./geometrie.js";
import { calcLigne, rect, rond, TYPES_GAINE } from "./gaines.js";

/* Boîte d'un objet posé (x, y au centre, z en bas), longueur L suivant dir, largeur l en travers, hauteur h */
function boiteOrientee(o, L, l, h) {
  const u = dirVec(o.dir || 0), hx = Math.abs(u[0]) * L / 2 + Math.abs(u[1]) * l / 2, hy = Math.abs(u[1]) * L / 2 + Math.abs(u[0]) * l / 2;
  return { u, box: { x0: o.x - hx, x1: o.x + hx, y0: o.y - hy, y1: o.y + hy, z0: o.z, z1: o.z + h } };
}

/* ---------- CTA : caisson en sections le long du soufflage (dir), piquages de reprise (arrière) et de soufflage (avant) ---------- */
export const SECTIONS_CTA = [
  { nom: "Reprise / mélange", part: 0.22, couleur: 0x9aa7bd },
  { nom: "Filtres", part: 0.14, couleur: 0xe8d27a },
  { nom: "Batterie", part: 0.2, couleur: 0x6fa8dc },
  { nom: "Ventilateur", part: 0.26, couleur: 0xb7c0cf },
  { nom: "Soufflage", part: 0.18, couleur: 0x9aa7bd }
];
export function ctaGeo(o) {
  const g = boiteOrientee(o, o.L, o.l, o.h), u = g.u, zc = o.z + o.h / 2;
  // Piquages : rectangle au milieu des faces avant et arrière (60 % de la largeur, 50 % de la hauteur)
  const piq = s => ({ c: [o.x + u[0] * s * o.L / 2, o.y + u[1] * s * o.L / 2, zc], n: [u[0] * s, u[1] * s, 0], w: o.l * 0.6, h: o.h * 0.5 });
  let t = -o.L / 2;
  const sections = SECTIONS_CTA.map(s => { const a = t; t += s.part * o.L; return Object.assign({}, s, { t0: a, t1: t }); });
  return { u, box: g.box, soufflage: piq(1), reprise: piq(-1), sections };
}

/* ---------- Plénum : caisson galva ---------- */
export function plenumGeo(o) { return boiteOrientee(o, o.L, o.l, o.h); }

/* ---------- Bouche (soufflage, reprise, air neuf, rejet) : au plafond (face vers le bas) ou murale (face vers dir) ---------- */
export const TYPES_BOUCHE = {
  soufflage: { nom: "Soufflage", couleur: 0x3d7bff },
  reprise: { nom: "Reprise", couleur: 0x14ca74 },
  airneuf: { nom: "Prise d'air neuf", couleur: 0x2fbfd6 },
  rejet: { nom: "Rejet", couleur: 0x8f9bb6 }
};
export function boucheGeo(o) {
  const ep = 0.06;
  if (o.pose === "plafond") return { n: [0, 0, -1], box: { x0: o.x - o.w / 2, x1: o.x + o.w / 2, y0: o.y - o.h / 2, y1: o.y + o.h / 2, z0: o.z - ep, z1: o.z }, c: [o.x, o.y, o.z - ep] };
  const u = dirVec(o.dir || 0), hx = Math.abs(u[0]) * ep / 2 + Math.abs(u[1]) * o.w / 2, hy = Math.abs(u[1]) * ep / 2 + Math.abs(u[0]) * o.w / 2;
  return { n: [u[0], u[1], 0], box: { x0: o.x - hx, x1: o.x + hx, y0: o.y - hy, y1: o.y + hy, z0: o.z - o.h / 2, z1: o.z + o.h / 2 }, c: [o.x + u[0] * ep / 2, o.y + u[1] * ep / 2, o.z] };
}

/* ---------- Gaines : polyligne de points 3D ---------- */
export const FORMES_GAINE = { rect: "Rectangulaire galva", rond: "Circulaire galva", textile: "Textile" };

/* Segments, longueur, coudes (changement de direction à un point intermédiaire) */
export function gaineTrace(points) {
  const seg = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (L > 1e-6) seg.push({ a, b, L, u: [(b[0] - a[0]) / L, (b[1] - a[1]) / L, (b[2] - a[2]) / L] });
  }
  let coudes = 0;
  for (let i = 1; i < seg.length; i++) { const p = seg[i - 1].u, q = seg[i].u; if (p[0] * q[0] + p[1] * q[1] + p[2] * q[2] < 0.999) coudes++; }
  return { seg, L: seg.reduce((s, x) => s + x.L, 0), coudes };
}

/* Section de la gaine : automatique (vitesse maximale, comme l'onglet Gaines de Frigobilan) ou imposée.
   Renvoie { forme, a, b (mm, largeur × hauteur) ou d (mm), v (m/s), pam (Pa/m), auto, erreur } */
export function gaineSection(o, reglages) {
  const r = reglages || {}, glob = { vmax: r.vmaxGaine || 7, ratio: r.ratioGaine || 4, T: 20 };
  const forme = FORMES_GAINE[o.forme] ? o.forme : "rect";
  if (o.auto) {
    const c = calcLigne({ type: forme, Q: o.q, L: 0, hmax: o.hmax }, glob);
    if (c.vide) return { forme, erreur: "Débit à saisir" };
    if (c.erreur) return { forme, erreur: c.erreur };
    return forme === "rect" ? { forme, a: c.g.a, b: c.g.b, v: c.g.v, pam: c.g.pam, auto: true } : { forme, d: c.g.d, v: c.g.v, pam: c.g.pam, auto: true, trop: c.trop };
  }
  // Section imposée : vitesse et perte de charge recalculées avec les mêmes formules
  if (forme === "rect") {
    const x = o.q > 0 ? rect(o.q, o.a, o.b, 20, TYPES_GAINE.rect.rugosite) : { v: 0, pam: 0 };
    return { forme, a: o.a, b: o.b, v: x.v, pam: x.pam, auto: false };
  }
  const x = o.q > 0 ? rond(o.q, o.d, 20, TYPES_GAINE[forme].rugosite) : { v: 0, pam: forme === "textile" ? null : 0 };
  return { forme, d: o.d, v: x.v, pam: x.pam, auto: false };
}
/* Encombrement de la section (m) : largeur et hauteur pour une gaine horizontale */
export function gaineEncombrement(s) {
  if (s.erreur) return { w: 0.3, h: 0.3 };
  return s.forme === "rect" ? { w: s.a / 1000, h: s.b / 1000 } : { w: s.d / 1000, h: s.d / 1000 };
}
/* Enveloppe d'une gaine pour le dessin : un anneau de sommets à chaque bout de tronçon.
   Aux coudes dont les sections se correspondent, coupe d'onglet (plan bissecteur) : raccord sans décalage ni trou.
   Sinon (section qui tourne, rond sur rectangulaire, diamètres différents), raccord en botte : le tronçon
   arrivant va jusqu'à la paroi opposée du suivant, qui démarre au ras de la paroi arrière du premier.
   Rectangulaire : la largeur reste horizontale sur les tronçons horizontaux ; un tronçon vertical garde
   l'orientation du tronçon horizontal qui le précède (sinon qui le suit), comme un coude réel.
   avant / apres : gaine raccordée bout à bout au premier point ({ u : direction arrivant sur lui, r : repère
   de section }) ou au dernier ({ u : direction partant de lui, r }), voir raccordBout.
   Renvoie { rond, troncons: [{ u, c: [décalages 3D du profil], a, b: [sommets aux deux bouts], capA, capB }] } */
export function gaineEnveloppe(points, sec, avant, apres, nRond = 24) {
  const { pts, us, reperes, rond: rondF, w, h } = reperesGaine(points, sec, avant && avant.u, apres && apres.u);
  if (us.length === 0) return { rond: rondF, troncons: [] };
  const profil = rondF
    ? Array.from({ length: nRond }, (_, k) => [Math.cos(2 * Math.PI * k / nRond) * w / 2, Math.sin(2 * Math.PI * k / nRond) * w / 2])
    : [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
  const lim = 3 * Math.max(w, h);
  // Sommets du profil c posé au point P, coupé par le plan de normale m passant par P
  const anneau = (P, c, u, m) => c.map(o => {
    const t = Math.max(-lim, Math.min(lim, -scal(o, m) / scal(u, m)));
    return [P[0] + o[0] + t * u[0], P[1] + o[1] + t * u[1], P[2] + o[2] + t * u[2]];
  });
  // Raccord entre un tronçon arrivant (u1, r1) et un tronçon partant (u2, r2) : onglet, botte ou coupe droite
  const raccord = (u1, r1, u2, r2) => {
    if (!u1 || !u2 || !r1 || !r2) return { type: "libre" };
    const d = scal(u1, u2);
    if (d < -0.9) return { type: "droit", e1: 0, e2: 0 };
    if (d > 0.9999) return { type: "onglet", m: u2 };
    const b = unitaire(vect(u1, u2));
    const pareil = r1.rond === r2.rond && Math.abs(etendue(r1, u2) - etendue(r2, u1)) < 1e-6 && Math.abs(etendue(r1, b) - etendue(r2, b)) < 1e-6;
    if (pareil) return { type: "onglet", m: unitaire(ajout(u1, u2)) };
    return { type: "botte", e1: etendue(r2, u1) / 2, e2: etendue(r1, u2) / 2 };
  };
  const n = us.length;
  const joints = [];
  for (let i = 0; i <= n; i++) {
    if (i === 0) joints.push(avant ? raccord(unitaire(avant.u), avant.r, us[0], reperes[0]) : { type: "libre" });
    else if (i === n) joints.push(apres ? raccord(us[n - 1], reperes[n - 1], unitaire(apres.u), apres.r) : { type: "libre" });
    else joints.push(raccord(us[i - 1], reperes[i - 1], us[i], reperes[i]));
  }
  const troncons = us.map((u, i) => {
    const { v, n: nh } = reperes[i];
    const c = profil.map(([s, t]) => [s * v[0] + t * nh[0], s * v[1] + t * nh[1], s * v[2] + t * nh[2]]);
    const ja = joints[i], jb = joints[i + 1];
    const recul = ja.type === "botte" || ja.type === "droit" ? -ja.e2 : 0, avance = jb.type === "botte" || jb.type === "droit" ? jb.e1 : 0;
    const A = [pts[i][0] + u[0] * recul, pts[i][1] + u[1] * recul, pts[i][2] + u[2] * recul];
    const B = [pts[i + 1][0] + u[0] * avance, pts[i + 1][1] + u[1] * avance, pts[i + 1][2] + u[2] * avance];
    return {
      u, c,
      a: anneau(A, c, u, ja.type === "onglet" ? ja.m : u), b: anneau(B, c, u, jb.type === "onglet" ? jb.m : u),
      capA: ja.type !== "onglet", capB: jb.type !== "onglet"
    };
  });
  return { rond: rondF, troncons };
}
/* Étendue d'une section (repère r) suivant une direction d perpendiculaire au tronçon */
function etendue(r, d) { return r.rond ? r.w : Math.abs(scal(d, r.v)) * r.w + Math.abs(scal(d, r.n)) * r.h; }
/* Points utiles (sans doublons ni points alignés), directions et repères de section (v : largeur, n : hauteur) */
function reperesGaine(points, sec, avant, apres) {
  const e = gaineEncombrement(sec), rond = sec.forme !== "rect";
  const pts = [];
  (points || []).forEach(p => {
    const d = pts[pts.length - 1];
    if (!d || Math.hypot(p[0] - d[0], p[1] - d[1], p[2] - d[2]) > 1e-6) pts.push(p);
  });
  for (let i = 1; i < pts.length - 1; i++) {
    const p = unitaire(sous(pts[i], pts[i - 1])), q = unitaire(sous(pts[i + 1], pts[i]));
    if (scal(p, q) > 0.9999) { pts.splice(i, 1); i--; }
  }
  const us = []; for (let i = 1; i < pts.length; i++) us.push(unitaire(sous(pts[i], pts[i - 1])));
  const vertical = u => Math.abs(u[2]) > 0.999;
  const horiz = u => { const l = Math.hypot(u[0], u[1]); return [u[0] / l, u[1] / l, 0]; };
  const reperes = us.map((u, i) => {
    let d;
    if (!vertical(u)) { d = horiz(u); const v = [-d[1], d[0], 0]; return { v, n: unitaire(vect(u, v)), w: e.w, h: e.h, rond }; }
    for (let k = i - 1; k >= 0 && !d; k--) if (!vertical(us[k])) d = horiz(us[k]);
    for (let k = i + 1; k < us.length && !d; k++) if (!vertical(us[k])) d = horiz(us[k]);
    if (!d && avant && !vertical(avant)) d = horiz(avant);
    if (!d && apres && !vertical(apres)) d = horiz(apres);
    if (!d) d = [1, 0, 0];
    return { v: [-d[1], d[0], 0], n: d, w: e.w, h: e.h, rond };
  });
  return { pts, us, reperes, rond, w: e.w, h: e.h };
}
function sous(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function ajout(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function scal(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function vect(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function unitaire(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
/* Gaine voisine raccordée bout à bout au point P (une seule, sinon null : piquage, plusieurs départs) :
   { u : direction de son dernier tronçon orientée vers P, r : repère de sa section sur ce tronçon } */
export function raccordBout(gaines, id, P, reglages) {
  const proche = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-3;
  const trouves = [];
  (gaines || []).forEach(g => {
    if (g.id === id || !g.points || g.points.length < 2) return;
    const p = g.points, k = p.length - 1, fin = proche(p[k], P), debut = !fin && proche(p[0], P);
    if (fin || debut) {
      const R = reperesGaine(p, gaineSection(g, reglages));
      if (!R.us.length) return;
      trouves.push(fin ? { u: R.us[R.us.length - 1], r: R.reperes[R.us.length - 1] } : { u: R.us[0].map(x => 0 - x), r: R.reperes[0] });
    } else if (p.some((q, i) => i > 0 && i < k && proche(q, P))) trouves.push(null, null);
  });
  return trouves.length === 1 ? trouves[0] : null;
}

/* Métrés d'une gaine : longueur, surface de tôle (ou de tissu), coudes, perte de charge linéaire */
export function gaineMetres(o, reglages) {
  const t = gaineTrace(o.points), s = gaineSection(o, reglages);
  if (s.erreur) return { L: t.L, coudes: t.coudes, section: s, surface: null, pdc: null };
  const perim = s.forme === "rect" ? 2 * (s.a + s.b) / 1000 : Math.PI * s.d / 1000;
  return { L: t.L, coudes: t.coudes, section: s, surface: perim * t.L, pdc: s.pam != null ? s.pam * t.L : null };
}
export function texteSection(s) {
  if (!s || s.erreur) return "–";
  return s.forme === "rect" ? s.a + " × " + s.b : "Ø " + s.d;
}

/* Tracé orthogonal entre deux points : x, puis y, puis z (les points égaux sont écartés) */
export function routeOrtho(a, b) {
  const pts = [[b[0], a[1], a[2]], [b[0], b[1], a[2]], [b[0], b[1], b[2]]], out = [];
  let prec = a;
  pts.forEach(p => { if (Math.hypot(p[0] - prec[0], p[1] - prec[1], p[2] - prec[2]) > 1e-6) { out.push(p); prec = p; } });
  return out;
}

/* Récapitulatif des métrés de toutes les gaines : par forme, longueur, surface et coudes */
export function metresGaines(gaines, reglages) {
  const tot = {};
  (gaines || []).forEach(o => {
    const m = gaineMetres(o, reglages), f = m.section.forme;
    const t = tot[f] || (tot[f] = { forme: f, nom: FORMES_GAINE[f], L: 0, surface: 0, coudes: 0, n: 0 });
    t.L += m.L; t.surface += m.surface || 0; t.coudes += m.coudes; t.n++;
  });
  return Object.values(tot);
}
export { TYPES_GAINE };
