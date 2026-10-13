# Modèle Frigo

Outil web de modélisation 3D d'une chambre froide et des flux d'air de ses évaporateurs, en français, livré en **un seul fichier HTML hors ligne** (PWA installable sur iPhone via GitHub Pages), pensé pour le pc. Projet frère de Frigobilan (dépôt `simonjosset/frigobilan`), dont il reprend le style, la construction et le modèle de jets, mais sans lien de données.

## Organisation

- `src/modele-frigo.html` : structure et CSS de la page (thèmes sombre et clair via les variables de `:root`), marqueurs remplacés au build (`<style data-inline="fonts">`, `<script type="text/plain" data-inline="worker">`, `<script data-inline="app">`).
- `src/core/` : modules ES purs (sans DOM), testés avec `node --test` :
  - `modele.js` : format du projet, valeurs par défaut, `normaliser` (migration de tout fichier, à garder compatible), ajout / duplication d'objets ;
  - `produits.js` : catalogue de produits, calcul d'une échelle (glissières, étages chargés, rangement, masse), résistance à l'air ;
  - `geometrie.js` : chambre rectangle ou en L (rectangle `longueur` × `largeur` moins un coin `coin` de `coinLong` × `coinLarg`), évaporateurs (côtés de soufflage, hélices, coudes vers le bas `coude` / `coudeAvance` / `coudeDescente` : caisson plein + sortie imposée sous le coude ; retombée anti-bypass `retombee*` générée comme cloison partielle par `retombeesEvap`, largeur et décalage `retombeeDecal` le long de l'appareil, étirée à la main par `etirerRetombee`), porte dans une cloison (`porte*`, `porteCloison` : ouverte, laissée libre au maillage), groupes d'échelles, cloisons, obstacles, portes, déflecteurs d'angle (`deflecteurGeo`, coin derrière l'arrondi plein) ;
  - `grille.js` : maillage en cellules (pleines, poreuses, produits) commun à l'aperçu et au calcul fin ;
  - `apercu.js` : modèle de jets empirique en 3D (fonction de courant à débit constant + vitesse de jet suivant la loi de portée) ;
  - `cfd.js` : Navier-Stokes incompressible isotherme sur grille décalée (semi-lagrangien, diffusion implicite, Forchheimer, projection par gradient conjugué) ; ventilateurs et aspirations en débits imposés sur les faces des caissons ; viscosité de jet réglée sur la portée (`REGLAGE.kPortee`) ;
  - `simulation.js` : déroulé par tranches (maillage, passes, recalage des portées par sécante) ;
  - `analyse.js` : indicateurs, portée mesurée, vitesses dans les échelles, alertes ;
  - `cotes.js` : points d'accroche des cotes (`pointsAccroche`) et mesure ; les cotes sont enregistrées dans le projet (`projet.cotes`, `normaliserCote`) ;
  - `champ.js` : échantillonnage, lignes de courant, échelle de couleurs ; `paquet.js` : transfert worker → page.
- `src/vue3d/` : `vue.js` (scène Three.js en repère z vers le haut, murs masqués côté caméra, objets, sélection, déplacement, poignées des cloisons et des retombées, mode cote avec accroche, étiquettes), `flux.js` (particules, lignes, coupe, flèches, zones mortes, sonde).
- `src/ui/` : `app.js` (contrôleur : sélection, saisie, historique, calculs, résultats, projets), `formulaires.js`, `store.js` (`localStorage` clé `modele-frigo-v1`), `calculs.js` (workers créés depuis le texte intégré, repli dans la page).
- `src/worker/worker.js` : aperçu et calcul fin hors du fil de la page.
- `tools/build.mjs` : fichier unique → `dist/modele-frigo.html` et `modele-frigo.html` (racine, servi par GitHub Pages, ne pas modifier à la main) ; `--dev <fichier>` produit une version non minifiée pour déboguer.
- `tools/smoke.mjs` : test de bout en bout Playwright hors ligne (pc puis iPhone) ; `PAGE=` pour tester une autre page, `SHOTS=` pour le dossier des captures.

## Commandes

```
npm install
npm run build        # après toute modification de src/
npm test             # tests unitaires + vérifie que les fichiers construits sont à jour
npm run test:e2e     # bout en bout (Chromium)
```

## Règles

- À chaque livraison : incrémenter `version` dans `package.json` (affichée à côté du logo) et `VERSION` dans `sw.js`, puis `npm run build`.

- Interface et textes en français ; pc d'abord, l'écran étroit (iPhone) doit rester utilisable.
- Aucun CDN ni appel réseau : police, Three.js, worker et modules sont intégrés au fichier (vérifié par `tests/build.test.mjs`).
- Aucun nom de client réel dans le code, les exemples ou les tests : noms de code uniquement (Projet Alpha…).
- Toute évolution du format de projet passe par `normaliser` et reste compatible avec les anciens exports JSON.
- Le calcul est isotherme et indicatif : le dire dans l'interface quand on présente des résultats.
