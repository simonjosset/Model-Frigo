/* Cotes (mesures de longueur point à point) : points d'accroche de la chambre et des objets, mesure.
   Module pur. Une cote est enregistrée dans le projet : { id, a: [x, y, z], b: [x, y, z] }. */
import { ctaGeo, plenumGeo, boucheGeo } from "./composants.js";
import { dims, polygone, pieceGeo, personneGeo, localPolygone, mursLocaux, porteSurMurs, evapGeo, echellesGeo, obstacleGeo, cloisonGeo, porteCloison, porteSnap, retombeesEvap, basRetombeeAuto, deflecteurGeo } from "./geometrie.js";

/* Sommets d'une boîte alignée sur les axes */
function sommetsBoite(b, nom, out) {
  for (const z of [b.z0, b.z1]) for (const [x, y] of [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]]) out.push({ p: [x, y, z], nom });
}
/* Sommets d'un panneau vertical d'épaisseur ep le long du segment (x0, y0) → (x1, y1) */
function sommetsPanneau(x0, y0, x1, y1, ep, zb, zh, nom, out) {
  const L = Math.hypot(x1 - x0, y1 - y0) || 1e-9, nx = -(y1 - y0) / L * ep / 2, ny = (x1 - x0) / L * ep / 2;
  for (const z of [zb, zh]) for (const [x, y] of [[x0, y0], [x1, y1]]) {
    out.push({ p: [x, y, z], nom });
    if (ep > 0.001) { out.push({ p: [x + nx, y + ny, z], nom }); out.push({ p: [x - nx, y - ny, z], nom }); }
  }
}

/* Points où une cote peut s'accrocher : coins et milieux des murs, sommets des objets */
export function pointsAccroche(projet) {
  const ch = projet.chambre, k = dims(ch), pl = projet.type === "batiment" ? [] : polygone(ch), out = [];
  pl.forEach((A, i) => {
    const B = pl[(i + 1) % pl.length];
    for (const z of [0, k.H]) {
      out.push({ p: [A[0], A[1], z], nom: "Coin de la chambre" });
      out.push({ p: [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, z], nom: "Milieu du mur" });
    }
  });
  const basA = basRetombeeAuto(projet);
  projet.evaps.forEach(e => {
    const g = evapGeo(e, ch);
    sommetsBoite(g.box, e.nom, out);
    g.cotes.forEach(c => c.fans.forEach(f => out.push({ p: f.coude ? f.coude.sortie.slice() : f.c.slice(), nom: e.nom + " · " + (f.coude ? "sortie du coude" : "centre d'hélice") })));
    retombeesEvap(e, ch, basA).forEach(r => sommetsPanneau(r.x0, r.y0, r.x1, r.y1, r.ep, r.zb, r.zh, e.nom + " · retombée", out));
  });
  projet.echelles.forEach(e => {
    const g = echellesGeo(e), H = g.info.H;
    g.chariots.forEach(c => sommetsBoite({ x0: c.x0, x1: c.x1, y0: c.y0, y1: c.y1, z0: 0, z1: H }, e.nom, out));
  });
  projet.cloisons.forEach(c => {
    const g = cloisonGeo(c, ch), po = porteCloison(c, ch);
    sommetsPanneau(c.x0, c.y0, c.x1, c.y1, g.ep, g.zb, g.zh, c.nom, out);
    if (po) for (const t of [po.t0, po.t1]) for (const z of [po.zb, po.zh]) out.push({ p: [c.x0 + g.ux * t, c.y0 + g.uy * t, z], nom: c.nom + " · porte" });
  });
  projet.obstacles.forEach(o => sommetsBoite(obstacleGeo(o).box, o.nom, out));
  const batiment = projet.type === "batiment", murs = batiment ? mursLocaux(projet.locaux) : null;
  projet.portes.forEach(d => {
    const s = batiment ? porteSurMurs(murs, d) : porteSnap(ch, d); if (!s) return;
    const h = Math.min(d.h, batiment ? s.H : k.H);
    for (const sg of [-1, 1]) for (const z of [0, h]) out.push({ p: [s.x + sg * s.ex * s.w / 2, s.y + sg * s.ey * s.w / 2, z], nom: d.nom });
  });
  projet.deflecteurs.forEach(o => sommetsBoite(deflecteurGeo(o, ch).box, o.nom, out));
  (projet.pieces || []).forEach(o => sommetsBoite(pieceGeo(o).box, o.nom, out));
  (projet.locaux || []).forEach(o => localPolygone(o).forEach(([x, y]) => { out.push({ p: [x, y, 0], nom: o.nom }); out.push({ p: [x, y, o.H], nom: o.nom }); }));
  // Traitement d'air : piquages de CTA, centres des faces des plénums, bouches, points des gaines
  (projet.ctas || []).forEach(o => {
    const g = ctaGeo(o);
    sommetsBoite(g.box, o.nom, out);
    out.push({ p: g.soufflage.c.slice(), nom: o.nom + " · soufflage", ref: { id: o.id, quoi: "soufflage" } });
    out.push({ p: g.reprise.c.slice(), nom: o.nom + " · reprise", ref: { id: o.id, quoi: "reprise" } });
  });
  (projet.plenums || []).forEach(o => {
    const b = plenumGeo(o).box, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, cz = (b.z0 + b.z1) / 2;
    sommetsBoite(b, o.nom, out);
    [[b.x0, cy, cz], [b.x1, cy, cz], [cx, b.y0, cz], [cx, b.y1, cz], [cx, cy, b.z0], [cx, cy, b.z1]].forEach(p => out.push({ p, nom: o.nom + " · face" }));
  });
  (projet.bouches || []).forEach(o => out.push({ p: boucheGeo(o).c.slice(), nom: o.nom }));
  (projet.gaines || []).forEach(o => o.points.forEach(p => out.push({ p: p.slice(), nom: o.nom })));
  (projet.personnes || []).forEach(o => { out.push({ p: [o.x, o.y, o.taille], nom: o.nom + " · haut de la tête" }); out.push({ p: [o.x, o.y, 0], nom: o.nom + " · pieds" }); });
  return out;
}

/* Longueur et écarts suivant les axes */
export function mesure(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  return { L: Math.hypot(dx, dy, dz), dx: Math.abs(dx), dy: Math.abs(dy), dz: Math.abs(dz), plan: Math.hypot(dx, dy) };
}

