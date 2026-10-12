/* Calques de visualisation des flux d'air dans la vue 3D : particules animées avec traînées,
   lignes de courant depuis chaque ventilateur, plan de coupe coloré par la vitesse (avec flèches),
   zones mortes en volume, sonde de vitesse. */
import {
  Group, BufferGeometry, Float32BufferAttribute, LineSegments, LineBasicMaterial, Mesh, MeshBasicMaterial, MeshLambertMaterial,
  DataTexture, RGBAFormat, LinearFilter, SRGBColorSpace, DoubleSide, InstancedMesh, BoxGeometry, Object3D, SphereGeometry, DynamicDrawUsage
} from "three";
import { vitesse, estSolide, ligneDeCourant, couleur } from "../core/champ.js";

const TL = 14;            // points de traînée par particule
const PAS_TRAINEE = 0.05; // s entre deux points de traînée

function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }

export function creerFlux(scene, opts) {
  const racine = new Group(); scene.add(racine);
  let F = null, k = null, sources = [], fluides = null, theme = { sombre: true };
  const aff = { particules: true, densite: 2500, vitesseAnim: 1, lignes: false, coupe: false, axe: "z", pos: 1.5, vecteurs: false, mortes: false, vmin: 0.15 };
  const tmp = [0, 0, 0], col = [0, 0, 0];
  const demander = () => opts && opts.demander && opts.demander();

  /* ---------- Particules ---------- */
  let P = null, gP = null, lP = null, chrono = 0;
  function creerParticules() {
    if (lP) { racine.remove(lP); lP.geometry.dispose(); lP = null; }
    if (!F || !aff.particules) { P = null; return; }
    const N = Math.max(100, Math.min(20000, Math.round(aff.densite)));
    P = { N, x: new Float32Array(N), y: new Float32Array(N), z: new Float32Array(N), age: new Float32Array(N), vie: new Float32Array(N), lent: new Float32Array(N), v: new Float32Array(N), tr: new Float32Array(N * TL * 3), tv: new Float32Array(N * TL), tete: 0 };
    for (let i = 0; i < N; i++) { naitre(i); P.age[i] = Math.random() * P.vie[i]; }
    gP = new BufferGeometry();
    const nSeg = N * (TL - 1);
    const pos = new Float32BufferAttribute(new Float32Array(nSeg * 6), 3), cl = new Float32BufferAttribute(new Float32Array(nSeg * 8), 4);
    pos.setUsage(DynamicDrawUsage); cl.setUsage(DynamicDrawUsage);
    gP.setAttribute("position", pos); gP.setAttribute("color", cl);
    lP = new LineSegments(gP, new LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
    lP.frustumCulled = false;
    racine.add(lP);
    remplirTraits();
  }
  function naitre(i) {
    let x, y, z;
    if (sources.length && Math.random() < 0.3) {
      // Devant une hélice, au prorata du débit
      let r = Math.random() * sources.qTot, s = sources[0];
      for (const q of sources) { r -= q.q; if (r <= 0) { s = q; break; } }
      const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * s.r * 0.9, t = s.t, b = s.b;
      x = s.c[0] + s.n[0] * 0.06 + (t[0] * Math.cos(a) + b[0] * Math.sin(a)) * rr;
      y = s.c[1] + s.n[1] * 0.06 + (t[1] * Math.cos(a) + b[1] * Math.sin(a)) * rr;
      z = s.c[2] + s.n[2] * 0.06 + (t[2] * Math.cos(a) + b[2] * Math.sin(a)) * rr;
    } else {
      const G = F.G, c = fluides[(Math.random() * fluides.length) | 0], ii = c % G.nx, jj = ((c - ii) / G.nx) % G.ny, kk = (c - ii - G.nx * jj) / (G.nx * G.ny);
      x = (ii + Math.random()) * G.dx; y = (jj + Math.random()) * G.dy; z = (kk + Math.random()) * G.dz;
    }
    P.x[i] = x; P.y[i] = y; P.z[i] = z; P.age[i] = 0; P.vie[i] = 3 + Math.random() * 7; P.lent[i] = 0;
    for (let q = 0; q < TL; q++) { const o = (i * TL + q) * 3; P.tr[o] = x; P.tr[o + 1] = y; P.tr[o + 2] = z; P.tv[i * TL + q] = 0; }
  }
  function avancerParticules(dt) {
    if (!P) return;
    const h = dt * aff.vitesseAnim, G = F.G, lim = 0.5 * Math.min(G.dx, G.dy, G.dz);
    chrono += h;
    let enregistrer = false;
    if (chrono >= PAS_TRAINEE * aff.vitesseAnim) { chrono = 0; P.tete = (P.tete + 1) % TL; enregistrer = true; }
    for (let i = 0; i < P.N; i++) {
      let x = P.x[i], y = P.y[i], z = P.z[i];
      let m = vitesse(F, x, y, z, tmp);
      // Sous-pas si la particule traverse plus d'une demi-maille
      const n = Math.min(6, Math.max(1, Math.ceil(m * h / lim)));
      for (let s = 0; s < n; s++) {
        x += tmp[0] * h / n; y += tmp[1] * h / n; z += tmp[2] * h / n;
        if (s < n - 1) m = vitesse(F, x, y, z, tmp);
      }
      P.age[i] += dt;
      if (m < 0.02) P.lent[i] += dt; else P.lent[i] = 0;
      if (P.age[i] > P.vie[i] || P.lent[i] > 1.5 || estSolide(F, x, y, z)) { naitre(i); continue; }
      P.x[i] = x; P.y[i] = y; P.z[i] = z; P.v[i] = m;
      if (enregistrer) { const o = (i * TL + P.tete) * 3; P.tr[o] = x; P.tr[o + 1] = y; P.tr[o + 2] = z; P.tv[i * TL + P.tete] = m; }
    }
    remplirTraits();
  }
  function remplirTraits() {
    const pos = gP.attributes.position.array, cl = gP.attributes.color.array;
    let o = 0, oc = 0;
    for (let i = 0; i < P.N; i++) {
      let ax = P.x[i], ay = P.y[i], az = P.z[i];
      couleur(P.v[i], col);
      const r = lin(col[0]), g = lin(col[1]), b = lin(col[2]);
      for (let s = 0; s < TL - 1; s++) {
        const q = ((P.tete - s) % TL + TL) % TL, t3 = (i * TL + q) * 3;
        const bx = P.tr[t3], by = P.tr[t3 + 1], bz = P.tr[t3 + 2];
        pos[o++] = ax; pos[o++] = ay; pos[o++] = az; pos[o++] = bx; pos[o++] = by; pos[o++] = bz;
        const a0 = 1 - s / (TL - 1), a1 = 1 - (s + 1) / (TL - 1);
        cl[oc++] = r; cl[oc++] = g; cl[oc++] = b; cl[oc++] = a0 * 0.95;
        cl[oc++] = r; cl[oc++] = g; cl[oc++] = b; cl[oc++] = a1 * 0.95;
        ax = bx; ay = by; az = bz;
      }
    }
    gP.attributes.position.needsUpdate = true; gP.attributes.color.needsUpdate = true;
  }

  /* ---------- Lignes de courant ---------- */
  let lL = null;
  function creerLignes() {
    if (lL) { racine.remove(lL); lL.geometry.dispose(); lL = null; }
    if (!F || !aff.lignes || !sources.length) return;
    const pos = [], cl = [];
    for (const s of sources) {
      const graines = [[0, 0]]; for (let a = 0; a < 6; a++) graines.push([Math.cos(a * Math.PI / 3) * 0.55, Math.sin(a * Math.PI / 3) * 0.55]);
      for (const [u, v] of graines) {
        const p0 = [0, 1, 2].map(d => s.c[d] + s.n[d] * 0.08 + (s.t[d] * u + s.b[d] * v) * s.r);
        const L = ligneDeCourant(F, p0, { longueur: 90 });
        for (let q = 0; q + 7 < L.length; q += 4) {
          pos.push(L[q], L[q + 1], L[q + 2], L[q + 4], L[q + 5], L[q + 6]);
          couleur(L[q + 3], col); const r = lin(col[0]), g = lin(col[1]), b = lin(col[2]);
          cl.push(r, g, b, r, g, b);
        }
      }
    }
    const geo = new BufferGeometry(); geo.setAttribute("position", new Float32BufferAttribute(pos, 3)); geo.setAttribute("color", new Float32BufferAttribute(cl, 3));
    lL = new LineSegments(geo, new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 }));
    racine.add(lL);
  }

  /* ---------- Plan de coupe ---------- */
  let mC = null, lV = null;
  function cadreCoupe() {
    // Coins du plan et axes (u, v) dans le plan
    const W = k.W, B = k.B, H = k.H, p = aff.pos;
    if (aff.axe === "x") return { o: [p, 0, 0], u: [0, B, 0], v: [0, 0, H], lu: B, lv: H };
    if (aff.axe === "y") return { o: [0, p, 0], u: [W, 0, 0], v: [0, 0, H], lu: W, lv: H };
    return { o: [0, 0, p], u: [W, 0, 0], v: [0, B, 0], lu: W, lv: B };
  }
  function creerCoupe() {
    if (mC) { racine.remove(mC); mC.geometry.dispose(); mC.material.map.dispose(); mC.material.dispose(); mC = null; }
    if (lV) { racine.remove(lV); lV.geometry.dispose(); lV = null; }
    if (!F || !aff.coupe || !k) return;
    const c = cadreCoupe(), res = Math.min(0.04, Math.max(c.lu, c.lv) / 420);
    const nu = Math.max(8, Math.ceil(c.lu / res)), nv = Math.max(8, Math.ceil(c.lv / res));
    const data = new Uint8Array(nu * nv * 4);
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = (i + 0.5) / nu, b = (j + 0.5) / nv;
      const x = c.o[0] + c.u[0] * a + c.v[0] * b, y = c.o[1] + c.u[1] * a + c.v[1] * b, z = c.o[2] + c.u[2] * a + c.v[2] * b;
      const o = (j * nu + i) * 4;
      if (estSolide(F, x, y, z)) { data[o + 3] = 0; continue; }
      couleur(vitesse(F, x, y, z, tmp), col);
      data[o] = col[0]; data[o + 1] = col[1]; data[o + 2] = col[2]; data[o + 3] = 215;
    }
    const tex = new DataTexture(data, nu, nv, RGBAFormat); tex.colorSpace = SRGBColorSpace; tex.magFilter = LinearFilter; tex.minFilter = LinearFilter; tex.needsUpdate = true;
    const o = c.o, U = c.u, V = c.v, P0 = o, P1 = [o[0] + U[0], o[1] + U[1], o[2] + U[2]], P2 = [P1[0] + V[0], P1[1] + V[1], P1[2] + V[2]], P3 = [o[0] + V[0], o[1] + V[1], o[2] + V[2]];
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute([...P0, ...P1, ...P2, ...P0, ...P2, ...P3], 3));
    geo.setAttribute("uv", new Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));
    mC = new Mesh(geo, new MeshBasicMaterial({ map: tex, transparent: true, side: DoubleSide, depthWrite: false }));
    mC.renderOrder = 2; mC.userData.coupe = true;
    racine.add(mC);
    if (aff.vecteurs) {
      const pas = Math.max(0.25, Math.max(c.lu, c.lv) / 45), pos = [], cl = [], n = aff.axe === "x" ? 0 : aff.axe === "y" ? 1 : 2;
      for (let b = pas / 2; b < c.lv; b += pas) for (let a = pas / 2; a < c.lu; a += pas) {
        const x = o[0] + U[0] / c.lu * a + V[0] / c.lv * b, y = o[1] + U[1] / c.lu * a + V[1] / c.lv * b, z = o[2] + U[2] / c.lu * a + V[2] / c.lv * b;
        if (estSolide(F, x, y, z)) continue;
        const m = vitesse(F, x, y, z, tmp); tmp[n] = 0;
        const mp = Math.hypot(tmp[0], tmp[1], tmp[2]); if (mp < 0.02) continue;
        const L = Math.min(pas * 0.95, 0.12 + 0.5 * mp * pas), ux = tmp[0] / mp, uy = tmp[1] / mp, uz = tmp[2] / mp;
        const ex = x + ux * L, ey = y + uy * L, ez = z + uz * L;
        // pointe : deux traits à ±25° dans le plan de coupe
        let wx = 0, wy = 0, wz = 0;
        if (n === 2) { wx = -uy; wy = ux; } else if (n === 1) { wx = -uz; wz = ux; } else { wy = -uz; wz = uy; }
        const t = L * 0.3;
        pos.push(x, y, z, ex, ey, ez, ex, ey, ez, ex - ux * t + wx * t * 0.5, ey - uy * t + wy * t * 0.5, ez - uz * t + wz * t * 0.5, ex, ey, ez, ex - ux * t - wx * t * 0.5, ey - uy * t - wy * t * 0.5, ez - uz * t - wz * t * 0.5);
        const cc = theme.sombre ? [1, 1, 1] : [0.03, 0.06, 0.16];
        for (let q = 0; q < 6; q++) cl.push(cc[0], cc[1], cc[2]);
        void m;
      }
      const g2 = new BufferGeometry(); g2.setAttribute("position", new Float32BufferAttribute(pos, 3)); g2.setAttribute("color", new Float32BufferAttribute(cl, 3));
      lV = new LineSegments(g2, new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false }));
      lV.renderOrder = 3; racine.add(lV);
    }
  }

  /* ---------- Zones mortes ---------- */
  let mM = null;
  function creerMortes() {
    if (mM) { racine.remove(mM); mM.geometry.dispose(); mM.material.dispose(); mM = null; }
    if (!F || !aff.mortes) return;
    // Seule l'enveloppe du volume d'air immobile est dessinée : cellules mortes touchant de l'air en mouvement
    const G = F.G, nx = G.nx, ny = G.ny, nz = G.nz, mort = c => !G.solide[c] && F.mag[c] < aff.vmin, vif = c => !G.solide[c] && F.mag[c] >= aff.vmin;
    const liste = [];
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const c = i + nx * (j + ny * k); if (!mort(c)) continue;
      if ((i > 0 && vif(c - 1)) || (i < nx - 1 && vif(c + 1)) || (j > 0 && vif(c - nx)) || (j < ny - 1 && vif(c + nx)) || (k > 0 && vif(c - nx * ny)) || (k < nz - 1 && vif(c + nx * ny)))
        liste.push([(i + 0.5) * G.dx, (j + 0.5) * G.dy, (k + 0.5) * G.dz]);
    }
    if (!liste.length) return;
    const t = new Object3D();
    mM = new InstancedMesh(new BoxGeometry(G.dx * 0.94, G.dy * 0.94, G.dz * 0.94), new MeshLambertMaterial({ color: 0xff3b4e, emissive: 0x501018, transparent: true, opacity: 0.32, depthWrite: false }), liste.length);
    liste.forEach((p, i) => { t.position.set(p[0], p[1], p[2]); t.updateMatrix(); mM.setMatrixAt(i, t.matrix); });
    mM.renderOrder = 1; racine.add(mM);
  }

  /* ---------- Sonde ---------- */
  let marque = null;
  function sonde(ray) {
    if (!mC || !F) return null;
    const h = ray.intersectObject(mC, false); if (!h.length) return null;
    const p = h[0].point;
    if (estSolide(F, p.x, p.y, p.z)) return null;
    const m = vitesse(F, p.x, p.y, p.z, tmp);
    if (!marque) { marque = new Mesh(new SphereGeometry(0.06, 14, 10), new MeshBasicMaterial({ color: 0xffffff })); marque.renderOrder = 4; racine.add(marque); }
    marque.position.copy(p); marque.visible = true; demander();
    return { x: p.x, y: p.y, z: p.z, u: tmp[0], v: tmp[1], w: tmp[2], m };
  }

  function toutRefaire() { creerParticules(); creerLignes(); creerCoupe(); creerMortes(); demander(); }

  return {
    setLimites(kk) { k = kk; },
    setTheme(t) { theme = Object.assign(theme, t); creerCoupe(); },
    /* Sources des particules et lignes : hélices { c, n, r, q } */
    setSources(list) {
      sources = list.map(s => {
        const n = s.n, t = Math.abs(n[2]) > 0.9 ? [1, 0, 0] : [-n[1], n[0], 0], tl = Math.hypot(t[0], t[1], t[2]) || 1;
        const tt = [t[0] / tl, t[1] / tl, t[2] / tl], b = [n[1] * tt[2] - n[2] * tt[1], n[2] * tt[0] - n[0] * tt[2], n[0] * tt[1] - n[1] * tt[0]];
        return Object.assign({}, s, { t: tt, b });
      });
      sources.qTot = sources.reduce((a, s) => a + s.q, 0);
    },
    setChamp(f) {
      F = f; fluides = null;
      if (F) { const G = F.G, l = []; for (let c = 0; c < G.n; c++) if (!G.solide[c]) l.push(c); fluides = Int32Array.from(l); }
      if (marque) marque.visible = false;
      toutRefaire();
    },
    setAffichage(o) {
      const avant = Object.assign({}, aff); Object.assign(aff, o);
      if (avant.particules !== aff.particules || avant.densite !== aff.densite) creerParticules();
      if (avant.lignes !== aff.lignes) creerLignes();
      if (avant.coupe !== aff.coupe || avant.axe !== aff.axe || avant.pos !== aff.pos || avant.vecteurs !== aff.vecteurs) { creerCoupe(); if (marque) marque.visible = false; }
      if (avant.mortes !== aff.mortes || avant.vmin !== aff.vmin) creerMortes();
      demander();
    },
    animer(dt) { avancerParticules(dt); },
    anime() { return !!(P && aff.particules && aff.vitesseAnim > 0); },
    sonde, couleurVitesse: v => couleur(v, [0, 0, 0]),
    masquerSonde() { if (marque) { marque.visible = false; demander(); } }
  };
}
