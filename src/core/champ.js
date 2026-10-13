/* Champ de vitesses aux centres des cellules : échantillonnage, lignes de courant, couleurs. */

export function creerChamp(G, u, v, w, info) {
  const mag = new Float32Array(G.n);
  for (let c = 0; c < G.n; c++) mag[c] = G.solide[c] ? 0 : Math.hypot(u[c], v[c], w[c]);
  return { G, u, v, w, mag, info: info || {} };
}

/* Vitesse interpolée (trilinéaire) en un point ; les cellules pleines comptent pour zéro.
   out : tableau de 3 valeurs réutilisé ; renvoie la norme. */
export function vitesse(F, x, y, z, out) {
  const G = F.G, nx = G.nx, ny = G.ny, nz = G.nz;
  let gx = x / G.dx - 0.5, gy = y / G.dy - 0.5, gz = z / G.dz - 0.5;
  gx = gx < 0 ? 0 : gx > nx - 1 ? nx - 1 : gx; gy = gy < 0 ? 0 : gy > ny - 1 ? ny - 1 : gy; gz = gz < 0 ? 0 : gz > nz - 1 ? nz - 1 : gz;
  let i = Math.floor(gx), j = Math.floor(gy), k = Math.floor(gz);
  if (i > nx - 2) i = Math.max(0, nx - 2); if (j > ny - 2) j = Math.max(0, ny - 2); if (k > nz - 2) k = Math.max(0, nz - 2);
  const fx = gx - i, fy = gy - j, fz = gz - k;
  let su = 0, sv = 0, sw = 0;
  for (let c = 0; c < 8; c++) {
    const di = c & 1, dj = (c >> 1) & 1, dk = (c >> 2) & 1;
    const wt = (di ? fx : 1 - fx) * (dj ? fy : 1 - fy) * (dk ? fz : 1 - fz);
    if (wt === 0) continue;
    const id = (i + di) + nx * ((j + dj) + ny * (k + dk));
    su += F.u[id] * wt; sv += F.v[id] * wt; sw += F.w[id] * wt;
  }
  out[0] = su; out[1] = sv; out[2] = sw;
  return Math.hypot(su, sv, sw);
}

export function estSolide(F, x, y, z) {
  const G = F.G;
  if (x < 0 || y < 0 || z < 0 || x > G.W || y > G.B || z > G.H) return true;
  const i = Math.min(G.nx - 1, Math.floor(x / G.dx)), j = Math.min(G.ny - 1, Math.floor(y / G.dy)), k = Math.min(G.nz - 1, Math.floor(z / G.dz));
  return G.solide[i + G.nx * (j + G.ny * k)] > 0;
}

/* Ligne de courant (Runge-Kutta 2) depuis un point : tableau plat [x, y, z, v, …] */
export function ligneDeCourant(F, p0, opts) {
  opts = opts || {};
  const G = F.G, h = Math.min(G.dx, G.dy, G.dz) * 0.5, maxL = opts.longueur || 80, vStop = opts.vStop || 0.03;
  const pts = [], a = [0, 0, 0], b = [0, 0, 0];
  let x = p0[0], y = p0[1], z = p0[2], L = 0, n = 0;
  while (L < maxL && n < 4000) {
    const m = vitesse(F, x, y, z, a);
    pts.push(x, y, z, m);
    if (m < vStop) break;
    const xm = x + a[0] / m * h / 2, ym = y + a[1] / m * h / 2, zm = z + a[2] / m * h / 2;
    const m2 = vitesse(F, xm, ym, zm, b); if (m2 < 1e-6) break;
    const nx = x + b[0] / m2 * h, ny = y + b[1] / m2 * h, nz = z + b[2] / m2 * h;
    if (estSolide(F, nx, ny, nz)) break;
    x = nx; y = ny; z = nz; L += h; n++;
  }
  return pts;
}

/* Échelle de couleurs des vitesses (m/s) : rouge = air immobile … violet = jet, rose pâle = jet rapide (3 m/s et plus) */
export const PALIERS = [[0, [255, 59, 78]], [0.1, [253, 181, 42]], [0.25, [20, 202, 116]], [0.6, [0, 194, 255]], [1.2, [203, 60, 255]], [3, [255, 196, 238]]];
export const VMAX_ECHELLE = 3;
/* Graduations de la légende ; position sur la barre en racine carrée pour garder lisibles les faibles vitesses */
export const GRADUATIONS = [0, 0.1, 0.25, 0.5, 1, 1.5, 2, 3];
export function positionEchelle(v) { return Math.sqrt(Math.min(1, Math.max(0, v / VMAX_ECHELLE))); }
export function couleur(v, out) {
  out = out || [0, 0, 0];
  if (v <= 0) { const c = PALIERS[0][1]; out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; return out; }
  for (let i = 1; i < PALIERS.length; i++) {
    if (v <= PALIERS[i][0]) {
      const A = PALIERS[i - 1], B = PALIERS[i], t = (v - A[0]) / (B[0] - A[0]);
      for (let k = 0; k < 3; k++) out[k] = A[1][k] + (B[1][k] - A[1][k]) * t;
      return out;
    }
  }
  const c = PALIERS[PALIERS.length - 1][1]; out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
  return out;
}
