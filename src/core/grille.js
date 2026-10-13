/* Maillage de la chambre en cellules cubiques (ou presque) : parois, évaporateurs, cloisons,
   obstacles pleins, échelles chargées traitées en milieu poreux. Commun à l'aperçu et au calcul fin. */
import { dims, volume, evapGeo, echellesGeo, obstacleGeo, cloisonGeo, distSegment, dansEncoche, retombeesEvap, basRetombeeAuto, deflecteurGeo, derriereDeflecteur } from "./geometrie.js";

export const SOLIDE = { fluide: 0, paroi: 1, evap: 2, cloison: 3, obstacle: 4, deflecteur: 5 };

/* Taille de maille pour un nombre de cellules visé */
export function tailleMaille(ch, cellules) {
  const k = dims(ch);
  return Math.min(0.5, Math.max(0.05, Math.cbrt(k.W * k.B * k.H / Math.max(1000, cellules))));
}

/* Plage d'indices des cellules dont le centre est dans [a0, a1] (au moins une cellule) */
export function plage(a0, a1, d, n) {
  let i0 = Math.ceil(a0 / d - 0.5 - 1e-9), i1 = Math.floor(a1 / d - 0.5 + 1e-9);
  if (i1 < i0) { const c = Math.floor((a0 + a1) / 2 / d); i0 = i1 = c; }
  return [Math.max(0, i0), Math.min(n - 1, i1)];
}

export function construireGrille(projet, opts) {
  opts = opts || {};
  const ch = projet.chambre, k = dims(ch);
  const h = opts.h || tailleMaille(ch, opts.cellules || 110000);
  const nx = Math.max(6, Math.round(k.W / h)), ny = Math.max(6, Math.round(k.B / h)), nz = Math.max(5, Math.round(k.H / h));
  const dx = k.W / nx, dy = k.B / ny, dz = k.H / nz, n = nx * ny * nz;
  const solide = new Uint8Array(n), cH = new Float32Array(n), cV = new Float32Array(n), phi = new Float32Array(n).fill(1), produit = new Uint8Array(n);
  const id = (i, j, kk) => i + nx * (j + ny * kk);
  const G = { nx, ny, nz, dx, dy, dz, n, W: k.W, B: k.B, H: k.H, k, solide, cH, cV, phi, produit, id, evaps: [], echelles: [], volumeChambre: volume(ch) };

  // Encoche du L
  if (k.L) {
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const x = (i + 0.5) * dx, y = (j + 0.5) * dy;
      if (dansEncoche(k, x, y)) for (let kk = 0; kk < nz; kk++) solide[id(i, j, kk)] = SOLIDE.paroi;
    }
  }
  const boite = (b, val, f) => {
    const [i0, i1] = plage(b.x0, b.x1, dx, nx), [j0, j1] = plage(b.y0, b.y1, dy, ny), [k0, k1] = plage(b.z0, b.z1, dz, nz);
    for (let kk = k0; kk <= k1; kk++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const c = id(i, j, kk);
      if (val) { if (!solide[c]) solide[c] = val; } else if (f && !solide[c]) f(c);
    }
    return { i0, i1, j0, j1, k0, k1 };
  };

  // Cloisons (et retombées des évaporateurs) : bande d'au moins une cellule, sans fuite en diagonale
  const bas = basRetombeeAuto(projet);
  G.retombees = projet.evaps.reduce((l, e) => l.concat(retombeesEvap(e, ch, bas)), []);
  for (const c of projet.cloisons.concat(G.retombees)) {
    const g = cloisonGeo(c, ch), seuil = Math.max(g.ep / 2, 0.5 * Math.max(dx, dy) * (Math.abs(g.ux) + Math.abs(g.uy)));
    const [k0, k1] = plage(g.zb, g.zh, dz, nz);
    const xa = Math.min(c.x0, c.x1) - seuil - dx, xb = Math.max(c.x0, c.x1) + seuil + dx, ya = Math.min(c.y0, c.y1) - seuil - dy, yb = Math.max(c.y0, c.y1) + seuil + dy;
    for (let j = Math.max(0, Math.floor(ya / dy)); j <= Math.min(ny - 1, Math.floor(yb / dy)); j++)
      for (let i = Math.max(0, Math.floor(xa / dx)); i <= Math.min(nx - 1, Math.floor(xb / dx)); i++) {
        if (distSegment((i + 0.5) * dx, (j + 0.5) * dy, c.x0, c.y0, c.x1, c.y1) > seuil + 1e-9) continue;
        for (let kk = k0; kk <= k1; kk++) if (!solide[id(i, j, kk)]) solide[id(i, j, kk)] = SOLIDE.cloison;
      }
  }
  // Déflecteurs d'angle : le coin derrière l'arrondi est plein
  for (const o of projet.deflecteurs || []) {
    const g = deflecteurGeo(o, ch), b = g.box;
    const [i0, i1] = plage(b.x0 - dx, b.x1 + dx, dx, nx), [j0, j1] = plage(b.y0 - dy, b.y1 + dy, dy, ny), [k0, k1] = plage(b.z0, b.z1, dz, nz);
    for (let kk = k0; kk <= k1; kk++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const c = id(i, j, kk);
      if (!solide[c] && derriereDeflecteur(g, (i + 0.5) * dx, (j + 0.5) * dy, (kk + 0.5) * dz, k.H)) solide[c] = SOLIDE.deflecteur;
    }
  }
  // Obstacles : pleins ou poreux
  for (const o of projet.obstacles) {
    const g = obstacleGeo(o);
    if (o.poreux > 0.01) {
      const p = Math.max(0.05, o.poreux), c = 0.5 * (Math.pow(1 / p - 1, 2) + 0.3 * (1 - p)) / Math.max(0.3, Math.min(o.L, o.l) / 3);
      boite(g.box, 0, cc => { cH[cc] = Math.max(cH[cc], c); cV[cc] = Math.max(cV[cc], c); phi[cc] = Math.min(phi[cc], p); });
    } else boite(g.box, SOLIDE.obstacle);
  }
  // Évaporateurs (caisson plein) : ventilateurs et aspiration posés par le calcul sur les faces du caisson
  for (const e of projet.evaps) {
    if (e.off) continue;
    const geo = evapGeo(e, ch), r = boite(geo.box, SOLIDE.evap);
    // Coudes en sortie d'hélice : pleins (l'air n'en sort que par le dessous)
    geo.cotes.forEach(c => c.fans.forEach(f => { if (f.coude) f.rc = boite(f.coude.box, SOLIDE.evap); }));
    G.evaps.push({ e, geo, r });
  }
  // Échelles chargées : milieu poreux sur la hauteur des produits
  for (const e of projet.echelles) {
    const geo = echellesGeo(e);
    G.echelles.push({ e, geo });
    if (!geo.info.nb) continue;
    for (const c of geo.chariots) {
      boite({ x0: c.x0, x1: c.x1, y0: c.y0, y1: c.y1, z0: geo.info.zBas, z1: geo.info.zHaut }, 0, cc => {
        cH[cc] = Math.max(cH[cc], geo.res.cH); cV[cc] = Math.max(cV[cc], geo.res.cV); phi[cc] = Math.min(phi[cc], geo.res.phiH); produit[cc] = 1;
      });
    }
  }
  let fl = 0; for (let c = 0; c < n; c++) if (!solide[c]) fl++;
  G.fluides = fl;
  return G;
}

/* Indices de cellule d'un point (borné à la grille) */
export function cellule(G, x, y, z) {
  const i = Math.min(G.nx - 1, Math.max(0, Math.floor(x / G.dx))), j = Math.min(G.ny - 1, Math.max(0, Math.floor(y / G.dy))), k = Math.min(G.nz - 1, Math.max(0, Math.floor(z / G.dz)));
  return [i, j, k];
}

/* Distance libre depuis un point dans une direction horizontale, jusqu'à une paroi ou un objet plein */
export function distanceLibre(G, x, y, z, ux, uy, max) {
  const pas = Math.min(G.dx, G.dy) / 2, lim = max || 200, depart = 1.5 * Math.max(G.dx, G.dy);
  for (let s = pas; s < lim; s += pas) {
    const px = x + ux * s, py = y + uy * s;
    if (px < 0 || py < 0 || px > G.W || py > G.B) return s - pas / 2;
    const [i, j, k] = cellule(G, px, py, z), so = G.solide[G.id(i, j, k)];
    // Le caisson de l'évaporateur d'où part le jet est ignoré au départ (arrondi du maillage)
    if (so && !(so === SOLIDE.evap && s < depart)) return s - pas / 2;
  }
  return lim;
}
