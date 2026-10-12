/* Échelles (chariots à glissières) et produits rangés dedans.
   Une échelle : châssis sur roulettes, glissières régulièrement espacées sur la hauteur,
   produits posés à plat sur les glissières. Module pur (sans DOM), testé sous node. */

/* Produits proposés : valeurs modifiables ensuite dans l'échelle (dimensions en m, masse en kg) */
export const CATALOGUE = [
  { ref: "glace33", nom: "Pot de glace 3,3 kg", L: 0.36, l: 0.165, h: 0.10, m: 3.3 },
  { ref: "glace17", nom: "Pot de glace 1,7 kg", L: 0.25, l: 0.165, h: 0.08, m: 1.7 },
  { ref: "gn11", nom: "Bac gastronorme GN 1/1 h 100", L: 0.53, l: 0.325, h: 0.10, m: 6 },
  { ref: "gn12", nom: "Bac gastronorme GN 1/2 h 100", L: 0.325, l: 0.265, h: 0.10, m: 3 },
  { ref: "plaque", nom: "Plaque pâtissière 600 × 400", L: 0.60, l: 0.40, h: 0.04, m: 2 },
  { ref: "carton", nom: "Carton 400 × 300 × 200", L: 0.40, l: 0.30, h: 0.20, m: 8 }
];

export function produitDuCatalogue(ref) {
  const p = CATALOGUE.find(c => c.ref === ref) || CATALOGUE[0];
  return { ref: p.ref, nom: p.nom, L: p.L, l: p.l, h: p.h, m: p.m };
}

/* Constantes du châssis */
export const ROUES = 0.12;      // hauteur des roulettes et du cadre bas
export const HAUT_LIBRE = 0.08; // cadre haut au-dessus de la dernière glissière
export const JEU = 0.006;       // jeu entre produits voisins et épaisseur de la glissière

/* Meilleur rangement des produits sur une glissière (deux orientations possibles) */
export function rangement(W, D, L, l) {
  const a = { nD: Math.floor((D + 1e-6) / L), nW: Math.floor((W + 1e-6) / l), dD: L, dW: l };
  const b = { nD: Math.floor((D + 1e-6) / l), nW: Math.floor((W + 1e-6) / L), dD: l, dW: L };
  a.n = a.nD * a.nW; b.n = b.nD * b.nW;
  return a.n >= b.n ? a : b;
}

function num(v, d) { v = +v; return isFinite(v) ? v : d; }

/* Calcul d'une échelle : glissières, étages chargés, produits par étage, masse.
   e : { H, W, D, etages, etagesCharges (null = maximum), parEtage (null = maximum), produit:{L,l,h,m} } */
export function echelleInfo(e) {
  const H = Math.max(0.4, num(e.H, 1.875)), W = Math.max(0.2, num(e.W, 0.626)), D = Math.max(0.2, num(e.D, 0.507));
  const N = Math.max(1, Math.min(80, Math.round(num(e.etages, 23))));
  const pr = e.produit || {}, L = Math.max(0.02, num(pr.L, 0.36)), l = Math.max(0.02, num(pr.l, 0.165)), h = Math.max(0.01, num(pr.h, 0.1)), m = Math.max(0, num(pr.m, 0));
  const pitch = Math.max(0.01, (H - ROUES - HAUT_LIBRE) / N);
  // Un produit plus haut que l'écart entre glissières occupe plusieurs glissières
  const pas = Math.max(1, Math.ceil((h + 0.02) / pitch));
  const niveaux = [];
  for (let i = 0; i < N; i += pas) {
    const z = ROUES + 0.04 + i * pitch + JEU;
    if (z + h <= H - 0.02) niveaux.push({ i, z });
  }
  const maxNiveaux = niveaux.length;
  let charges = e.etagesCharges == null || e.etagesCharges === "" ? maxNiveaux : Math.round(num(e.etagesCharges, maxNiveaux));
  charges = Math.max(0, Math.min(maxNiveaux, charges));
  const pack = rangement(W, D, L, l);
  let parEtage = e.parEtage == null || e.parEtage === "" ? pack.n : Math.round(num(e.parEtage, pack.n));
  parEtage = Math.max(0, Math.min(pack.n, parEtage));
  const nb = charges * parEtage;
  // Remplissage, utile au calcul de la résistance à l'air (rapport surface produits / surface de l'échelle)
  const remplissage = (parEtage * L * l) / (W * D);
  const pasEff = pas * pitch;
  const alertes = [];
  if (pack.n === 0) alertes.push("Le produit ne tient pas sur une glissière de " + fr(W, 3) + " × " + fr(D, 3) + " m.");
  if (pas > 1) alertes.push("Produit plus haut que l'écart entre glissières (" + fr(pitch * 1000, 0) + " mm) : une glissière sur " + pas + " est chargée.");
  if (e.parEtage != null && e.parEtage !== "" && +e.parEtage > pack.n) alertes.push("Au plus " + pack.n + " produits par étage.");
  if (e.etagesCharges != null && e.etagesCharges !== "" && +e.etagesCharges > maxNiveaux) alertes.push("Au plus " + maxNiveaux + " étages chargés.");
  return {
    H, W, D, N, pitch, pas, pasEff, niveaux: niveaux.slice(0, charges), maxNiveaux, charges,
    pack, parEtage, nb, masse: nb * m, produit: { L, l, h, m },
    remplissage, zBas: niveaux.length && charges ? niveaux[0].z : ROUES, zHaut: charges ? niveaux[charges - 1].z + h : ROUES,
    alertes
  };
}

/* Positions des produits d'une échelle, dans son repère local (centre au sol, x le long de la largeur W,
   y le long de la profondeur D) : liste de boîtes { x, y, z (bas), sx, sy, sz, niveau } */
export function produitsLocaux(info) {
  const out = [], pk = info.pack;
  if (!pk.n || !info.parEtage) return out;
  const totW = pk.nW * pk.dW + (pk.nW - 1) * JEU, totD = pk.nD * pk.dD + (pk.nD - 1) * JEU;
  info.niveaux.forEach((nv, k) => {
    let c = 0;
    for (let a = 0; a < pk.nD && c < info.parEtage; a++) {
      for (let b = 0; b < pk.nW && c < info.parEtage; b++, c++) {
        out.push({
          x: -totW / 2 + b * (pk.dW + JEU) + pk.dW / 2,
          y: -totD / 2 + a * (pk.dD + JEU) + pk.dD / 2,
          z: nv.z, sx: pk.dW - 0.004, sy: pk.dD - 0.004, sz: info.produit.h, niveau: k
        });
      }
    }
  });
  return out;
}

/* Perte de charge d'une échelle chargée, modèle de milieu poreux (Forchheimer) :
   accélération de freinage = c · |u| · u, c en 1/m. Horizontal (entre les étages) et vertical (à travers les étages). */
export function resistanceEchelle(info) {
  if (!info.nb) return { phiH: 1, phiV: 1, cH: 0, cV: 0 };
  const occ = Math.min(1, info.remplissage);
  const phiH = Math.max(0.05, 1 - Math.min(0.95, info.produit.h / info.pasEff) * Math.sqrt(occ));
  const phiV = Math.max(0.03, 1 - occ);
  const rang = Math.max(0.1, Math.max(info.produit.L, info.produit.l));
  const coef = phi => 0.5 * (Math.pow(1 / phi - 1, 2) + 0.3 * (1 - phi));
  return { phiH, phiV, cH: coef(phiH) / rang, cV: coef(phiV) / Math.max(0.05, info.pasEff) };
}

function fr(x, d) { return x.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d }); }
