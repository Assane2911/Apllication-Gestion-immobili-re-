import { Router } from "express";
import {
  createStoredDocument,
  deleteStoredDocument,
  getStoredDocumentLink,
  listStoredDocuments,
  updateStoredDocument,
} from "../controllers/storedDocument.controller";
import { authenticate, requireActiveSubscription, requireRole } from "../middleware/auth";
import { uploadStoredDocument } from "../middleware/upload";

const router = Router();

router.use(authenticate, requireRole("MANAGER"), requireActiveSubscription);

router.get("/", listStoredDocuments);
router.post("/", uploadStoredDocument.single("file"), createStoredDocument);
router.get("/:id/link", getStoredDocumentLink);
router.put("/:id", updateStoredDocument);
router.delete("/:id", deleteStoredDocument);

export default router;
