import { Router } from "express";
import { addPhotoToIssue, createIssue, listIssues, myIssues, updateIssueStatus } from "../controllers/issue.controller";
import { authenticate, requireActiveSubscription, requireRole } from "../middleware/auth";
import { uploadIssuePhoto } from "../middleware/upload";

const router = Router();

// Portail locataire & Ajout de photos
router.get("/mine", authenticate, requireRole("TENANT"), myIssues);
router.post("/", authenticate, requireRole("TENANT"), uploadIssuePhoto.single("photo"), createIssue);
router.post("/:id/photo", authenticate, uploadIssuePhoto.single("photo"), addPhotoToIssue);

// Gestionnaire
router.get("/", authenticate, requireRole("MANAGER"), requireActiveSubscription, listIssues);
router.put("/:id/status", authenticate, requireRole("MANAGER"), requireActiveSubscription, updateIssueStatus);

export default router;
