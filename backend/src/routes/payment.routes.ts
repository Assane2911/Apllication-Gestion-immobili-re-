import { Router } from "express";
import { getAvailableMethods } from "../controllers/payment.controller";
import { authenticate } from "../middleware/auth";

const router = Router();

// Accessible aux gestionnaires comme aux locataires : les deux ont un écran de
// paiement. Aucune donnée sensible n'est exposée — seulement la liste des
// moyens utilisables, jamais la raison technique d'une indisponibilité.
router.get("/methods", authenticate, getAvailableMethods);

export default router;
