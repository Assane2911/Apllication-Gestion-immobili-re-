import { Router } from "express";
import { login, me, registerManager, updateCurrency } from "../controllers/auth.controller";
import { authenticate } from "../middleware/auth";

const router = Router();

router.post("/register", registerManager);
router.post("/login", login);
router.get("/me", authenticate, me);
router.patch("/currency", authenticate, updateCurrency);

export default router;
