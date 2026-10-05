import { Router } from "express";
import { createVendor, deleteVendor, listVendors, updateVendor } from "../controllers/vendor.controller";
import { authenticate, requireActiveSubscription, requireRole } from "../middleware/auth";

const router = Router();

router.use(authenticate, requireRole("MANAGER"), requireActiveSubscription);

router.get("/", listVendors);
router.post("/", createVendor);
router.put("/:id", updateVendor);
router.delete("/:id", deleteVendor);

export default router;
