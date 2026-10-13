/* Vue 3D de la chambre : murs en coupe automatique, objets, sélection, déplacement à la souris,
   vues prédéfinies, image PNG. Repère du projet conservé : x, y au sol, z vers le haut. */
import {
  Scene, PerspectiveCamera, WebGLRenderer, HemisphereLight, DirectionalLight, AmbientLight, Raycaster, Vector2, Vector3, Color, Group, Mesh,
  BoxGeometry, CapsuleGeometry, CircleGeometry, RingGeometry, CylinderGeometry, ConeGeometry, SphereGeometry, ShapeGeometry, Shape, BufferGeometry, Float32BufferAttribute,
  MeshLambertMaterial, MeshBasicMaterial, LineBasicMaterial, LineSegments, InstancedMesh, Object3D, Plane, DoubleSide, MOUSE, TOUCH, EdgesGeometry, Box3, TubeGeometry, QuadraticBezierCurve3
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { dims, polygone, evapGeo, echellesGeo, obstacleGeo, cloisonGeo, porteSnap, retombeesEvap, basRetombeeAuto, deflecteurGeo, etirerRetombee, porteCloison, pieceGeo, localGeo, localPolygone, mursLocaux, porteSurMurs, emprise } from "../core/geometrie.js";
import { projetVisible, LISTES_PROJET } from "../core/modele.js";
import { pointsAccroche, mesure } from "../core/cotes.js";
import { produitsLocaux, ROUES } from "../core/produits.js";
import { creerFlux } from "./flux.js";

export function webglDisponible() {
  try { const c = document.createElement("canvas"); return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl"))); }
  catch (e) { return false; }
}

const fr = (x, d) => (+x).toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
const PASTELS = [0xf4c7d3, 0xcfe8d4, 0xf6e7b4, 0xdccbf0, 0xf8d3b0, 0xc9e4f5];

/* cb : { onPick(id|null), onDrag(id, champ, valeurs), onDragFin(id), onSonde(info|null),
        onCote(a, b), onCoteSuppr(id), onCoteSurvol(info|null) } */
export function creerVue(conteneur, cb) {
  cb = cb || {};
  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.className = "vue3d-canvas";
  conteneur.appendChild(renderer.domElement);
  const el = renderer.domElement;

  const scene = new Scene(), camera = new PerspectiveCamera(38, 1, 0.05, 2000);
  camera.up.set(0, 0, 1);
  scene.add(new HemisphereLight(0xffffff, 0x5d6886, 1.9));
  const sun = new DirectionalLight(0xffffff, 1.4); sun.position.set(0.6, -1, 1.6); scene.add(sun);
  const fill = new DirectionalLight(0xffffff, 0.5); fill.position.set(-1, 1.2, 0.4); scene.add(fill);
  scene.add(new AmbientLight(0xffffff, 0.25));

  const controls = new OrbitControls(camera, el);
  controls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };
  controls.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN };
  controls.screenSpacePanning = true; controls.rotateSpeed = 0.7; controls.zoomSpeed = 1.1;
  controls.maxPolarAngle = Math.PI * 0.98;

  let projet = null, theme = { fond: 0x0b1739, accent: 0xcb3cff, sombre: true }, selId = null;
  const racine = new Group(); scene.add(racine);
  let murs = [], mursLoc = [], plafondsLoc = [], plafond = null, objets = {}, pickables = [], selBox = null, poignees = [];
  const aff = { murs: true, plafond: false, etiquettes: true, couleurProduits: false, pieces: true };
  const flux = creerFlux(scene, { demander: () => demander() });
  let vitEchelles = null; // vitesses par chariot (analyse) pour colorer les produits

  /* ---------- Rendu à la demande, animation des particules ---------- */
  let attente = false, anime = false, tPrec = 0;
  function rendre() {
    attente = false;
    majMurs();
    renderer.render(scene, camera);
    majEtiquettes();
  }
  function demander() { if (!attente && !anime) { attente = true; requestAnimationFrame(rendre); } }
  function boucle(t) {
    if (!anime) return;
    const dt = tPrec ? Math.min(0.05, (t - tPrec) / 1000) : 0.016; tPrec = t;
    flux.animer(dt);
    rendre();
    requestAnimationFrame(boucle);
  }
  function animer(on) {
    if (on && !anime) { anime = true; tPrec = 0; requestAnimationFrame(boucle); }
    else if (!on) { anime = false; demander(); }
  }
  controls.addEventListener("change", demander);

  function taille() {
    const w = conteneur.clientWidth, h = conteneur.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); el.style.width = "100%"; el.style.height = "100%";
    camera.aspect = w / h; camera.updateProjectionMatrix(); demander();
  }
  const ro = window.ResizeObserver ? new ResizeObserver(taille) : null;
  if (ro) ro.observe(conteneur); else window.addEventListener("resize", taille);

  /* ---------- Matériaux ---------- */
  const M = {};
  function materiaux() {
    const s = theme.sombre;
    M.mur = new MeshLambertMaterial({ color: s ? 0x5a6f9e : 0xb9c4dd, transparent: true, opacity: s ? 0.16 : 0.22, side: DoubleSide, depthWrite: false });
    M.sol = new MeshLambertMaterial({ color: s ? 0x1c2a52 : 0xe3e8f3, side: DoubleSide });
    M.plafond = new MeshLambertMaterial({ color: s ? 0x5a6f9e : 0xb9c4dd, transparent: true, opacity: 0.12, side: DoubleSide, depthWrite: false });
    M.trait = new LineBasicMaterial({ color: s ? 0x8fb4ff : 0x1d3b7a, transparent: true, opacity: 0.75 });
    M.grille = new LineBasicMaterial({ color: s ? 0x3a4a78 : 0xc6cee0, transparent: true, opacity: 0.6 });
    M.caisson = new MeshLambertMaterial({ color: 0xe6eaf0 });
    M.coude = new MeshLambertMaterial({ color: 0xc3cad4, side: DoubleSide });
    M.deflecteur = new MeshLambertMaterial({ color: 0xd8b75a, side: DoubleSide, transparent: true, opacity: 0.8 });
    M.retombee = new MeshLambertMaterial({ color: 0x9fb2d6, transparent: true, opacity: 0.55, side: DoubleSide, depthWrite: false });
    M.helice = new MeshLambertMaterial({ color: 0x2b3140, side: DoubleSide });
    M.anneau = new MeshLambertMaterial({ color: 0x3d7bff, side: DoubleSide });
    M.batterie = new MeshLambertMaterial({ color: 0x7c8799, side: DoubleSide });
    M.fleche = new MeshLambertMaterial({ color: 0x3d7bff });
    M.inox = new MeshLambertMaterial({ color: 0xb8c2cc });
    M.roue = new MeshLambertMaterial({ color: 0x2b3140 });
    M.produit = new MeshLambertMaterial({ color: 0xffffff });
    M.cloison = new MeshLambertMaterial({ color: s ? 0xaab4c8 : 0xc9ced6, transparent: true, opacity: 0.92 });
    M.obstacle = new MeshLambertMaterial({ color: 0xb07d45 });
    M.poreux = new MeshLambertMaterial({ color: 0x3fb7a0, transparent: true, opacity: 0.45, depthWrite: false });
    M.porte = new MeshLambertMaterial({ color: 0xe07b39, side: DoubleSide, transparent: true, opacity: 0.85 });
    M.sel = new LineBasicMaterial({ color: theme.accent });
    M.poignee = new MeshBasicMaterial({ color: theme.accent });
    M.pieceMur = new MeshLambertMaterial({ color: s ? 0x8fa3d1 : 0x9aa8c8, transparent: true, opacity: s ? 0.06 : 0.1, side: DoubleSide, depthWrite: false });
    M.pieceTrait = new LineBasicMaterial({ color: s ? 0x6f86c0 : 0x7f8db0, transparent: true, opacity: 0.55 });
    M.localMur = new MeshLambertMaterial({ color: s ? 0xb9c3d8 : 0xc9cfdb, transparent: true, opacity: s ? 0.42 : 0.5, depthWrite: false, side: DoubleSide });
    M.localPlafond = new MeshLambertMaterial({ color: s ? 0xb9c3d8 : 0xd5dae4, transparent: true, opacity: 0.2, depthWrite: false, side: DoubleSide });
    M.gilet = new MeshLambertMaterial({ color: 0xff8a2a });
    M.pantalon = new MeshLambertMaterial({ color: 0x34405e });
    M.peau = new MeshLambertMaterial({ color: 0xe8c2a0 });
    M.poigneeDessus = new MeshBasicMaterial({ color: theme.accent, depthTest: false, transparent: true }); // visible même derrière l'appareil
    // Cotes : dessinées par-dessus les objets
    M.cote = new LineBasicMaterial({ color: s ? 0xffd166 : 0xb3541e, depthTest: false, transparent: true });
    M.coteBout = new MeshBasicMaterial({ color: s ? 0xffd166 : 0xb3541e, depthTest: false, transparent: true });
    M.accroche = new MeshBasicMaterial({ color: 0x14ca74, depthTest: false, transparent: true });
    M.libre = new MeshBasicMaterial({ color: s ? 0xffffff : 0x1d3b7a, depthTest: false, transparent: true, opacity: 0.8 });
  }
  materiaux();

  function vider(o) {
    o.traverse(x => { if (x.geometry) x.geometry.dispose(); });
    if (o.parent) o.parent.remove(o);
  }

  /* ---------- Chambre ---------- */
  let chambre = null;
  /* Bâtiment : pas d'enveloppe, un sol quadrillé sous l'emprise de tous les locaux et machines */
  function construireSolBatiment() {
    const b = emprise(projetVisible(projet)), m = 4;
    const x0 = Math.floor(b.x0 - m), x1 = Math.ceil(b.x1 + m), y0 = Math.floor(b.y0 - m), y1 = Math.ceil(b.y1 + m);
    const sol = boite(x1 - x0, y1 - y0, 0.02, M.sol, (x0 + x1) / 2, (y0 + y1) / 2, -0.014); sol.userData.sol = true; chambre.add(sol);
    const g = [];
    for (let x = x0; x <= x1; x++) g.push(x, y0, 0, x, y1, 0);
    for (let y = y0; y <= y1; y++) g.push(x0, y, 0, x1, y, 0);
    const gg = new BufferGeometry(); gg.setAttribute("position", new Float32BufferAttribute(g, 3));
    chambre.add(new LineSegments(gg, M.grille));
    plafond = null;
  }
  function construireChambre() {
    if (chambre) vider(chambre);
    chambre = new Group(); racine.add(chambre); murs = [];
    if (projet.type === "batiment") { construireSolBatiment(); return; }
    const k = dims(projet.chambre), pl = polygone(projet.chambre), H = k.H;
    const forme = new Shape(); pl.forEach((p, i) => i ? forme.lineTo(p[0], p[1]) : forme.moveTo(p[0], p[1]));
    const sol = new Mesh(new ShapeGeometry(forme), M.sol); sol.position.z = -0.002; sol.userData.sol = true; chambre.add(sol);
    plafond = new Mesh(new ShapeGeometry(forme), M.plafond); plafond.position.z = H; plafond.visible = aff.plafond; chambre.add(plafond);
    // Quadrillage d'un mètre, limité à la chambre
    const g = [];
    const e = k.enc;
    for (let x = 1; x < k.W - 0.01; x++) {
      if (e && x > e.x0 && x < e.x1) { if (e.cy) g.push(x, 0, 0, x, e.y0, 0); else g.push(x, e.y1, 0, x, k.B, 0); }
      else g.push(x, 0, 0, x, k.B, 0);
    }
    for (let y = 1; y < k.B - 0.01; y++) {
      if (e && y > e.y0 && y < e.y1) { if (e.cx) g.push(0, y, 0, e.x0, y, 0); else g.push(e.x1, y, 0, k.W, y, 0); }
      else g.push(0, y, 0, k.W, y, 0);
    }
    const gg = new BufferGeometry(); gg.setAttribute("position", new Float32BufferAttribute(g, 3));
    chambre.add(new LineSegments(gg, M.grille));
    // Murs : un panneau par côté, masqué quand il est entre la caméra et l'intérieur
    const tr = [];
    pl.forEach((A, i) => {
      const B = pl[(i + 1) % pl.length], ex = B[0] - A[0], ey = B[1] - A[1], L = Math.hypot(ex, ey);
      const geo = new BufferGeometry();
      geo.setAttribute("position", new Float32BufferAttribute([A[0], A[1], 0, B[0], B[1], 0, B[0], B[1], H, A[0], A[1], 0, B[0], B[1], H, A[0], A[1], H], 3));
      geo.computeVertexNormals();
      const m = new Mesh(geo, M.mur);
      m.userData.n = [ey / L, -ex / L]; m.userData.p = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
      chambre.add(m); murs.push(m);
      tr.push(A[0], A[1], 0, B[0], B[1], 0, A[0], A[1], H, B[0], B[1], H, A[0], A[1], 0, A[0], A[1], H);
    });
    const tg = new BufferGeometry(); tg.setAttribute("position", new Float32BufferAttribute(tr, 3));
    chambre.add(new LineSegments(tg, M.trait));
    flux.setLimites(k);
  }
  function majMurs() {
    if (!projet) return;
    const c = camera.position;
    murs.concat(mursLoc).forEach(m => {
      const n = m.userData.n, p = m.userData.p;
      m.visible = aff.murs && ((c.x - p[0]) * n[0] + (c.y - p[1]) * n[1] < 0);
    });
    plafondsLoc.forEach(m => { m.visible = aff.plafond; });
    if (plafond) plafond.visible = aff.plafond && c.z < dims(projet.chambre).H;
  }

  /* ---------- Objets ---------- */
  function boite(sx, sy, sz, mat, x, y, z) {
    const m = new Mesh(new BoxGeometry(sx, sy, sz), mat); m.position.set(x, y, z); return m;
  }
  function construireEvap(e) {
    const g = new Group(), geo = evapGeo(e, projet.chambre), b = geo.box, z = geo.z;
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    g.add(boite(b.x1 - b.x0, b.y1 - b.y0, z.eh, M.caisson, cx, cy, z.zc));
    const u = geo.u, p = geo.p, r = geo.dv / 2;
    const disque = (c, n) => {
      const d = new Mesh(new CircleGeometry(r * 0.92, 28), M.helice); d.up.set(0, 0, 1); d.position.set(c[0] + n[0] * 0.006, c[1] + n[1] * 0.006, c[2] + n[2] * 0.006);
      d.lookAt(d.position.x + n[0], d.position.y + n[1], d.position.z + n[2]); g.add(d);
      const a = new Mesh(new RingGeometry(r * 0.92, r, 28), M.anneau); a.position.copy(d.position); a.position.x += n[0] * 0.002; a.position.y += n[1] * 0.002; a.position.z += n[2] * 0.002; a.quaternion.copy(d.quaternion); g.add(a);
    };
    const plaque = (c, n, w, h, mat) => {
      const q = new Mesh(new BoxGeometry(w, h, 0.01), mat); q.position.set(c[0] + n[0] * 0.006, c[1] + n[1] * 0.006, c[2]);
      q.up.set(0, 0, 1); // repère du projet : z vers le haut
      q.lookAt(q.position.x + n[0], q.position.y + n[1], q.position.z); g.add(q);
    };
    if (e.type === "double") {
      // Ventilateurs sous l'appareil, soufflage par les deux faces latérales
      geo.cotes[0].fans.forEach(f => disque([e.x + p[0] * f.o, e.y + p[1] * f.o, z.zb], [0, 0, -1]));
      geo.cotes.forEach(c => plaque([c.O[0], c.O[1], z.zc], [c.u[0], c.u[1], 0], e.len * 0.94, z.eh * 0.7, M.batterie));
    } else {
      geo.cotes[0].fans.forEach(f => disque(f.c, [u[0], u[1], 0]));
      plaque([e.x - u[0] * geo.dep / 2, e.y - u[1] * geo.dep / 2, z.zc], [-u[0], -u[1], 0], e.len * 0.94, z.eh * 0.8, M.batterie);
    }
    // Retombée anti-bypass
    retombeesEvap(Object.assign({}, e, { off: false }), projet.chambre, basRetombeeAuto(projet)).forEach(rt => {
      const L = Math.hypot(rt.x1 - rt.x0, rt.y1 - rt.y0), m = boite(L, rt.ep, rt.zh - rt.zb, M.retombee, (rt.x0 + rt.x1) / 2, (rt.y0 + rt.y1) / 2, (rt.zb + rt.zh) / 2);
      m.rotation.z = Math.atan2(rt.y1 - rt.y0, rt.x1 - rt.x0); g.add(m);
      const ed = new LineSegments(new EdgesGeometry(m.geometry), M.trait); ed.position.copy(m.position); ed.rotation.copy(m.rotation); g.add(ed);
    });
    // Coudes vers le bas en sortie d'hélice
    geo.cotes.forEach(c => c.fans.forEach(f => {
      if (!f.coude) return;
      const so = f.coude.sortie, av = f.coude.avance, depart = new Vector3(f.c[0] - c.u[0] * 0.02, f.c[1] - c.u[1] * 0.02, f.c[2]);
      // Gaine droite (si avancée), puis coude jusqu'à la sortie
      const debutCoude = new Vector3(f.c[0] + c.u[0] * av, f.c[1] + c.u[1] * av, f.c[2]);
      if (av > 0.01) {
        const lg = av + 0.02, gaine = new Mesh(new CylinderGeometry(f.coude.r * 0.98, f.coude.r * 0.98, lg, 20, 1, true), M.coude);
        gaine.position.copy(depart).lerp(debutCoude, 0.5);
        gaine.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(c.u[0], c.u[1], 0)); g.add(gaine);
      }
      const courbe = new QuadraticBezierCurve3(av > 0.01 ? debutCoude : depart, new Vector3(so[0], so[1], f.c[2]), new Vector3(so[0], so[1], so[2]));
      g.add(new Mesh(new TubeGeometry(courbe, 24, f.coude.r * 0.98, 20, false), M.coude));
      const bord = new Mesh(new RingGeometry(f.coude.r * 0.82, f.coude.r * 1.02, 24), M.anneau);
      bord.position.set(so[0], so[1], so[2] - 0.004); bord.rotation.x = Math.PI; g.add(bord);
    }));
    // Flèche de soufflage sur le dessus
    geo.cotes.forEach(c => {
      const f = new Mesh(new ConeGeometry(0.09, 0.26, 12), M.fleche);
      f.position.set(c.O[0] - c.u[0] * 0.15, c.O[1] - c.u[1] * 0.15, z.zt + 0.02);
      f.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(c.u[0], c.u[1], 0)); g.add(f);
    });
    if (e.off) g.traverse(o => { if (o.material) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.3; } });
    return g;
  }
  const tmpO = new Object3D(), tmpC = new Color();
  function construireEchelles(e) {
    const g = new Group(), geo = echellesGeo(e), info = geo.info, a = geo.a, b = geo.b;
    const W = info.W, D = info.D, H = info.H, prods = produitsLocaux(info);
    const nCh = geo.chariots.length;
    // Châssis : montants, cadres haut et bas, glissières de chaque côté
    const barres = [];
    const ajout = (lx, ly, lz, sx, sy, sz) => barres.push([lx, ly, lz, sx, sy, sz]);
    const t = 0.025;
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([i, j]) => ajout(i * (W / 2 - t / 2), j * (D / 2 - t / 2), ROUES - 0.02 + (H - ROUES + 0.02) / 2, t, t, H - ROUES + 0.02));
    [ROUES - 0.01, H - 0.01].forEach(z => { ajout(0, -D / 2 + t / 2, z, W, t, 0.02); ajout(0, D / 2 - t / 2, z, W, t, 0.02); ajout(-W / 2 + t / 2, 0, z, t, D, 0.02); ajout(W / 2 - t / 2, 0, z, t, D, 0.02); });
    for (let i = 0; i < info.N; i++) { const z = ROUES + 0.04 + i * info.pitch; ajout(-W / 2 + 0.012, 0, z, 0.024, D - 0.02, 0.006); ajout(W / 2 - 0.012, 0, z, 0.024, D - 0.02, 0.006); }
    const mB = new InstancedMesh(new BoxGeometry(1, 1, 1), M.inox, barres.length * nCh);
    const mR = new InstancedMesh(new CylinderGeometry(0.045, 0.045, 0.035, 12), M.roue, 4 * nCh);
    const mP = prods.length ? new InstancedMesh(new BoxGeometry(1, 1, 1), M.produit.clone(), prods.length * nCh) : null;
    const place = (c, lx, ly, lz, sx, sy, sz) => {
      // Repère local : x le long de a (largeur W), y le long de b (profondeur D)
      tmpO.position.set(c.cx + a[0] * lx + b[0] * ly, c.cy + a[1] * lx + b[1] * ly, lz);
      tmpO.rotation.set(0, 0, Math.atan2(a[1], a[0]));
      tmpO.scale.set(sx, sy, sz); tmpO.updateMatrix(); return tmpO.matrix;
    };
    let ib = 0, ir = 0, ip = 0;
    const base = [], niv = [];
    geo.chariots.forEach((c, n) => {
      barres.forEach(bb => mB.setMatrixAt(ib++, place(c, bb[0], bb[1], bb[2], bb[3], bb[4], bb[5])));
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([i, j]) => {
        tmpO.position.set(c.cx + a[0] * i * (W / 2 - 0.06) + b[0] * j * (D / 2 - 0.06), c.cy + a[1] * i * (W / 2 - 0.06) + b[1] * j * (D / 2 - 0.06), 0.045);
        tmpO.rotation.set(0, 0, Math.atan2(a[1], a[0])); tmpO.scale.set(1, 1, 1); tmpO.updateMatrix(); mR.setMatrixAt(ir++, tmpO.matrix);
      });
      if (mP) prods.forEach(pr => {
        mP.setMatrixAt(ip, place(c, pr.x, pr.y, pr.z + pr.sz / 2, pr.sx, pr.sy, pr.sz));
        base.push(PASTELS[(pr.niveau + n) % PASTELS.length]); niv.push(pr.niveau);
        mP.setColorAt(ip, tmpC.setHex(base[ip]));
        ip++;
      });
    });
    g.add(mB); g.add(mR);
    if (mP) { mP.userData.produits = { n: prods.length, chariots: nCh }; mP.userData.base = base; mP.userData.niv = niv; g.add(mP); g.userData.mP = mP; }
    return g;
  }
  function colorerProduits() {
    Object.values(objets).forEach(o => {
      const mP = o.userData.mP; if (!mP) return;
      const id = o.userData.id, ve = vitEchelles && vitEchelles[id], n = mP.userData.produits.n;
      for (let c = 0; c < mP.userData.produits.chariots; c++) for (let q = 0; q < n; q++) {
        const i = c * n + q;
        const vv = ve && ve[c] && ve[c][mP.userData.niv[i]];
        if (aff.couleurProduits && vv != null) { const col = flux.couleurVitesse(vv); tmpC.setRGB(col[0] / 255, col[1] / 255, col[2] / 255).convertSRGBToLinear(); }
        else tmpC.setHex(mP.userData.base[i]);
        mP.setColorAt(i, tmpC);
      }
      if (mP.instanceColor) mP.instanceColor.needsUpdate = true;
    });
    demander();
  }
  function construireCloison(c) {
    const g = new Group(), cg = cloisonGeo(c, projet.chambre), po = porteCloison(c, projet.chambre), rot = Math.atan2(cg.uy, cg.ux);
    // Morceau de cloison de t0 à t1 (le long de la cloison) et de z0 à z1
    const morceau = (t0, t1, z0, z1, mat, ep) => {
      if (t1 - t0 < 0.005 || z1 - z0 < 0.005) return null;
      const tm = (t0 + t1) / 2, m = boite(t1 - t0, ep || cg.ep, z1 - z0, mat, c.x0 + cg.ux * tm, c.y0 + cg.uy * tm, (z0 + z1) / 2);
      m.rotation.z = rot; g.add(m);
      const ed = new LineSegments(new EdgesGeometry(m.geometry), M.trait); ed.position.copy(m.position); ed.rotation.copy(m.rotation); g.add(ed);
      return m;
    };
    if (!po) { morceau(0, cg.L, cg.zb, cg.zh, M.cloison); return g; }
    morceau(0, po.t0, cg.zb, cg.zh, M.cloison);
    morceau(po.t1, cg.L, cg.zb, cg.zh, M.cloison);
    morceau(po.t0, po.t1, po.zh, cg.zh, M.cloison);
    if (!po.ouverte) { morceau(po.t0, po.t1, po.zb, po.zh, M.porte, Math.min(cg.ep, 0.06)); return g; }
    // Porte ouverte : vantail tourné à 90° autour de ses gonds (côté t0)
    const hx = c.x0 + cg.ux * po.t0, hy = c.y0 + cg.uy * po.t0, nx = -cg.uy, ny = cg.ux, ep = 0.04;
    const v = boite(po.w, ep, po.zh - po.zb, M.porte, hx + nx * (cg.ep / 2 + po.w / 2), hy + ny * (cg.ep / 2 + po.w / 2), (po.zb + po.zh) / 2);
    v.rotation.z = Math.atan2(ny, nx); g.add(v);
    const cadre = [];
    [[po.t0, po.t0], [po.t1, po.t1]].forEach(([t]) => cadre.push(c.x0 + cg.ux * t, c.y0 + cg.uy * t, po.zb, c.x0 + cg.ux * t, c.y0 + cg.uy * t, po.zh));
    cadre.push(hx, hy, po.zh, c.x0 + cg.ux * po.t1, c.y0 + cg.uy * po.t1, po.zh);
    const cg2 = new BufferGeometry(); cg2.setAttribute("position", new Float32BufferAttribute(cadre, 3));
    g.add(new LineSegments(cg2, new LineBasicMaterial({ color: 0xffb27a })));
    return g;
  }
  function construireObstacle(o) {
    const g = new Group(), b = obstacleGeo(o).box;
    const m = boite(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0, o.poreux > 0.01 ? M.poreux : M.obstacle, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
    g.add(m);
    const ed = new LineSegments(new EdgesGeometry(m.geometry), M.trait); ed.position.copy(m.position); g.add(ed);
    return g;
  }
  function construirePorte(d) {
    const g = new Group(), s = snapPorte(d), w = s.w, h = Math.min(d.h, s.H || d.h);
    const off = -0.012, x0 = s.x - s.ex * w / 2 + s.nx * off, y0 = s.y - s.ey * w / 2 + s.ny * off, x1 = s.x + s.ex * w / 2 + s.nx * off, y1 = s.y + s.ey * w / 2 + s.ny * off;
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute([x0, y0, 0, x1, y1, 0, x1, y1, h, x0, y0, 0, x1, y1, h, x0, y0, h], 3));
    geo.computeVertexNormals();
    g.add(new Mesh(geo, M.porte));
    const cadre = new BufferGeometry(); cadre.setAttribute("position", new Float32BufferAttribute([x0, y0, 0, x0, y0, h, x0, y0, h, x1, y1, h, x1, y1, h, x1, y1, 0], 3));
    g.add(new LineSegments(cadre, new LineBasicMaterial({ color: 0xffb27a })));
    return g;
  }
  /* Porte posée sur le mur le plus proche : de la chambre, ou des locaux en bâtiment */
  function snapPorte(d) {
    if (projet.type !== "batiment") return porteSnap(projet.chambre, d);
    return porteSurMurs(mursLocaux(projet.locaux), d) || { x: d.x, y: d.y, ex: 1, ey: 0, nx: 0, ny: -1, w: d.w, H: d.h };
  }
  /* Déflecteur d'angle : bande cintrée en quart de cercle, du plafond (ou du sol) jusqu'au mur */
  function construireDeflecteur(o) {
    const g = new Group(), d = deflecteurGeo(o, projet.chambre), N = 18, pos = [], idx = [];
    const vz = d.haut ? 1 : -1, cx = d.x + d.ix * d.R, cy = d.y + d.iy * d.R;
    for (let q = 0; q <= N; q++) {
      const a = q / N * Math.PI / 2, h = -Math.sin(a) * d.R, v = Math.cos(a) * d.R * vz; // h : vers le mur, v : vers le plafond (ou le sol)
      const px = cx + d.ix * h, py = cy + d.iy * h, pz = d.zc + v;
      pos.push(px - d.ex * d.L / 2, py - d.ey * d.L / 2, pz, px + d.ex * d.L / 2, py + d.ey * d.L / 2, pz);
      if (q < N) { const b = 2 * q; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    }
    const geo = new BufferGeometry(); geo.setAttribute("position", new Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
    g.add(new Mesh(geo, M.deflecteur));
    const bords = [];
    for (let q = 0; q < N; q++) for (const c of [0, 1]) { const a = 6 * q + 3 * c; bords.push(pos[a], pos[a + 1], pos[a + 2], pos[a + 6], pos[a + 7], pos[a + 8]); }
    const bg = new BufferGeometry(); bg.setAttribute("position", new Float32BufferAttribute(bords, 3)); g.add(new LineSegments(bg, M.trait));
    return g;
  }
  /* Pièce voisine (décor) : sol teinté selon la température, murs à peine visibles, arêtes */
  function couleurTemperature(T) { return T <= -15 ? 0x3d7bff : T <= 0 ? 0x5fb4ff : T <= 8 ? 0x2fbfb8 : T <= 18 ? 0x8f9bb6 : 0xe0a050; }
  function construirePiece(o) {
    const g = new Group(), b = pieceGeo(o).box, L = b.x1 - b.x0, l = b.y1 - b.y0, H = b.z1;
    const sol = new Mesh(new BoxGeometry(L, l, 0.02), new MeshLambertMaterial({ color: couleurTemperature(o.T), transparent: true, opacity: 0.38, depthWrite: false }));
    sol.position.set(o.x, o.y, -0.012); g.add(sol);
    [[b.x0, b.y0, b.x1, b.y0], [b.x1, b.y0, b.x1, b.y1], [b.x1, b.y1, b.x0, b.y1], [b.x0, b.y1, b.x0, b.y0]].forEach(([x0, y0, x1, y1]) => {
      const geo = new BufferGeometry();
      geo.setAttribute("position", new Float32BufferAttribute([x0, y0, 0, x1, y1, 0, x1, y1, H, x0, y0, 0, x1, y1, H, x0, y0, H], 3)); geo.computeVertexNormals();
      const m = new Mesh(geo, M.pieceMur); m.userData.decor = true; g.add(m);
    });
    const ar = new LineSegments(new EdgesGeometry(new BoxGeometry(L, l, H)), M.pieceTrait); ar.position.set(o.x, o.y, H / 2); g.add(ar);
    g.visible = aff.pieces;
    return g;
  }
  /* Personne debout (repère d'échelle) : silhouette simple, proportions d'un adulte, regard suivant dir */
  function construirePersonne(o) {
    const g = new Group(), h = new Group(), k = o.taille / 1.75;
    const capsule = (r, L, mat, x, y, z, sx) => { const m = new Mesh(new CapsuleGeometry(r, L, 4, 10), mat); m.rotation.x = Math.PI / 2; m.position.set(x, y, z); if (sx) m.scale.x = sx; h.add(m); };
    [-0.1, 0.1].forEach(y => capsule(0.07, 0.72, M.pantalon, 0, y, 0.43));          // jambes
    capsule(0.17, 0.36, M.gilet, 0, 0, 1.16, 0.62);                                  // buste
    [-0.235, 0.235].forEach(y => capsule(0.05, 0.5, M.gilet, 0, y, 1.13));           // bras
    const tete = new Mesh(new SphereGeometry(0.105, 16, 12), M.peau); tete.position.set(0.01, 0, 1.635); h.add(tete);
    const nez = new Mesh(new SphereGeometry(0.025, 8, 6), M.peau); nez.position.set(0.105, 0, 1.63); h.add(nez); // indique le regard
    h.scale.setScalar(k); h.rotation.z = o.dir * Math.PI / 180; h.position.set(o.x, o.y, 0);
    g.add(h);
    return g;
  }
  /* Local du bâtiment (rectangle ou L) : sol teinté selon la température, murs masqués côté caméra
     comme ceux de la chambre, plafond affiché avec le calque « Plafond » */
  function construireLocal(o) {
    const g = new Group(), pl = localPolygone(o), H = o.H;
    const forme = new Shape(); pl.forEach((q, i) => i ? forme.lineTo(q[0], q[1]) : forme.moveTo(q[0], q[1]));
    const sol = new Mesh(new ShapeGeometry(forme), new MeshLambertMaterial({ color: couleurTemperature(o.T), transparent: true, opacity: 0.38, depthWrite: false, side: DoubleSide }));
    sol.position.z = 0.006; g.add(sol);
    const tr = [];
    pl.forEach((A, i) => {
      const B = pl[(i + 1) % pl.length], ex = B[0] - A[0], ey = B[1] - A[1], L = Math.hypot(ex, ey) || 1e-9;
      const geo = new BufferGeometry();
      geo.setAttribute("position", new Float32BufferAttribute([A[0], A[1], 0, B[0], B[1], 0, B[0], B[1], H, A[0], A[1], 0, B[0], B[1], H, A[0], A[1], H], 3));
      geo.computeVertexNormals();
      const m = new Mesh(geo, M.localMur); m.userData.decor = true; m.userData.n = [ey / L, -ex / L]; m.userData.p = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
      g.add(m); mursLoc.push(m);
      tr.push(A[0], A[1], 0, B[0], B[1], 0, A[0], A[1], H, B[0], B[1], H, A[0], A[1], 0, A[0], A[1], H);
    });
    const tg = new BufferGeometry(); tg.setAttribute("position", new Float32BufferAttribute(tr, 3)); g.add(new LineSegments(tg, M.trait));
    if (o.plafond) { const p = new Mesh(new ShapeGeometry(forme), M.localPlafond); p.position.z = H; p.userData.decor = true; p.visible = aff.plafond; g.add(p); plafondsLoc.push(p); }
    return g;
  }
  const CONSTR = { evaps: construireEvap, echelles: construireEchelles, cloisons: construireCloison, obstacles: construireObstacle, portes: construirePorte, deflecteurs: construireDeflecteur, pieces: construirePiece, personnes: construirePersonne, locaux: construireLocal };

  function construireObjet(liste, o) {
    if (objets[o.id]) {
      const anc = objets[o.id];
      mursLoc = mursLoc.filter(m => m.parent !== anc); plafondsLoc = plafondsLoc.filter(m => m.parent !== anc);
      vider(anc);
    }
    const g = CONSTR[liste](o);
    g.userData.id = o.id; g.userData.liste = liste;
    racine.add(g); objets[o.id] = g;
    return g;
  }
  function majPickables() { pickables = Object.values(objets).filter(o => o.visible); }

  /* ---------- Sélection ---------- */
  function majSelection() {
    if (selBox) { vider(selBox); selBox = null; }
    poignees.forEach(vider); poignees = [];
    const o = selId && objets[selId]; if (!o) { demander(); return; }
    o.updateMatrixWorld(true);
    const bb = new Box3().setFromObject(o);
    const s = new Vector3(), c = new Vector3(); bb.getSize(s); bb.getCenter(c);
    const m = 0.04;
    selBox = new LineSegments(new EdgesGeometry(new BoxGeometry(s.x + m, s.y + m, s.z + m)), M.sel);
    selBox.position.copy(c); scene.add(selBox);
    if (o.userData.liste === "cloisons") {
      const cl = projet.cloisons.find(x => x.id === selId);
      if (cl) [[cl.x0, cl.y0, "a"], [cl.x1, cl.y1, "b"]].forEach(([x, y, q]) => {
        const p = new Mesh(new SphereGeometry(0.12, 16, 12), M.poignee); p.position.set(x, y, 0.12); p.userData.poignee = q; scene.add(p); poignees.push(p);
      });
    }
    // Retombée d'un évaporateur : une poignée à chaque bout, au bas du panneau, pour régler sa longueur
    if (o.userData.liste === "evaps") {
      const ev = projet.evaps.find(x => x.id === selId);
      if (ev && ev.retombee) retombeesEvap(Object.assign({}, ev, { off: false }), projet.chambre, basRetombeeAuto(projet)).forEach(rt =>
        [[rt.x0, rt.y0, 0], [rt.x1, rt.y1, 1]].forEach(([x, y, b]) => {
          const p = new Mesh(new SphereGeometry(0.1, 16, 12), M.poigneeDessus); p.position.set(x, y, rt.zb); p.renderOrder = 12;
          p.userData.poignee = { retombee: rt.s, bout: b, z: rt.zb }; scene.add(p); poignees.push(p);
        }));
    }
    demander();
  }

  /* ---------- Étiquettes ---------- */
  const calque = document.createElement("div"); calque.className = "vue3d-etiquettes"; conteneur.appendChild(calque);
  let etiq = [];
  function construireEtiquettes() {
    calque.innerHTML = ""; etiq = [];
    if (!projet) return;
    const pr = projetVisible(projet), signe = T => (T > 0 ? "+" : "") + fr(T, 0) + " °C";
    const ajoute = (id, txt, pos, cls) => { const d = document.createElement("div"); d.className = "etq " + (cls || ""); d.textContent = txt; calque.appendChild(d); etiq.push({ id, d, pos: new Vector3(pos[0], pos[1], pos[2]) }); };
    pr.evaps.forEach(e => { const z = evapGeo(e, pr.chambre).z; ajoute(e.id, e.nom, [e.x, e.y, z.zt + 0.25], "ev"); });
    pr.echelles.forEach(e => { const g = echellesGeo(e); ajoute(e.id, e.nom + " · " + g.total + " éch.", [e.x, e.y, g.info.H + 0.25], "ec"); });
    pr.personnes.forEach(o => ajoute(o.id, o.nom + " · " + fr(o.taille, 2) + " m", [o.x, o.y, o.taille + 0.22], "pe"));
    pr.locaux.forEach(o => ajoute(o.id, o.nom + " · " + signe(o.T), [o.x, o.y, o.H + 0.3], "lc"));
    if (pr.type === "batiment") pr.obstacles.forEach(o => ajoute(o.id, o.nom, [o.x, o.y, o.zb + o.h + 0.3], "ob"));
    pr.pieces.forEach(o => { ajoute(o.id, o.nom + " · " + signe(o.T), [o.x, o.y, 0.15], "pc"); etiq[etiq.length - 1].piece = true; });
  }
  const pv = new Vector3();
  function majEtiquettes() {
    calque.hidden = !aff.etiquettes && !etiqCotes.length; calque.classList.toggle("sans-noms", !aff.etiquettes);
    const w = el.clientWidth, h = el.clientHeight;
    if (aff.etiquettes) etiq.forEach(t => {
      pv.copy(t.pos).project(camera);
      const vis = (!t.piece || aff.pieces) && pv.z < 1 && Math.abs(pv.x) < 1.1 && Math.abs(pv.y) < 1.1;
      t.d.style.display = vis ? "" : "none";
      if (vis) t.d.style.transform = "translate(" + ((pv.x + 1) / 2 * w).toFixed(1) + "px," + ((1 - pv.y) / 2 * h).toFixed(1) + "px) translate(-50%,-100%)";
      t.d.classList.toggle("on", t.id === selId);
    });
    etiqCotes.forEach(t => {
      pv.copy(t.pos).project(camera);
      const vis = pv.z < 1 && Math.abs(pv.x) < 1.1 && Math.abs(pv.y) < 1.1;
      t.d.style.display = vis ? "" : "none";
      if (vis) t.d.style.transform = "translate(" + ((pv.x + 1) / 2 * w).toFixed(1) + "px," + ((1 - pv.y) / 2 * h).toFixed(1) + "px) translate(-50%,-50%)";
    });
  }

  /* ---------- Caméra ---------- */
  const VUES = { iso: [-0.9, -1.25, 1.05], dessus: [0, -0.0001, 1], face: [0, -1, 0.12], cote: [1, 0, 0.12], arriere: [0, 1, 0.12] };
  let anim = null;
  function vue(nom, immediat) {
    if (!projet) return;
    const k = dims(projet.chambre), bb = projet.type === "batiment" ? emprise(projetVisible(projet)) : { x0: 0, x1: k.W, y0: 0, y1: k.B, H: k.H };
    // Cadrage : la chambre et les pièces voisines affichées
    if (aff.pieces) (projet.pieces || []).forEach(o => { const b = pieceGeo(o).box; bb.x0 = Math.min(bb.x0, b.x0); bb.x1 = Math.max(bb.x1, b.x1); bb.y0 = Math.min(bb.y0, b.y0); bb.y1 = Math.max(bb.y1, b.y1); bb.H = Math.max(bb.H, b.z1); });
    const ctr = new Vector3((bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2, bb.H * 0.35);
    const d = new Vector3().fromArray(VUES[nom] || VUES.iso).normalize();
    const R = Math.hypot(bb.x1 - bb.x0, bb.y1 - bb.y0, bb.H) / 2, dist = R / Math.sin(camera.fov * Math.PI / 360) * (camera.aspect < 1 ? 1.6 : 1.05);
    const to = ctr.clone().add(d.multiplyScalar(dist));
    if (anim) cancelAnimationFrame(anim);
    if (immediat) { camera.position.copy(to); controls.target.copy(ctr); controls.update(); demander(); return; }
    const p0 = camera.position.clone(), t0 = controls.target.clone(), deb = performance.now();
    const pas = now => {
      const x = Math.min(1, (now - deb) / 450), e = 1 - Math.pow(1 - x, 3);
      camera.position.lerpVectors(p0, to, e); controls.target.lerpVectors(t0, ctr, e); controls.update(); rendre();
      anim = x < 1 ? requestAnimationFrame(pas) : null;
    };
    anim = requestAnimationFrame(pas);
  }

  /* ---------- Pointeur : sélection, déplacement, sonde ---------- */
  const ray = new Raycaster(), ptr = new Vector2(), plan = new Plane(new Vector3(0, 0, 1), 0), hitP = new Vector3();
  let bas = null, glisse = null;
  function viser(ev) {
    const r = el.getBoundingClientRect();
    ptr.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
  }
  function objetSous(ev) {
    viser(ev);
    if (poignees.length) { const hp = ray.intersectObjects(poignees, false); if (hp.length) return { poignee: hp[0].object.userData.poignee }; }
    const hits = ray.intersectObjects(pickables, true);
    for (const h of hits) {
      if (h.object.userData && h.object.userData.decor) continue; // murs des pièces voisines : on vise à travers
      let o = h.object; const mP = o.userData && o.userData.produits ? o : null;
      while (o && !(o.userData && o.userData.id)) o = o.parent;
      if (!o) continue;
      // Produit d'une échelle : numéro de l'échelle dans le groupe et étage
      const produit = mP && h.instanceId != null ? { chariot: Math.floor(h.instanceId / mP.userData.produits.n), niveau: mP.userData.niv[h.instanceId] } : null;
      return { id: o.userData.id, liste: o.userData.liste, point: h.point, produit };
    }
    return null;
  }
  function solSous(ev, z) { viser(ev); plan.constant = -(z || 0); return ray.ray.intersectPlane(plan, hitP) ? hitP.clone() : null; }
  el.addEventListener("pointerdown", ev => {
    if (ev.button !== 0) return;
    bas = { x: ev.clientX, y: ev.clientY, t: performance.now() };
    if (coter) return; // mode cote : un appui sert à poser un point, un glissé tourne la vue
    const o = objetSous(ev);
    if (o && o.poignee) { glisse = { poignee: o.poignee, id: selId }; controls.enabled = false; el.setPointerCapture(ev.pointerId); return; }
    if (o && o.id && o.id === selId) {
      const ob = objetProjet(selId), p = solSous(ev, 0);
      if (ob && p) {
        glisse = { id: selId, liste: o.liste, dx: (o.liste === "cloisons" ? ob.x0 : ob.x) - p.x, dy: (o.liste === "cloisons" ? ob.y0 : ob.y) - p.y, depart: o.liste === "cloisons" ? [ob.x1 - ob.x0, ob.y1 - ob.y0] : null, bouge: false };
        controls.enabled = false; el.setPointerCapture(ev.pointerId);
      }
    }
  });
  el.addEventListener("pointermove", ev => {
    if (!glisse) {
      if (coter) { if (!ev.buttons) survolCote(ev); return; }
      if (ev.pointerType === "mouse" && !ev.buttons) { const o = objetSous(ev); el.style.cursor = o ? (o.id === selId || o.poignee ? "move" : "pointer") : ""; }
      return;
    }
    const pas = ev.shiftKey ? 0.01 : 0.05, ar = v => Math.round(v / pas) * pas;
    const rt = glisse.poignee && typeof glisse.poignee === "object" ? glisse.poignee : null;
    const p = solSous(ev, rt ? rt.z : 0); if (!p) return;
    glisse.bouge = true;
    if (rt) {
      const e = objetProjet(glisse.id);
      const v = e && etirerRetombee(e, projet.chambre, basRetombeeAuto(projet), rt.retombee, rt.bout, p.x, p.y, pas);
      if (v) cb.onDrag && cb.onDrag(glisse.id, v);
    } else if (glisse.poignee) {
      const v = glisse.poignee === "a" ? { x0: ar(p.x), y0: ar(p.y) } : { x1: ar(p.x), y1: ar(p.y) };
      cb.onDrag && cb.onDrag(glisse.id, v);
    } else if (glisse.liste === "cloisons") {
      const x0 = ar(p.x + glisse.dx), y0 = ar(p.y + glisse.dy);
      cb.onDrag && cb.onDrag(glisse.id, { x0, y0, x1: x0 + glisse.depart[0], y1: y0 + glisse.depart[1] });
    } else cb.onDrag && cb.onDrag(glisse.id, { x: ar(p.x + glisse.dx), y: ar(p.y + glisse.dy) });
  });
  el.addEventListener("pointerup", ev => {
    if (glisse) {
      const g = glisse; glisse = null; controls.enabled = true;
      if (g.bouge) { cb.onDragFin && cb.onDragFin(g.id); bas = null; return; }
    }
    if (!bas) return;
    const bouge = Math.hypot(ev.clientX - bas.x, ev.clientY - bas.y), long = performance.now() - bas.t; bas = null;
    if (bouge > 5 || long > 700) return;
    if (coter) { poserPoint(ev); return; }
    // Sonde sur le plan de coupe, sinon sélection
    viser(ev);
    const s = flux.sonde(ray);
    const o = objetSous(ev);
    if (o && o.id) { cb.onPick && cb.onPick(o.id, o.produit); return; }
    if (s) { cb.onSonde && cb.onSonde(s); return; }
    cb.onPick && cb.onPick(null);
  });
  function objetProjet(id) {
    for (const l of ["evaps", "echelles", "cloisons", "obstacles", "portes", "deflecteurs", "pieces", "personnes", "locaux"]) { const o = (projet[l] || []).find(x => x.id === id); if (o) return o; }
    return null;
  }

  /* ---------- Cotes : mesure point à point avec accroche ---------- */
  let coter = false, accroches = null, premier = null, survol = null;
  const gCotes = new Group(); gCotes.renderOrder = 10; scene.add(gCotes);
  const gApercu = new Group(); scene.add(gApercu);
  let etiqCotes = [];
  const RAYON_ACCROCHE = 16; // pixels (doigt : plus large)
  function bout(p, mat, r) { const m = new Mesh(new SphereGeometry(r || 0.035, 12, 8), mat); m.position.set(p[0], p[1], p[2]); m.renderOrder = 11; return m; }
  function trait(a, b, mat) {
    const g = new BufferGeometry(); g.setAttribute("position", new Float32BufferAttribute([a[0], a[1], a[2], b[0], b[1], b[2]], 3));
    const l = new LineSegments(g, mat); l.renderOrder = 11; return l;
  }
  function texteCote(a, b) { return fr(mesure(a, b).L, 2) + " m"; }
  function construireCotes() {
    gCotes.children.slice().forEach(vider);
    etiqCotes.forEach(t => t.d.remove()); etiqCotes = [];
    if (!projet) return;
    (projet.cotes || []).forEach(c => {
      gCotes.add(trait(c.a, c.b, M.cote)); gCotes.add(bout(c.a, M.coteBout)); gCotes.add(bout(c.b, M.coteBout));
      const d = document.createElement("div"); d.className = "etq cote";
      const m = mesure(c.a, c.b);
      d.title = "Δx " + fr(m.dx, 2) + " · Δy " + fr(m.dy, 2) + " · Δz " + fr(m.dz, 2) + " m";
      d.innerHTML = "<span>" + texteCote(c.a, c.b) + '</span><button type="button" aria-label="Supprimer la cote" data-cote="' + c.id + '">✕</button>';
      calque.appendChild(d);
      etiqCotes.push({ id: c.id, d, pos: new Vector3((c.a[0] + c.b[0]) / 2, (c.a[1] + c.b[1]) / 2, (c.a[2] + c.b[2]) / 2) });
    });
    accroches = null;
  }
  calque.addEventListener("click", ev => {
    const b = ev.target.closest("[data-cote]"); if (!b) return;
    ev.stopPropagation(); cb.onCoteSuppr && cb.onCoteSuppr(b.dataset.cote);
  });
  /* Point visé : sommet le plus proche à l'écran (accroche), sinon la surface touchée (objet, mur, sol) */
  function pointVise(ev, libre) {
    viser(ev);
    if (!libre) {
      if (!accroches) { const v = projetVisible(projet); if (!aff.pieces) v.pieces = []; accroches = pointsAccroche(v); }
      const r = el.getBoundingClientRect(), w = r.width, h = r.height, mx = ev.clientX - r.left, my = ev.clientY - r.top;
      const rayon = ev.pointerType === "mouse" ? RAYON_ACCROCHE : RAYON_ACCROCHE * 1.8;
      let best = null, dmin = rayon;
      for (const q of accroches) {
        pv.set(q.p[0], q.p[1], q.p[2]).project(camera);
        if (pv.z > 1 || pv.z < -1) continue;
        const d = Math.hypot((pv.x + 1) / 2 * w - mx, (1 - pv.y) / 2 * h - my);
        if (d < dmin - 0.5 || (best && Math.abs(d - dmin) <= 0.5 && pv.z < best.z)) { dmin = d; best = { p: q.p.slice(), nom: q.nom, z: pv.z }; }
      }
      if (best) return { p: best.p, nom: best.nom, accroche: true };
    }
    const cibles = pickables.concat(chambre ? chambre.children.filter(m => m.isMesh && m.visible) : []);
    const hit = ray.intersectObjects(cibles, true).find(x => x.object.isMesh && x.object.visible);
    if (hit) return { p: [hit.point.x, hit.point.y, hit.point.z], nom: null, accroche: false };
    const s = solSous(ev, 0);
    return s ? { p: [s.x, s.y, 0], nom: null, accroche: false } : null;
  }
  function majApercuCote() {
    gApercu.children.slice().forEach(vider);
    if (!coter) return;
    if (premier) gApercu.add(bout(premier.p, M.coteBout, 0.045));
    if (survol) {
      gApercu.add(bout(survol.p, survol.accroche ? M.accroche : M.libre, survol.accroche ? 0.06 : 0.04));
      if (premier) gApercu.add(trait(premier.p, survol.p, M.cote));
    }
    demander();
  }
  function infoCote() {
    if (!cb.onCoteSurvol) return;
    if (!coter) { cb.onCoteSurvol(null); return; }
    const a = premier, b = survol;
    cb.onCoteSurvol({ premier: a ? a.p : null, point: b ? b.p : null, nom: b && b.nom, accroche: !!(b && b.accroche), mesure: a && b && a !== b ? mesure(a.p, b.p) : null });
  }
  function survolCote(ev) {
    survol = pointVise(ev, ev.shiftKey);
    el.style.cursor = "crosshair";
    majApercuCote(); infoCote();
  }
  function poserPoint(ev) {
    const q = pointVise(ev, ev.shiftKey); if (!q) return;
    if (!premier) { premier = q; survol = q; majApercuCote(); infoCote(); return; }
    const a = premier.p, b = q.p; premier = null; survol = q;
    if (mesure(a, b).L > 0.005) cb.onCote && cb.onCote(a, b);
    majApercuCote(); infoCote();
  }
  function setCoter(on) {
    coter = !!on; premier = null; survol = null; accroches = null;
    el.style.cursor = coter ? "crosshair" : "";
    calque.classList.toggle("coter", coter);
    majApercuCote(); infoCote();
  }

  /* ---------- API ---------- */
  return {
    canvas: el,
    setTheme(t) {
      theme = Object.assign(theme, t); scene.background = new Color(theme.fond);
      const avant = M; materiaux(); Object.values(avant).forEach(m => m.dispose && m.dispose());
      if (projet) this.setProjet(projet, true);
      flux.setTheme(theme);
      demander();
    },
    /* Reconstruit toute la scène (garder = ne pas recadrer la caméra) */
    setProjet(p, garder) {
      const premier = !projet;
      projet = p;
      Object.values(objets).forEach(vider); objets = {}; mursLoc = []; plafondsLoc = [];
      construireChambre();
      (LISTES_PROJET[p.type] || LISTES_PROJET.chambre).forEach(l => (p[l] || []).forEach(o => construireObjet(l, o)));
      majPickables(); construireEtiquettes(); construireCotes(); majSelection(); colorerProduits();
      taille();
      if (premier || !garder) vue("iso", true);
      demander();
    },
    /* Reconstruit un seul objet (déplacement) */
    majObjet(liste, o) {
      construireObjet(liste, o);
      if (projet.type === "batiment") { construireChambre(); if (liste === "locaux") (projet.portes || []).forEach(d => construireObjet("portes", d)); } majPickables(); construireEtiquettes(); majSelection(); colorerProduits(); accroches = null; demander();
    },
    selection(id) { selId = id || null; majSelection(); },
    setCoter, coter: () => coter,
    /* Position à l'écran (pixels de la page) d'un point de la chambre, et des poignées affichées */
    ecran(q) { const r = el.getBoundingClientRect(); pv.set(q[0], q[1], q[2]).project(camera); return { x: r.left + (pv.x + 1) / 2 * r.width, y: r.top + (1 - pv.y) / 2 * r.height }; },
    poignees() { return poignees.map(m => Object.assign(this.ecran([m.position.x, m.position.y, m.position.z]), { q: m.userData.poignee })); },
    /* Échap en mode cote : abandonne le premier point ; renvoie faux s'il n'y en avait pas */
    annulerPoint() { if (!premier) return false; premier = null; majApercuCote(); infoCote(); return true; },
    setChamp(F, vitesses) { flux.setChamp(F); vitEchelles = vitesses || null; colorerProduits(); animer(flux.anime()); demander(); },
    setAffichage(o) {
      Object.assign(aff, o);
      flux.setAffichage(o);
      if (plafond) plafond.visible = aff.plafond;
      if ("pieces" in o) { Object.values(objets).forEach(g => { if (g.userData.liste === "pieces") g.visible = aff.pieces; }); majPickables(); accroches = null; }
      if ("couleurProduits" in o) colorerProduits();
      animer(flux.anime());
      demander();
    },
    vue, rendre: demander,
    flux,
    toPNG() {
      rendre();
      if (!etiqCotes.length) return el.toDataURL("image/png");
      // Cotes : longueurs écrites sur l'image
      const c = document.createElement("canvas"); c.width = el.width; c.height = el.height;
      const x = c.getContext("2d"), k = el.width / (el.clientWidth || el.width);
      x.drawImage(el, 0, 0);
      x.font = "600 " + Math.round(12 * k) + "px system-ui, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
      (projet.cotes || []).forEach(q => {
        pv.set((q.a[0] + q.b[0]) / 2, (q.a[1] + q.b[1]) / 2, (q.a[2] + q.b[2]) / 2).project(camera);
        if (pv.z > 1) return;
        const t = texteCote(q.a, q.b), px = (pv.x + 1) / 2 * c.width, py = (1 - pv.y) / 2 * c.height, tw = x.measureText(t).width + 10 * k;
        x.fillStyle = theme.sombre ? "rgba(11,23,57,.85)" : "rgba(255,255,255,.9)"; x.fillRect(px - tw / 2, py - 9 * k, tw, 18 * k);
        x.fillStyle = theme.sombre ? "#ffd166" : "#b3541e"; x.fillText(t, px, py);
      });
      return c.toDataURL("image/png");
    },
    dispose() { animer(false); if (ro) ro.disconnect(); controls.dispose(); renderer.dispose(); el.remove(); calque.remove(); }
  };
}
