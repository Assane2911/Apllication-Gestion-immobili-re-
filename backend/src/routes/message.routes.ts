import { Router } from "express";
import {
  getMessagesByContract,
  listConversations,
  sendMessage,
} from "../controllers/message.controller";
import { authenticate, requireActiveSubscription } from "../middleware/auth";

const router = Router();

// Voir document.routes.ts : la messagerie suit la même règle que le reste de
// l'espace gestionnaire. Les locataires et propriétaires, eux, conservent un
// accès complet quel que soit l'abonnement de leur gestionnaire.
router.use(authenticate, requireActiveSubscription);

router.get("/conversations", listConversations);
router.get("/:contractId", getMessagesByContract);
router.post("/:contractId", sendMessage);

export default router;
