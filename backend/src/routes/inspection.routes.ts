import { Router } from "express";
import {
  createInspection,
  deleteInspection,
  getInspection,
  listInspections,
  myInspections,
  signInspection,
  updateInspection,
} from "../controllers/inspection.controller";
import { authenticate, requireActiveSubscription, requireRole } from "../middleware/auth";

const router = Router();

router.get("/mine", authenticate, requireRole("TENANT"), myInspections);
router.post("/:id/sign", authenticate, signInspection);

router.use(authenticate, requireRole("MANAGER"), requireActiveSubscription);
router.get("/", listInspections);
router.get("/:id", getInspection);
router.post("/", createInspection);
router.put("/:id", updateInspection);
router.delete("/:id", deleteInspection);

export default router;
