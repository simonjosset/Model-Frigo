import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildHTML } from "../tools/build.mjs";

test("les fichiers construits sont à jour (sinon : npm run build)", async () => {
  const html = await buildHTML();
  for (const f of ["dist/modele-frigo.html", "modele-frigo.html"]) assert.ok((await readFile(new URL("../" + f, import.meta.url), "utf8")) === html, f + " n'est pas à jour");
});

test("fichier unique hors ligne : aucune ressource externe, police, worker et 3D intégrés", async () => {
  const html = await buildHTML();
  const ext = [...html.matchAll(/(?:src|href)=["'](https?:[^"']+)/g)].map(m => m[1]);
  assert.deepEqual(ext, []);
  assert.ok(!/@import|url\(\s*["']?https?:/.test(html), "aucune feuille ou police distante");
  assert.ok(!html.includes('data-inline="'), "marqueur non remplacé");
  assert.ok(html.includes("font/woff2;base64,"), "police intégrée");
  assert.ok(html.includes('id="mf-worker"'), "worker de calcul intégré");
  assert.ok(Buffer.byteLength(html) < 2.5 * 1024 * 1024, "taille raisonnable");
});

test("aucun nom de client réel : le projet d'exemple porte un nom de code", async () => {
  const { projetExemple } = await import("../src/core/modele.js");
  const p = projetExemple();
  assert.match(p.nom, /^Projet [A-Z][a-z]+$/);
  for (const l of ["evaps", "echelles", "cloisons", "obstacles", "portes", "deflecteurs"]) for (const o of p[l]) assert.match(o.nom, /^(Évap|Échelles|Cloison|Obstacle|Porte|Déflecteur) /);
});
