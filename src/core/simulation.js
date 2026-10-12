/* Déroulé du calcul fin, découpé en petits morceaux (worker ou page) :
   maillage → aperçu (état initial) → passe 1 → mesure des portées → recalage des jets → passe 2.
   Le recalage ajuste la viscosité de chaque jet pour retrouver la portée constructeur,
   quand l'espace libre devant l'appareil permet de la mesurer. */
import { construireGrille } from "./grille.js";
import { calculerApercu } from "./apercu.js";
import { demarrer } from "./cfd.js";
import { porteeMesuree } from "./analyse.js";
import { MAILLES } from "./modele.js";

const EXPOSANT = 1.8; // portée ≈ viscosité^(-0,55) en moyenne, mesuré sur le solveur
const PASSES = 3;

export function creerSimulation(projet, opts) {
  opts = opts || {};
  const cellules = opts.cellules || MAILLES[projet.reglages.maille].cellules;
  const recaler = opts.recalage != null ? opts.recalage : projet.reglages.recalage;
  const maxPasses = recaler ? PASSES : 1;
  let etape = "maillage", G = null, sim = null, kEvap = {}, histo = {}, recalage = [], F = null, passe = 0;
  const poidsPasse = [0.55, 0.3, 0.15];
  const libelle = () => recaler ? (passe === 1 ? "Calcul (passe 1)" : "Calcul (passe " + passe + ", portées recalées)") : "Calcul";
  const S = {
    fini: false, phase: "Maillage",
    avancer(budgetMs) {
      const t0 = Date.now();
      while (!S.fini && Date.now() - t0 < budgetMs) {
        if (etape === "maillage") {
          G = construireGrille(projet, { cellules });
          const A = calculerApercu(projet, { grille: G });
          sim = demarrer(G, { init: A, reglage: opts.reglage });
          etape = "calcul"; passe = 1; S.phase = libelle();
        } else if (etape === "calcul") {
          sim.avancer(5);
          if (sim.fini) {
            const R = sim.resultat();
            F = R;
            if (passe < maxPasses) {
              recalage = mesurer(R, G, kEvap, histo);
              if (recalage.some(x => x.ajuste)) {
                recalage.forEach(x => { if (x.ajuste) kEvap[x.id] = x.k; });
                sim = demarrer(G, { init: R, reglage: opts.reglage, kEvap, tMin: 10 }); // repart du résultat précédent : converge plus vite
                passe++; S.phase = libelle();
                continue;
              }
            } else if (recaler) recalage = mesurer(R, G, kEvap, histo, true);
            etape = "fin";
          }
        }
        if (etape === "fin") {
          F.info.recalage = recalage; F.info.passes = passe;
          F.info.cellules = G.n; F.info.maille = [G.dx, G.dy, G.dz];
          S.fini = true;
        }
      }
      let fr = 0;
      if (etape === "fin") fr = 1;
      else if (etape === "calcul") {
        const avant = poidsPasse.slice(0, passe - 1).reduce((a, b) => a + b, 0), w = recaler ? poidsPasse[passe - 1] : 1;
        const x = sim.converge ? Math.max(0.9, sim.S.n / sim.nPas) : sim.S.n / sim.nPas;
        fr = (recaler ? avant : 0) + w * Math.min(1, x);
      }
      return { fraction: Math.min(1, fr), phase: S.phase };
    },
    resultat() { return F; },
    grille() { return G; }
  };
  return S;
}

/* Mesure des portées et facteur de viscosité à appliquer à chaque évaporateur
   (puissance moyenne au premier recalage, sécante ensuite) */
function mesurer(F, G, kEvap, histo, dernier) {
  const out = [];
  for (const ev of G.evaps) {
    const e = ev.e, T = e.T;
    let ratio = null;
    const mesures = [];
    for (const cote of ev.geo.cotes) {
      const m = porteeMesuree(F, ev, cote);
      mesures.push(m);
      // Portée mesurable seulement si le jet retombe sous 0,25 m/s loin de la paroi (sinon il freine en l'approchant)
      const libre = !m.paroi && m.portee < 0.75 * m.Lf;
      if (libre && m.portee > 0.5) ratio = ratio == null ? m.portee / T : Math.max(ratio, m.portee / T);
      // Jet qui atteint la paroi alors que la portée constructeur s'arrête bien avant : trop fort
      else if (!libre && T < 0.7 * m.Lf) ratio = Math.max(ratio || 0, Math.max(m.portee, 0.75 * m.Lf) / T);
    }
    const k0 = kEvap[e.id] || 1, h = histo[e.id] = histo[e.id] || [];
    if (ratio != null) h.push([k0, ratio]);
    let k = k0, ajuste = false;
    if (!dernier && ratio != null && Math.abs(ratio - 1) > (h.length > 1 ? 0.12 : 0.08)) {
      let expo = EXPOSANT;
      if (h.length > 1) {
        const [ka, ra] = h[h.length - 2], [kb, rb] = h[h.length - 1];
        const pente = (Math.log(rb) - Math.log(ra)) / (Math.log(kb) - Math.log(ka));
        if (isFinite(pente) && pente < -0.15 && pente > -1.5) expo = -1 / pente;
      }
      k = k0 * Math.min(4, Math.max(0.2, Math.pow(ratio, expo)));
      ajuste = true;
    }
    out.push({ id: e.id, nom: e.nom, T, mesures: mesures.map(m => ({ portee: m.portee, paroi: m.paroi, Lf: m.Lf })), ratio, k, ajuste });
  }
  return out;
}

/* Calcul complet en une fois (tests, node) */
export function simuler(projet, opts) {
  const S = creerSimulation(projet, opts);
  while (!S.fini) { const r = S.avancer(1000); if (opts && opts.progres) opts.progres(r); }
  return S.resultat();
}
