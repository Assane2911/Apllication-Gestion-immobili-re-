import { Router } from "express";
import { anonymiserPersonne, exporterPersonne } from "../controllers/personne.controller";
import { authenticate, requireActiveSubscription, requireRole } from "../middleware/auth";

const router = Router();

router.use(authenticate, requireRole("MANAGER"), requireActiveSubscription);

// Droits d'une personne sans compte (garant, prospect) : l'export est une lecture sensible, l'anonymisation une écriture
// réservée au propriétaire de l'agence et aux administrateurs d'équipe (voir utils/rolesEquipe.ts).
router.get("/export", exporterPersonne);
router.post("/anonymiser", anonymiserPersonne);

export default router;
