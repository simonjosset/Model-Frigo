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
