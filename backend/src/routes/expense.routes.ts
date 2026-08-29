import { Router } from "express";
import {
  createExpense,
  deleteExpense,
  exportFinancialReport,
  getFinancialSummary,
  listExpenses,
} from "../controllers/expense.controller";
import { authenticate, requireActiveSubscription, requireRole } from "../middleware/auth";

const router = Router();

router.use(authenticate, requireRole("MANAGER"), requireActiveSubscription);

router.get("/", listExpenses);
router.get("/summary", getFinancialSummary);
router.get("/export", exportFinancialReport);
router.post("/", createExpense);
router.delete("/:id", deleteExpense);

export default router;
