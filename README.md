# Modèle Frigo

Modélisation 3D d'une chambre froide, de ses évaporateurs et des flux d'air produits par leurs ventilateurs. Application web en un seul fichier (`modele-frigo.html`), hors ligne, en français, pensée pour le pc et installable sur iPhone.

## Ce que fait l'outil

- **Chambre** rectangulaire ou en L (rectangle total moins un coin, choisi sur un plan coté), hauteur sous plafond, portes accrochées aux murs.
- **Évaporateurs** simple flux (reprise arrière) ou double flux (reprise dessous) : débit, portée constructeur, nombre et diamètre des hélices, dimensions, hauteur de pose, sens de soufflage. Option **coudes vers le bas** : une manchette coudée à 90° en sortie de chaque hélice dirige le soufflage verticalement (avancée horizontale et descente réglables). Option **retombée anti-bypass** : panneau vertical attaché à l'évaporateur, du plafond (ou de sous l'appareil) jusqu'au haut des échelles, pour forcer l'air à traverser les produits ; l'outil mesure le jour restant et la part d'air qui passe par-dessus. Un appareil peut être masqué pour simuler la chambre sans lui.
- **Échelles** (chariots à glissières) chargées de produits : hauteur, largeur, profondeur, nombre d'étages, produit (pot de glace 3,3 kg, bacs gastronormes, plaques, cartons ou produit personnalisé), produits par étage et étages chargés, rangées d'échelles avec écart et allée. Chaque produit est dessiné dans la 3D ; nombre de produits et masse calculés.
- **Déflecteurs d'angle** : arrondi en quart de cercle dans l'angle plafond / mur (ou sol / mur), rayon et longueur réglables, accroché au mur le plus proche, pour que le jet tourne sans buter dans l'angle.
- **Cloisons** pleine hauteur ou partielles (l'air passe dessus ou dessous), **obstacles** pleins ou ajourés.
- **Flux d'air** :
  - *Aperçu* instantané, recalculé à chaque modification : modèle de jets empirique (jet collé au plafond, arrivée sur la paroi d'en face, retour d'air au sol) ;
  - *Calcul fin* sur un bouton : équations de Navier-Stokes isothermes sur une grille de cellules, dans un worker. Les jets sont recalés sur la portée constructeur (2 à 3 passes) quand l'espace libre permet de la mesurer. Les échelles chargées freinent l'air comme un milieu poreux.
- **Visualisation** : particules animées, lignes de courant depuis chaque hélice, plan de coupe horizontal ou vertical coloré par la vitesse (avec flèches et sonde au clic), enveloppe des zones mortes, produits colorés étage par étage selon la vitesse de l'air qui passe dessus.
- **Vitesse sur les produits** : tableau par échelle et par étage dans le panneau du groupe d'échelles, lecture au clic sur une case ou sur un produit de la 3D (vitesse moyenne dans la lame d'air au-dessus du rang de produits, et estimation dans les passages entre produits), export CSV pour le tableur.
- **Résultats** : volume bien brassé, taux de brassage, vitesse moyenne, vitesse à travers les produits, courant d'air en zone de travail, portée de chaque jet, vitesse dans chaque échelle, contrôles (portée insuffisante ou surdimensionnée, soufflage vers une porte, jet gêné, reprise d'air gênée, produits peu ventilés, objets qui se chevauchent).
- Projets enregistrés sur l'appareil, export et import en JSON, annuler / rétablir, image PNG de la vue, thèmes sombre et clair.

C'est un outil de comparaison d'implantations, pas une étude aéraulique certifiée : ni la chute du jet froid, ni la convection naturelle, ni le givrage ne sont modélisés.

## Utilisation à la souris

Clic : sélectionner · glisser l'objet sélectionné : le déplacer (Maj : au centimètre) · glisser ailleurs : tourner la vue · clic droit : décaler · molette : zoom · R : pivoter de 90° · flèches : déplacer de 10 cm · Suppr : supprimer · Ctrl+D : dupliquer · Ctrl+Z / Ctrl+Y : annuler / rétablir · Échap : revenir à la chambre.

## Installer sur iPhone / iPad

L'application est une PWA : une fois publiée en HTTPS (GitHub Pages), elle s'installe comme une app et fonctionne hors ligne.

1. Ouvrir l'adresse du site dans **Safari**.
2. Bouton **Partager** → **Sur l'écran d'accueil** → **Ajouter**.

Les projets sont enregistrés sur l'appareil ; l'app installée a son propre stockage, distinct de Safari (passer par *Exporter* puis *Importer un fichier* pour transférer des projets).

## Publication sur GitHub Pages

Dans les réglages du dépôt : *Pages* → *Deploy from a branch* → branche principale, dossier racine. Le site sert `index.html`, qui redirige vers `modele-frigo.html`.

## Développement

L'application se modifie dans `src/` puis se construit en un seul fichier :

```
npm install
npm run build      # → dist/modele-frigo.html et modele-frigo.html
npm test           # tests unitaires (calculs, maillage, échelles, fichiers construits)
npm run test:e2e   # test de bout en bout hors ligne dans Chromium (pc et iPhone)
npm run icons      # régénère les icônes PNG depuis icons/icon.svg
```

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `src/modele-frigo.html` | Page de l'application : structure et styles |
| `src/core/` | Calculs, sans dépendance au navigateur : données du projet, géométrie, échelles et produits, maillage, aperçu, calcul fin, analyse |
| `src/vue3d/` | Vue 3D (Three.js) : chambre et objets, calques de flux d'air |
| `src/ui/` | Interface : panneaux, projets, lancement des calculs |
| `src/worker/` | Worker de calcul, intégré au fichier unique sous forme de texte |
| `src/fonts/` | Police Mona Sans (licence SIL OFL) intégrée au fichier |
| `tools/build.mjs` | Construction du fichier unique |
| `dist/modele-frigo.html` | Application construite, à télécharger |
| `modele-frigo.html` | Même fichier, servi par GitHub Pages (ne pas modifier à la main) |
| `index.html` | Redirige la racine du site vers l'application |
| `manifest.webmanifest`, `sw.js`, `icons/` | App installable et hors ligne (incrémenter `VERSION` dans `sw.js` pour forcer un rafraîchissement complet) |
| `tests/`, `tools/smoke.mjs` | Tests |
