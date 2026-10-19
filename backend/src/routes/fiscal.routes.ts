import { Router } from "express";
import { exportFEC, exportGrandLivre, exportSyscohada, getAnnualSynthesis } from "../controllers/fiscal.controller";
import { authenticate, requireActiveSubscription, requirePlan, requireRole } from "../middleware/auth";
import { pasDeCache } from "../middleware/pasDeCache";

const router = Router();

router.use(authenticate, requireRole("MANAGER"), requireActiveSubscription);

router.get("/synthese", getAnnualSynthesis);
// Export comptable (grand livre / FEC / SYSCOHADA) : réservé à Entreprise
// (CGU §3 — "export comptable") ; la synthèse fiscale à
// l'écran ci-dessus reste accessible à toutes les formules.
router.get("/grand-livre", pasDeCache, requirePlan("ENTERPRISE"), exportGrandLivre);
router.get("/fec", pasDeCache, requirePlan("ENTERPRISE"), exportFEC);
router.get("/syscohada", pasDeCache, requirePlan("ENTERPRISE"), exportSyscohada);

export default router;
