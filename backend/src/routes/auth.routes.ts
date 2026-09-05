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

const router = Router();

router.post("/register", registerManager);
router.post("/login", login);
router.post("/verify-email", verifyEmail);
router.post("/resend-verification", resendVerification);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.get("/me", authenticate, me);
router.patch("/currency", authenticate, updateCurrency);

export default router;
