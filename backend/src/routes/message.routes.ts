import { Router } from "express";
import {
  getMessagesByContract,
  listConversations,
  sendMessage,
} from "../controllers/message.controller";
import { authenticate } from "../middleware/auth";

const router = Router();

router.use(authenticate);

router.get("/conversations", listConversations);
router.get("/:contractId", getMessagesByContract);
router.post("/:contractId", sendMessage);

export default router;
