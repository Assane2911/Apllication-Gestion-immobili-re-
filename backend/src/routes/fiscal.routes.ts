import { Router } from "express";
import { exportGrandLivre, getAnnualSynthesis } from "../controllers/fiscal.controller";
import { authenticate, requireActiveSubscription, requirePlan, requireRole } from "../middleware/auth";

const router = Router();

router.use(authenticate, requireRole("MANAGER"), requireActiveSubscription);

router.get("/synthese", getAnnualSynthesis);
// Export comptable (grand livre) : réservé à Entreprise (CGU §3) — la
// synthèse fiscale à l'écran ci-dessus reste accessible à toutes les formules.
router.get("/grand-livre", requirePlan("ENTERPRISE"), exportGrandLivre);

export default router;
