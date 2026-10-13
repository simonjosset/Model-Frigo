/* Analyse d'un champ de vitesses : indicateurs de brassage, portée des jets, vitesse dans les
   échelles, alertes. Fonctionne sur l'aperçu comme sur le calcul fin. */
import { vitesse } from "./champ.js";
import { distanceLibre, plage, SOLIDE } from "./grille.js";
import { dims, volume, porteSnap, obstacleGeo, dansEncoche, distSegment } from "./geometrie.js";

function fr(x, d) { return (+x).toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d }); }

/* Portée mesurée d'un côté de soufflage : distance où la plus grande vitesse vers l'avant,
   dans la section du jet, passe sous 0,25 m/s */
export function porteeMesuree(F, ev, cote, seuil) {
  seuil = seuil || 0.25;
  const G = F.G, e = ev.e, u = cote.u, p = cote.p, O = cote.O, h = Math.min(G.dx, G.dy);
  const Lf = distanceLibre(G, O[0], O[1], Math.min(G.H - G.dz / 2, O[2]), u[0], u[1]);
  const o = [0, 0, 0];
  let prev = null, prevS = 0, vFin = 0;
  for (let s = Math.max(0.3, h); s <= Lf - h * 0.5; s += h) {
    const lar = e.len / 2 + 0.3 * s;
    let m = 0;
    for (let r = -lar; r <= lar; r += h) {
      const x = O[0] + u[0] * s + p[0] * r, y = O[1] + u[1] * s + p[1] * r;
      if (x < 0 || y < 0 || x > G.W || y > G.B) continue;
      for (let z = G.dz / 2; z < G.H; z += G.dz) {
        vitesse(F, x, y, z, o);
        const va = o[0] * u[0] + o[1] * u[1];
        if (va > m) m = va;
      }
    }
    vFin = m;
    if (m < seuil) {
      const sP = prev == null ? s : prevS + (s - prevS) * (prev - seuil) / Math.max(1e-9, prev - m);
      return { portee: sP, paroi: false, Lf, vParoi: null };
    }
    prev = m; prevS = s;
  }
  return { portee: Lf, paroi: true, Lf, vParoi: vFin };
}

/* Indicateurs et alertes */
export function analyser(projet, F) {
  const G = F.G, rg = projet.reglages, vmin = rg.vmin, k = dims(projet.chambre);
  const cellV = G.dx * G.dy * G.dz;
  let n = 0, bon = 0, somme = 0, nT = 0, fortT = 0, vMaxT = 0, nP = 0, sP = 0, bonP = 0;
  const kT = Math.min(G.nz, Math.round(rg.zTravail / G.dz));
  for (let kk = 0; kk < G.nz; kk++) for (let j = 0; j < G.ny; j++) for (let i = 0; i < G.nx; i++) {
    const c = i + G.nx * (j + G.ny * kk); if (G.solide[c]) continue;
    const m = F.mag[c]; n++; somme += m; if (m >= vmin) bon++;
    if (kk < kT && !G.produit[c]) { nT++; if (m > rg.vCourant) fortT++; if (m > vMaxT) vMaxT = m; }
    if (G.produit[c]) { nP++; sP += m; if (m >= vmin) bonP++; }
  }
  const V = volume(projet.chambre), Q = projet.evaps.filter(e => !e.off).reduce((s, e) => s + e.q, 0);
  const R = {
    methode: F.info.methode, volume: V, volumeAir: n * cellV, debit: Q, taux: V > 0 ? Q / V : 0,
    vMoy: n ? somme / n : 0, couverture: n ? bon / n : 0,
    travail: { vMax: vMaxT, fort: nT ? fortT / nT : 0 },
    produits: { n: nP, vMoy: nP ? sP / nP : 0, couverture: nP ? bonP / nP : 0 },
    echelles: [], evaps: [], alertes: [],
    totaux: { echelles: 0, produits: 0, masse: 0 }
  };
  const A = (niveau, titre, texte, id) => R.alertes.push({ niveau, titre, texte, id: id || null });

  // Échelles : vitesse moyenne dans chaque chariot, sur la hauteur des produits
  for (const eg of G.echelles) {
    const e = eg.e, geo = eg.geo, info = geo.info, ch = [];
    R.totaux.echelles += geo.total; R.totaux.produits += geo.total * info.nb; R.totaux.masse += geo.total * info.masse;
    // Par étage : vitesse dans la lame d'air au-dessus de chaque rang de produits (9 points répartis sur
    // l'emprise de l'échelle). Le maillage ne voit pas chaque produit : c'est la vitesse moyenne sur la
    // section de l'échelle ; dans les passages libres entre produits, l'air va plus vite (÷ part de passage).
    const phi = Math.max(0.05, geo.res.phiH), o3 = [0, 0, 0];
    for (const c of geo.chariots) {
      const etages = info.niveaux.map((nv, k) => {
        const haut = k + 1 < info.niveaux.length ? info.niveaux[k + 1].z : Math.min(info.H - 0.02, nv.z + info.pasEff);
        const z = Math.min(G.H - 0.01, (nv.z + info.produit.h + haut) / 2);
        let s = 0, n9 = 0;
        for (const fx of [0.2, 0.5, 0.8]) for (const fy of [0.2, 0.5, 0.8]) {
          s += vitesse(F, c.x0 + (c.x1 - c.x0) * fx, c.y0 + (c.y1 - c.y0) * fy, z, o3); n9++;
        }
        const v = s / n9;
        return { z, v, vPassage: v / phi };
      });
      const vs0 = etages.map(x => x.v);
      ch.push({ v: vs0.length ? vs0.reduce((a, b) => a + b, 0) / vs0.length : 0, vMin: vs0.length ? Math.min.apply(null, vs0) : 0, vMax: vs0.length ? Math.max.apply(null, vs0) : 0, etages, rang: c.rang });
    }
    const vs = ch.map(c => c.v), moy = vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : 0;
    R.echelles.push({ id: e.id, nom: e.nom, chariots: ch, vMoy: moy, vMin: vs.length ? Math.min.apply(null, ch.map(c => c.vMin)) : 0, phi, n: e.n, info });
    info.alertes.forEach(t => A("warn", e.nom + " : chargement", t, e.id));
    if (info.nb) {
      const faibles = ch.filter(c => c.v < vmin).length;
      if (faibles) A(faibles > ch.length / 3 ? "bad" : "warn", e.nom + " : produits peu ventilés", faibles + " échelle" + (faibles > 1 ? "s" : "") + " sur " + ch.length + " sous " + fr(vmin, 2) + " m/s en moyenne à travers les produits (la plus faible : " + fr(Math.min.apply(null, vs), 2) + " m/s).", e.id);
    }
  }

  // Évaporateurs : portée constructeur face à l'espace libre, portée retrouvée par le calcul
  const portes = projet.portes.map(d => Object.assign({}, porteSnap(projet.chambre, d), { nom: d.nom }));
  for (const ev of G.evaps) {
    const e = ev.e, geo = ev.geo, cotes = [];
    for (const cote of geo.cotes) {
      if (cote.fans.some(f => f.coude)) { cotes.push(analyseCoudes(F, G, e, cote, geo, A)); continue; }
      const m = porteeMesuree(F, ev, cote), Lf = m.Lf, ratio = e.T / Math.max(0.1, Lf), nom = e.nom + (geo.cotes.length > 1 ? (cote.s ? " (arrière)" : " (avant)") : "");
      cotes.push({ s: cote.s, Lf, portee: m.portee, paroi: m.paroi, vParoi: m.vParoi });
      if (Lf < 0.6) A("bad", nom + " : soufflage bouché", "Moins de " + fr(Lf, 1) + " m libres devant les ventilateurs.", e.id);
      else if (ratio < 0.75) A("warn", nom + " : portée insuffisante", "Portée constructeur de " + fr(e.T, 1) + " m pour " + fr(Lf, 1) + " m libres devant l'appareil : environ " + fr(Lf - e.T, 1) + " m en bout de chambre ne sont pas couverts par le jet.", e.id);
      else if (ratio > 1.5) A("warn", nom + " : portée surdimensionnée", "Portée constructeur de " + fr(e.T, 1) + " m pour " + fr(Lf, 1) + " m libres : le jet arrive fort sur la paroi d'en face (courant d'air, dessèchement des produits).", e.id);
      else A("ok", nom + " : portée adaptée", "Portée constructeur de " + fr(e.T, 1) + " m pour " + fr(Lf, 1) + " m libres devant l'appareil.", e.id);
      // Obstacle juste devant le soufflage
      const gene = obstruction(G, cote, Math.min(1.5, Lf));
      if (gene) A("warn", nom + " : jet gêné", "Un " + gene.quoi + " se trouve à " + fr(gene.s, 1) + " m devant les ventilateurs, à leur hauteur.", e.id);
      // Soufflage vers une porte
      portes.forEach(d => {
        const rx = d.x - cote.O[0], ry = d.y - cote.O[1], along = rx * cote.u[0] + ry * cote.u[1], across = Math.abs(rx * cote.p[0] + ry * cote.p[1]);
        if (along > 0 && across < e.len / 2 + d.w / 2 && Math.abs(along - Lf) < 0.6) A("warn", nom + " : soufflage vers " + d.nom, "Le jet arrive sur une porte à " + fr(along, 1) + " m : pertes d'air froid et givrage accrus à chaque ouverture.", e.id);
      });
    }
    if (geo.aspiration === "arriere") {
      const u = geo.u, back = [e.x - u[0] * geo.dep / 2, e.y - u[1] * geo.dep / 2];
      const Lb = distanceLibre(G, back[0], back[1], Math.min(G.H - G.dz / 2, geo.z.zc), -u[0], -u[1]);
      if (Lb < 0.3) A("warn", e.nom + " : reprise d'air gênée", "Seulement " + fr(Lb * 100, 0) + " cm derrière la batterie : prévoir au moins 30 à 50 cm.", e.id);
    }
    R.evaps.push({ id: e.id, nom: e.nom, cotes });
  }

  // Retombées anti-bypass : jour au-dessus des échelles voisines, part du débit qui passe par-dessus
  R.retombees = (G.retombees || []).map(rt => analyseRetombee(F, G, rt, A));

  // Brassage global
  if (!projet.evaps.length) A("bad", "Aucun évaporateur", "Ajoutez un évaporateur pour voir les flux d'air.");
  else if (!G.evaps.length) A("bad", "Tous les évaporateurs sont masqués", "Réaffichez au moins un évaporateur.");
  else {
    const c = R.couverture * 100;
    if (c < 70) A("bad", "Brassage insuffisant", "Seulement " + fr(c, 0) + " % du volume d'air au-dessus de " + fr(vmin, 2) + " m/s.");
    else if (c < 85) A("warn", "Brassage à surveiller", fr(c, 0) + " % du volume d'air au-dessus de " + fr(vmin, 2) + " m/s : les zones rouges sont à vérifier.");
    else A("ok", "Brassage correct", fr(c, 0) + " % du volume d'air au-dessus de " + fr(vmin, 2) + " m/s.");
    if (R.taux < rg.tauxVise) A("warn", "Taux de brassage sous l'objectif", fr(R.taux, 1) + " vol/h pour " + fr(rg.tauxVise, 0) + " vol/h visés : il manque environ " + fr((rg.tauxVise - R.taux) * V, 0) + " m³/h de débit d'air.");
    if (R.travail.fort > 0.1) A("warn", "Courant d'air en zone de travail", fr(R.travail.fort * 100, 0) + " % du volume sous " + fr(rg.zTravail, 1) + " m dépasse " + fr(rg.vCourant, 2) + " m/s (maximum " + fr(R.travail.vMax, 2) + " m/s).");
  }
  (F.info.avert || []).forEach(t => A("warn", "Calcul", t));
  chevauchements(projet, G).forEach(t => A("warn", "Implantation", t));
  return R;
}

/* Retombée : sous son bord bas, l'air passe soit au-dessus des échelles (bypass), soit à travers ou
   sous elles. On mesure le débit qui traverse le plan de la retombée, de part et d'autre du haut des échelles. */
function analyseRetombee(F, G, rt, A) {
  const L = Math.hypot(rt.x1 - rt.x0, rt.y1 - rt.y0) || 1e-9, ux = (rt.x1 - rt.x0) / L, uy = (rt.y1 - rt.y0) / L, nx = -uy, ny = ux;
  // Échelles proches de la retombée (moins de 1,5 m en plan) : la plus haute fixe la limite du bypass
  let hEch = 0;
  for (const eg of G.echelles) for (const c of eg.geo.chariots) {
    const d = distSegment(c.cx, c.cy, rt.x0, rt.y0, rt.x1, rt.y1) - Math.max(c.hx, c.hy);
    if (d < 1.5 && eg.geo.info.nb) hEch = Math.max(hEch, eg.geo.info.H);
  }
  const nom = rt.nom.replace(" · retombée", ""), jour = hEch ? rt.zb - hEch : null;
  // Avec des coudes : la retombée doit séparer les sorties de soufflage de la reprise, sinon elle ne sert à rien
  const ev = G.evaps.find(x => x.e.id === rt.evap);
  if (ev) {
    const g = ev.geo, cote = g.cotes[0], so = cote.fans[0].coude, mx = (rt.x0 + rt.x1) / 2, my = (rt.y0 + rt.y1) / 2;
    if (so) {
      const asp = g.aspiration === "arriere" ? [ev.e.x - g.u[0] * g.dep / 2, ev.e.y - g.u[1] * g.dep / 2] : [ev.e.x, ev.e.y];
      const cote1 = (so.sortie[0] - mx) * nx + (so.sortie[1] - my) * ny, cote2 = (asp[0] - mx) * nx + (asp[1] - my) * ny;
      if (cote1 * cote2 > 0) A("warn", nom + " : retombée mal placée", "La retombée n'est pas entre la sortie des coudes et la reprise de l'évaporateur : elle ne peut pas empêcher le bypass et gêne la circulation. Placez-la au-dessus de la rangée d'échelles, entre les deux (réglage « Position »).", rt.evap);
    }
  }
  let haut = 0, bas = 0;
  if (hEch) {
    const o = [0, 0, 0], ps = Math.min(G.dx, G.dy) / 2, pz = G.dz / 2;
    for (let t = ps / 2; t < L; t += ps) {
      const x = rt.x0 + ux * t, y = rt.y0 + uy * t;
      if (x < 0 || y < 0 || x > G.W || y > G.B) continue;
      for (let z = pz / 2; z < rt.zb; z += pz) {
        vitesse(F, x, y, z, o);
        const q = Math.abs(o[0] * nx + o[1] * ny) * ps * pz;
        if (z >= hEch) haut += q; else bas += q;
      }
    }
  }
  const part = haut + bas > 1e-9 ? haut / (haut + bas) : null;
  if (jour != null) {
    if (jour > 0.15) A("warn", nom + " : bypass au-dessus des échelles", fr(jour * 100, 0) + " cm entre le bas de la retombée (" + fr(rt.zb, 2) + " m) et le haut des échelles voisines (" + fr(hEch, 2) + " m) : environ " + fr((part || 0) * 100, 0) + " % de l'air sous la retombée passe par-dessus les produits. Descendez la retombée.", rt.evap);
    else if (jour < -0.02) A("warn", nom + " : retombée plus basse que les échelles", "Le bas de la retombée (" + fr(rt.zb, 2) + " m) descend sous le haut des échelles (" + fr(hEch, 2) + " m) : vérifiez que les échelles passent dessous.", rt.evap);
    else A("ok", nom + " : retombée anti-bypass", "Bas de la retombée à " + fr(rt.zb, 2) + " m, au ras des échelles : " + fr((part || 0) * 100, 0) + " % de l'air sous la retombée passe par-dessus les produits.", rt.evap);
  }
  return { id: rt.id, evap: rt.evap, zb: rt.zb, zh: rt.zh, largeur: L, hEchelles: hEch || null, jour, partBypass: part };
}

/* Soufflage vers le bas par des coudes : vitesse d'arrivée et ce qui se trouve sous chaque sortie */
function analyseCoudes(F, G, e, cote, geo, A) {
  const nom = e.nom + (geo.cotes.length > 1 ? (cote.s ? " (arrière)" : " (avant)") : ""), o = [0, 0, 0];
  const sorties = cote.fans.map(f => {
    const so = f.coude.sortie;
    // Premier obstacle sous la sortie (produits, objet plein) ou le sol
    let zArr = 0, quoi = "sol";
    for (let z = so[2] - G.dz / 2; z > 0; z -= G.dz / 2) {
      const i = Math.min(G.nx - 1, Math.max(0, Math.floor(so[0] / G.dx))), j = Math.min(G.ny - 1, Math.max(0, Math.floor(so[1] / G.dy))), k = Math.min(G.nz - 1, Math.floor(z / G.dz)), c = i + G.nx * (j + G.ny * k);
      if (G.solide[c] && G.solide[c] !== SOLIDE.evap) { zArr = z; quoi = G.solide[c] === SOLIDE.cloison ? "cloison" : "obstacle"; break; }
      if (G.produit[c]) { zArr = z; quoi = "produits"; break; }
    }
    // Vitesse descendante la plus forte dans la largeur du jet, 30 cm au-dessus de l'arrivée
    const zMes = Math.min(so[2] - 0.05, zArr + 0.3), b = f.coude.r + 0.25 * (so[2] - zMes), pas = Math.min(G.dx, G.dy) / 2;
    let v = 0;
    for (let dx = -b; dx <= b; dx += pas) for (let dy = -b; dy <= b; dy += pas) {
      if (dx * dx + dy * dy > b * b) continue;
      vitesse(F, so[0] + dx, so[1] + dy, zMes, o); if (-o[2] > v) v = -o[2];
    }
    return { zOut: so[2], chute: so[2] - zArr, quoi, v };
  });
  const dehors = cote.fans.filter(f => { const so = f.coude.sortie; return so[0] < 0 || so[1] < 0 || so[0] > G.W || so[1] > G.B || dansEncoche(G.k, so[0], so[1]); }).length;
  if (dehors) A("bad", nom + " : coude trop long", dehors + " sortie" + (dehors > 1 ? "s" : "") + " de coude hors de la chambre : réduisez l'avancée horizontale.", e.id);
  const vMoy = sorties.reduce((a, x) => a + x.v, 0) / sorties.length, chute = Math.min.apply(null, sorties.map(x => x.chute));
  const surProduits = sorties.filter(x => x.quoi === "produits").length;
  A("ok", nom + " : soufflage vers le bas", "Coudes en sortie des " + sorties.length + " hélices, sortie à " + fr(sorties[0].zOut, 2) + " m du sol ; l'air arrive à environ " + fr(vMoy, 2) + " m/s, 30 cm avant " + (surProduits ? "les produits (" + surProduits + " sortie" + (surProduits > 1 ? "s" : "") + " au-dessus des échelles)" : sorties[0].quoi === "sol" ? "le sol" : "l'obstacle situé dessous") + ".", e.id);
  if (vMoy > 1.5) A("warn", nom + " : soufflage vertical fort", "Environ " + fr(vMoy, 2) + " m/s en arrivant " + (surProduits ? "sur les produits" : "au sol") + " : courant d'air marqué, dessèchement possible des produits exposés.", e.id);
  return { s: cote.s, coude: true, sorties, vArrivee: vMoy, chute, Lf: chute, portee: null, paroi: false };
}

function obstruction(G, cote, Lmax) {
  const z = Math.min(G.H - G.dz / 2, cote.O[2]), h = Math.min(G.dx, G.dy) / 2;
  for (let s = 0.2; s <= Lmax; s += h) {
    for (const f of cote.fans) {
      const x = f.c[0] + cote.u[0] * s, y = f.c[1] + cote.u[1] * s;
      if (x < 0 || y < 0 || x > G.W || y > G.B) continue;
      const i = Math.min(G.nx - 1, Math.floor(x / G.dx)), j = Math.min(G.ny - 1, Math.floor(y / G.dy)), k = Math.min(G.nz - 1, Math.floor(z / G.dz)), c = i + G.nx * (j + G.ny * k);
      const so = G.solide[c];
      if (so === SOLIDE.cloison) return { s, quoi: "cloison" };
      if (so === SOLIDE.obstacle) return { s, quoi: "obstacle" };
      if (G.produit[c]) return { s, quoi: "rayonnage d'échelles" };
      if (G.cH[c] > 0) return { s, quoi: "obstacle" };
    }
  }
  return null;
}

/* Objets qui se chevauchent en plan et en hauteur */
function chevauchements(projet, G) {
  const bx = [];
  G.evaps.forEach(ev => bx.push({ nom: ev.e.nom, b: ev.geo.box }));
  G.echelles.forEach(eg => { const i = eg.geo.info; eg.geo.chariots.forEach((c, n) => bx.push({ nom: eg.e.nom, grp: eg.e.id, b: { x0: c.x0, x1: c.x1, y0: c.y0, y1: c.y1, z0: 0, z1: i.H } })); });
  projet.obstacles.forEach(o => bx.push({ nom: o.nom, b: obstacleGeo(o).box }));
  const out = [], vu = {};
  for (let a = 0; a < bx.length; a++) for (let b = a + 1; b < bx.length; b++) {
    const A = bx[a], B = bx[b];
    if (A.grp && A.grp === B.grp) continue;
    const e = 0.01;
    if (A.b.x0 < B.b.x1 - e && B.b.x0 < A.b.x1 - e && A.b.y0 < B.b.y1 - e && B.b.y0 < A.b.y1 - e && A.b.z0 < B.b.z1 - e && B.b.z0 < A.b.z1 - e) {
      const key = [A.nom, B.nom].sort().join("|");
      if (!vu[key]) { vu[key] = 1; out.push(A.nom + " et " + B.nom + " se chevauchent."); }
    }
  }
  const k = G.k;
  G.echelles.forEach(eg => eg.geo.chariots.some(c => {
    const e = k.enc, hors = c.x0 < -0.01 || c.y0 < -0.01 || c.x1 > k.W + 0.01 || c.y1 > k.B + 0.01 || (!!e && c.x1 > e.x0 + 0.01 && c.x0 < e.x1 - 0.01 && c.y1 > e.y0 + 0.01 && c.y0 < e.y1 - 0.01);
    if (hors) out.push(eg.e.nom + " : des échelles dépassent de la chambre.");
    return hors;
  }));
  return out;
}
