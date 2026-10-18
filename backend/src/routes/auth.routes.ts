import { Router } from "express";
import {
  deleteMyAccount,
  forgotPassword,
  login,
  loginWithGoogle,
  logout,
  me,
  registerManager,
  resendVerification,
  resetPassword,
  logoutAllDevices,
  updateCurrency,
  verifyEmail,
  verifyTwoFactorLogin,
} from "../controllers/auth.controller";
import {
  confirmTwoFactor,
  disableTwoFactor,
  regenerateBackupCodes,
  setupTwoFactor,
} from "../controllers/twoFactor.controller";
import { authenticate, requireRole } from "../middleware/auth";
import { authEmailLimiter, authIpLimiter, authSecondFacteurLimiter } from "../middleware/rateLimit";

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
// Pas de authEmailLimiter ici : la requête ne porte ni email ni mot de passe
// en clair, seulement le jeton intermédiaire émis par login() (déjà borné à
// 5 minutes) et un code à 6 ou 10 caractères. authIpLimiter borne le volume
// par adresse ; authSecondFacteurLimiter borne les ÉCHECS par compte (lu dans
// le jeton intermédiaire), même répartis sur plusieurs adresses.
router.post("/2fa/verify-login", authIpLimiter, authSecondFacteurLimiter, verifyTwoFactorLogin);
// Pas de authEmailLimiter ici : la requête ne porte pas d'email en clair
// (seulement un jeton Google) — authIpLimiter suffit, comme pour
// verify-email/reset-password ci-dessous.
router.post("/google", authIpLimiter, loginWithGoogle);
router.post("/verify-email", authIpLimiter, verifyEmail);
router.post("/resend-verification", authIpLimiter, authEmailLimiter, resendVerification);
router.post("/forgot-password", authIpLimiter, authEmailLimiter, forgotPassword);
router.post("/reset-password", authIpLimiter, resetPassword);
router.get("/me", authenticate, me);
router.patch("/currency", authenticate, updateCurrency);
// Sans authenticate : voir le commentaire de logout (auth.controller.ts) —
// un cookie déjà expiré ou absent doit pouvoir être "nettoyé" sans 401.
router.post("/logout", logout);
router.post("/logout-all", authenticate, logoutAllDevices);
router.delete("/account", authenticate, requireRole("MANAGER"), deleteMyAccount);

// Double authentification (TOTP) — réservée aux gestionnaires et à l'administrateur
// (voir twoFactor.controller.ts) ; les comptes locataire et propriétaire ne l'ont pas. Ces routes exigent un jeton de session valide
// (authenticate), mais celles qui demandent un code ou le mot de passe à
// nouveau (confirmer, désactiver, régénérer les codes de secours) restent
// brute-forçables avec un jeton volé : elles partagent la limite d'ÉCHECS par
// compte du second facteur.
router.post("/2fa/setup", authenticate, requireRole("MANAGER", "ADMIN"), setupTwoFactor);
router.post("/2fa/confirm", authenticate, requireRole("MANAGER", "ADMIN"), authSecondFacteurLimiter, confirmTwoFactor);
router.post("/2fa/disable", authenticate, requireRole("MANAGER", "ADMIN"), authSecondFacteurLimiter, disableTwoFactor);
router.post("/2fa/backup-codes/regenerate", authenticate, requireRole("MANAGER", "ADMIN"), authSecondFacteurLimiter, regenerateBackupCodes);

export default router;
