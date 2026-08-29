import { Router } from "express";
import {
  createExpense,
  deleteExpense,
  getFinancialSummary,
  listExpenses,
} from "../controllers/expense.controller";
import { authenticate, requireActiveSubscription, requireRole } from "../middleware/auth";

const router = Router();

router.use(authenticate, requireRole("MANAGER"), requireActiveSubscription);

router.get("/", listExpenses);
router.get("/summary", getFinancialSummary);
router.post("/", createExpense);
router.delete("/:id", deleteExpense);

export default router;
