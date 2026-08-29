import { Router } from "express";
import {
  cancelInvoice,
  listInvoices,
  markInvoicePaid,
  myInvoices,
  payInvoice,
  sendInvoiceReminder,
  sendMonthlyReminders,
} from "../controllers/invoice.controller";
import { authenticate, requireActiveSubscription, requireRole } from "../middleware/auth";

const router = Router();

// Portail locataire (toujours accessible)
router.get("/mine", authenticate, requireRole("TENANT"), myInvoices);
router.post("/:id/pay", authenticate, requireRole("TENANT"), payInvoice);

// Espace Gestionnaire (nécessite essai ou abonnement actif)
router.use(authenticate, requireRole("MANAGER"), requireActiveSubscription);
router.get("/", listInvoices);
router.post("/send-monthly-reminders", sendMonthlyReminders);
router.post("/:id/send-reminder", sendInvoiceReminder);
router.post("/:id/mark-paid", markInvoicePaid);
router.post("/:id/cancel", cancelInvoice);

export default router;
