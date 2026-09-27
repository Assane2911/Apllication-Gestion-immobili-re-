import { Router } from "express";
import { exportFEC, exportGrandLivre, getAnnualSynthesis } from "../controllers/fiscal.controller";
import { authenticate, requireActiveSubscription, requirePlan, requireRole } from "../middleware/auth";

const router = Router();

router.use(authenticate, requireRole("MANAGER"), requireActiveSubscription);

router.get("/synthese", getAnnualSynthesis);
// Export comptable (grand livre / FEC) : réservé à Entreprise (CGU §3 —
// "export comptable avancé (FEC/Excel)") ; la synthèse fiscale à l'écran
// ci-dessus reste accessible à toutes les formules.
router.get("/grand-livre", requirePlan("ENTERPRISE"), exportGrandLivre);
router.get("/fec", requirePlan("ENTERPRISE"), exportFEC);

export default router;
