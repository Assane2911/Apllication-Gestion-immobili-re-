import { Router } from "express";
import {
  getMyOwnerThread,
  getOwnerThread,
  listOwnerConversations,
  sendMyOwnerMessage,
  sendMyOwnerVoice,
  sendOwnerMessage,
  sendOwnerVoice,
} from "../controllers/ownerMessage.controller";
import { authenticate, requireActiveSubscription, requireRole } from "../middleware/auth";
import { uploadMessageAudio } from "../middleware/upload";

const router = Router();

// Côté propriétaire : son fil unique avec l'agence, résolu par son compte. Avant le router.use ci-dessous, réservé au
// gestionnaire ; un propriétaire garde l'accès quel que soit l'abonnement de son agence (comme un locataire).
router.get("/mine", authenticate, requireRole("OWNER"), getMyOwnerThread);
router.post("/mine", authenticate, requireRole("OWNER"), sendMyOwnerMessage);
router.post("/mine/audio", authenticate, requireRole("OWNER"), uploadMessageAudio.single("audio"), sendMyOwnerVoice);

// Côté gestionnaire : les fils des propriétaires de son agence.
router.use(authenticate, requireRole("MANAGER"), requireActiveSubscription);

router.get("/conversations", listOwnerConversations);
router.get("/:ownerId", getOwnerThread);
router.post("/:ownerId", sendOwnerMessage);
router.post("/:ownerId/audio", uploadMessageAudio.single("audio"), sendOwnerVoice);

export default router;
