/* Point d'entrée de l'application (intégré au fichier unique par « npm run build »). */
import { demarrer, toast } from "./app.js";

window.addEventListener("error", e => { if (e && e.message) toast("Erreur : " + e.message); });
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", demarrer);
else demarrer();
