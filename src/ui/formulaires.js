/* Panneaux de propriétés : HTML des formulaires (chambre, objets, réglages) et lecture des saisies. */
import { CATALOGUE } from "../core/produits.js";
import { dims, surface, volume, evapGeo, echellesGeo, cloisonGeo } from "../core/geometrie.js";
import { MAILLES } from "../core/modele.js";

export function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
export function fr(x, d) { return (+x).toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d }); }
function aff(v, dec) { return v == null || v === "" ? "" : fr(v, dec).replace(/ | /g, ""); }

/* Lecture d'un nombre saisi à la française ; "" → null */
export function lireNombre(t) {
  t = String(t).trim().replace(/\s/g, "").replace(",", ".");
  if (t === "") return null;
  const v = parseFloat(t);
  return isFinite(v) ? v : NaN;
}

/* ---------- Champs ---------- */
function num(o, k, l, u, opt) {
  opt = opt || {};
  const f = opt.f || 1, v = val(o, k), cle = opt.cle || k;
  const txt = v == null ? "" : aff(v * f, opt.dec != null ? opt.dec : 2);
  return '<div' + (opt.w2 ? ' class="w2"' : "") + '><label for="f_' + cle + '">' + l + '</label><div class="f"><input id="f_' + cle + '" data-k="' + cle + '" data-f="' + f + '"' + (opt.vide ? ' data-vide="1"' : "") + ' inputmode="decimal" autocomplete="off" value="' + txt + '"' + (opt.vide ? ' placeholder="' + esc(opt.vide) + '"' : "") + '>' + (u ? '<span class="u">' + u + '</span>' : "") + '</div></div>';
}
function sel(o, k, l, options, opt) {
  opt = opt || {};
  const v = val(o, k), cle = opt.cle || k;
  return '<div' + (opt.w2 ? ' class="w2"' : "") + '><label for="f_' + cle + '">' + l + '</label><div class="f"><select id="f_' + cle + '" data-k="' + cle + '" data-type="sel">' + options.map(([x, t]) => '<option value="' + esc(x) + '"' + (String(x) === String(v) ? " selected" : "") + ">" + esc(t) + "</option>").join("") + "</select></div></div>";
}
function dirs(o, k, l) {
  const v = val(o, k), D = [[0, "→", "+x"], [90, "↑", "+y"], [180, "←", "−x"], [270, "↓", "−y"]];
  return '<div class="w2"><label>' + l + '</label><div class="dirs" role="group">' + D.map(([a, s, t]) => '<button type="button" data-dir="' + k + '" data-v="' + a + '" aria-pressed="' + (v === a) + '" title="Vers ' + t + '">' + s + ' <small>' + t + '</small></button>').join("") + "</div></div>";
}
function val(o, k) { return k.split(".").reduce((a, x) => a == null ? a : a[x], o); }
function titre(o, sous) {
  return '<h2><input data-k="nom" data-type="txt" value="' + esc(o.nom) + '" aria-label="Nom" maxlength="60"></h2><p class="sous">' + sous + "</p>";
}
function actions(liste, o) {
  return '<div class="actions">' + (liste === "evaps" ? '<button type="button" class="b-ghost" data-act="masquer">' + (o.off ? "Réafficher" : "Simuler sans cet appareil") + "</button>" : "") +
    '<button type="button" class="b-ghost" data-act="dupliquer">Dupliquer</button><button type="button" class="b-ghost b-danger" data-act="supprimer">Supprimer</button></div>';
}
function info(lignes) { return '<div class="info">' + lignes.map(l => l ? (l.tot ? '<span class="tot">' + l[0] + '</span><b class="tot">' + l[1] + "</b>" : "<span>" + l[0] + "</span><b>" + l[1] + "</b>") : "").join("") + "</div>"; }

/* ---------- Chambre ---------- */
export function panneauChambre(p) {
  const ch = p.chambre, k = dims(ch), c = x => ({ cle: "chambre." + x });
  let h = '<h2><input data-k="projet.nom" data-type="txt" value="' + esc(p.nom) + '" aria-label="Nom du projet" maxlength="80"></h2><p class="sous">Projet · géométrie de la chambre froide</p>';
  h += '<div class="sec"><h4>Chambre</h4><div class="grid">' + sel(ch, "forme", "Forme", [["rect", "Rectangulaire"], ["L", "En L"]], { w2: true, cle: "chambre.forme" });
  h += num(ch, "a", "Largeur" + (k.L ? " (branche 1)" : ""), "m", c("a")) + num(ch, "B", "Profondeur" + (k.L ? " totale" : ""), "m", c("B"));
  if (k.L) h += num(ch, "c", "Largeur ajoutée (branche 2)", "m", c("c")) + num(ch, "b", "Profondeur de la branche 2", "m", c("b"));
  h += num(ch, "H", "Hauteur sous plafond", "m", c("H")) + num(ch, "Ti", "Température", "°C", { dec: 0, cle: "chambre.Ti" }) + "</div>";
  if (k.L) h += '<p class="hint">En L : branche 1 de largeur a sur toute la profondeur, branche 2 ajoutée à droite (côté +x) sur la profondeur b, au fond (côté +y).</p>';
  h += info([["Surface au sol", fr(surface(ch), 1) + " m²"], ["Volume", fr(volume(ch), 1) + " m³"]]) + "</div>";
  h += '<p class="note">La température sert de repère : le calcul des flux est isotherme (pas de chute du jet froid ni de convection naturelle).</p>';
  return h;
}

/* ---------- Évaporateur ---------- */
function panneauEvap(p, e, R) {
  const g = evapGeo(e, p.chambre), nf = Math.max(1, e.nf), vS = (e.q / 3600 / g.cotes.length / nf) / (Math.PI * g.dv * g.dv / 4);
  let h = titre(e, (e.type === "double" ? "Évaporateur plafonnier double flux" : "Évaporateur à soufflage simple") + (e.off ? " · masqué" : ""));
  h += '<div class="sec"><h4>Appareil</h4><div class="grid">' + sel(e, "type", "Type", [["simple", "Simple flux (reprise arrière)"], ["double", "Double flux (reprise dessous)"]], { w2: true }) +
    num(e, "q", "Débit d'air total", "m³/h", { dec: 0 }) + num(e, "T", "Portée constructeur" + (e.type === "double" ? " (par côté)" : ""), "m", { dec: 1 }) +
    num(e, "nf", "Ventilateurs" + (e.type === "double" ? " par côté" : ""), "", { dec: 0 }) + num(e, "dv", "Diamètre des hélices", "mm", { f: 1000, dec: 0 }) + "</div>";
  h += '<p class="hint">Débit et portée à reprendre sur la fiche technique (portée à 0,25 m/s).</p></div>';
  h += '<div class="sec"><h4>Dimensions et pose</h4><div class="grid">' + num(e, "len", "Longueur", "m") + num(e, "dep", "Profondeur", "m") + num(e, "eh", "Hauteur", "m") +
    num(e, "zb", "Hauteur de pose (bas)", "m", { vide: "Auto : " + aff(g.z.zb, 2) }) +
    num(e, "x", "Position x (centre)", "m") + num(e, "y", "Position y (centre)", "m") + dirs(e, "dir", "Sens de soufflage") + "</div>";
  h += '<p class="hint">Hauteur de pose vide : appareil suspendu à 8 cm sous le plafond.</p>';
  const ev = R && R.evaps.find(x => x.id === e.id);
  const lignes = [["Débit par ventilateur", fr(e.q / g.cotes.length / nf, 0) + " m³/h"], ["Vitesse dans l'hélice (approx.)", fr(vS, 1) + " m/s"], ["Distance au plafond", fr(g.z.drop, 2) + " m"]];
  if (ev) ev.cotes.forEach((c, i) => {
    const s = ev.cotes.length > 1 ? (i ? " (arrière)" : " (avant)") : "";
    lignes.push(["Espace libre devant" + s, fr(c.Lf, 1) + " m"]);
    lignes.push(["Portée dans la chambre" + s, c.paroi ? "jusqu'à la paroi" + (c.vParoi != null ? " (" + fr(c.vParoi, 2) + " m/s)" : "") : fr(c.portee, 1) + " m"]);
  });
  h += info(lignes) + "</div>" + actions("evaps", e);
  return h;
}

/* ---------- Échelles ---------- */
function panneauEchelles(p, e, R) {
  const g = echellesGeo(e), i = g.info;
  let h = titre(e, "Groupe d'échelles chargées · " + g.total + " échelle" + (g.total > 1 ? "s" : ""));
  h += '<div class="sec"><h4>Implantation</h4><div class="grid">' + num(e, "n", "Échelles par rangée", "", { dec: 0 }) + num(e, "rangees", "Rangées", "", { dec: 0 }) +
    num(e, "ecart", "Écart entre échelles", "cm", { f: 100, dec: 0 }) + num(e, "allee", "Allée entre rangées", "m") +
    num(e, "x", "Position x (centre)", "m") + num(e, "y", "Position y (centre)", "m") + dirs(e, "dir", "Sens de la rangée (largeur des échelles)") + "</div></div>";
  h += '<div class="sec"><h4>Échelle</h4><div class="grid">' + num(e, "H", "Hauteur", "m", { dec: 3 }) + num(e, "etages", "Étages (glissières)", "", { dec: 0 }) +
    num(e, "W", "Largeur", "m", { dec: 3 }) + num(e, "D", "Profondeur", "m", { dec: 3 }) + "</div></div>";
  const ref = CATALOGUE.some(c => c.ref === e.produit.ref) ? e.produit.ref : "perso";
  h += '<div class="sec"><h4>Produit</h4><div class="grid">' + sel({ ref }, "ref", "Type de produit", CATALOGUE.map(c => [c.ref, c.nom]).concat([["perso", "Personnalisé"]]), { w2: true, cle: "produit.ref" }) +
    (ref === "perso" ? '<div class="w2"><label for="f_pn">Nom du produit</label><div class="f"><input id="f_pn" data-k="produit.nom" data-type="txt" value="' + esc(e.produit.nom) + '"></div></div>' : "") +
    num(e, "produit.L", "Longueur", "mm", { f: 1000, dec: 0 }) + num(e, "produit.l", "Largeur", "mm", { f: 1000, dec: 0 }) +
    num(e, "produit.h", "Hauteur", "mm", { f: 1000, dec: 0 }) + num(e, "produit.m", "Masse", "kg", { dec: 2 }) + "</div></div>";
  h += '<div class="sec"><h4>Chargement</h4><div class="grid">' + num(e, "parEtage", "Produits par étage", "", { dec: 0, vide: "Max : " + i.pack.n }) +
    num(e, "etagesCharges", "Étages chargés", "", { dec: 0, vide: "Max : " + i.maxNiveaux }) + "</div>";
  h += '<p class="hint">Laissez vide pour charger au maximum. Rangement automatique dans le sens qui loge le plus de produits.</p>';
  const ec = R && R.echelles.find(x => x.id === e.id);
  h += info([
    ["Écart entre glissières", fr(i.pitch * 1000, 0) + " mm"],
    i.pas > 1 ? ["Glissières chargées", "1 sur " + i.pas] : null,
    ["Produits par étage", i.parEtage + " (" + i.pack.nD + " × " + i.pack.nW + " max)"],
    ["Étages chargés", i.charges + " sur " + i.maxNiveaux],
    ["Par échelle", i.nb + " produits · " + fr(i.masse, 1) + " kg"],
    Object.assign(["Groupe (" + g.total + " échelles)", fr(g.total * i.nb, 0) + " produits · " + fr(g.total * i.masse / 1000, 2) + " t"], { tot: true }),
    ec && i.nb ? ["Air à travers les produits", "moy. " + fr(ec.vMoy, 2) + " · min. " + fr(ec.vMin, 2) + " m/s"] : null
  ]);
  if (i.alertes.length) h += i.alertes.map(t => '<p class="hint" style="color:var(--yellow)">' + esc(t) + "</p>").join("");
  h += "</div>" + actions("echelles", e);
  return h;
}

function panneauCloison(p, c) {
  const g = cloisonGeo(c, p.chambre);
  let h = titre(c, "Cloison" + (g.pleine ? " pleine hauteur" : " partielle"));
  h += '<div class="sec"><h4>Tracé</h4><div class="grid">' + num(c, "x0", "Début x", "m") + num(c, "y0", "Début y", "m") + num(c, "x1", "Fin x", "m") + num(c, "y1", "Fin y", "m") +
    num(c, "ep", "Épaisseur", "cm", { f: 100, dec: 0 }) + "<div></div>" + num(c, "zb", "Bas de la cloison", "m") + num(c, "zh", "Haut de la cloison", "m", { vide: "Plafond" }) + "</div>";
  h += '<p class="hint">Faites glisser la cloison pour la déplacer, ou ses deux poignées pour changer son tracé. Une cloison qui ne monte pas jusqu\'au plafond, ou qui part au-dessus du sol, laisse passer l\'air.</p>';
  h += info([["Longueur", fr(g.L, 2) + " m"]]) + "</div>" + actions("cloisons", c);
  return h;
}

function panneauObstacle(p, o) {
  let h = titre(o, "Obstacle (palettes, rayonnage, machine…)");
  h += '<div class="sec"><h4>Volume</h4><div class="grid">' + num(o, "L", "Longueur", "m") + num(o, "l", "Largeur", "m") + num(o, "h", "Hauteur", "m") + num(o, "zb", "Posé à", "m") +
    num(o, "x", "Position x (centre)", "m") + num(o, "y", "Position y (centre)", "m") + dirs(o, "dir", "Sens de la longueur") +
    num(o, "poreux", "Passage d'air", "%", { f: 100, dec: 0 }) + "</div>";
  h += '<p class="hint">0 % : bloc plein. Au-delà, l\'air traverse l\'obstacle en étant freiné (rayonnage ajouré, palettes espacées).</p></div>' + actions("obstacles", o);
  return h;
}

function panneauPorte(p, d) {
  let h = titre(d, "Porte");
  h += '<div class="sec"><h4>Porte</h4><div class="grid">' + num(d, "w", "Largeur", "m") + num(d, "h", "Hauteur", "m") + num(d, "x", "Position x", "m") + num(d, "y", "Position y", "m") + "</div>";
  h += '<p class="hint">La porte se place sur le mur le plus proche ; faites-la glisser le long des murs. Elle est fermée dans le calcul : elle sert aux contrôles (soufflage vers la porte).</p></div>' + actions("portes", d);
  return h;
}

export function panneauObjet(p, liste, o, R) {
  if (liste === "evaps") return panneauEvap(p, o, R);
  if (liste === "echelles") return panneauEchelles(p, o, R);
  if (liste === "cloisons") return panneauCloison(p, o);
  if (liste === "obstacles") return panneauObstacle(p, o);
  return panneauPorte(p, o);
}

/* ---------- Réglages ---------- */
export function panneauReglages(p, a) {
  const r = p.reglages, c = x => ({ cle: "reglages." + x });
  let h = '<h2>Réglages</h2><p class="sous">Seuils d\'analyse, finesse du calcul et animation</p>';
  h += '<div class="sec"><h4>Analyse</h4><div class="grid">' + num(r, "vmin", "Air considéré brassé dès", "m/s", c("vmin")) +
    num(r, "tauxVise", "Taux de brassage visé", "vol/h", { dec: 0, cle: "reglages.tauxVise" }) +
    num(r, "zTravail", "Zone de travail jusqu'à", "m", { dec: 1, cle: "reglages.zTravail" }) +
    num(r, "vCourant", "Courant d'air au-delà de", "m/s", c("vCourant")) + "</div></div>";
  h += '<div class="sec"><h4>Calcul fin</h4><div class="grid">' + sel(r, "maille", "Finesse du maillage", Object.keys(MAILLES).map(m => [m, MAILLES[m].nom + " (" + fr(MAILLES[m].cellules / 1000, 0) + " 000 cellules)"]), { w2: true, cle: "reglages.maille" }) + "</div>";
  h += '<label class="chk"><input type="checkbox" data-k="reglages.recalage" data-type="chk"' + (r.recalage ? " checked" : "") + '> Recaler les jets sur la portée constructeur (2 à 3 passes)</label>';
  h += '<p class="hint">Plus le maillage est fin, plus le calcul est long : de quelques dizaines de secondes en rapide à plusieurs minutes en fin.</p></div>';
  h += '<div class="sec"><h4>Animation</h4><div class="grid">' + num(a, "densite", "Nombre de particules", "", { dec: 0, cle: "aff.densite" }) +
    sel(a, "vitesseAnim", "Vitesse d'animation", [[0, "Pause"], [0.5, "× 0,5"], [1, "Temps réel"], [2, "× 2"], [4, "× 4"]], { cle: "aff.vitesseAnim" }) + "</div></div>";
  h += '<p class="note">Aperçu : modèle de jets empirique, instantané, pour comparer des implantations. Calcul fin : équations de Navier-Stokes isothermes sur une grille de cellules, viscosité des jets recalée sur la portée constructeur ; ni la chute du jet froid ni le givrage ne sont modélisés. Dans les deux cas, c\'est un outil de comparaison, pas une étude aéraulique certifiée.</p>';
  return h;
}

export function resumeObjet(liste, o) {
  if (liste === "evaps") return fr(o.q, 0) + " m³/h · " + fr(o.T, 0) + " m" + (o.type === "double" ? " · double flux" : "");
  if (liste === "echelles") { const g = echellesGeo(o); return g.total + " éch. · " + fr(g.total * g.info.nb, 0) + " produits"; }
  if (liste === "cloisons") { return "L " + fr(Math.hypot(o.x1 - o.x0, o.y1 - o.y0), 2) + " m" + (o.zh != null || o.zb > 0 ? " · partielle" : ""); }
  if (liste === "obstacles") return fr(o.L, 2) + " × " + fr(o.l, 2) + " × " + fr(o.h, 2) + " m" + (o.poreux > 0.01 ? " · ajouré" : "");
  return fr(o.w, 2) + " × " + fr(o.h, 2) + " m";
}
