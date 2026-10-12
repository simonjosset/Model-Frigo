/* Worker de calcul : aperçu instantané et calcul fin, hors du fil de la page.
   Intégré au fichier unique sous forme de texte, lancé depuis un Blob (aucun fichier séparé). */
import { normaliser } from "../core/modele.js";
import { calculerApercu } from "../core/apercu.js";
import { creerSimulation } from "../core/simulation.js";
import { analyser } from "../core/analyse.js";
import { emballer } from "../core/paquet.js";

let enCours = null;

self.onmessage = ev => {
  const m = ev.data;
  if (m.type === "apercu") {
    const p = normaliser(m.projet), F = calculerApercu(p);
    const R = analyser(p, F);
    const { msg, transferts } = emballer(F, R);
    msg.type = "resultat"; msg.id = m.id; msg.genre = "apercu";
    self.postMessage(msg, transferts);
  } else if (m.type === "cfd") {
    const p = normaliser(m.projet), S = creerSimulation(p, m.options || {});
    enCours = m.id;
    const tour = () => {
      if (enCours !== m.id) return;
      const r = S.avancer(200);
      self.postMessage({ type: "progres", id: m.id, fraction: r.fraction, phase: r.phase });
      if (!S.fini) { setTimeout(tour, 0); return; }
      const F = S.resultat(), R = analyser(p, F);
      const { msg, transferts } = emballer(F, R);
      msg.type = "resultat"; msg.id = m.id; msg.genre = "cfd";
      self.postMessage(msg, transferts);
      enCours = null;
    };
    tour();
  } else if (m.type === "stop") enCours = null;
};
