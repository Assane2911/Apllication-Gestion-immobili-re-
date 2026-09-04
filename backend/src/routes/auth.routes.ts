import { Router } from "express";
import {
  forgotPassword,
  login,
  me,
  registerManager,
  resetPassword,
  updateCurrency,
} from "../controllers/auth.controller";
import { authenticate } from "../middleware/auth";

const router = Router();

router.post("/register", registerManager);
router.post("/login", login);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.get("/me", authenticate, me);
router.patch("/currency", authenticate, updateCurrency);

export default router;
