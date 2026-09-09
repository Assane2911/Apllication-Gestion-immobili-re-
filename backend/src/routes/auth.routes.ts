import { Router } from "express";
import {
  forgotPassword,
  login,
  me,
  registerManager,
  resendVerification,
  resetPassword,
  updateCurrency,
  verifyEmail,
} from "../controllers/auth.controller";
import { authenticate } from "../middleware/auth";
import { authEmailLimiter, authIpLimiter } from "../middleware/rateLimit";

const router = Router();

// Aucune de ces routes n'avait de limite de fréquence : /login, /forgot-password
// et /resend-verification étaient brute-forçables sans aucune contrainte, et
// /register/verify-email/reset-password pouvaient être spammées à volonté.
// authIpLimiter borne le volume par adresse IP ; authEmailLimiter borne en plus
// les tentatives ciblant un email précis (register/login/resend-verification/
// forgot-password, qui reçoivent un email en clair) même réparties sur
// plusieurs IP — verify-email/reset-password n'identifient que par token, donc
// seule la limite par IP s'y applique.
router.post("/register", authIpLimiter, authEmailLimiter, registerManager);
router.post("/login", authIpLimiter, authEmailLimiter, login);
router.post("/verify-email", authIpLimiter, verifyEmail);
router.post("/resend-verification", authIpLimiter, authEmailLimiter, resendVerification);
router.post("/forgot-password", authIpLimiter, authEmailLimiter, forgotPassword);
router.post("/reset-password", authIpLimiter, resetPassword);
router.get("/me", authenticate, me);
router.patch("/currency", authenticate, updateCurrency);

export default router;
