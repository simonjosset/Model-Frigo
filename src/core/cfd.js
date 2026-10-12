/* Calcul fin des flux d'air : équations de Navier-Stokes incompressibles, isothermes, sur une grille
   décalée (vitesses sur les faces, pression au centre des cellules).
   Chaque pas : advection semi-lagrangienne, diffusion implicite (viscosité turbulente), freinage des
   milieux poreux (échelles chargées), projection de pression (gradient conjugué préconditionné).
   Ventilateurs : débit imposé sur les faces du caisson couvertes par chaque hélice ; aspiration :
   débit imposé sur la face arrière (simple flux) ou le dessous (double flux).
   Turbulence : viscosité constante dans chaque jet, réglée pour que le jet libre retrouve 0,25 m/s
   à la portée constructeur (solution de Schlichting du jet rond : u = 3K / (8π ν x)), et viscosité
   faible dans le reste de la chambre. Le résultat est la moyenne de fin de calcul. */
import { creerChamp } from "./champ.js";

export const REGLAGE = { nuPiece: 0.015, cfl: 6, kPortee: 0.15, dtMax: 0.25 };

/* ---------- Interpolation trilinéaire dans un tableau de dimensions NX × NY × NZ ---------- */
function interp(A, NX, NY, NZ, gx, gy, gz) {
  if (gx < 0) gx = 0; else if (gx > NX - 1) gx = NX - 1;
  if (gy < 0) gy = 0; else if (gy > NY - 1) gy = NY - 1;
  if (gz < 0) gz = 0; else if (gz > NZ - 1) gz = NZ - 1;
  let i = gx | 0, j = gy | 0, k = gz | 0;
  if (i > NX - 2) i = NX - 2; if (j > NY - 2) j = NY - 2; if (k > NZ - 2) k = NZ - 2;
  if (i < 0) i = 0; if (j < 0) j = 0; if (k < 0) k = 0;
  const fx = gx - i, fy = gy - j, fz = gz - k, sx = 1, sy = NX, sz = NX * NY;
  const a = i + NX * (j + NY * k);
  const c00 = A[a] + (A[a + sx] - A[a]) * fx, c10 = A[a + sy] + (A[a + sy + sx] - A[a + sy]) * fx;
  const c01 = A[a + sz] + (A[a + sz + sx] - A[a + sz]) * fx, c11 = A[a + sz + sy] + (A[a + sz + sy + sx] - A[a + sz + sy]) * fx;
  const c0 = c00 + (c10 - c00) * fy, c1 = c01 + (c11 - c01) * fy;
  return c0 + (c1 - c0) * fz;
}

/* ---------- Préparation : faces imposées, ventilateurs, viscosité, connexité ---------- */
export function preparer(G, opts) {
  opts = opts || {};
  const R = Object.assign({}, REGLAGE, opts.reglage || {});
  const { nx, ny, nz, dx, dy, dz, solide } = G;
  const NXU = nx + 1, NYV = ny + 1, NZW = nz + 1;
  const NU = NXU * ny * nz, NV = nx * NYV * nz, NW = nx * ny * NZW;
  const S = {
    G, R, nx, ny, nz, dx, dy, dz, NU, NV, NW,
    U: new Float32Array(NU), V: new Float32Array(NV), W: new Float32Array(NW),
    Ua: new Float32Array(NU), Va: new Float32Array(NV), Wa: new Float32Array(NW),
    fu: new Uint8Array(NU), fv: new Uint8Array(NV), fw: new Uint8Array(NW),
    bu: new Float32Array(NU), bv: new Float32Array(NV), bw: new Float32Array(NW),
    avert: [], sorties: []
  };
  const cid = (i, j, k) => i + nx * (j + ny * k);
  const sol = (i, j, k) => i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz || solide[cid(i, j, k)] > 0;
  // Faces fermées : bord du domaine ou contact d'une cellule pleine
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i <= nx; i++) if (sol(i - 1, j, k) || sol(i, j, k)) S.fu[i + NXU * (j + ny * k)] = 1;
  for (let k = 0; k < nz; k++) for (let j = 0; j <= ny; j++) for (let i = 0; i < nx; i++) if (sol(i, j - 1, k) || sol(i, j, k)) S.fv[i + nx * (j + NYV * k)] = 1;
  for (let k = 0; k <= nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (sol(i, j, k - 1) || sol(i, j, k)) S.fw[i + nx * (j + ny * k)] = 1;

  /* Faces d'une face du caisson donnant sur une cellule d'air.
     axe 0/1/2 (x/y/z), sens +1/-1 : renvoie [{t:'u'|'v'|'w', id, x, y, z, A}] */
  function facesCaisson(r, axe, sens) {
    const out = [];
    if (axe === 0) {
      const iF = sens > 0 ? r.i1 + 1 : r.i0, io = sens > 0 ? r.i1 + 1 : r.i0 - 1;
      if (io < 0 || io >= nx) return out;
      for (let k = r.k0; k <= r.k1; k++) for (let j = r.j0; j <= r.j1; j++) if (!sol(io, j, k) && sol(io - sens, j, k))
        out.push({ t: "u", id: iF + NXU * (j + ny * k), x: iF * dx, y: (j + 0.5) * dy, z: (k + 0.5) * dz, A: dy * dz });
    } else if (axe === 1) {
      const jF = sens > 0 ? r.j1 + 1 : r.j0, jo = sens > 0 ? r.j1 + 1 : r.j0 - 1;
      if (jo < 0 || jo >= ny) return out;
      for (let k = r.k0; k <= r.k1; k++) for (let i = r.i0; i <= r.i1; i++) if (!sol(i, jo, k) && sol(i, jo - sens, k))
        out.push({ t: "v", id: i + nx * (jF + NYV * k), x: (i + 0.5) * dx, y: jF * dy, z: (k + 0.5) * dz, A: dx * dz });
    } else {
      const kF = sens > 0 ? r.k1 + 1 : r.k0, ko = sens > 0 ? r.k1 + 1 : r.k0 - 1;
      if (ko < 0 || ko >= nz) return out;
      for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) if (!sol(i, j, ko) && sol(i, j, ko - sens))
        out.push({ t: "w", id: i + nx * (j + ny * kF), x: (i + 0.5) * dx, y: (j + 0.5) * dy, z: kF * dz, A: dx * dy });
    }
    return out;
  }
  function imposer(f, vit) {
    if (f.t === "u") { S.fu[f.id] = 1; S.bu[f.id] = vit; }
    else if (f.t === "v") { S.fv[f.id] = 1; S.bv[f.id] = vit; }
    else { S.fw[f.id] = 1; S.bw[f.id] = vit; }
  }
  const jets = [];
  for (const ev of G.evaps) {
    const e = ev.e, geo = ev.geo, r = ev.r;
    let qPose = 0;
    for (const cote of geo.cotes) {
      const axe = cote.u[0] !== 0 ? 0 : 1, sens = cote.u[0] !== 0 ? cote.u[0] : cote.u[1];
      const faces = facesCaisson(r, axe, sens);
      if (!faces.length) { S.avert.push(e.nom + " : soufflage contre une paroi, ventilateurs ignorés."); continue; }
      const tang = f => axe === 0 ? f.y : f.x, R2 = (geo.dv / 2) * (geo.dv / 2);
      const parFan = cote.fans.map(() => []);
      faces.forEach(f => {
        let best = -1, bd = Infinity;
        cote.fans.forEach((fan, n) => {
          const d2 = Math.pow(tang(f) - (axe === 0 ? fan.c[1] : fan.c[0]), 2) + Math.pow(f.z - fan.c[2], 2);
          if (d2 <= R2 && d2 < bd) { bd = d2; best = n; }
        });
        if (best >= 0) parFan[best].push(f);
      });
      const qFace = new Map();
      cote.fans.forEach((fan, n) => {
        let lst = parFan[n];
        if (!lst.length) { // hélice plus petite qu'une maille : face la plus proche
          let bf = null, bd = Infinity;
          faces.forEach(f => { const d2 = Math.pow(tang(f) - (axe === 0 ? fan.c[1] : fan.c[0]), 2) + Math.pow(f.z - fan.c[2], 2); if (d2 < bd) { bd = d2; bf = f; } });
          lst = [bf];
        }
        lst.forEach(f => qFace.set(f, (qFace.get(f) || 0) + fan.q / lst.length));
      });
      let K = 0, A = 0;
      qFace.forEach((q, f) => { imposer(f, sens * q / f.A); K += q * q / f.A; A += f.A; });
      qPose += cote.q;
      jets.push({ e, geo, cote, K, A, q: cote.q, vSortie: cote.q / A });
      S.sorties.push({ id: e.id, nom: e.nom, cote: cote.s, faces: qFace.size, A, v: cote.q / A });
    }
    // Aspiration : débit égal au soufflage effectivement posé
    if (qPose > 0) {
      const ordre = geo.aspiration === "dessous" ? [[2, -1], [0, -1], [2, 1]] : [[-1, 0], [2, -1], [2, 1]];
      let faces = [];
      for (const [axe, sens] of ordre) {
        if (axe === -1) { const u = geo.u, ax = u[0] !== 0 ? 0 : 1, sg = -(u[0] !== 0 ? u[0] : u[1]); faces = facesCaisson(r, ax, sg); }
        else if (axe === 0) { const u = geo.p, ax = u[0] !== 0 ? 0 : 1, sg = u[0] !== 0 ? u[0] : u[1]; faces = facesCaisson(r, ax, sg).concat(facesCaisson(r, ax, -sg)); }
        else faces = facesCaisson(r, 2, sens);
        if (faces.length) break;
      }
      if (!faces.length) { S.avert.push(e.nom + " : aspiration impossible (caisson enfermé)."); continue; }
      const A = faces.reduce((s, f) => s + f.A, 0);
      faces.forEach(f => {
        // Vers l'intérieur du caisson : de la cellule d'air vers la cellule pleine
        const versInt = f.t === "u" ? (sol(Math.round(f.x / dx), Math.floor(f.y / dy), Math.floor(f.z / dz)) ? 1 : -1)
          : f.t === "v" ? (sol(Math.floor(f.x / dx), Math.round(f.y / dy), Math.floor(f.z / dz)) ? 1 : -1)
            : (sol(Math.floor(f.x / dx), Math.floor(f.y / dy), Math.round(f.z / dz)) ? 1 : -1);
        imposer(f, versInt * qPose / A);
      });
    }
  }
  S.jets = jets;

  // Viscosité turbulente : réglée jet par jet sur la portée constructeur
  const nu = new Float32Array(G.n).fill(R.nuPiece), H = G.H;
  for (const J of jets) {
    const e = J.e, z = J.geo.z, T = Math.max(0.5, e.T), att = z.attache;
    J.k = R.kPortee * ((opts.kEvap && opts.kEvap[e.id]) || 1);
    J.nu = Math.max(R.nuPiece, J.k * 3 * J.K * (1 + att) / (8 * Math.PI * 0.25 * T));
    const O = J.cote.O, u = J.cote.u, p = J.cote.p, half = e.len / 2;
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const c = cid(i, j, k); if (solide[c]) continue;
      const x = (i + 0.5) * dx - O[0], y = (j + 0.5) * dy - O[1], zz = (k + 0.5) * dz;
      const s = x * u[0] + y * u[1]; if (s < -0.3 || s > 2.5 * T) continue;
      const sp = Math.max(0, s), bh = half + 0.25 * sp, bz = J.geo.dv / 2 + 0.25 * sp;
      const rr = x * p[0] + y * p[1], dzz = zz < z.zc ? zz - z.zc : Math.max(0, zz - z.zc - att * (H - z.zc));
      let w = Math.exp(-0.5 * (rr * rr / (bh * bh) + dzz * dzz / (bz * bz)));
      if (s > 1.2 * T) w *= Math.exp(-Math.pow((s - 1.2 * T) / (0.4 * T), 2));
      const val = R.nuPiece + w * (J.nu - R.nuPiece);
      if (val > nu[c]) nu[c] = val;
    }
  }
  S.nu = nu;
  // Viscosité et freinage poreux aux faces
  const nuU = new Float32Array(NU), nuV = new Float32Array(NV), nuW = new Float32Array(NW);
  let poreux = false; for (let c = 0; c < G.n; c++) if (G.cH[c] > 0 || G.cV[c] > 0) { poreux = true; break; }
  const cU = poreux ? new Float32Array(NU) : null, cV = poreux ? new Float32Array(NV) : null, cW = poreux ? new Float32Array(NW) : null;
  const nuC = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) ? R.nuPiece : nu[cid(i, j, k)];
  const ch = (A, i, j, k) => (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) ? 0 : A[cid(i, j, k)];
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i <= nx; i++) {
    const f = i + NXU * (j + ny * k); nuU[f] = 0.5 * (nuC(i - 1, j, k) + nuC(i, j, k));
    if (poreux) cU[f] = Math.max(ch(G.cH, i - 1, j, k), ch(G.cH, i, j, k));
  }
  for (let k = 0; k < nz; k++) for (let j = 0; j <= ny; j++) for (let i = 0; i < nx; i++) {
    const f = i + nx * (j + NYV * k); nuV[f] = 0.5 * (nuC(i, j - 1, k) + nuC(i, j, k));
    if (poreux) cV[f] = Math.max(ch(G.cH, i, j - 1, k), ch(G.cH, i, j, k));
  }
  for (let k = 0; k <= nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const f = i + nx * (j + ny * k); nuW[f] = 0.5 * (nuC(i, j, k - 1) + nuC(i, j, k));
    if (poreux) cW[f] = Math.max(ch(G.cV, i, j, k - 1), ch(G.cV, i, j, k));
  }
  Object.assign(S, { nuU, nuV, nuW, cU, cV, cW });

  // Pression : faces ouvertes de chaque cellule d'air, diagonale, composantes connexes
  const n = G.n, ouv = new Uint8Array(n), diag = new Float32Array(n), fl = [];
  const ix2 = 1 / (dx * dx), iy2 = 1 / (dy * dy), iz2 = 1 / (dz * dz);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = cid(i, j, k); if (solide[c]) continue;
    let m = 0, d = 0;
    if (!S.fu[i + NXU * (j + ny * k)]) { m |= 1; d += ix2; }
    if (!S.fu[i + 1 + NXU * (j + ny * k)]) { m |= 2; d += ix2; }
    if (!S.fv[i + nx * (j + NYV * k)]) { m |= 4; d += iy2; }
    if (!S.fv[i + nx * (j + 1 + NYV * k)]) { m |= 8; d += iy2; }
    if (!S.fw[i + nx * (j + ny * k)]) { m |= 16; d += iz2; }
    if (!S.fw[i + nx * (j + ny * (k + 1))]) { m |= 32; d += iz2; }
    ouv[c] = m; diag[c] = d; fl.push(c);
  }
  const comp = new Int32Array(n).fill(-1), tailles = [];
  let nc = 0; const pile = new Int32Array(fl.length);
  for (const c0 of fl) {
    if (comp[c0] >= 0) continue;
    let sp = 0, cnt = 0; pile[sp++] = c0; comp[c0] = nc;
    while (sp) {
      const c = pile[--sp], m = ouv[c]; cnt++;
      const vois = [m & 1 ? c - 1 : -1, m & 2 ? c + 1 : -1, m & 4 ? c - nx : -1, m & 8 ? c + nx : -1, m & 16 ? c - nx * ny : -1, m & 32 ? c + nx * ny : -1];
      for (const v of vois) if (v >= 0 && comp[v] < 0) { comp[v] = nc; pile[sp++] = v; }
    }
    tailles.push(cnt); nc++;
  }
  Object.assign(S, { ouv, diag, fl: Int32Array.from(fl), comp, tailles, ix2, iy2, iz2, p: new Float32Array(n), b: new Float32Array(n), r: new Float32Array(n), z: new Float32Array(n), d: new Float32Array(n), Ad: new Float32Array(n) });

  // Pas de temps (semi-lagrangien : stable au-delà de CFL 1)
  let vmax = 0.5; S.sorties.forEach(s => { if (s.v > vmax) vmax = s.v; });
  S.dt = Math.min(R.dtMax, R.cfl * Math.min(dx, dy, dz) / vmax);
  S.vmax = vmax; S.t = 0; S.n = 0;
  appliquerImposees(S);
  return S;
}

function appliquerImposees(S) {
  for (let f = 0; f < S.NU; f++) if (S.fu[f]) S.U[f] = S.bu[f];
  for (let f = 0; f < S.NV; f++) if (S.fv[f]) S.V[f] = S.bv[f];
  for (let f = 0; f < S.NW; f++) if (S.fw[f]) S.W[f] = S.bw[f];
}

/* Initialise les vitesses de faces depuis un champ aux centres (par exemple l'aperçu), puis projette */
export function initialiser(S, F) {
  const { nx, ny, nz } = S, NXU = nx + 1, NYV = ny + 1;
  const val = (A, i, j, k) => (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) ? 0 : A[i + nx * (j + ny * k)];
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i <= nx; i++) { const f = i + NXU * (j + ny * k); if (!S.fu[f]) S.U[f] = 0.5 * (val(F.u, i - 1, j, k) + val(F.u, i, j, k)); }
  for (let k = 0; k < nz; k++) for (let j = 0; j <= ny; j++) for (let i = 0; i < nx; i++) { const f = i + nx * (j + NYV * k); if (!S.fv[f]) S.V[f] = 0.5 * (val(F.v, i, j - 1, k) + val(F.v, i, j, k)); }
  for (let k = 0; k <= nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const f = i + nx * (j + ny * k); if (!S.fw[f]) S.W[f] = 0.5 * (val(F.w, i, j, k - 1) + val(F.w, i, j, k)); }
  projeter(S, 200);
}

/* ---------- Un pas de temps ---------- */
export function pas(S) {
  advecter(S);
  diffuser(S);
  freiner(S);
  const it = projeter(S, 40);
  S.t += S.dt; S.n++;
  return it;
}

function advecter(S) {
  const { nx, ny, nz, dx, dy, dz, dt, U, V, W, Ua, Va, Wa, fu, fv, fw } = S, NXU = nx + 1, NYV = ny + 1, NZW = nz + 1;
  const idx = 1 / dx, idy = 1 / dy, idz = 1 / dz;
  // Composantes transverses sur une face : moyenne des 4 faces voisines (grille décalée)
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i <= nx; i++) {
    const f = i + NXU * (j + ny * k);
    if (fu[f]) { Ua[f] = U[f]; continue; }
    const il = i > 0 ? i - 1 : 0, ir = i < nx ? i : nx - 1;
    const v = 0.25 * (V[il + nx * (j + NYV * k)] + V[ir + nx * (j + NYV * k)] + V[il + nx * (j + 1 + NYV * k)] + V[ir + nx * (j + 1 + NYV * k)]);
    const w = 0.25 * (W[il + nx * (j + ny * k)] + W[ir + nx * (j + ny * k)] + W[il + nx * (j + ny * (k + 1))] + W[ir + nx * (j + ny * (k + 1))]);
    const xb = i * dx - dt * U[f], yb = (j + 0.5) * dy - dt * v, zb = (k + 0.5) * dz - dt * w;
    Ua[f] = interp(U, NXU, ny, nz, xb * idx, yb * idy - 0.5, zb * idz - 0.5);
  }
  for (let k = 0; k < nz; k++) for (let j = 0; j <= ny; j++) for (let i = 0; i < nx; i++) {
    const f = i + nx * (j + NYV * k);
    if (fv[f]) { Va[f] = V[f]; continue; }
    const jl = j > 0 ? j - 1 : 0, jr = j < ny ? j : ny - 1;
    const u = 0.25 * (U[i + NXU * (jl + ny * k)] + U[i + 1 + NXU * (jl + ny * k)] + U[i + NXU * (jr + ny * k)] + U[i + 1 + NXU * (jr + ny * k)]);
    const w = 0.25 * (W[i + nx * (jl + ny * k)] + W[i + nx * (jr + ny * k)] + W[i + nx * (jl + ny * (k + 1))] + W[i + nx * (jr + ny * (k + 1))]);
    const xb = (i + 0.5) * dx - dt * u, yb = j * dy - dt * V[f], zb = (k + 0.5) * dz - dt * w;
    Va[f] = interp(V, nx, NYV, nz, xb * idx - 0.5, yb * idy, zb * idz - 0.5);
  }
  for (let k = 0; k <= nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const f = i + nx * (j + ny * k);
    if (fw[f]) { Wa[f] = W[f]; continue; }
    const kl = k > 0 ? k - 1 : 0, kr = k < nz ? k : nz - 1;
    const u = 0.25 * (U[i + NXU * (j + ny * kl)] + U[i + 1 + NXU * (j + ny * kl)] + U[i + NXU * (j + ny * kr)] + U[i + 1 + NXU * (j + ny * kr)]);
    const v = 0.25 * (V[i + nx * (j + NYV * kl)] + V[i + nx * (j + 1 + NYV * kl)] + V[i + nx * (j + NYV * kr)] + V[i + nx * (j + 1 + NYV * kr)]);
    const xb = (i + 0.5) * dx - dt * u, yb = (j + 0.5) * dy - dt * v, zb = k * dz - dt * W[f];
    Wa[f] = interp(W, nx, ny, NZW, xb * idx - 0.5, yb * idy - 0.5, zb * idz);
  }
  U.set(Ua); V.set(Va); W.set(Wa);
}

/* Diffusion implicite (Gauss-Seidel), bords du domaine en glissement libre */
function diffuser(S, iters) {
  iters = iters || 2;
  const { nx, ny, nz, dt, U, V, W, Ua, Va, Wa, fu, fv, fw, nuU, nuV, nuW } = S;
  const ax = dt / (S.dx * S.dx), ay = dt / (S.dy * S.dy), az = dt / (S.dz * S.dz);
  function passe(A, A0, fix, nuF, NX, NY, NZ) {
    const sy = NX, sz = NX * NY;
    for (let it = 0; it < iters; it++) {
      for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) {
        let f = NX * (j + NY * k);
        for (let i = 0; i < NX; i++, f++) {
          if (fix[f]) continue;
          const nu = nuF[f], cx = ax * nu, cy = ay * nu, cz = az * nu;
          let num = A0[f], den = 1;
          if (i > 0) { num += cx * A[f - 1]; den += cx; } if (i < NX - 1) { num += cx * A[f + 1]; den += cx; }
          if (j > 0) { num += cy * A[f - sy]; den += cy; } if (j < NY - 1) { num += cy * A[f + sy]; den += cy; }
          if (k > 0) { num += cz * A[f - sz]; den += cz; } if (k < NZ - 1) { num += cz * A[f + sz]; den += cz; }
          A[f] = num / den;
        }
      }
    }
  }
  passe(U, Ua, fu, nuU, nx + 1, ny, nz);
  passe(V, Va, fv, nuV, nx, ny + 1, nz);
  passe(W, Wa, fw, nuW, nx, ny, nz + 1);
}

function freiner(S) {
  if (!S.cU) return;
  const dt = S.dt;
  const f1 = (A, C, fix) => { for (let f = 0; f < A.length; f++) { const c = C[f]; if (c > 0 && !fix[f]) A[f] /= 1 + dt * c * Math.abs(A[f]); } };
  f1(S.U, S.cU, S.fu); f1(S.V, S.cV, S.fv); f1(S.W, S.cW, S.fw);
}

/* Produit A·x de l'opérateur de pression (laplacien changé de signe sur les faces ouvertes) */
function appliquerA(S, x, out) {
  const { fl, ouv, diag, nx, ny, ix2, iy2, iz2 } = S, sz = nx * ny;
  for (let q = 0; q < fl.length; q++) {
    const c = fl[q], m = ouv[c];
    let s = diag[c] * x[c];
    if (m & 1) s -= ix2 * x[c - 1]; if (m & 2) s -= ix2 * x[c + 1];
    if (m & 4) s -= iy2 * x[c - nx]; if (m & 8) s -= iy2 * x[c + nx];
    if (m & 16) s -= iz2 * x[c - sz]; if (m & 32) s -= iz2 * x[c + sz];
    out[c] = s;
  }
}

/* Divergence des cellules d'air */
export function divergence(S, out) {
  const { nx, ny, nz, dx, dy, dz, U, V, W, fl } = S, NXU = nx + 1, NYV = ny + 1;
  let mx = 0;
  for (let q = 0; q < fl.length; q++) {
    const c = fl[q], i = c % nx, j = ((c - i) / nx) % ny, k = (c - i - nx * j) / (nx * ny);
    const d = (U[i + 1 + NXU * (j + ny * k)] - U[i + NXU * (j + ny * k)]) / dx + (V[i + nx * (j + 1 + NYV * k)] - V[i + nx * (j + NYV * k)]) / dy + (W[i + nx * (j + ny * (k + 1))] - W[i + nx * (j + ny * k)]) / dz;
    if (out) out[c] = d;
    if (Math.abs(d) > mx) mx = Math.abs(d);
  }
  return mx;
}

function projeter(S, maxIt) {
  const { fl, comp, tailles, diag, p, b, r, z, d, Ad, dt, nx, ny, nz, dx, dy, dz, ouv } = S;
  divergence(S, b);
  // b = -div/dt, de moyenne nulle par zone d'air
  const moy = new Float64Array(tailles.length);
  for (let q = 0; q < fl.length; q++) { const c = fl[q]; b[c] = -b[c] / dt; moy[comp[c]] += b[c]; }
  for (let i = 0; i < moy.length; i++) moy[i] /= tailles[i];
  let bn = 0;
  for (let q = 0; q < fl.length; q++) { const c = fl[q]; b[c] -= moy[comp[c]]; bn += b[c] * b[c]; }
  bn = Math.sqrt(bn); if (bn < 1e-12) return 0;
  appliquerA(S, p, Ad);
  let rz = 0;
  for (let q = 0; q < fl.length; q++) { const c = fl[q]; r[c] = b[c] - Ad[c]; z[c] = diag[c] > 0 ? r[c] / diag[c] : 0; d[c] = z[c]; rz += r[c] * z[c]; }
  let it = 0;
  const { ouv: m0, ix2, iy2, iz2 } = S, sz0 = nx * ny, nf = fl.length;
  for (; it < maxIt; it++) {
    // A·d et d·A·d en une passe
    let dAd = 0;
    for (let q = 0; q < nf; q++) {
      const c = fl[q], m = m0[c];
      let v = diag[c] * d[c];
      if (m & 1) v -= ix2 * d[c - 1]; if (m & 2) v -= ix2 * d[c + 1];
      if (m & 4) v -= iy2 * d[c - nx]; if (m & 8) v -= iy2 * d[c + nx];
      if (m & 16) v -= iz2 * d[c - sz0]; if (m & 32) v -= iz2 * d[c + sz0];
      Ad[c] = v; dAd += d[c] * v;
    }
    if (Math.abs(dAd) < 1e-30) break;
    const al = rz / dAd; let rn = 0, rz2 = 0;
    for (let q = 0; q < nf; q++) {
      const c = fl[q]; p[c] += al * d[c];
      const rr = r[c] - al * Ad[c]; r[c] = rr; rn += rr * rr;
      const zz = diag[c] > 0 ? rr / diag[c] : 0; z[c] = zz; rz2 += rr * zz;
    }
    if (Math.sqrt(rn) < 1e-3 * bn) { it++; break; }
    const be = rz2 / rz; rz = rz2;
    for (let q = 0; q < nf; q++) { const c = fl[q]; d[c] = z[c] + be * d[c]; }
  }
  // Correction des vitesses sur les faces ouvertes
  const NXU = nx + 1, NYV = ny + 1, sz = nx * ny;
  for (let q = 0; q < fl.length; q++) {
    const c = fl[q], m = ouv[c], i = c % nx, j = ((c - i) / nx) % ny, k = (c - i - nx * j) / sz;
    if (m & 2) S.U[i + 1 + NXU * (j + ny * k)] -= dt * (p[c + 1] - p[c]) / dx;
    if (m & 8) S.V[i + nx * (j + 1 + NYV * k)] -= dt * (p[c + nx] - p[c]) / dy;
    if (m & 32) S.W[i + nx * (j + ny * (k + 1))] -= dt * (p[c + sz] - p[c]) / dz;
  }
  return it;
}

/* Vitesses aux centres des cellules */
export function versCentres(S, U, V, W) {
  const { nx, ny, nz } = S, NXU = nx + 1, NYV = ny + 1, n = nx * ny * nz;
  const u = new Float32Array(n), v = new Float32Array(n), w = new Float32Array(n);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = i + nx * (j + ny * k);
    u[c] = 0.5 * (U[i + NXU * (j + ny * k)] + U[i + 1 + NXU * (j + ny * k)]);
    v[c] = 0.5 * (V[i + nx * (j + NYV * k)] + V[i + nx * (j + 1 + NYV * k)]);
    w[c] = 0.5 * (W[i + nx * (j + ny * k)] + W[i + nx * (j + ny * (k + 1))]);
  }
  return { u, v, w };
}

/* ---------- Simulation complète, pas à pas (worker ou découpage dans la page) ---------- */
export function demarrer(G, opts) {
  opts = opts || {};
  const S = preparer(G, opts);
  if (opts.init) initialiser(S, opts.init);
  const Q = S.jets.reduce((s, J) => s + J.q, 0) || 0.1;
  const tMel = G.volumeChambre / Q; // temps de renouvellement de l'air de la chambre
  const tFin = opts.tFin || Math.min(150, Math.max(30, 0.6 * tMel + 20));
  const nPas = Math.max(40, Math.min(opts.pasMax || 1500, Math.ceil(tFin / S.dt)));
  // Moyenne sur la fin du calcul ; arrêt anticipé dès que l'écoulement ne bouge plus
  let debutMoy = Math.floor(nPas * 0.6), finMoy = nPas;
  const mU = new Float32Array(S.NU), mV = new Float32Array(S.NV), mW = new Float32Array(S.NW);
  let nMoy = 0, prev = null, evol = [], itP = 0;
  const sim = {
    S, nPas, tFin: nPas * S.dt, fini: false, converge: false,
    avancer(nb) {
      for (let q = 0; q < nb && S.n < finMoy; q++) {
        itP = pas(S);
        if (S.n > debutMoy) {
          for (let f = 0; f < S.NU; f++) mU[f] += S.U[f];
          for (let f = 0; f < S.NV; f++) mV[f] += S.V[f];
          for (let f = 0; f < S.NW; f++) mW[f] += S.W[f];
          nMoy++;
        }
        if (S.n % 10 === 0) {
          // Évolution : variation relative de l'énergie cinétique entre deux contrôles
          let e = 0; for (let f = 0; f < S.NU; f++) e += S.U[f] * S.U[f]; for (let f = 0; f < S.NV; f++) e += S.V[f] * S.V[f]; for (let f = 0; f < S.NW; f++) e += S.W[f] * S.W[f];
          evol.push({ t: S.t, e, ecart: prev ? Math.abs(e - prev) / Math.max(1e-9, prev) : 1 }); prev = e;
          const der = evol.slice(-8);
          if (!sim.converge && S.t > (opts.tMin != null ? opts.tMin : Math.min(25, 0.3 * sim.tFin)) && der.length === 8 && der.every(x => x.ecart < 4e-4)) {
            sim.converge = true; debutMoy = S.n; finMoy = Math.min(nPas, S.n + Math.max(40, Math.ceil(6 / S.dt)));
            mU.fill(0); mV.fill(0); mW.fill(0); nMoy = 0;
          }
        }
      }
      if (S.n >= finMoy) sim.fini = true;
      return { fraction: sim.fini ? 1 : S.n / finMoy, t: S.t, itPression: itP, converge: sim.converge };
    },
    resultat() {
      const k = Math.max(1, nMoy);
      for (let f = 0; f < S.NU; f++) mU[f] /= k; for (let f = 0; f < S.NV; f++) mV[f] /= k; for (let f = 0; f < S.NW; f++) mW[f] /= k;
      const c = nMoy ? versCentres(S, mU, mV, mW) : versCentres(S, S.U, S.V, S.W);
      const fin = evol.slice(-6), stab = fin.length ? fin.reduce((s, x) => s + x.ecart, 0) / fin.length : 1;
      return creerChamp(G, c.u, c.v, c.w, {
        methode: "cfd", pas: S.n, converge: sim.converge, dt: S.dt, t: S.t, moyenne: nMoy, avert: S.avert, sorties: S.sorties,
        jets: S.jets.map(J => ({ id: J.e.id, nu: J.nu, K: J.K, vSortie: J.vSortie })), stabilite: stab, divMax: divergence(S)
      });
    }
  };
  return sim;
}

export function calculer(G, opts) {
  const sim = demarrer(G, opts), t0 = Date.now();
  while (!sim.fini) { const r = sim.avancer(10); if (opts && opts.progres) opts.progres(r); }
  const F = sim.resultat(); F.info.ms = Date.now() - t0;
  return F;
}
