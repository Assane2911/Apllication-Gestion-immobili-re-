import { Router } from "express";
import { inviteTeamMember, listTeamMembers, removeTeamMember, resendTeamInvitation, updateTeamMemberRole } from "../controllers/team.controller";
import { authenticate, requireActiveSubscription, requirePlan, requireRole } from "../middleware/auth";

const router = Router();

router.use(authenticate, requireRole("MANAGER"), requireActiveSubscription);

router.get("/", listTeamMembers);
// Inviter un nouveau collaborateur : réservé à Entreprise (CGU §3). Voir/
// révoquer les collaborateurs existants reste possible après un
// changement de formule, seul l'AJOUT en est empêché.
router.post("/", requirePlan("ENTERPRISE"), inviteTeamMember);
router.patch("/:id/role", updateTeamMemberRole);
// Renvoyer une invitation en attente : possible après un changement de formule, comme révoquer.
router.post("/:id/resend", resendTeamInvitation);
router.delete("/:id", removeTeamMember);

export default router;
