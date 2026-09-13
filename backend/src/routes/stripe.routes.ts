import { Router } from "express";
import { handleStripeWebhook } from "../controllers/stripe.controller";

const router = Router();

// Route publique : Stripe appelle cette URL depuis ses propres serveurs pour
// confirmer un paiement. L'authentification se fait par la signature de
// l'en-tête Stripe-Signature, vérifiée dans le contrôleur — pas par un JWT.
//
// Le corps arrive brut (voir express.raw dans app.ts) : la signature porte sur
// les octets exacts émis par Stripe.
router.post("/webhook", handleStripeWebhook);

export default router;
