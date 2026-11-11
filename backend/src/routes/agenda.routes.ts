import { Router } from "express";
import { createAgendaFeed, deleteAgendaFeed, getAgenda, getAgendaFeed, getAgendaIcs, getAgendaSummary, updateAgendaFeed } from "../controllers/agenda.controller";
import { authenticate, requireActiveSubscription, requireRole } from "../middleware/auth";
import { agendaFeedLimiter } from "../middleware/rateLimit";

const router = Router();

// Public : lu par les calendriers, sans session. Le jeton du lien en tient lieu ; seuls les échecs comptent dans la limite.
router.get("/ics/:fichier", agendaFeedLimiter, getAgendaIcs);

router.use(authenticate, requireRole("MANAGER"), requireActiveSubscription);
router.get("/", getAgenda);
router.get("/summary", getAgendaSummary);
router.get("/feed", getAgendaFeed);
router.post("/feed", createAgendaFeed);
router.put("/feed", updateAgendaFeed);
router.delete("/feed", deleteAgendaFeed);

export default router;
