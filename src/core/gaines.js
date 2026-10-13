/* Dimensionnement des gaines aérauliques : rectangulaires galva, circulaires galva, textiles.
   Module pur repris de Frigobilan (onglet Gaines), mêmes formules ; utilisé ici pour les gaines du bâtiment.

   Principe : on retient la plus petite gaine dont la vitesse reste sous la vitesse maximale
   (7 m/s par défaut). Pour une gaine rectangulaire, parmi les sections qui conviennent
   (pas de 50 mm, rapport largeur / hauteur limité, hauteur maximale éventuelle), on prend
   celle qui demande le moins de tôle (plus petit périmètre).
   Pertes de charge : Darcy-Weisbach, frottement de Colebrook, rugosité galva 0,15 mm ;
   gaine rectangulaire calculée sur son diamètre équivalent (Huebscher). */

export const ROND_GALVA = [80, 100, 125, 160, 200, 250, 315, 355, 400, 450, 500, 560, 630, 710, 800, 900, 1000, 1120, 1250];
export const ROND_TEXTILE = [100, 125, 160, 200, 250, 315, 355, 400, 450, 500, 560, 630, 710, 800, 900, 1000, 1120, 1250, 1400, 1600];
export const TYPES_GAINE = {
  rect: { nom: "Rectangulaire galva", rugosite: 0.15 },
  rond: { nom: "Circulaire galva", rugosite: 0.15 },
  textile: { nom: "Textile", rugosite: null }
};
export const DEFAUTS = { vmax: 7, ratio: 4, T: 20, maj: 0, pas: 50, min: 100, max: 3000 };

function r(x, d) { var k = Math.pow(10, d); return Math.round(x * k) / k; }

/* Air sec à la pression atmosphérique : masse volumique (kg/m³) et viscosité cinématique (m²/s) */
export function airProps(T) {
  var K = (isFinite(T) ? T : 20) + 273.15, rho = 101325 / (287.05 * K);
  var mu = 1.458e-6 * Math.pow(K, 1.5) / (K + 110.4);   // loi de Sutherland
  return { rho: rho, nu: mu / rho };
}

/* Coefficient de frottement : laminaire 64/Re, sinon Colebrook-White (résolu par itération) */
export function friction(Re, eps, D) {
  if (!(Re > 0)) return 0;
  if (Re < 2300) return 64 / Re;
  var x = 0.02;
  for (var i = 0; i < 30; i++) x = Math.pow(-2 * Math.log10(eps / D / 3.7 + 2.51 / (Re * Math.sqrt(x))), -2);
  return x;
}

/* Diamètre équivalent d'une gaine rectangulaire (même perte de charge au même débit), Huebscher */
export function deqRect(a, b) { return 1.30 * Math.pow(a * b, 0.625) / Math.pow(a + b, 0.25); }

/* Écoulement dans une gaine ronde de diamètre D (mm) pour Q (m³/h) : vitesse, Re, Pa/m */
export function rond(Qh, Dmm, T, rug) {
  var p = airProps(T), D = Dmm / 1000, A = Math.PI * D * D / 4, v = Qh / 3600 / A, Re = v * D / p.nu;
  var f = rug == null ? null : friction(Re, rug / 1000, D);
  return { v: v, Re: Re, pd: p.rho * v * v / 2, pam: f == null ? null : f / D * p.rho * v * v / 2, section: A };
}

/* Gaine rectangulaire a × b (mm, largeur × hauteur) */
export function rect(Qh, a, b, T, rug) {
  var A = a * b / 1e6, de = deqRect(a, b), p = airProps(T), v = Qh / 3600 / A;
  var eq = rond(Qh, de, T, rug); // même débit dans le rond équivalent : même perte de charge
  return { a: a, b: b, v: v, section: A, de: de, pd: p.rho * v * v / 2, pam: eq.pam, perimetre: 2 * (a + b) / 1000 };
}

/* Sections rectangulaires possibles pour un débit : une par hauteur, la plus étroite qui convient */
export function rectCandidates(Qh, o) {
  o = Object.assign({}, DEFAUTS, o || {});
  var Areq = Qh / 3600 / o.vmax * 1e6, out = [], hmax = o.hmax > 0 ? Math.min(o.hmax, o.max) : o.max;
  for (var b = o.min; b <= hmax + 1e-9; b += o.pas) {
    var a = Math.max(o.min, Math.ceil(Areq / b / o.pas - 1e-9) * o.pas, Math.ceil(b / o.ratio / o.pas - 1e-9) * o.pas);
    if (a > o.max || a / b > o.ratio + 1e-9) continue;
    out.push(rect(Qh, a, b, o.T, TYPES_GAINE.rect.rugosite));
  }
  return out;
}

/* Choix de la gaine pour une ligne : { type, Q (m³/h), L (m), hmax (mm) } */
export function calcLigne(l, glob) {
  var o = Object.assign({}, DEFAUTS, glob || {}), Q = Number(l.Q), L = Number(l.L) > 0 ? Number(l.L) : 0;
  if (!(Q > 0)) return { vide: true };
  if (!(o.vmax > 0)) return { erreur: "Indiquez une vitesse maximale." };
  var maj = 1 + (o.maj > 0 ? o.maj : 0) / 100, res;
  if (l.type === "rect") {
    var c = rectCandidates(Q, { vmax: o.vmax, ratio: o.ratio, hmax: Number(l.hmax) > 0 ? Number(l.hmax) : 0, T: o.T, pas: o.pas, min: o.min, max: o.max });
    if (!c.length) return { erreur: "Aucune gaine possible : augmentez la hauteur maximale ou le rapport largeur / hauteur." };
    var best = c.reduce(function (m, x) { return x.perimetre < m.perimetre - 1e-9 || (Math.abs(x.perimetre - m.perimetre) < 1e-9 && (x.section < m.section - 1e-12 || (Math.abs(x.section - m.section) < 1e-12 && x.a >= x.b))) ? x : m; });
    // Variantes : hauteurs voisines, utiles quand la place manque au plafond
    var i = c.indexOf(best), alt = c.slice(Math.max(0, i - 2), i + 3);
    res = { type: "rect", g: best, alt: alt };
    res.surface = L ? r(best.perimetre * L, 2) : null;
  } else {
    var list = l.type === "textile" ? ROND_TEXTILE : ROND_GALVA, rug = TYPES_GAINE[l.type === "textile" ? "textile" : "rond"].rugosite;
    var rows = list.map(function (d) { var x = rond(Q, d, o.T, rug); x.d = d; return x; });
    var k = 0; while (k < rows.length - 1 && rows[k].v > o.vmax + 1e-9) k++;
    res = { type: l.type === "textile" ? "textile" : "rond", g: rows[k], alt: rows.slice(Math.max(0, k - 1), k + 2), trop: rows[k].v > o.vmax + 1e-9 };
    res.surface = L ? r(Math.PI * rows[k].d / 1000 * L, 2) : null;
  }
  res.pdc = L && res.g.pam != null ? r(res.g.pam * L * maj, 1) : null;
  return res;
}
