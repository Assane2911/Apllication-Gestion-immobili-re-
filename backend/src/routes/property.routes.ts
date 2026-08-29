import { Router } from "express";
import {
  createProperty,
  deleteProperty,
  getProperty,
  listProperties,
  updateProperty,
} from "../controllers/property.controller";
import { authenticate, requireActiveSubscription, requireRole } from "../middleware/auth";
import { uploadPropertyImage } from "../middleware/upload";

const router = Router();

router.use(authenticate, requireRole("MANAGER"), requireActiveSubscription);

router.get("/", listProperties);
router.get("/:id", getProperty);
router.post("/", uploadPropertyImage.single("image"), createProperty);
router.put("/:id", uploadPropertyImage.single("image"), updateProperty);
router.delete("/:id", deleteProperty);

export default router;
