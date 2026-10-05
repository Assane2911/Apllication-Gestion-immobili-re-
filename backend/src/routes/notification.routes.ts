import { Router } from "express";
import { getNotifications, getTenantNotifications } from "../controllers/notification.controller";
import { authenticate, requireActiveSubscription, requireRole } from "../middleware/auth";

const router = Router();

router.use(authenticate);
router.get("/", requireRole("MANAGER"), requireActiveSubscription, getNotifications);
// Pas de requireActiveSubscription ici : ce n'est pas l'abonnement du
// locataire qui est en jeu (il n'en a pas), mais celui de l'agence qui le
// gère — déjà hors de son contrôle, le bloquer serait le punir d'un défaut
// de paiement qui n'est pas le sien.
router.get("/mine", requireRole("TENANT"), getTenantNotifications);

export default router;
