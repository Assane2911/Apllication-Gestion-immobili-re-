import { Router } from "express";
import { handlePaydunyaIpn, handlePaydunyaIpnAgence } from "../controllers/paydunya.controller";
import { ipnLimiter } from "../middleware/rateLimit";

const router = Router();

// Routes publiques (pas de middleware d'authentification) : PayDunya appelle
// ces URL directement depuis ses propres serveurs pour confirmer un
// paiement. La sécurité est assurée par la vérification du hash dans le
// contrôleur, pas par un JWT — voir paydunya.controller.ts.
// Limite des REFUS par adresse IP (hash invalide, agence inconnue) : voir ipnLimiter. Les notifications authentiques ne la consomment pas.
router.post("/ipn", ipnLimiter, handlePaydunyaIpn);
// Loyers payés sur le compte PayDunya d'une agence : hash et confirmation vérifiés avec SES clés.
router.post("/ipn/agence/:managerId", ipnLimiter, handlePaydunyaIpnAgence);

export default router;
