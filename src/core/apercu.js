/* Aperçu instantané des flux : modèle de jets empirique (repris du Brassage de Frigobilan), passé en 3D.
   Pour chaque évaporateur : coupe verticale suivant l'axe de soufflage (fonction de courant, jet collé au
   plafond, arrivée sur la paroi d'en face, retour d'air côté sol), étalée en largeur par les jets des
   ventilateurs, plus une reprise d'air vers l'aspiration. Ce n'est pas un calcul aéraulique. */
import { construireGrille, distanceLibre } from "./grille.js";
import { creerChamp } from "./champ.js";

function sstep(t) { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); }

/* Coupe d'un évaporateur dans son axe : vitesses U (suivant l'axe) et W (verticale) sur une grille (s, z) */
function coupe(G, ev) {
  const e = ev.e, geo = ev.geo, H = G.H, dep = geo.dep, u = geo.u, dbl = e.type === "double";
  const z0 = geo.z, zc0 = Math.min(H - 0.05, z0.zc);
  const Of = [e.x + u[0] * dep / 2, e.y + u[1] * dep / 2], Ob = [e.x - u[0] * dep / 2, e.y - u[1] * dep / 2];
  const Lf = distanceLibre(G, Of[0], Of[1], zc0, u[0], u[1]), Lb = distanceLibre(G, Ob[0], Ob[1], zc0, -u[0], -u[1]);
  const xF = dep / 2 + Lf, xB = -(dep / 2 + Lb), span = xF - xB;
  const ds = Math.max(0.05, span / 600), nsx = Math.max(10, Math.ceil(span / ds)), dzs = Math.max(0.04, H / 90), nzs = Math.max(10, Math.ceil(H / dzs));
  const dxs = span / nsx, dz = H / nzs;
  const T = Math.max(0.5, e.T), Qs = e.q / (dbl ? 2 : 1) / 3600, Qlen = Qs / Math.max(0.3, e.len);
  const wd = Math.min(1.5, Math.max(0.7, Math.sqrt(Qlen / 0.46)));
  const thick = s => Math.min(0.55 * H, 0.45 * wd + 0.17 * s);
  const attach = z0.attache, zc = z0.zc + attach * (H - z0.zc);
  // Vitesse dans l'axe du jet (loi de portée) et vitesse « à débit constant » servant à la fonction de courant :
  // la circulation (retour d'air, descente le long de la paroi d'en face) ne dépend pas de la décroissance du jet.
  const umR = s => Math.min(5, 0.25 * T / Math.max(s, 0.3)), bRef = thick(0.5 * T), umF = s => 0.5 * bRef / thick(s);
  function profil(s) {
    const b = thick(s), um = umF(s), uj = new Float32Array(nzs), rr = new Float32Array(nzs), thr = 1.3 * b * (0.5 + 0.5 * attach);
    let qj = 0, rs = 0;
    for (let j = 0; j < nzs; j++) {
      const z = (j + 0.5) * dz, d = z - zc;
      uj[j] = um * Math.exp(-1.5 * d * d / (b * b)); qj += uj[j] * dz;
      rr[j] = (1 / (1 + Math.exp(-(Math.abs(d) - thr) / 0.15))) * (0.25 + Math.pow(1 - z / H, 2)); rs += rr[j] * dz;
    }
    const ps = new Float32Array(nzs); let acc = 0;
    for (let j = 0; j < nzs; j++) { acc += (uj[j] - (rs > 0 ? qj * rr[j] / rs : 0)) * dz; ps[j] = acc; }
    return ps;
  }
  function surplus(s) {
    const b = thick(s), du = umR(s) - umF(s), e = new Float32Array(nzs);
    for (let j = 0; j < nzs; j++) { const d = (j + 0.5) * dz - zc; e[j] = du * Math.exp(-1.5 * d * d / (b * b)); }
    return e;
  }
  const p0 = profil(0), psi = new Float32Array(nsx * nzs), E = new Float32Array(nsx * nzs), wtF = Math.max(0.15, Math.min(1.2, 0.3 * Lf)), wtB = Math.max(0.15, Math.min(1.2, 0.3 * Lb));
  const xR = Math.max(xB, -dep / 2 - 1.0), denR = Math.max(0.2, -dep / 2 - xR);
  for (let i = 0; i < nsx; i++) {
    const x = xB + (i + 0.5) * dxs; let prof = null, fac = 1;
    if (!dbl) {
      const s0 = x - dep / 2;
      if (s0 >= 0) { prof = profil(s0); fac = sstep((Lf - s0) / wtF); const e = surplus(s0); for (let j = 0; j < nzs; j++) E[j * nsx + i] = fac * e[j]; }
      else if (x >= -dep / 2) prof = p0;
      else if (x >= xR) { prof = p0; fac = sstep((x - xR) / denR); }
    } else {
      const ax = Math.abs(x), L = x >= 0 ? Lf : Lb, wt = x >= 0 ? wtF : wtB, s2 = ax - dep / 2;
      if (s2 >= 0) { prof = profil(s2); fac = sstep((L - s2) / wt); const e = surplus(s2); for (let j = 0; j < nzs; j++) E[j * nsx + i] = (x < 0 ? -fac : fac) * e[j]; } else { prof = p0; fac = sstep(ax / (dep / 2)); }
      if (x < 0 && prof) fac = -fac; // côté arrière : soufflage dans l'autre sens
    }
    if (!prof) continue;
    for (let j = 0; j < nzs; j++) psi[j * nsx + i] = fac * prof[j];
  }
  const U = new Float32Array(nsx * nzs), Wv = new Float32Array(nsx * nzs);
  for (let j = 0; j < nzs; j++) for (let i = 0; i < nsx; i++) {
    const id = j * nsx + i, up = j < nzs - 1 ? psi[id + nsx] : 0, dn = j > 0 ? psi[id - nsx] : 0, dzz = (j === 0 || j === nzs - 1) ? 1.5 * dz : 2 * dz;
    const rt = i < nsx - 1 ? psi[id + 1] : 0, lf = i > 0 ? psi[id - 1] : 0, dxx = (i === 0 || i === nsx - 1) ? 1.5 * dxs : 2 * dxs;
    U[id] = (up - dn) / dzz + E[id]; Wv[id] = -(rt - lf) / dxx;
  }
  return { U, W: Wv, nsx, nzs, dxs, dz, xB, xF, Lf, Lb, zc, attach, dbl };
}

function echCoupe(C, s, z, out) {
  let gx = (s - C.xB) / C.dxs - 0.5, gz = z / C.dz - 0.5;
  if (gx < -0.5 || gx > C.nsx - 0.5) { out[0] = 0; out[1] = 0; return; }
  gx = Math.min(C.nsx - 1, Math.max(0, gx)); gz = Math.min(C.nzs - 1, Math.max(0, gz));
  const i = Math.min(C.nsx - 2, Math.floor(gx)), j = Math.min(C.nzs - 2, Math.floor(gz)), fx = gx - i, fz = gz - j;
  const a = j * C.nsx + i;
  out[0] = (C.U[a] * (1 - fx) + C.U[a + 1] * fx) * (1 - fz) + (C.U[a + C.nsx] * (1 - fx) + C.U[a + C.nsx + 1] * fx) * fz;
  out[1] = (C.W[a] * (1 - fx) + C.W[a + 1] * fx) * (1 - fz) + (C.W[a + C.nsx] * (1 - fx) + C.W[a + C.nsx + 1] * fx) * fz;
}

/* Visibilité en plan depuis un point (à une hauteur donnée) : 1 si le segment ne traverse pas de paroi */
function visibilite(G, x0, y0, z) {
  const vis = new Uint8Array(G.nx * G.ny), k = Math.min(G.nz - 1, Math.max(0, Math.floor(z / G.dz))), pas = Math.min(G.dx, G.dy) * 0.5;
  const i0 = Math.floor(x0 / G.dx), j0 = Math.floor(y0 / G.dy);
  for (let j = 0; j < G.ny; j++) for (let i = 0; i < G.nx; i++) {
    const x1 = (i + 0.5) * G.dx, y1 = (j + 0.5) * G.dy, L = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(L / pas);
    let ok = 1;
    for (let s = 1; s < n; s++) {
      const t = s / n, ii = Math.floor((x0 + (x1 - x0) * t) / G.dx), jj = Math.floor((y0 + (y1 - y0) * t) / G.dy);
      if (Math.abs(ii - i0) + Math.abs(jj - j0) <= 1) continue; // départ dans le caisson
      const so = G.solide[ii + G.nx * (jj + G.ny * k)];
      if (so && so !== 2) { ok = 0; break; }
    }
    vis[i + G.nx * j] = ok;
  }
  return vis;
}

export function calculerApercu(projet, opts) {
  opts = opts || {};
  const t0 = Date.now();
  const G = opts.grille || construireGrille(projet, { cellules: opts.cellules || 45000 });
  const n = G.n, u = new Float32Array(n), v = new Float32Array(n), w = new Float32Array(n), tmp = [0, 0];
  const jets = [];
  for (const ev of G.evaps) {
    const e = ev.e, geo = ev.geo;
    const sorties = [];
    geo.cotes.forEach(c => c.fans.forEach(f => { if (f.coude) sorties.push({ c: f.coude.sortie, r: f.coude.r }); }));
    if (sorties.length) {
      // Coudes vers le bas : jet vertical sous chaque sortie, puis nappe qui s'étale au sol
      const asp = e.type === "double" ? [e.x, e.y] : [e.x - geo.u[0] * (geo.dep / 2 + 0.15), e.y - geo.u[1] * (geo.dep / 2 + 0.15)];
      sorties.forEach(so => { so.vis = visibilite(G, so.c[0], so.c[1], Math.min(G.H - G.dz / 2, 0.3)); });
      jets.push({ e, geo, coude: true, sorties, asp, visA: visibilite(G, asp[0], asp[1], Math.min(G.H - G.dz / 2, 1.0)), Q: e.q / 3600, C: { Lf: null, Lb: null } });
      continue;
    }
    const C = coupe(G, ev);
    const zv = Math.min(G.H - G.dz / 2, Math.max(G.dz / 2, geo.z.zc));
    const vis = visibilite(G, e.x, e.y, zv);
    const nf = Math.max(1, Math.round(e.nf)), Lu = e.len / nf, s0 = (e.len / 2) / 0.22;
    const offs = []; for (let f = 0; f < nf; f++) offs.push(((f + 0.5) / nf - 0.5) * e.len);
    const asp = e.type === "double" ? [e.x, e.y] : [e.x - geo.u[0] * (geo.dep / 2 + 0.15), e.y - geo.u[1] * (geo.dep / 2 + 0.15)];
    const visA = visibilite(G, asp[0], asp[1], Math.min(G.H - G.dz / 2, 1.0));
    jets.push({ e, geo, C, vis, visA, offs, Lu, s0, asp, Q: e.q / 3600 });
  }
  for (let k = 0; k < G.nz; k++) for (let j = 0; j < G.ny; j++) for (let i = 0; i < G.nx; i++) {
    const c = i + G.nx * (j + G.ny * k);
    if (G.solide[c]) continue;
    const x = (i + 0.5) * G.dx, y = (j + 0.5) * G.dy, z = (k + 0.5) * G.dz, col = i + G.nx * j;
    let sx = 0, sy = 0, sz = 0;
    for (const J of jets) {
      if (J.coude) {
        const T = Math.max(0.5, J.e.T);
        let gMax = 0;
        for (const so of J.sorties) {
          const dxs = x - so.c[0], dys = y - so.c[1], rr = Math.hypot(dxs, dys), zo = so.c[2];
          const um = s0 => Math.min(5, 0.25 * T / Math.max(s0, 0.3)), bS = so.r + 0.22 * zo, uSol = um(zo);
          if (z < zo) {
            // Jet vertical, freiné en approchant du sol
            const sv = zo - z, b = so.r + 0.22 * sv, g = Math.exp(-1.5 * rr * rr / (b * b)), fv = Math.min(1, z / (0.6 * bS));
            sz -= um(sv) * g * fv; gMax = Math.max(gMax, g);
          }
          // Nappe au sol : part du point d'impact et s'étale dans toutes les directions
          if (rr > 0.05 && so.vis[col]) {
            const ep = 0.15 + 0.08 * rr, vr = uSol * (bS / (bS + rr)) * Math.exp(-Math.pow(z / ep, 2)) * (1 - Math.exp(-rr * rr / (bS * bS)));
            sx += vr * dxs / rr; sy += vr * dys / rr;
          }
        }
        if (J.visA[col]) {
          const qx = J.asp[0] - x, qy = J.asp[1] - y, d = Math.hypot(qx, qy);
          if (d > 0.05) { const vs = Math.min(0.4, J.Q / (2 * Math.PI * Math.max(d, 0.5) * G.H)) * (1 - Math.min(1, gMax)); sx += vs * qx / d; sy += vs * qy / d; }
        }
        continue;
      }
      const e = J.e, gu = J.geo.u, gp = J.geo.p, rx = x - e.x, ry = y - e.y;
      const s = rx * gu[0] + ry * gu[1], r = rx * gp[0] + ry * gp[1];
      let g = 0;
      const sf0 = Math.abs(s) - J.geo.dep / 2, dansJet = sf0 >= 0 && (s >= 0 || J.C.dbl);
      if (J.vis[col]) {
        const sf = sf0;
        if (dansJet) {
          let acc = 0;
          for (const o of J.offs) { const bw = J.Lu / 2 + 0.22 * sf, d = r - o; acc += Math.exp(-3 * d * d / (bw * bw)); }
          g = Math.sqrt(acc / J.offs.length);
        } else {
          const d = Math.max(0, Math.abs(r) - e.len / 2);
          g = Math.exp(-d * d / 0.09);
        }
      }
      if (g > 0.003) {
        echCoupe(J.C, s, z, tmp);
        const sg = s >= 0 ? 1 : -1, sf = Math.max(0, Math.abs(s) - J.geo.dep / 2);
        // Direction horizontale : le jet s'ouvre depuis une origine virtuelle derrière la sortie
        let hx = gu[0], hy = gu[1];
        if (dansJet && sf > 0) { const a = sf + J.s0, rn = Math.hypot(a, r); hx = (gu[0] * a + gp[0] * r * sg) / rn; hy = (gu[1] * a + gp[1] * r * sg) / rn; }
        sx += tmp[0] * g * hx; sy += tmp[0] * g * hy; sz += tmp[1] * g;
      }
      // Reprise d'air vers l'aspiration, hors du jet
      if (J.visA[col]) {
        const qx = J.asp[0] - x, qy = J.asp[1] - y, d = Math.hypot(qx, qy);
        if (d > 0.05) {
          const vs = Math.min(0.4, J.Q / (2 * Math.PI * Math.max(d, 0.5) * G.H)) * (1 - Math.min(1, g));
          sx += vs * qx / d; sy += vs * qy / d;
        }
      }
    }
    const ph = G.phi[c];
    u[c] = sx * ph; v[c] = sy * ph; w[c] = sz * ph;
  }
  return creerChamp(G, u, v, w, { methode: "apercu", ms: Date.now() - t0, jets: jets.map(J => ({ id: J.e.id, Lf: J.C.Lf, Lb: J.C.Lb })) });
}
