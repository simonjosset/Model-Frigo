/* Lancement des calculs dans des workers (créés depuis le texte intégré au fichier unique).
   Un worker pour l'aperçu (rapide, relancé à chaque modification), un pour le calcul fin.
   Sans worker possible : calcul dans la page, découpé pour ne pas figer l'affichage. */
import { normaliser } from "../core/modele.js";
import { calculerApercu } from "../core/apercu.js";
import { creerSimulation } from "../core/simulation.js";
import { analyser } from "../core/analyse.js";
import { emballer, deballer } from "../core/paquet.js";

function creerWorker() {
  try {
    const src = document.getElementById("mf-worker");
    if (!src || !window.Worker || !window.Blob) return null;
    const url = URL.createObjectURL(new Blob([src.textContent], { type: "text/javascript" }));
    const w = new Worker(url);
    return w;
  } catch (e) { return null; }
}

export function creerCalculs(cb) {
  let wA = creerWorker(), wC = null, n = 0, attenteA = null, occupeA = false, idA = 0, idC = 0, cfdLocal = null;
  const local = !wA;

  function recevoirA(m) {
    if (m.id !== idA) { occupeA = false; suivant(); return; }
    occupeA = false;
    cb.apercu && cb.apercu(deballer(m), m.analyse);
    suivant();
  }
  if (wA) {
    wA.onmessage = e => recevoirA(e.data);
    wA.onerror = e => { e.preventDefault && e.preventDefault(); occupeA = false; cb.erreur && cb.erreur("aperçu", e.message); };
  }
  function suivant() {
    if (occupeA || !attenteA) return;
    const p = attenteA; attenteA = null; occupeA = true; idA = ++n;
    if (wA) wA.postMessage({ type: "apercu", id: idA, projet: p });
    else setTimeout(() => {
      const pr = normaliser(p), F = calculerApercu(pr), R = analyser(pr, F), { msg } = emballer(F, R);
      msg.id = idA; recevoirA(msg);
    }, 0);
  }

  return {
    local,
    /* Demande un aperçu ; seules la dernière demande et celle en cours comptent */
    apercu(projet) { attenteA = JSON.parse(JSON.stringify(projet)); suivant(); },
    cfd(projet, options) {
      this.stop();
      const id = idC = ++n, p = JSON.parse(JSON.stringify(projet));
      if (!local) {
        wC = creerWorker();
        if (wC) {
          wC.onmessage = e => {
            const m = e.data; if (m.id !== idC) return;
            if (m.type === "progres") cb.progres && cb.progres(m);
            else if (m.type === "resultat") { wC.terminate(); wC = null; cb.cfd && cb.cfd(deballer(m), m.analyse); }
          };
          wC.onerror = e => { e.preventDefault && e.preventDefault(); cb.erreur && cb.erreur("calcul fin", e.message); this.stop(); };
          wC.postMessage({ type: "cfd", id, projet: p, options });
          return;
        }
      }
      // Dans la page, par tranches de 40 ms
      const pr = normaliser(p), S = creerSimulation(pr, options || {});
      cfdLocal = id;
      const tour = () => {
        if (cfdLocal !== id) return;
        const r = S.avancer(40);
        cb.progres && cb.progres({ fraction: r.fraction, phase: r.phase });
        if (!S.fini) { setTimeout(tour, 0); return; }
        const F = S.resultat(), R = analyser(pr, F), { msg } = emballer(F, R);
        cfdLocal = null; cb.cfd && cb.cfd(deballer(msg), R);
      };
      setTimeout(tour, 0);
    },
    stop() { if (wC) { wC.terminate(); wC = null; } cfdLocal = null; idC = ++n; },
    enCours() { return !!wC || !!cfdLocal; }
  };
}
