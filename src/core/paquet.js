/* Emballage d'un champ et de son analyse pour l'envoyer du worker à la page (tableaux transférés),
   et reconstruction côté page d'un champ utilisable par la vue 3D. */

export function emballer(F, R) {
  const G = F.G;
  const grille = { nx: G.nx, ny: G.ny, nz: G.nz, dx: G.dx, dy: G.dy, dz: G.dz, W: G.W, B: G.B, H: G.H, n: G.n, solide: G.solide.slice(), produit: G.produit.slice() };
  const msg = { grille, u: F.u, v: F.v, w: F.w, mag: F.mag, info: F.info, analyse: R };
  return { msg, transferts: [F.u.buffer, F.v.buffer, F.w.buffer, F.mag.buffer, grille.solide.buffer, grille.produit.buffer] };
}

export function deballer(msg) {
  const g = msg.grille;
  const G = Object.assign({}, g, { id: (i, j, k) => i + g.nx * (j + g.ny * k) });
  return { G, u: msg.u, v: msg.v, w: msg.w, mag: msg.mag, info: msg.info };
}
