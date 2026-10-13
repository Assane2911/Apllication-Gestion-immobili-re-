import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expenses } from "../db/schema";
import { createExpense, createManager, createProperty } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { runRecurringExpenseGeneration } from "./recurringExpense.service";
import { budgetTemps } from "../utils/budgetTemps";

describe("runRecurringExpenseGeneration", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 5, 30)); // 30 juin 2026
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function occurrencesDuModele(templateId: string) {
    return testDb
      .select()
      .from(expenses)
      .where(eq(expenses.templateId, templateId))
      .orderBy(expenses.periodIndex);
  }

  it("génère la prochaine occurrence d'un modèle mensuel déjà due", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const modele = await createExpense(property.id, {
      title: "Loyer du local",
      amount: 200,
      recurrence: "MONTHLY",
      expenseDate: new Date(2026, 3, 15), // 15 avril 2026
    });

    const { generees, interrompu } = await runRecurringExpenseGeneration();

    expect(interrompu).toBe(false);
    expect(generees).toBe(2); // mai et juin

    const occurrences = await occurrencesDuModele(modele.id);
    expect(occurrences).toHaveLength(2);
    expect(occurrences[0].periodIndex).toBe(1);
    expect(occurrences[0].expenseDate).toEqual(new Date(2026, 4, 15));
    expect(occurrences[0].amount).toBe(200);
    expect(occurrences[0].title).toBe("Loyer du local");
    expect(occurrences[1].periodIndex).toBe(2);
    expect(occurrences[1].expenseDate).toEqual(new Date(2026, 5, 15));
  });

  it("ne génère rien tant que la prochaine occurrence n'est pas encore due", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const modele = await createExpense(property.id, {
      recurrence: "MONTHLY",
      expenseDate: new Date(2026, 5, 20), // 20 juin 2026, après "aujourd'hui" (1er juin)
    });

    const { generees } = await runRecurringExpenseGeneration();

    expect(generees).toBe(0);
    expect(await occurrencesDuModele(modele.id)).toHaveLength(0);
  });

  it("est idempotent : un second passage ne duplique rien", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const modele = await createExpense(property.id, {
      recurrence: "MONTHLY",
      expenseDate: new Date(2026, 4, 1),
    });

    await runRecurringExpenseGeneration();
    const { generees: secondPassage } = await runRecurringExpenseGeneration();

    expect(secondPassage).toBe(0);
    expect(await occurrencesDuModele(modele.id)).toHaveLength(1);
  });

  it("rattrape plusieurs occurrences manquées (cron resté arrêté plusieurs mois)", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const modele = await createExpense(property.id, {
      recurrence: "MONTHLY",
      expenseDate: new Date(2026, 0, 10), // 10 janvier 2026
    });

    const { generees } = await runRecurringExpenseGeneration();

    // De février à juin inclus = 5 occurrences manquées d'un coup.
    expect(generees).toBe(5);
    const occurrences = await occurrencesDuModele(modele.id);
    expect(occurrences).toHaveLength(5);
    expect(occurrences.map((o: typeof expenses.$inferSelect) => o.periodIndex)).toEqual([1, 2, 3, 4, 5]);
  });

  it("s'arrête à la date de fin de récurrence", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const modele = await createExpense(property.id, {
      recurrence: "MONTHLY",
      expenseDate: new Date(2026, 0, 10),
      recurrenceEndDate: new Date(2026, 3, 1), // fin début avril : seules fév. et mars (le 10) sont dues
    });

    const { generees } = await runRecurringExpenseGeneration();

    expect(generees).toBe(2);
    const occurrences = await occurrencesDuModele(modele.id);
    expect(occurrences.map((o: typeof expenses.$inferSelect) => o.periodIndex)).toEqual([1, 2]);
  });

  it("gère la récurrence ANNUELLE", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const modele = await createExpense(property.id, {
      recurrence: "ANNUAL",
      expenseDate: new Date(2024, 5, 1), // 1er juin 2024
    });

    const { generees } = await runRecurringExpenseGeneration();

    expect(generees).toBe(2); // 2025 et 2026
    const occurrences = await occurrencesDuModele(modele.id);
    expect(occurrences[0].expenseDate).toEqual(new Date(2025, 5, 1));
    expect(occurrences[1].expenseDate).toEqual(new Date(2026, 5, 1));
  });

  it("ignore les dépenses ordinaires (non récurrentes) et les occurrences déjà générées", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    await createExpense(property.id, { recurrence: null, expenseDate: new Date(2026, 0, 1) });
    const modele = await createExpense(property.id, { recurrence: "MONTHLY", expenseDate: new Date(2026, 4, 1) });
    await runRecurringExpenseGeneration();

    // Deuxième passage : seul le modèle doit encore être considéré comme
    // tel — ses propres occurrences générées (templateId renseigné) ne
    // doivent jamais être prises à leur tour pour des modèles.
    const { generees } = await runRecurringExpenseGeneration();

    expect(generees).toBe(0);
    expect(await occurrencesDuModele(modele.id)).toHaveLength(1);
  });

  it("garde le jour du mois d'un modèle du 31 : fin février ne le décale pas au 28 pour toujours", async () => {
    // Chaque date était calculée à partir de la précédente : le 31 janvier donnait le 28 février, puis
    // le 28 mars, le 28 avril... Le jour 31 était perdu après le premier mois court.
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const modele = await createExpense(property.id, { recurrence: "MONTHLY", expenseDate: new Date(2026, 0, 31) });

    await runRecurringExpenseGeneration();

    const dates = (await occurrencesDuModele(modele.id)).map((o: typeof expenses.$inferSelect) => o.expenseDate);
    expect(dates).toEqual([
      new Date(2026, 1, 28),
      new Date(2026, 2, 31),
      new Date(2026, 3, 30),
      new Date(2026, 4, 31),
      new Date(2026, 5, 30),
    ]);
  });

  it("ne régénère pas une occurrence que le gestionnaire a supprimée, même la plus récente", async () => {
    // Le point de reprise était le plus grand numéro d'occurrence EXISTANT : supprimer la dernière
    // occurrence faisait revenir ce numéro en arrière, et le cron suivant la recréait.
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const modele = await createExpense(property.id, { recurrence: "MONTHLY", expenseDate: new Date(2026, 3, 15) });
    await runRecurringExpenseGeneration();
    const avant = await occurrencesDuModele(modele.id);
    expect(avant).toHaveLength(2);

    await testDb.delete(expenses).where(eq(expenses.id, avant[1].id));
    const { generees } = await runRecurringExpenseGeneration();

    expect(generees).toBe(0);
    const apres = await occurrencesDuModele(modele.id);
    expect(apres.map((o: typeof expenses.$inferSelect) => o.periodIndex)).toEqual([1]);
  });

  it("génère malgré tout les occurrences suivantes, une fois leur date venue, après une suppression", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const modele = await createExpense(property.id, { recurrence: "MONTHLY", expenseDate: new Date(2026, 3, 15) });
    await runRecurringExpenseGeneration();
    const [, derniere] = await occurrencesDuModele(modele.id);
    await testDb.delete(expenses).where(eq(expenses.id, derniere.id));

    vi.setSystemTime(new Date(2026, 6, 20)); // 20 juillet
    await runRecurringExpenseGeneration();

    const apres = await occurrencesDuModele(modele.id);
    expect(apres.map((o: typeof expenses.$inferSelect) => o.periodIndex)).toEqual([1, 3]);
    expect(apres[1].expenseDate).toEqual(new Date(2026, 6, 15));
  });

  it("s'interrompt proprement quand le budget de temps est épuisé", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    await createExpense(property.id, { recurrence: "MONTHLY", expenseDate: new Date(2026, 4, 1) });

    const budgetEpuise = { epuise: () => true, restant: () => 0 };
    const { generees, interrompu } = await runRecurringExpenseGeneration(budgetEpuise);

    expect(interrompu).toBe(true);
    expect(generees).toBe(0);
  });

  it("budgetTemps réel : ne s'interrompt pas tant que le temps n'est pas écoulé", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const modele = await createExpense(property.id, { recurrence: "MONTHLY", expenseDate: new Date(2026, 4, 1) });

    const { generees, interrompu } = await runRecurringExpenseGeneration(budgetTemps(60_000));

    expect(interrompu).toBe(false);
    expect(generees).toBe(1);
    expect(await occurrencesDuModele(modele.id)).toHaveLength(1);
  });
});
