import { Router } from "express";
import { createIssue, listIssues, myIssues, updateIssueStatus } from "../controllers/issue.controller";
import { authenticate, requireRole } from "../middleware/auth";
import { uploadIssuePhoto } from "../middleware/upload";

const router = Router();

// Portail locataire
router.get("/mine", authenticate, requireRole("TENANT"), myIssues);
router.post("/", authenticate, requireRole("TENANT"), uploadIssuePhoto.single("photo"), createIssue);

// Gestionnaire
router.get("/", authenticate, requireRole("MANAGER"), listIssues);
router.put("/:id/status", authenticate, requireRole("MANAGER"), updateIssueStatus);

export default router;
