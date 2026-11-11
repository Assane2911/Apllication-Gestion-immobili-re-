import { Router } from "express";
import {
  compareInspection,
  compareMyInspection,
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
router.get("/mine/:id/comparison", authenticate, requireRole("TENANT"), compareMyInspection);
router.post("/:id/sign", authenticate, signInspection);

router.use(authenticate, requireRole("MANAGER"), requireActiveSubscription);
router.get("/", listInspections);
router.get("/:id", getInspection);
router.get("/:id/comparison", compareInspection);
router.post("/", createInspection);
router.put("/:id", updateInspection);
router.delete("/:id", deleteInspection);

export default router;
