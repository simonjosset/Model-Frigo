/* Données d'un projet Modèle Frigo : valeurs par défaut, migration (normaliser), objets.
   Repère : x le long de la largeur, y le long de la profondeur, z vers le haut, origine au coin du sol.
   Orientations (dir) en degrés : 0 = vers +x, 90 = vers +y, 180 = vers -x, 270 = vers -y. */
import { produitDuCatalogue } from "./produits.js";
import { COINS } from "./geometrie.js";

export const FORMAT = "modele-frigo";
export const VERSION = 1;

export function uid(prefix) {
  return (prefix || "o") + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export const TYPES = {
  evaps: { seul: "Évaporateur", plusieurs: "Évaporateurs", prefixe: "Évap " },
  echelles: { seul: "Groupe d'échelles", plusieurs: "Échelles", prefixe: "Échelles " },
  cloisons: { seul: "Cloison", plusieurs: "Cloisons", prefixe: "Cloison " },
  obstacles: { seul: "Obstacle", plusieurs: "Obstacles", prefixe: "Obstacle " },
  portes: { seul: "Porte", plusieurs: "Portes", prefixe: "Porte " }
};
export const LISTES = ["evaps", "echelles", "cloisons", "obstacles", "portes"];

export const MAILLES = {
  rapide: { nom: "Rapide", cellules: 40000 },
  normal: { nom: "Normal", cellules: 110000 },
  fin: { nom: "Fin", cellules: 260000 }
};

export function chambreDefaut() {
  return { forme: "rect", longueur: 9, largeur: 6.5, H: 3.6, coin: "arriere-droit", coinLong: 3, coinLarg: 3, Ti: -25 };
}
export function reglagesDefaut() {
  return { vmin: 0.15, vCourant: 0.5, zTravail: 1.8, tauxVise: 40, maille: "normal", recalage: true };
}

export function evapDefaut(ch) {
  return { type: "simple", x: ch.longueur / 2, y: 0.5, dir: 90, len: 2.4, dep: 0.6, eh: 0.6, zb: null, nf: 3, dv: 0.5, q: 12000, T: 18, off: false, coude: false, coudeDescente: 0.15, coudeAvance: 0 };
}
export function echellesDefaut(ch) {
  return {
    x: ch.longueur / 2, y: ch.largeur / 2, dir: 0, n: 6, rangees: 2, ecart: 0.05, allee: 0.8,
    H: 1.875, W: 0.626, D: 0.507, etages: 23, etagesCharges: null, parEtage: null,
    produit: produitDuCatalogue("glace33")
  };
}
export function cloisonDefaut(ch) {
  return { x0: ch.longueur * 0.65, y0: 0, x1: ch.longueur * 0.65, y1: ch.largeur * 0.6, ep: 0.1, zb: 0, zh: null };
}
export function obstacleDefaut(ch) {
  return { x: ch.longueur * 0.25, y: ch.largeur * 0.7, dir: 0, L: 1.2, l: 0.8, h: 1.5, zb: 0, poreux: 0 };
}
export function porteDefaut(ch) {
  return { x: ch.longueur * 0.8, y: ch.largeur, w: 1.2, h: 2.2 };
}
const DEFAUTS = { evaps: evapDefaut, echelles: echellesDefaut, cloisons: cloisonDefaut, obstacles: obstacleDefaut, portes: porteDefaut };

/* Projet d'exemple : chambre de stockage de glaces (nom de code uniquement) */
export function projetExemple() {
  const ch = chambreDefaut();
  const p = {
    format: FORMAT, version: VERSION, nom: "Projet Alpha", maj: Date.now(),
    chambre: ch, reglages: reglagesDefaut(),
    evaps: [], echelles: [], cloisons: [], obstacles: [], portes: []
  };
  ajouter(p, "evaps", { x: 4.5, y: 5.8, dir: 270, q: 9000, T: 8, dv: 0.45 });
  const a = ajouter(p, "echelles", { x: 4.2, y: 3.1, n: 7, rangees: 2 });
  a.nom = "Échelles glace";
  ajouter(p, "portes", { x: 7.6, y: 0 });
  return p;
}

/* Ajoute un objet d'un type (evaps, echelles…) avec ses valeurs par défaut */
export function ajouter(p, liste, valeurs) {
  const t = TYPES[liste], arr = p[liste];
  let n = arr.length + 1;
  const noms = arr.map(o => o.nom);
  while (noms.indexOf(t.prefixe + n) >= 0) n++;
  const o = Object.assign({ id: uid(liste.slice(0, 2)), nom: t.prefixe + n }, DEFAUTS[liste](p.chambre), valeurs || {});
  arr.push(normaliserObjet(liste, o, p.chambre));
  return arr[arr.length - 1];
}

export function dupliquer(p, liste, id) {
  const src = p[liste].find(o => o.id === id); if (!src) return null;
  const o = JSON.parse(JSON.stringify(src));
  o.id = uid(liste.slice(0, 2)); o.nom = src.nom + " (copie)";
  if (liste === "cloisons") { o.x0 += 0.5; o.x1 += 0.5; } else { o.x += 0.5; o.y += 0.5; }
  p[liste].push(normaliserObjet(liste, o, p.chambre));
  return o;
}

export function trouver(p, id) {
  for (const l of LISTES) { const o = p[l].find(x => x.id === id); if (o) return { liste: l, objet: o }; }
  return null;
}

/* ---------- Normalisation : complète et borne toutes les valeurs (anciens fichiers, saisies) ---------- */
function n(v, d, min, max) {
  v = typeof v === "string" ? parseFloat(v.replace(",", ".")) : +v;
  if (!isFinite(v)) v = d;
  if (min != null && v < min) v = min;
  if (max != null && v > max) v = max;
  return v;
}
function nOuNull(v, min, max) {
  if (v == null || v === "") return null;
  v = typeof v === "string" ? parseFloat(v.replace(",", ".")) : +v;
  if (!isFinite(v)) return null;
  return Math.min(max, Math.max(min, v));
}
function angle(v) { return ((Math.round(n(v, 0) / 90) * 90) % 360 + 360) % 360; }

export function normaliserObjet(liste, o, ch) {
  const d = DEFAUTS[liste](ch);
  const r = Object.assign({}, d, o);
  r.id = o.id || uid(liste.slice(0, 2));
  r.nom = String(o.nom || TYPES[liste].prefixe).slice(0, 60);
  if (liste === "evaps") {
    r.type = r.type === "double" ? "double" : "simple";
    r.x = n(r.x, d.x); r.y = n(r.y, d.y); r.dir = angle(r.dir);
    r.len = n(r.len, d.len, 0.3, 8); r.dep = n(r.dep, d.dep, 0.2, 2); r.eh = n(r.eh, d.eh, 0.2, 2);
    r.zb = nOuNull(r.zb, 0, 20);
    r.nf = Math.round(n(r.nf, d.nf, 1, 8)); r.dv = n(r.dv, d.dv, 0.2, 1.2);
    r.q = n(r.q, d.q, 100, 200000); r.T = n(r.T, d.T, 1, 80); r.off = !!r.off;
    r.coude = !!r.coude; r.coudeDescente = n(r.coudeDescente, 0.15, 0, 5); r.coudeAvance = n(r.coudeAvance, 0, 0, 10);
  } else if (liste === "echelles") {
    r.x = n(r.x, d.x); r.y = n(r.y, d.y); r.dir = angle(r.dir);
    r.n = Math.round(n(r.n, d.n, 1, 60)); r.rangees = Math.round(n(r.rangees, d.rangees, 1, 20));
    r.ecart = n(r.ecart, d.ecart, 0, 3); r.allee = n(r.allee, d.allee, 0, 6);
    r.H = n(r.H, d.H, 0.4, 3); r.W = n(r.W, d.W, 0.2, 2); r.D = n(r.D, d.D, 0.2, 2);
    r.etages = Math.round(n(r.etages, d.etages, 1, 80));
    r.etagesCharges = nOuNull(r.etagesCharges, 0, 80); if (r.etagesCharges != null) r.etagesCharges = Math.round(r.etagesCharges);
    r.parEtage = nOuNull(r.parEtage, 0, 200); if (r.parEtage != null) r.parEtage = Math.round(r.parEtage);
    const pr = Object.assign({}, d.produit, o.produit || {});
    r.produit = { ref: String(pr.ref || "perso"), nom: String(pr.nom || "Produit").slice(0, 60), L: n(pr.L, 0.36, 0.02, 2), l: n(pr.l, 0.165, 0.02, 2), h: n(pr.h, 0.1, 0.01, 1.5), m: n(pr.m, 0, 0, 500) };
  } else if (liste === "cloisons") {
    r.x0 = n(r.x0, d.x0); r.y0 = n(r.y0, d.y0); r.x1 = n(r.x1, d.x1); r.y1 = n(r.y1, d.y1);
    r.ep = n(r.ep, 0.1, 0.02, 1); r.zb = n(r.zb, 0, 0, 20); r.zh = nOuNull(r.zh, 0.1, 20);
  } else if (liste === "obstacles") {
    r.x = n(r.x, d.x); r.y = n(r.y, d.y); r.dir = angle(r.dir);
    r.L = n(r.L, d.L, 0.05, 30); r.l = n(r.l, d.l, 0.05, 30); r.h = n(r.h, d.h, 0.05, 20); r.zb = n(r.zb, 0, 0, 20);
    r.poreux = n(r.poreux, 0, 0, 0.95);
  } else if (liste === "portes") {
    r.x = n(r.x, d.x); r.y = n(r.y, d.y); r.w = n(r.w, d.w, 0.4, 8); r.h = n(r.h, d.h, 0.5, 8);
  }
  return r;
}

export function normaliser(p) {
  p = p && typeof p === "object" ? p : {};
  const src = Object.assign({}, p.chambre || {});
  // Ancien format (branches a, B, c, b) : rectangle total moins le coin avant droit
  if (src.longueur == null && src.a != null) {
    const a = n(src.a, 9, 0.8, 200), B = n(src.B, 6.5, 0.8, 200), L = src.forme === "L";
    const c = n(src.c, 3, 0.3, 200), b = Math.min(n(src.b, 3, 0.3, 200), B);
    Object.assign(src, { longueur: a + (L ? c : 0), largeur: B, coin: "avant-droit", coinLong: c, coinLarg: B - b });
    if (L && B - b < 0.1) src.forme = "rect";
  }
  ["a", "B", "c", "b"].forEach(x => delete src[x]);
  const ch = Object.assign(chambreDefaut(), src);
  ch.forme = ch.forme === "L" ? "L" : "rect";
  ch.longueur = n(ch.longueur, 9, 0.8, 200); ch.largeur = n(ch.largeur, 6.5, 0.8, 200); ch.H = n(ch.H, 3.6, 1.2, 30);
  ch.coin = COINS[ch.coin] ? ch.coin : "arriere-droit";
  ch.coinLong = n(ch.coinLong, 3, 0.1, Math.max(0.1, ch.longueur - 0.3)); ch.coinLarg = n(ch.coinLarg, 3, 0.1, Math.max(0.1, ch.largeur - 0.3));
  ch.Ti = n(ch.Ti, -25, -60, 30);
  const out = {
    format: FORMAT, version: VERSION,
    nom: String(p.nom || "Projet").slice(0, 80), maj: n(p.maj, Date.now()),
    chambre: ch, reglages: Object.assign(reglagesDefaut(), p.reglages || {})
  };
  const rg = out.reglages;
  rg.vmin = n(rg.vmin, 0.15, 0.02, 2); rg.vCourant = n(rg.vCourant, 0.5, 0.05, 5); rg.zTravail = n(rg.zTravail, 1.8, 0.2, 10);
  rg.tauxVise = n(rg.tauxVise, 40, 1, 500); rg.recalage = rg.recalage !== false;
  if (!MAILLES[rg.maille]) rg.maille = "normal";
  for (const l of LISTES) out[l] = (Array.isArray(p[l]) ? p[l] : []).filter(o => o && typeof o === "object").map(o => normaliserObjet(l, o, ch));
  return out;
}
