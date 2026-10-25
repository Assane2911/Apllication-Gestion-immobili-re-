import { Router } from "express";
import { recevoirRapportCsp } from "../controllers/csp.controller";
import { cspLimiter } from "../middleware/rateLimit";

const router = Router();

// helmet envoie « Cross-Origin-Resource-Policy: same-origin » sur toute l'API. Le site et l'API sont deux origines
// différentes : le rapport arrivait (204) mais Chrome affichait « ERR_BLOCKED_BY_RESPONSE.NotSameOrigin » dans la
// console du visiteur. Cette réponse n'a aucun contenu à protéger : on la laisse lisible depuis le site.
// Réservé à ce point de collecte ; le reste de l'API garde « same-origin ».
router.use((_req, res, next) => {
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  next();
});

// Public (voir csp.controller.ts) : limité par adresse IP, n'écrit rien en base.
router.post("/", cspLimiter, recevoirRapportCsp);

export default router;
