import { Router } from "express";
import {
  createInsurancePolicy,
  deleteInsurancePolicy,
  listInsurancePolicies,
  updateInsurancePolicy,
} from "../controllers/insurance.controller";
import { authenticate, requireActiveSubscription, requireRole } from "../middleware/auth";

const router = Router();

router.use(authenticate, requireRole("MANAGER"), requireActiveSubscription);

router.get("/", listInsurancePolicies);
router.post("/", createInsurancePolicy);
router.put("/:id", updateInsurancePolicy);
router.delete("/:id", deleteInsurancePolicy);

export default router;
