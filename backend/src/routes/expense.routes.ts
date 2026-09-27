import { Router } from "express";
import {
  createExpense,
  deleteExpense,
  exportFinancialReport,
  getFinancialSummary,
  listExpenses,
} from "../controllers/expense.controller";
import { authenticate, requireActiveSubscription, requirePlan, requireRole } from "../middleware/auth";

const router = Router();

// Suivi des dépenses & rentabilité : fonctionnalité Pro (voir CGU §3 /
// page tarifs) — jamais vérifié jusqu'ici, comme pour maxPropertiesForPlan.
router.use(authenticate, requireRole("MANAGER"), requireActiveSubscription, requirePlan("PRO"));

router.get("/", listExpenses);
router.get("/summary", getFinancialSummary);
// Export comptable : réservé à Entreprise (CGU §3), au-delà du suivi des
// dépenses lui-même (Pro, voir le requirePlan("PRO") du router.use ci-dessus).
router.get("/export", requirePlan("ENTERPRISE"), exportFinancialReport);
router.post("/", createExpense);
router.delete("/:id", deleteExpense);

export default router;
