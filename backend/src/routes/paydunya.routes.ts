import { Router } from "express";
import { handlePaydunyaIpn } from "../controllers/paydunya.controller";

const router = Router();

// Route publique (pas de middleware d'authentification) : PayDunya appelle
// cette URL directement depuis ses propres serveurs pour confirmer un
// paiement. La sécurité est assurée par la vérification du hash dans le
// contrôleur, pas par un JWT — voir paydunya.controller.ts.
router.post("/ipn", handlePaydunyaIpn);

export default router;
