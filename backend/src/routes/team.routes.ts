import { Router } from "express";
import { inviteTeamMember, listTeamMembers, removeTeamMember } from "../controllers/team.controller";
import { authenticate, requireActiveSubscription, requirePlan, requireRole } from "../middleware/auth";

const router = Router();

router.use(authenticate, requireRole("MANAGER"), requireActiveSubscription);

router.get("/", listTeamMembers);
// Inviter un nouveau collaborateur : réservé à Entreprise (CGU §3). Voir/
// révoquer les collaborateurs existants reste possible après un
// changement de formule, seul l'AJOUT en est empêché.
router.post("/", requirePlan("ENTERPRISE"), inviteTeamMember);
router.delete("/:id", removeTeamMember);

export default router;
