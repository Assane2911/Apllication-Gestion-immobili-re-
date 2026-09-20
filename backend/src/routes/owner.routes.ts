import { Router } from "express";
import {
  createOwner,
  deleteOwner,
  getOwner,
  inviteOwnerPortalAccount,
  listOwners,
  updateOwner,
} from "../controllers/owner.controller";
import { authenticate, requireActiveSubscription, requireRole } from "../middleware/auth";

const router = Router();

router.use(authenticate, requireRole("MANAGER"), requireActiveSubscription);

router.get("/", listOwners);
router.get("/:id", getOwner);
router.post("/", createOwner);
router.put("/:id", updateOwner);
router.delete("/:id", deleteOwner);
router.post("/:id/invite", inviteOwnerPortalAccount);

export default router;
