/* Enregistrement des projets sur l'appareil (localStorage), export et import en JSON. */
import { normaliser, projetExemple, uid, FORMAT, VERSION } from "../core/modele.js";

const CLE = "modele-frigo-v1";

function lire() { try { const r = localStorage.getItem(CLE); return r ? JSON.parse(r) : null; } catch (e) { return null; } }

export function creerStore() {
  let st = lire();
  if (!st || !st.projets || !st.projets[st.courant]) {
    const id = uid("p"); st = { courant: id, projets: {} }; st.projets[id] = projetExemple();
  }
  Object.keys(st.projets).forEach(id => { st.projets[id] = normaliser(st.projets[id]); });
  let minuteur = null;
  function ecrire() { try { localStorage.setItem(CLE, JSON.stringify(st)); } catch (e) { /* stockage plein ou bloqué */ } }
  ecrire();
  return {
    courant: () => st.projets[st.courant],
    idCourant: () => st.courant,
    liste: () => Object.keys(st.projets).map(id => ({ id, nom: st.projets[id].nom, maj: st.projets[id].maj })).sort((a, b) => b.maj - a.maj),
    /* Remplace le projet courant (après une modification) et l'enregistre un peu plus tard */
    enregistrer(p) {
      p.maj = Date.now(); st.projets[st.courant] = p;
      clearTimeout(minuteur); minuteur = setTimeout(ecrire, 250);
    },
    maintenant() { clearTimeout(minuteur); ecrire(); },
    ouvrir(id) { if (st.projets[id]) { st.courant = id; ecrire(); } return st.projets[st.courant]; },
    nouveau(p) { const id = uid("p"); st.projets[id] = normaliser(p); st.courant = id; ecrire(); return st.projets[id]; },
    dupliquer(id) { const src = st.projets[id]; if (!src) return null; const p = JSON.parse(JSON.stringify(src)); p.nom = src.nom + " (copie)"; return this.nouveau(p); },
    supprimer(id) {
      delete st.projets[id];
      if (!Object.keys(st.projets).length) { const n = uid("p"); st.projets[n] = projetExemple(); }
      if (!st.projets[st.courant]) st.courant = this.liste()[0].id;
      ecrire();
    },
    exporter(tous) {
      const projets = tous ? Object.keys(st.projets).map(id => st.projets[id]) : [st.projets[st.courant]];
      return JSON.stringify({ format: FORMAT, version: VERSION, exporte: new Date().toISOString(), projets }, null, 1);
    },
    /* Importe un fichier exporté ; renvoie le nombre de projets ajoutés */
    importer(texte) {
      const o = JSON.parse(texte);
      const liste = o && o.format === FORMAT && Array.isArray(o.projets) ? o.projets : (o && o.chambre ? [o] : null);
      if (!liste || !liste.length) throw new Error("Ce fichier n'est pas un export de Modèle Frigo.");
      let dernier = null;
      liste.forEach(p => { const id = uid("p"); st.projets[id] = normaliser(p); dernier = id; });
      st.courant = dernier; ecrire();
      return liste.length;
    }
  };
}
