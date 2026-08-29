import { Router } from "express";
import {
  cancelInvoice,
  listInvoices,
  markInvoicePaid,
  myInvoices,
  payInvoice,
} from "../controllers/invoice.controller";
import { authenticate, requireRole } from "../middleware/auth";

const router = Router();

// Portail locataire
router.get("/mine", authenticate, requireRole("TENANT"), myInvoices);
router.post("/:id/pay", authenticate, requireRole("TENANT"), payInvoice);

// Gestionnaire
router.get("/", authenticate, requireRole("MANAGER"), listInvoices);
router.post("/:id/mark-paid", authenticate, requireRole("MANAGER"), markInvoicePaid);
router.post("/:id/cancel", authenticate, requireRole("MANAGER"), cancelInvoice);

export default router;
