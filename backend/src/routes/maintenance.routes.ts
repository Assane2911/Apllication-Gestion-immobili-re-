import { Router } from "express";
import { etatMaintenance } from "../controllers/maintenance.controller";

const router = Router();

// Public par conception : l'application s'en sert avant toute connexion (voir routesOuvertes.test.ts).
router.get("/", etatMaintenance);

export default router;
