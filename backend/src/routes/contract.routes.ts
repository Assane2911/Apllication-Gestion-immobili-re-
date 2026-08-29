import { Router } from "express";
import {
  createContract,
  deleteContract,
  getContract,
  listContracts,
  myContracts,
  renewContract,
  signContract,
  updateContract,
} from "../controllers/contract.controller";
import { authenticate, requireActiveSubscription, requireRole } from "../middleware/auth";

const router = Router();

router.get("/mine", authenticate, requireRole("TENANT"), myContracts);
router.post("/:id/sign", authenticate, signContract);

router.use(authenticate, requireRole("MANAGER"), requireActiveSubscription);
router.get("/", listContracts);
router.get("/:id", getContract);
router.post("/", createContract);
router.post("/:id/renew", renewContract);
router.put("/:id", updateContract);
router.delete("/:id", deleteContract);

export default router;
