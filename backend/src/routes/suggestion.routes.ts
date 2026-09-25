import { Router } from "express";
import { createSuggestion } from "../controllers/suggestion.controller";
import { authenticate } from "../middleware/auth";

const router = Router();

// Ouvert à tout utilisateur connecté, quel que soit son rôle — et
// délibérément SANS requireActiveSubscription : un gestionnaire dont
// l'abonnement a expiré est précisément celui dont l'avis compte.
router.post("/", authenticate, createSuggestion);

export default router;
