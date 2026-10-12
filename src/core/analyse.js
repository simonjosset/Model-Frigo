/* Analyse d'un champ de vitesses : indicateurs de brassage, portée des jets, vitesse dans les
   échelles, alertes. Fonctionne sur l'aperçu comme sur le calcul fin. */
import { vitesse } from "./champ.js";
import { distanceLibre, plage, SOLIDE } from "./grille.js";
import { dims, volume, porteSnap, obstacleGeo } from "./geometrie.js";

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
    for (const c of geo.chariots) {
      const [i0, i1] = plage(c.x0, c.x1, G.dx, G.nx), [j0, j1] = plage(c.y0, c.y1, G.dy, G.ny), [k0, k1] = plage(info.zBas, Math.max(info.zBas + 0.05, info.zHaut), G.dz, G.nz);
      let s = 0, cnt = 0, mn = Infinity;
      for (let kk = k0; kk <= k1; kk++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const id = i + G.nx * (j + G.ny * kk); if (G.solide[id]) continue;
        s += F.mag[id]; cnt++; if (F.mag[id] < mn) mn = F.mag[id];
      }
      ch.push({ v: cnt ? s / cnt : 0, vMin: cnt ? mn : 0 });
    }
    const vs = ch.map(c => c.v), moy = vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : 0;
    R.echelles.push({ id: e.id, nom: e.nom, chariots: ch, vMoy: moy, vMin: vs.length ? Math.min.apply(null, vs) : 0, info });
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
    const hors = c.x0 < -0.01 || c.y0 < -0.01 || c.x1 > k.W + 0.01 || c.y1 > k.B + 0.01 || (k.L && c.x1 > k.a + 0.01 && c.y0 < k.B - k.b - 0.01);
    if (hors) out.push(eg.e.nom + " : des échelles dépassent de la chambre.");
    return hors;
  }));
  return out;
}
