import { Router } from "express";
import {
  getMessagesByContract,
  listConversations,
  nonLusMessagerie,
  sendMessage,
  sendVoiceMessage,
} from "../controllers/message.controller";
import { authenticate, requireActiveSubscription } from "../middleware/auth";
import { uploadMessageAudio } from "../middleware/upload";

const router = Router();

// Voir document.routes.ts : la messagerie suit la même règle que le reste de
// l'espace gestionnaire. Les locataires et propriétaires, eux, conservent un
// accès complet quel que soit l'abonnement de leur gestionnaire.
router.use(authenticate, requireActiveSubscription);

router.get("/conversations", listConversations);
// Avant /:contractId, qui l'avalerait.
router.get("/unread-count", nonLusMessagerie);
router.get("/:contractId", getMessagesByContract);
router.post("/:contractId", sendMessage);
router.post("/:contractId/audio", uploadMessageAudio.single("audio"), sendVoiceMessage);

export default router;
