/* Modèle Frigo : contrôleur de l'interface (sélection, édition, annulation, calculs, résultats, projets). */
import { normaliser, normaliserObjet, normaliserCote, ajouter, dupliquer, trouver, projetExemple, batimentExemple, batimentVide, TYPES, LISTES, LISTES_PROJET, DECOR } from "../core/modele.js";
import { dims, volume, surface, evapGeo, echellesGeo, garderDedans as garderDedansChambre, collerPiece, murLibre, localSurface, mursLocaux, porteSurMurs, pivoterLocal, aimanterLocal, emprise, localGeo } from "../core/geometrie.js";
import { produitDuCatalogue } from "../core/produits.js";
import { creerStore } from "./store.js";
import { creerCalculs } from "./calculs.js";
import { panneauChambre, panneauObjet, panneauReglages, resumeObjet, lireNombre, esc, fr, info } from "./formulaires.js";
import { creerVue, webglDisponible } from "../vue3d/vue.js";
import { mesure } from "../core/cotes.js";
import { gaineMetres, metresGaines, texteSection, TYPES_BOUCHE } from "../core/composants.js";
import { PALIERS, GRADUATIONS, VMAX_ECHELLE, positionEchelle } from "../core/champ.js";

const $ = id => document.getElementById(id);
const COULEURS = { evaps: "#3D7BFF", echelles: "#14CA74", cloisons: "#8F9BB6", obstacles: "#B07D45", portes: "#E07B39", deflecteurs: "#C9A23F", pieces: "#5B6B8C", personnes: "#FF8A2A", locaux: "#7C8DB5", ctas: "#5C8DD6", plenums: "#9AA7BD", gaines: "#B8C2CC", bouches: "#3D7BFF" };
const ICONES = { evaps: "❄", echelles: "▤", cloisons: "▮", obstacles: "■", portes: "⌂", deflecteurs: "◜", pieces: "⬚", personnes: "☺", locaux: "▣", ctas: "⊞", plenums: "▭", gaines: "═", bouches: "▦" };
const AFF0 = { particules: true, lignes: false, coupe: false, vecteurs: false, mortes: false, couleurProduits: false, murs: true, plafond: false, etiquettes: true, pieces: true, axe: "z", pos: null, densite: 2500, vitesseAnim: 1 };

export function demarrer() {
  const store = creerStore();
  let projet = store.courant();
  let sel = "chambre";               // "chambre" ou id d'objet
  let mode = "apercu";               // champ affiché
  const champs = { apercu: null, cfd: null };
  let cfdPerime = false, onglet = "prop";
  let annuler = [], retablir = [], glisse = false, dernierApercu = 0, minuteurApercu = null;
  let aff = Object.assign({}, AFF0, lireLocal("modele-frigo-affichage") || {});

  /* ---------- Thème ---------- */
  function themeCourant() { return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark"; }
  function appliquerTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    document.querySelector('meta[name="theme-color"]').content = t === "light" ? "#F3F5FB" : "#081028";
    if (vue) vue.setTheme({ fond: t === "light" ? 0xeef1f8 : 0x0b1739, sombre: t !== "light" });
  }
  const t0 = lireLocal("modele-frigo-theme");

  /* ---------- Vue 3D ---------- */
  let vue = null;
  if (webglDisponible()) {
    try {
      vue = creerVue($("vue3d"), {
        onPick: (id, produit) => { selectionner(id || "chambre"); if (produit) choisirProduit(id, produit.chariot, produit.niveau); },
        onDrag: (id, v) => deplacer(id, v, true),
        onDragFin: () => { glisse = false; const t = trouver(projet, sel); if (!t || DECOR.indexOf(t.liste) < 0) demanderApercu(true); rendreProp(); },
        onSonde: s => afficherSonde(s),
        onCote: (a, b) => { memoriser(); const c = normaliserCote({ a, b }); projet.cotes.push(c); derniereCote = mesure(c.a, c.b); majCotes(); },
        onCoteSuppr: id => { memoriser(); projet.cotes = projet.cotes.filter(c => c.id !== id); majCotes(); },
        onCoteSurvol: info => afficherCote(info),
        onTraceInfo: info => afficherTrace(info)
      });
    } catch (e) { vue = null; }
  }
  if (!vue) $("msg3d").hidden = false;
  appliquerTheme(t0 === "light" || t0 === "dark" ? t0 : "dark");

  /* ---------- Calculs ---------- */
  const calculs = creerCalculs({
    apercu: (F, R) => { if (batiment()) return; champs.apercu = { F, R }; if (mode === "apercu" || !champs.cfd) { mode = "apercu"; afficherChamp(); } else rendreResultats(); },
    cfd: (F, R) => {
      F.info.ms = Date.now() - debutCfd;
      champs.cfd = { F, R }; cfdPerime = false; mode = "cfd"; $("prog").hidden = true; majBoutonsCalcul(); afficherChamp();
      toast("Calcul fin terminé en " + fr(F.info.ms / 1000, 0) + " s" + (F.info.passes > 1 ? " (" + F.info.passes + " passes)" : ""));
    },
    progres: m => { $("prog").hidden = false; $("progT").textContent = m.phase + " · " + Math.round(m.fraction * 100) + " %"; $("progB").style.width = (m.fraction * 100).toFixed(1) + "%"; },
    erreur: (q, t) => { $("prog").hidden = true; majBoutonsCalcul(); toast("Erreur du " + q + (t ? " : " + t : "")); }
  });
  let debutCfd = 0;

  function batiment() { return projet.type === "batiment"; }
  /* Type de projet : interface de la chambre froide (flux d'air) ou du bâtiment (implantation) */
  function majType() {
    document.body.classList.toggle("mode-batiment", batiment());
    $("chNom").textContent = batiment() ? "Bâtiment" : "Chambre";
    document.querySelector('[data-tab="res"]').textContent = batiment() ? "Récapitulatif" : "Résultats";
    if (batiment()) { calculs.stop(); $("prog").hidden = true; if (vue) vue.setChamp(null, null); }
  }
  /* Nom affiché d'un type d'objet (en bâtiment, les obstacles sont des machines ou équipements) */
  function nomType(l, pluriel) {
    if (batiment() && l === "obstacles") return pluriel ? "Machines" : "Machine";
    return pluriel ? TYPES[l].plusieurs : TYPES[l].seul;
  }
  function demanderApercu(maintenant) {
    clearTimeout(minuteurApercu);
    if (batiment()) return;
    const go = () => { dernierApercu = Date.now(); calculs.apercu(projet); };
    if (maintenant) go();
    else if (glisse) { if (Date.now() - dernierApercu > 350) go(); else minuteurApercu = setTimeout(go, 350); }
    else minuteurApercu = setTimeout(go, 120);
  }

  function afficherChamp() {
    const c = champs[mode] || champs.apercu;
    if (vue && c) {
      const vit = {};
      (c.R.echelles || []).forEach(e => { vit[e.id] = e.chariots.map(x => x.etages.map(t => t.v)); });
      vue.flux.setSources(sources());
      vue.setChamp(c.F, vit);
    }
    $("legMode").textContent = mode === "cfd" ? "Calcul fin" + (cfdPerime ? " (à relancer)" : "") : "Aperçu instantané";
    $("mApercu").setAttribute("aria-pressed", mode === "apercu"); $("mCfd").setAttribute("aria-pressed", mode === "cfd");
    if (vue && vue.coter()) afficherCote(derniereInfo); else $("sonde").hidden = true;
    rendreResultats(); rendreResume();
    if (onglet === "prop") rendreProp();
  }
  function sources() {
    const l = [];
    projet.evaps.forEach(e => {
      if (e.off) return;
      const g = evapGeo(e, projet.chambre);
      g.cotes.forEach(c => c.fans.forEach(f => l.push(f.coude ? { c: f.coude.sortie, n: [0, 0, -1], r: f.coude.r, q: f.q } : { c: f.c, n: [c.u[0], c.u[1], 0], r: g.dv / 2, q: f.q })));
    });
    return l;
  }
  function majBoutonsCalcul() {
    const enCours = calculs.enCours();
    $("bCalcul").disabled = enCours;
    $("bCalcul").textContent = enCours ? "Calcul en cours…" : champs.cfd ? "Relancer le calcul fin" : "Lancer le calcul fin";
    $("mCfd").disabled = !champs.cfd;
    $("perime").hidden = !(champs.cfd && cfdPerime);
  }

  /* ---------- Modifications et historique ---------- */
  function instantane() { return JSON.stringify(projet); }
  function memoriser() { annuler.push(instantane()); if (annuler.length > 80) annuler.shift(); retablir = []; majHisto(); }
  function majHisto() { $("bAnnuler").disabled = !annuler.length; $("bRetablir").disabled = !retablir.length; }
  function apresModif(opts) {
    opts = opts || {};
    store.enregistrer(projet);
    // Pièces voisines : décor, le calcul reste valable
    if (champs.cfd && !opts.decor) { cfdPerime = true; if (mode === "cfd") { mode = "apercu"; } }
    majBoutonsCalcul();
    if (vue) {
      if (opts.objet) vue.majObjet(opts.objet.liste, opts.objet.objet);
      else vue.setProjet(projet, true);
      vue.flux.setSources(sources());
    }
    rendreListes(); rendreResume();
    if (!opts.sansPanneau) rendreProp();
    if (!opts.decor) demanderApercu();
  }
  function restaurer(json) {
    const avant = projet.type;
    projet = normaliser(JSON.parse(json));
    if (sel !== "chambre" && !trouver(projet, sel)) sel = "chambre";
    if (projet.type !== avant) { majType(); majAffichage(); if (!batiment()) demanderApercu(true); }
    apresModif();
    if (vue) vue.selection(sel === "chambre" ? null : sel);
  }

  function selectionner(id) {
    sel = id || "chambre";
    if (sel !== "chambre" && vue && vue.coter()) modeCote(false);
    if (sel !== "chambre" && vue && vue.trace()) modeTrace(false);
    if (vue) vue.selection(sel === "chambre" ? null : sel);
    if (onglet !== "prop") choisirOnglet("prop");
    rendreListes(); rendreProp();
  }

  /* Garde un objet en place : dans la chambre ; en bâtiment, rien n'est borné (les portes vont sur les murs des locaux) */
  function garderDedans(liste, o) {
    if (!batiment()) { garderDedansChambre(liste, o, projet.chambre); return; }
    if (liste === "portes") { const s = porteSurMurs(mursLocaux(projet.locaux), o); if (s) { o.x = s.x; o.y = s.y; } }
  }
  /* Portes posées sur les murs d'un local (elles le suivent quand il bouge) */
  function portesDuLocal(id) {
    const murs = mursLocaux(projet.locaux);
    return projet.portes.filter(d => { const s = porteSurMurs(murs, d); return s && s.dist < 0.05 && murs[s.mur].local === id; });
  }
  function deplacer(id, v, aimant) {
    const t = trouver(projet, id); if (!t) return;
    if (!glisse) { memoriser(); glisse = true; }
    if (batiment() && t.liste === "locaux") {
      const o = t.objet, portes = portesDuLocal(o.id), x0 = o.x, y0 = o.y;
      Object.assign(o, v);
      if (aimant) Object.assign(o, aimanterLocal(o, projet.locaux, 0.3)); // à la souris : aimantation contre les locaux voisins
      portes.forEach(d => { d.x += o.x - x0; d.y += o.y - y0; });
      apresModif({ sansPanneau: true, decor: true });
      return;
    }
    Object.assign(t.objet, v);
    garderDedans(t.liste, t.objet);
    apresModif({ objet: t, sansPanneau: true, decor: DECOR.indexOf(t.liste) >= 0 });
  }

  function ajouterObjet(liste) {
    if (liste === "gaines") { modeTrace(true); return; } // une gaine se trace dans la 3D
    memoriser();
    const k = dims(projet.chambre), v = {};
    if (liste === "evaps") { v.x = k.W / 2; v.y = 0.5; v.dir = 90; }
    else if (liste === "echelles") { v.x = k.W / 2; v.y = k.B / 2; v.n = 4; v.rangees = 1; }
    else if (liste === "portes") { v.x = k.W * 0.5; v.y = k.B; }
    else if (liste === "locaux") {
      // Collé à droite du local le plus à droite, aligné sur son bord avant
      const b = projet.locaux.reduce((m, o) => { const x = localGeo(o).box; return !m || x.x1 > m.x1 ? x : m; }, null);
      Object.assign(v, b ? { x: b.x1 + 4, y: b.y0 + 3 } : { x: 4, y: 3 });
    }
    else if (liste === "obstacles" && batiment()) { const b = emprise(projet); v.nom = "Machine " + (projet.obstacles.length + 1); v.x = b.x1 + 3; v.y = (b.y0 + b.y1) / 2; v.L = 3; v.l = 1.5; v.h = 1.8; }
    else if (liste === "personnes" && batiment()) { const b = emprise(projet); v.x = b.x0 + 2; v.y = b.y0 + 2; }
    else if (liste === "ctas" || liste === "plenums" || liste === "bouches") {
      // Au centre du local sélectionné (ou du premier) ; plénums et bouches sous son plafond
      const l = projet.locaux.find(o => o.id === sel) || projet.locaux[0];
      if (l) { v.x = l.x; v.y = l.y; if (liste !== "ctas") v.z = Math.max(0.5, l.H - (liste === "plenums" ? 1 : 0)); }
    }
    else if (liste === "portes" && batiment()) { const l = projet.locaux.find(o => o.id === sel) || projet.locaux[0]; if (l) { const b = localGeo(l).box; v.x = (b.x0 + b.x1) / 2; v.y = b.y0; } }
    else if (liste === "pieces") Object.assign(v, collerPiece(Object.assign({}, { L: 3, l: 3 }), projet.chambre, murLibre(projet.pieces, projet.chambre)), { H: k.H });
    else if (liste === "deflecteurs") {
      // Sur le mur que vise le soufflage du premier évaporateur
      const e = projet.evaps.find(x => !x.off);
      if (e) { const g = evapGeo(e, projet.chambre); v.x = Math.min(k.W, Math.max(0, e.x + g.u[0] * 1000)); v.y = Math.min(k.B, Math.max(0, e.y + g.u[1] * 1000)); v.longueur = Math.max(1, e.len + 0.6); }
    }
    const o = ajouter(projet, liste, v);
    garderDedans(liste, o);
    apresModif({ decor: DECOR.indexOf(liste) >= 0 });
    selectionner(o.id);
  }

  function action(nom) {
    const t = trouver(projet, sel); if (!t) return;
    memoriser();
    if (nom === "supprimer") { projet[t.liste] = projet[t.liste].filter(o => o.id !== sel); sel = "chambre"; if (vue) vue.selection(null); }
    else if (nom === "dupliquer") { const o = dupliquer(projet, t.liste, sel); garderDedans(t.liste, o); sel = o.id; }
    else if (nom === "masquer") t.objet.off = !t.objet.off;
    else if (nom === "pivoter" && "dir" in t.objet) t.objet.dir = (t.objet.dir + 90) % 360;
    else if (nom === "pivoter" && t.liste === "pieces") [t.objet.L, t.objet.l] = [t.objet.l, t.objet.L];
    else if (nom === "pivoter" && t.liste === "locaux") Object.assign(t.objet, pivoterLocal(t.objet));
    else if (nom.startsWith("coller-") && t.liste === "pieces") Object.assign(t.objet, collerPiece(t.objet, projet.chambre, nom.slice(7)));
    else if (nom === "pivoter" && t.liste === "cloisons") { const o = t.objet, cx = (o.x0 + o.x1) / 2, cy = (o.y0 + o.y1) / 2; [o.x0, o.y0, o.x1, o.y1] = [cx - (o.y0 - cy), cy + (o.x0 - cx), cx - (o.y1 - cy), cy + (o.x1 - cx)]; garderDedans("cloisons", o); }
    if (t.objet && nom === "pivoter") garderDedans(t.liste, t.objet);
    apresModif({ decor: DECOR.indexOf(t.liste) >= 0 });
    if (vue) vue.selection(sel === "chambre" ? null : sel);
  }

  /* Saisie dans un panneau */
  function saisir(cle, brut, type, facteur, vide) {
    let v = brut;
    if (type === "txt") v = String(brut).trim();
    else if (type === "chk") v = !!brut;
    else if (type !== "sel") {
      v = lireNombre(brut);
      if (v === null && !vide) { rendreProp(); return; }
      if (Number.isNaN(v)) { toast("Valeur non reconnue : " + brut); rendreProp(); return; }
      if (v !== null) v = v / (facteur || 1);
    }
    if (cle.startsWith("aff.")) { const k = cle.slice(4); aff[k] = type === "sel" ? +v : v; majAffichage(); rendreReglages(); return; }
    memoriser();
    if (cle === "projet.nom") { projet.nom = v || "Projet"; majNom(); }
    else if (cle === "projet.type") {
      projet.type = v === "batiment" ? "batiment" : "chambre"; sel = "chambre";
      majType(); apresModif(); majAffichage(); if (vue) { vue.selection(null); vue.vue("iso"); }
      if (!batiment()) demanderApercu(true);
      return;
    }
    else if (cle.startsWith("chambre.")) {
      projet.chambre[cle.slice(8)] = v;
      projet = normaliser(projet);
      LISTES.forEach(l => projet[l].forEach(o => garderDedans(l, o)));
      majCoupeBornes();
    } else if (cle.startsWith("reglages.")) {
      projet.reglages[cle.slice(9)] = v; projet = normaliser(projet);
    } else {
      const t = trouver(projet, sel); if (!t) return;
      const o = t.objet;
      if (cle === "produit.ref") { if (v !== "perso") o.produit = produitDuCatalogue(v); else o.produit = Object.assign({}, o.produit, { ref: "perso" }); }
      else if (cle.startsWith("produit.")) { o.produit[cle.slice(8)] = v; if (cle !== "produit.nom") o.produit.ref = "perso"; if (cle !== "produit.nom" && o.produit.ref === "perso" && !/\(modifié\)$|^Produit/.test(o.produit.nom)) o.produit.nom = o.produit.nom + " (modifié)"; }
      else if (cle.startsWith("points.")) { const [, i, j] = cle.split("."); if (o.points[+i]) o.points[+i][+j] = v; }
      else o[cle] = v;
      // Double flux : appareil plus profond (batteries des deux côtés)
      if (cle === "type" && v === "double" && o.dep < 0.9) o.dep = 1.0;
      const portes = batiment() && t.liste === "locaux" ? portesDuLocal(o.id) : [], x0 = o.x, y0 = o.y;
      const n = normaliserObjet(t.liste, o, projet.chambre);
      Object.keys(o).forEach(k => delete o[k]); Object.assign(o, n);
      portes.forEach(d => { d.x += o.x - x0; d.y += o.y - y0; }); // les portes du local le suivent
      garderDedans(t.liste, o);
      if (DECOR.indexOf(t.liste) >= 0) { apresModif({ decor: true }); return; }
    }
    apresModif();
  }

  /* ---------- Rendu des panneaux ---------- */
  function majNom() { $("nomProjet").textContent = projet.nom; document.title = projet.nom + " · Modèle Frigo"; }
  function rendreListes() {
    const k = dims(projet.chambre);
    $("chNom").textContent = batiment() ? "Bâtiment" : "Chambre";
    if (batiment()) $("chInfo").textContent = projet.locaux.length + (projet.locaux.length > 1 ? " locaux" : " local") + " · " + fr(projet.locaux.reduce((s, o) => s + localSurface(o), 0), 0) + " m²";
    else $("chInfo").textContent = (k.L ? "En L · " : "") + fr(k.W, 2) + " × " + fr(k.B, 2) + " × " + fr(k.H, 2) + " m";
    document.querySelector('[data-sel="chambre"]').setAttribute("aria-current", sel === "chambre");
    let h = "";
    LISTES_PROJET[projet.type].forEach(l => {
      h += '<div class="grp"><div class="grp-h"><h3>' + nomType(l, true) + '</h3><button type="button" data-ajout="' + l + '" title="Ajouter : ' + nomType(l).toLowerCase() + '">+ Ajouter</button></div>';
      if (l === "pieces" && projet[l].length) h += '<label class="chk grp-chk"><input type="checkbox" data-affchk="pieces"' + (aff.pieces ? " checked" : "") + "> Afficher les pièces voisines</label>";
      if (!projet[l].length) h += '<div class="vide">Aucun' + (l === "echelles" || l === "cloisons" || l === "portes" || l === "pieces" || l === "personnes" || l === "gaines" || l === "bouches" || l === "ctas" ? "e" : "") + " " + nomType(l).toLowerCase().replace("groupe d'échelles", "échelle") + "</div>";
      projet[l].forEach(o => {
        h += '<button type="button" class="it' + (o.off ? " off" : "") + '" data-sel="' + o.id + '" aria-current="' + (sel === o.id) + '"><span class="ic" style="background:' + COULEURS[l] + '">' + ICONES[l] + '</span><span class="nm">' + esc(o.nom) + "<small>" + esc(resumeObjet(l, o, projet)) + "</small></span>" +
          (l === "evaps" ? '<span class="eye" role="button" tabindex="0" data-oeil="' + o.id + '" title="' + (o.off ? "Réafficher" : "Simuler sans cet appareil") + '">' + (o.off ? "◌" : "◉") + "</span>" : "") + "</button>";
      });
      h += "</div>";
    });
    $("listes").innerHTML = h;
    majNom();
  }
  function rendreResume() {
    if (batiment()) {
      const sL = projet.locaux.reduce((s, o) => s + localSurface(o), 0), vL = projet.locaux.reduce((s, o) => s + localSurface(o) * o.H, 0);
      $("resume").innerHTML = "<span>Locaux</span><b>" + projet.locaux.length + "</b><span>Surface</span><b>" + fr(sL, 0) + " m²</b><span>Volume</span><b>" + fr(vL, 0) + " m³</b>" +
        "<span>Machines</span><b>" + projet.obstacles.length + "</b>";
      return;
    }
    const V = volume(projet.chambre), Q = projet.evaps.filter(e => !e.off).reduce((s, e) => s + e.q, 0);
    let nE = 0, nP = 0, m = 0;
    projet.echelles.forEach(e => { const g = echellesGeo(e); nE += g.total; nP += g.total * g.info.nb; m += g.total * g.info.masse; });
    $("resume").innerHTML = "<span>Volume</span><b>" + fr(V, 1) + " m³</b><span>Débit d'air</span><b>" + fr(Q, 0) + " m³/h</b><span>Taux de brassage</span><b>" + fr(V ? Q / V : 0, 1) + " vol/h</b>" +
      "<span>Échelles</span><b>" + nE + "</b><span>Produits</span><b>" + fr(nP, 0) + "</b><span>Masse de produits</span><b>" + fr(m / 1000, 2) + " t</b>";
  }
  function analyseCourante() { const c = champs[mode] || champs.apercu; return c ? c.R : null; }
  function rendreProp() {
    const p = $("pane-prop");
    if (document.activeElement && p.contains(document.activeElement) && document.activeElement.tagName === "INPUT" && document.activeElement.type !== "checkbox") return;
    if (sel === "chambre") { p.innerHTML = panneauChambre(projet); return; }
    const t = trouver(projet, sel);
    if (!t) { sel = "chambre"; p.innerHTML = panneauChambre(projet); return; }
    p.innerHTML = panneauObjet(projet, t.liste, t.objet, analyseCourante(), { produitSel: produitSel && produitSel.id === sel ? produitSel : null, mode });
  }
  function rendreReglages() { $("pane-regl").innerHTML = panneauReglages(projet, aff); }
  function rendreResultats() {
    if (batiment()) { $("pane-res").innerHTML = recapBatiment(); return; }
    const c = champs[mode] || champs.apercu, el = $("pane-res");
    if (!c) { el.innerHTML = '<h2>Résultats</h2><p class="sous">Calcul en cours…</p>'; return; }
    const R = c.R, F = c.F, i = F.info;
    let h = "<h2>Résultats</h2>";
    if (mode === "cfd") {
      const m = i.maille || [0, 0, 0];
      h += '<div class="methode"><b>Calcul fin' + (cfdPerime ? " · à relancer" : "") + "</b> · " + fr(i.cellules || 0, 0) + " cellules de " + fr(m[0] * 100, 0) + " cm · " + (i.passes || 1) + " passe" + ((i.passes || 1) > 1 ? "s" : "") + " · " + fr((i.ms || 0) / 1000, 0) + " s" + (i.converge ? "" : " · écoulement instationnaire, résultat moyenné") +
        (cfdPerime ? '<br>Le projet a changé depuis ce calcul : les valeurs ci-dessous ne correspondent plus à la 3D.' : "") + "</div>";
    } else h += '<div class="methode"><b>Aperçu instantané</b> · modèle de jets simplifié. Lancez le calcul fin pour les retours d\'air, les zones abritées et l\'effet des obstacles.</div>';
    h += '<div class="kpis"><div class="kpi hero"><span>Volume bien brassé</span><b>' + fr(R.couverture * 100, 0) + ' <small>%</small></b></div>' +
      '<div class="kpi"><span>Taux de brassage</span><b>' + fr(R.taux, 1) + ' <small>vol/h</small></b></div>' +
      '<div class="kpi"><span>Vitesse moyenne</span><b>' + fr(R.vMoy, 2) + ' <small>m/s</small></b></div>' +
      '<div class="kpi"><span>À travers les produits</span><b>' + (R.produits.n ? fr(R.produits.vMoy, 2) + " <small>m/s</small>" : "–") + "</b></div>" +
      '<div class="kpi"><span>Max. en zone de travail</span><b>' + fr(R.travail.vMax, 2) + ' <small>m/s</small></b></div>' +
      '<div class="kpi"><span>Débit d\'air</span><b>' + fr(R.debit, 0) + ' <small>m³/h</small></b></div></div>';
    if (R.evaps.length) {
      h += '<div class="sec"><h4>Jets des évaporateurs</h4><table class="tab-mini"><tr><th>Appareil</th><th class="n">Libre</th><th class="n">Constr.</th><th class="n">' + (mode === "cfd" ? "Calculée" : "Aperçu") + "</th></tr>";
      R.evaps.forEach(e => {
        const o = projet.evaps.find(x => x.id === e.id);
        e.cotes.forEach((c, k) => {
          if (c.coude) { h += '<tr><td>' + esc(e.nom) + ' ↓</td><td class="n">' + fr(c.chute, 1) + ' m</td><td class="n">coudes</td><td class="n">' + fr(c.vArrivee, 2) + " m/s</td></tr>"; return; }
          h += '<tr><td>' + esc(e.nom) + (e.cotes.length > 1 ? (k ? " ←" : " →") : "") + '</td><td class="n">' + fr(c.Lf, 1) + ' m</td><td class="n">' + (o ? fr(o.T, 1) + " m" : "–") + '</td><td class="n">' + (c.paroi ? "paroi" + (c.vParoi != null ? " " + fr(c.vParoi, 2) + " m/s" : "") : fr(c.portee, 1) + " m") + "</td></tr>";
        });
      });
      h += "</table>";
      if (mode === "cfd" && i.recalage && i.recalage.length) h += '<p class="hint">Portée calculée : distance où le jet retombe sous 0,25 m/s. ' + (i.passes > 1 ? "Les jets ont été recalés sur la portée constructeur quand l'espace libre le permettait." : "") + "</p>";
      h += "</div>";
    }
    if (R.echelles.some(e => e.info.nb)) {
      h += '<div class="sec"><h4>Air à travers les échelles</h4>';
      R.echelles.forEach(e => {
        if (!e.info.nb) return;
        h += '<p style="margin:4px 0 2px"><b>' + esc(e.nom) + "</b> · moy. " + fr(e.vMoy, 2) + " m/s · min. " + fr(e.vMin, 2) + ' m/s</p><div class="puces">' +
          e.chariots.map((c, n) => { const col = vue ? vue.flux.couleurVitesse(c.v) : [128, 128, 128]; return '<i title="Échelle ' + (n + 1) + " : " + fr(c.v, 2) + ' m/s" style="background:rgb(' + col.map(Math.round).join(",") + ')"></i>'; }).join("") + "</div>";
      });
      h += '<p class="hint">Une case par échelle, colorée selon la vitesse moyenne de l\'air entre les produits. Le calque « Produits » colore les produits dans la 3D.</p></div>';
    }
    h += '<div class="sec"><h4>Contrôles</h4>' + R.alertes.slice().sort((a, b) => rang(a.niveau) - rang(b.niveau)).map(a => '<button type="button" class="al ' + a.niveau + '"' + (a.id ? ' data-sel="' + a.id + '"' : "") + "><b>" + esc(a.titre) + "</b>" + esc(a.texte) + "</button>").join("") + "</div>";
    el.innerHTML = h;
  }
  /* Bâtiment : récapitulatif des surfaces et volumes des locaux */
  function recapBatiment() {
    const signe = T => (T > 0 ? "+" : "") + fr(T, 0);
    let h = '<h2>Récapitulatif</h2><p class="sous">Bâtiment · implantation, sans calcul des flux d\'air</p>';
    h += '<div class="sec"><h4>Locaux</h4><table class="tab-mini"><tr><th>Local</th><th class="n">m²</th><th class="n">m³</th><th class="n">°C</th></tr>';
    let sT = 0, vT = 0;
    projet.locaux.forEach(o => { const S = localSurface(o); sT += S; vT += S * o.H; h += "<tr><td>" + esc(o.nom) + (o.forme === "L" ? " (en L)" : "") + '</td><td class="n">' + fr(S, 1) + '</td><td class="n">' + fr(S * o.H, 0) + '</td><td class="n">' + signe(o.T) + "</td></tr>"; });
    h += '<tr><td><b>Total</b></td><td class="n"><b>' + fr(sT, 1) + '</b></td><td class="n"><b>' + fr(vT, 0) + "</b></td><td></td></tr></table></div>";
    // Traitement d'air : CTA, gaines (sections et métrés), bouches
    if (projet.ctas.length) {
      h += '<div class="sec"><h4>Centrales de traitement d\'air</h4><table class="tab-mini"><tr><th>CTA</th><th class="n">m³/h</th><th class="n">L × l × h (m)</th></tr>';
      projet.ctas.forEach(o => { h += "<tr><td>" + esc(o.nom) + '</td><td class="n">' + fr(o.q, 0) + '</td><td class="n">' + fr(o.L, 1) + " × " + fr(o.l, 1) + " × " + fr(o.h, 1) + "</td></tr>"; });
      h += "</table></div>";
    }
    if (projet.gaines.length) {
      h += '<div class="sec"><h4>Gaines</h4><table class="tab-mini"><tr><th>Gaine</th><th class="n">Section</th><th class="n">m³/h</th><th class="n">m/s</th><th class="n">ml</th><th class="n">m²</th><th class="n">Coudes</th></tr>';
      projet.gaines.forEach(o => {
        const m = gaineMetres(o, projet.reglages), s = m.section;
        h += "<tr><td>" + esc(o.nom) + '</td><td class="n">' + texteSection(s) + '</td><td class="n">' + fr(o.q, 0) + '</td><td class="n">' + (s.erreur ? "–" : fr(s.v, 1)) + '</td><td class="n">' + fr(m.L, 1) + '</td><td class="n">' + (m.surface != null ? fr(m.surface, 1) : "–") + '</td><td class="n">' + m.coudes + "</td></tr>";
      });
      h += "</table>";
      h += '<table class="tab-mini" style="margin-top:8px"><tr><th>Total par type</th><th class="n">ml</th><th class="n">m²</th><th class="n">Coudes</th></tr>' +
        metresGaines(projet.gaines, projet.reglages).map(t => "<tr><td>" + esc(t.nom) + (t.forme === "textile" ? " (tissu)" : " (tôle)") + '</td><td class="n">' + fr(t.L, 1) + '</td><td class="n">' + fr(t.surface, 1) + '</td><td class="n">' + t.coudes + "</td></tr>").join("") + "</table>";
      h += '<p class="hint">Métrés en longueur droite (axe de la gaine) ; coudes comptés à chaque changement de direction. Sections calculées pour ' + fr(projet.reglages.vmaxGaine, 1) + " m/s maximum.</p></div>";
    }
    if (projet.bouches.length) {
      const n = {}; projet.bouches.forEach(o => { n[o.type] = (n[o.type] || 0) + 1; });
      h += '<div class="sec"><h4>Bouches et grilles</h4>' + info(Object.keys(n).map(t => [TYPES_BOUCHE[t].nom, String(n[t])])) + "</div>";
    }
    return h;
  }
  function rang(n) { return n === "bad" ? 0 : n === "warn" ? 1 : 2; }

  function choisirOnglet(t) {
    onglet = t;
    document.querySelectorAll(".tabs [data-tab]").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === t));
    ["prop", "res", "regl"].forEach(x => { $("pane-" + x).hidden = x !== t; });
    if (t === "prop") rendreProp(); else if (t === "res") rendreResultats(); else rendreReglages();
  }

  /* ---------- Affichage 3D ---------- */
  function majCoupeBornes() {
    const k = dims(projet.chambre), max = aff.axe === "x" ? k.W : aff.axe === "y" ? k.B : k.H;
    if (aff.pos == null || aff.pos > max) aff.pos = aff.axe === "z" ? Math.min(1.5, k.H / 2) : max / 2;
    $("coupePos").max = max.toFixed(2); $("coupePos").step = "0.05"; $("coupePos").value = aff.pos;
    $("coupeVal").textContent = (aff.axe === "z" ? "z = " : aff.axe === "y" ? "y = " : "x = ") + fr(aff.pos, 2) + " m";
  }
  /* Légende des vitesses : dégradé et graduations, de 0 à 3 m/s */
  function majLegende() {
    $("legGrad").style.background = "linear-gradient(90deg," + PALIERS.map(p => "rgb(" + p[1].join(",") + ") " + (positionEchelle(p[0]) * 100).toFixed(1) + "%").join(",") + ")";
    $("legEch").innerHTML = GRADUATIONS.map(v => '<span style="left:' + (positionEchelle(v) * 100).toFixed(1) + '%">' + (v === VMAX_ECHELLE ? "≥ " : "") + fr(v, v === 0.25 ? 2 : v % 1 ? 1 : 0) + "</span>").join("");
  }
  function majAffichage() {
    document.querySelectorAll("[data-aff]").forEach(b => b.setAttribute("aria-pressed", !!aff[b.dataset.aff]));
    document.querySelectorAll("[data-affchk]").forEach(c => { c.checked = !!aff[c.dataset.affchk]; });
    document.querySelectorAll("[data-axe]").forEach(b => b.setAttribute("aria-pressed", b.dataset.axe === aff.axe));
    $("coupeBar").hidden = !aff.coupe || batiment();
    majCoupeBornes();
    // Bâtiment : pas de champ de vitesses, les calques de flux sont coupés (sans toucher aux préférences)
    const sansFlux = batiment() ? { particules: false, lignes: false, coupe: false, vecteurs: false, mortes: false, couleurProduits: false } : {};
    if (vue) vue.setAffichage(Object.assign({}, aff, { vmin: projet.reglages.vmin }, sansFlux));
    try { localStorage.setItem("modele-frigo-affichage", JSON.stringify(aff)); } catch (e) { /* rien */ }
  }
  /* Vitesse de l'air au-dessus d'un produit (clic sur un produit ou une case du tableau) */
  let produitSel = null;
  function choisirProduit(id, chariot, niveau) {
    produitSel = { id, chariot, niveau };
    const R = analyseCourante(), e = R && R.echelles.find(x => x.id === id), c = e && e.chariots[chariot], t = c && c.etages[niveau];
    const el = $("sonde");
    if (!t) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = "<b>" + fr(t.v, 2) + " m/s</b> au-dessus des produits<br><span style=\"color:var(--muted)\">" + esc(e.nom) + " · rangée " + (c.rang + 1) + ", échelle " + (chariot % e.n + 1) + " · étage " + (niveau + 1) + " (z " + fr(t.z, 2) + " m)<br>dans les passages entre produits ≈ " + fr(t.vPassage, 2) + " m/s" + (mode === "apercu" ? "<br>Aperçu : lancez le calcul fin pour une valeur fiable" : "") + "</span>";
    if (onglet === "prop") rendreProp();
  }
  function afficherSonde(s) {
    const el = $("sonde");
    if (!s) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = "<b>" + fr(s.m, 2) + " m/s</b><br><span style=\"color:var(--muted)\">x " + fr(s.x, 2) + " · y " + fr(s.y, 2) + " · z " + fr(s.z, 2) + " m<br>vx " + fr(s.u, 2) + " · vy " + fr(s.v, 2) + " · vz " + fr(s.w, 2) + "</span>";
  }

  /* ---------- Cotes ---------- */
  let derniereCote = null;
  function majCotes() {
    store.enregistrer(projet);
    if (vue) vue.setProjet(projet, true);
    afficherCote(derniereInfo);
  }
  function modeCote(on) {
    if (!vue) return;
    derniereCote = null;
    vue.setCoter(on);
    $("bCote").setAttribute("aria-pressed", !!on);
    if (on && sel !== "chambre") selectionner("chambre");
  }
  let derniereInfo = null;
  /* Panneau de mesure : consigne, point visé, longueur en cours et écarts suivant les axes */
  function afficherCote(info) {
    derniereInfo = info;
    const el = $("sonde");
    if (!info) { el.hidden = true; return; }
    el.hidden = false;
    let h;
    if (info.mesure) {
      const m = info.mesure;
      h = '<span class="cote-l">' + fr(m.L, 2) + " m</span><br><span style=\"color:var(--muted)\">Δx " + fr(m.dx, 2) + " · Δy " + fr(m.dy, 2) + " · Δz " + fr(m.dz, 2) + " m" + (m.dz > 0.005 && m.plan > 0.005 ? "<br>en plan : " + fr(m.plan, 2) + " m" : "") + "</span>";
    } else if (derniereCote && !info.premier) {
      const m = derniereCote;
      h = 'Cote posée : <span class="cote-l">' + fr(m.L, 2) + " m</span><br><span style=\"color:var(--muted)\">Δx " + fr(m.dx, 2) + " · Δy " + fr(m.dy, 2) + " · Δz " + fr(m.dz, 2) + " m</span><br><span style=\"color:var(--muted)\">Visez le premier point de la cote suivante.</span>";
    } else h = "<b style=\"font-size:14px\">Mode cote</b><br><span style=\"color:var(--muted)\">" + (info.premier ? "Visez le second point." : "Visez un premier point : coins des murs, des objets, bouts des retombées…") + "</span>";
    if (info.point) h += '<br><span style="color:var(--faint)">' + (info.accroche ? "● " + esc(info.nom || "Accroche") : "○ point libre") + " · x " + fr(info.point[0], 2) + " · y " + fr(info.point[1], 2) + " · z " + fr(info.point[2], 2) + "</span>";
    h += '<p class="hint" style="margin:6px 0 0">Accroche aux points remarquables (Maj : point libre) · glisser : tourner la vue · Échap : annuler</p>';
    h += '<div class="cote-a">' + (projet.cotes.length ? '<button type="button" class="b-ghost" id="bCotesEff">Effacer les ' + projet.cotes.length + " cote" + (projet.cotes.length > 1 ? "s" : "") + "</button>" : "") + '<button type="button" class="b-ghost" id="bCoteFin">Terminer</button></div>';
    el.innerHTML = h;
  }
  $("bCote").onclick = () => { if (vue && vue.trace()) modeTrace(false); modeCote(!(vue && vue.coter())); };

  /* ---------- Tracé de gaine ---------- */
  function modeTrace(on) {
    if (!vue) return;
    if (on && vue.coter()) modeCote(false);
    vue.setTrace(on);
    $("bGaine").setAttribute("aria-pressed", !!on);
    if (on && sel !== "chambre") selectionner("chambre");
  }
  function finirTrace() {
    const r = vue.finTrace(); $("bGaine").setAttribute("aria-pressed", false);
    if (r.points.length < 2) { toast("Gaine abandonnée : posez au moins deux points."); return; }
    memoriser();
    // Débit : celui de la CTA si la gaine part de son soufflage, sinon celui de la dernière gaine
    const cta = r.depart && r.depart.ref && projet.ctas.find(c => c.id === r.depart.ref.id), der = projet.gaines[projet.gaines.length - 1];
    const o = ajouter(projet, "gaines", { points: r.points, q: cta ? cta.q : der ? der.q : 5000, forme: der ? der.forme : "rect" });
    apresModif({ decor: true });
    selectionner(o.id);
  }
  function afficherTrace(info) {
    const el = $("sonde");
    if (!info) { if (!(vue && vue.coter())) el.hidden = true; return; }
    el.hidden = false;
    let h = "<b style=\"font-size:14px\">Tracé de gaine</b> · " + info.n + " point" + (info.n > 1 ? "s" : "") + (info.n > 1 ? " · " + fr(info.L, 2) + " m" : "");
    h += '<br><span style="color:var(--muted)">' + (info.n ? "Cliquez le point suivant" + (info.Lprevu > info.L ? " (→ " + fr(info.Lprevu, 2) + " m)" : "") : "Cliquez le départ : piquage de CTA, face de plénum, bouche, ou dans le vide") + "</span>";
    if (info.point) h += '<br><span style="color:var(--faint)">' + (info.accroche ? "● " + esc(info.accroche) : "○ libre") + " · x " + fr(info.point[0], 2) + " · y " + fr(info.point[1], 2) + " · z " + fr(info.point[2], 2) + "</span>";
    h += '<div class="trace-h"><label for="traceH">Hauteur du tracé</label><input id="traceH" inputmode="decimal" value="' + fr(info.hauteur, 2) + '"> m</div>';
    h += '<p class="hint" style="margin:6px 0 0">Tracé à angles droits (Maj : en biais) ; vers une accroche, la gaine fait les coudes toute seule. Entrée : terminer · Retour arrière : retirer un point · Échap : abandonner</p>';
    h += '<div class="cote-a"><button type="button" class="b-main" id="bTraceFin"' + (info.n < 2 ? " disabled" : "") + '>Terminer la gaine</button><button type="button" class="b-ghost" id="bTraceAnnul">Abandonner</button></div>';
    if (document.activeElement && document.activeElement.id === "traceH") return; // ne pas réécrire pendant la saisie
    el.innerHTML = h;
  }
  $("bGaine").onclick = () => modeTrace(!(vue && vue.trace()));
  $("sonde").addEventListener("click", ev => {
    if (ev.target.id === "bTraceFin") finirTrace();
    else if (ev.target.id === "bTraceAnnul") modeTrace(false);
  });
  $("sonde").addEventListener("change", ev => {
    if (ev.target.id === "traceH") { const v = lireNombre(ev.target.value); if (v != null && !Number.isNaN(v)) { ev.target.blur(); vue.hauteurTrace(v); } }
  });
  $("sonde").addEventListener("click", ev => {
    if (ev.target.id === "bCoteFin") modeCote(false);
    else if (ev.target.id === "bCotesEff") { memoriser(); projet.cotes = []; majCotes(); }
  });

  /* ---------- Événements ---------- */
  document.addEventListener("click", ev => {
    const t = ev.target.closest("[data-oeil],[data-sel],[data-ajout],[data-act],[data-dir],[data-coin],[data-ech],[data-csv],[data-vue],[data-aff],[data-axe],[data-tab]");
    if (!t) return;
    if (t.dataset.oeil) { ev.stopPropagation(); const r = trouver(projet, t.dataset.oeil); if (r) { memoriser(); r.objet.off = !r.objet.off; apresModif(); } return; }
    if (t.dataset.sel) selectionner(t.dataset.sel);
    else if (t.dataset.ajout) ajouterObjet(t.dataset.ajout);
    else if (t.dataset.act) action(t.dataset.act);
    else if (t.dataset.dir) saisir(t.dataset.dir, t.dataset.v, "num", 1, false);
    else if (t.dataset.coin) saisir("chambre.coin", t.dataset.coin, "sel");
    else if (t.dataset.ech) { const [c, n] = t.dataset.ech.split(",").map(Number); choisirProduit(sel, c, n); }
    else if (t.dataset.csv) exporterVitesses(t.dataset.csv);
    else if (t.dataset.vue) { if (vue) vue.vue(t.dataset.vue); }
    else if (t.dataset.aff) { aff[t.dataset.aff] = !aff[t.dataset.aff]; if (t.dataset.aff === "vecteurs" && aff.vecteurs) aff.coupe = true; majAffichage(); }
    else if (t.dataset.axe) { aff.axe = t.dataset.axe; aff.pos = null; majAffichage(); }
    else if (t.dataset.tab) choisirOnglet(t.dataset.tab);
  });
  document.addEventListener("change", ev => {
    const t = ev.target;
    if (t.dataset && t.dataset.affchk) { aff[t.dataset.affchk] = t.checked; majAffichage(); return; }
    if (!t.dataset || !t.dataset.k) return;
    const type = t.dataset.type || "num";
    saisir(t.dataset.k, type === "chk" ? t.checked : t.value, type, +t.dataset.f || 1, !!t.dataset.vide);
  });
  document.addEventListener("keydown", ev => {
    const tag = (ev.target.tagName || "").toLowerCase();
    if (tag === "input" && ev.key === "Enter") { ev.target.blur(); return; }
    if (tag === "input" || tag === "select" || tag === "textarea" || $("dlgProjets").open) return;
    const ctrl = ev.ctrlKey || ev.metaKey;
    if (ctrl && ev.key.toLowerCase() === "z" && !ev.shiftKey) { ev.preventDefault(); $("bAnnuler").click(); }
    else if (ctrl && (ev.key.toLowerCase() === "y" || (ev.key.toLowerCase() === "z" && ev.shiftKey))) { ev.preventDefault(); $("bRetablir").click(); }
    else if (ctrl && ev.key.toLowerCase() === "d" && sel !== "chambre") { ev.preventDefault(); action("dupliquer"); }
    else if ((ev.key === "Delete" || ev.key === "Backspace") && sel !== "chambre") { ev.preventDefault(); action("supprimer"); }
    else if (ev.key.toLowerCase() === "r" && !ctrl && sel !== "chambre") action("pivoter");
    else if (vue && vue.trace() && ev.key === "Enter") { ev.preventDefault(); finirTrace(); }
    else if (vue && vue.trace() && ev.key === "Backspace") { ev.preventDefault(); vue.retirerPointTrace(); }
    else if (vue && vue.trace() && ev.key === "Escape") modeTrace(false);
    else if (ev.key.toLowerCase() === "g" && !ctrl && batiment()) modeTrace(!(vue && vue.trace()));
    else if (ev.key.toLowerCase() === "m" && !ctrl) modeCote(!(vue && vue.coter()));
    else if (ev.key === "Escape" && vue && vue.coter()) { if (!vue.annulerPoint()) modeCote(false); }
    else if (ev.key === "Escape") selectionner("chambre");
    else if (ev.key.startsWith("Arrow") && sel !== "chambre") {
      const t = trouver(projet, sel); if (!t) return;
      ev.preventDefault();
      const d = ev.shiftKey ? 0.01 : 0.1, dx = ev.key === "ArrowRight" ? d : ev.key === "ArrowLeft" ? -d : 0, dy = ev.key === "ArrowUp" ? d : ev.key === "ArrowDown" ? -d : 0;
      const o = t.objet;
      if (t.liste === "cloisons") deplacer(sel, { x0: o.x0 + dx, y0: o.y0 + dy, x1: o.x1 + dx, y1: o.y1 + dy });
      else deplacer(sel, { x: Math.round((o.x + dx) * 100) / 100, y: Math.round((o.y + dy) * 100) / 100 });
      glisse = false; demanderApercu(); rendreProp();
    }
  });
  $("bAnnuler").onclick = () => { if (!annuler.length) return; retablir.push(instantane()); restaurer(annuler.pop()); majHisto(); };
  $("bRetablir").onclick = () => { if (!retablir.length) return; annuler.push(instantane()); restaurer(retablir.pop()); majHisto(); };
  $("bTheme").onclick = () => { const t = themeCourant() === "light" ? "dark" : "light"; appliquerTheme(t); try { localStorage.setItem("modele-frigo-theme", JSON.stringify(t)); } catch (e) { /* rien */ } };
  $("mApercu").onclick = () => { mode = "apercu"; afficherChamp(); };
  $("mCfd").onclick = () => { if (champs.cfd) { mode = "cfd"; afficherChamp(); } };
  $("bCalcul").onclick = () => {
    if (!projet.evaps.some(e => !e.off)) { toast("Ajoutez un évaporateur avant de lancer le calcul."); return; }
    debutCfd = Date.now();
    calculs.cfd(projet);
    $("prog").hidden = false; $("progT").textContent = "Préparation du calcul fin…"; $("progB").style.width = "0";
    majBoutonsCalcul();
  };
  $("bStop").onclick = () => { calculs.stop(); $("prog").hidden = true; majBoutonsCalcul(); };
  $("coupePos").oninput = () => { aff.pos = +$("coupePos").value; $("coupeVal").textContent = (aff.axe === "z" ? "z = " : aff.axe === "y" ? "y = " : "x = ") + fr(aff.pos, 2) + " m"; if (vue) vue.setAffichage({ pos: aff.pos }); };
  $("coupePos").onchange = () => majAffichage();
  $("bPng").onclick = () => {
    if (!vue) return;
    const a = document.createElement("a"); a.href = vue.toPNG(); a.download = nomFichier(projet.nom) + ".png"; document.body.appendChild(a); a.click(); a.remove();
  };

  /* Export CSV (tableur) des vitesses par échelle et par étage */
  function exporterVitesses(id) {
    const R = analyseCourante(), e = R && R.echelles.find(x => x.id === id); if (!e) return;
    const n = (v, d) => fr(v, d).replace(/\s/g, "");
    let t = "Groupe;Calcul;Rangée;Échelle;Étage;Hauteur (m);Vitesse au-dessus des produits (m/s);Vitesse dans les passages (m/s)\n";
    e.chariots.forEach((c, k) => c.etages.forEach((x, j) => {
      t += [e.nom, mode === "cfd" ? "calcul fin" : "aperçu", c.rang + 1, k % e.n + 1, j + 1, n(x.z, 2), n(x.v, 3), n(x.vPassage, 3)].join(";") + "\n";
    }));
    const b = new Blob(["\ufeff" + t], { type: "text/csv" }), a = document.createElement("a");
    a.href = URL.createObjectURL(b); a.download = nomFichier(projet.nom + "-" + e.nom) + "-vitesses.csv"; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------- Projets ---------- */
  function rendreProjets() {
    const cur = store.idCourant();
    $("projListe").innerHTML = store.liste().map(p => '<li class="' + (p.id === cur ? "cur" : "") + '"><span class="nm"><b>' + esc(p.nom) + "</b><small>Modifié le " + new Date(p.maj).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) + "</small></span>" +
      (p.id === cur ? "" : '<button type="button" class="b-ghost" data-pouvrir="' + p.id + '">Ouvrir</button>') +
      '<button type="button" class="b-ico" data-pcopie="' + p.id + '" title="Dupliquer">⧉</button><button type="button" class="b-ico b-danger" data-psuppr="' + p.id + '" title="Supprimer">✕</button></li>').join("");
  }
  function chargerProjet(p) {
    store.maintenant();
    projet = p; sel = "chambre"; annuler = []; retablir = []; majHisto();
    champs.apercu = null; champs.cfd = null; cfdPerime = false; mode = "apercu"; calculs.stop(); $("prog").hidden = true;
    majType(); aff.pos = null; majAffichage();
    if (vue && vue.coter()) modeCote(false);
    if (vue && vue.trace()) modeTrace(false);
    if (vue) { vue.setProjet(projet, false); vue.selection(null); }
    rendreListes(); rendreResume(); rendreProp(); rendreReglages(); majBoutonsCalcul();
    demanderApercu(true);
  }
  $("bProjets").onclick = () => { rendreProjets(); $("dlgProjets").showModal(); };
  $("projFermer").onclick = () => $("dlgProjets").close();
  $("projListe").onclick = ev => {
    const b = ev.target.closest("button"); if (!b) return;
    if (b.dataset.pouvrir) { chargerProjet(store.ouvrir(b.dataset.pouvrir)); $("dlgProjets").close(); }
    else if (b.dataset.pcopie) { chargerProjet(store.dupliquer(b.dataset.pcopie)); rendreProjets(); }
    else if (b.dataset.psuppr) {
      const p = store.liste().find(x => x.id === b.dataset.psuppr);
      if (p && confirm("Supprimer le projet « " + p.nom + " » de cet appareil ?")) { const cur = b.dataset.psuppr === store.idCourant(); store.supprimer(b.dataset.psuppr); if (cur) chargerProjet(store.courant()); rendreProjets(); }
    }
  };
  $("projNouveau").onclick = () => {
    const nom = prompt("Nom du nouveau projet (nom de code, sans nom de client) :", "Projet " + (store.liste().length + 1));
    if (nom === null) return;
    chargerProjet(store.nouveau({ nom: nom || "Projet", evaps: [], echelles: [], portes: [{ x: 4.5, y: 6.5 }] })); $("dlgProjets").close();
  };
  $("projExemple").onclick = () => { chargerProjet(store.nouveau(projetExemple())); $("dlgProjets").close(); };
  $("projBatiment").onclick = () => {
    const nom = prompt("Nom du bâtiment (nom de code, sans nom de client) :", "Bâtiment " + (store.liste().length + 1));
    if (nom === null) return;
    chargerProjet(store.nouveau(batimentVide(nom))); $("dlgProjets").close();
  };
  $("projBatimentEx").onclick = () => { chargerProjet(store.nouveau(batimentExemple())); $("dlgProjets").close(); };
  $("projExport").onclick = () => telecharger(store.exporter(false), nomFichier(projet.nom) + ".json");
  $("projExportTout").onclick = () => telecharger(store.exporter(true), "modele-frigo-projets.json");
  $("projImport").onclick = () => $("projFichier").click();
  $("projFichier").onchange = () => {
    const f = $("projFichier").files[0]; if (!f) return;
    f.text().then(t => { const n = store.importer(t); chargerProjet(store.courant()); rendreProjets(); toast(n + " projet" + (n > 1 ? "s importés" : " importé")); })
      .catch(e => toast(e.message || "Fichier illisible")).finally(() => { $("projFichier").value = ""; });
  };

  /* ---------- Démarrage ---------- */
  majLegende(); majType();
  if (vue) { vue.setProjet(projet, false); }
  majAffichage(); rendreListes(); rendreResume(); rendreProp(); rendreReglages(); majHisto(); majBoutonsCalcul();
  demanderApercu(true);
  window.addEventListener("beforeunload", () => store.maintenant());
  // Accès pour les tests de bout en bout
  window.MF = { projet: () => projet, modeCote, modeTrace, finirTrace, champs, calculs, vue, store, selectionner, saisir, ajouterObjet, action, lancerCalcul: () => $("bCalcul").click(), mode: () => mode };
}

function nomFichier(n) { return String(n || "projet").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9-_]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "projet"; }
function lireLocal(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
function telecharger(texte, nom) {
  const blob = new Blob([texte], { type: "application/json" });
  const f = typeof File === "function" ? new File([blob], nom, { type: "application/json" }) : null;
  // Application installée sur iPhone : feuille de partage (Enregistrer dans Fichiers, AirDrop…)
  if (f && navigator.canShare && navigator.canShare({ files: [f] }) && window.matchMedia("(display-mode: standalone)").matches) {
    navigator.share({ files: [f], title: nom }).catch(() => {});
    return;
  }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nom; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
let toastMin = null;
export function toast(t) {
  let el = document.querySelector(".toast");
  if (!el) { el = document.createElement("div"); el.className = "toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
  el.textContent = t; el.hidden = false;
  clearTimeout(toastMin); toastMin = setTimeout(() => { el.hidden = true; }, 3800);
}
