import { Router } from "express";
import { login, me, registerManager } from "../controllers/auth.controller";
import { authenticate } from "../middleware/auth";

const router = Router();

router.post("/register", registerManager);
router.post("/login", login);
router.get("/me", authenticate, me);

export default router;
