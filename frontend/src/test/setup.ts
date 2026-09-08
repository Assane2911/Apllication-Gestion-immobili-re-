import "@testing-library/jest-dom/vitest";
import "../i18n"; // initialise i18next une fois pour tous les tests (pages/composants traduits)
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Chaque test doit repartir d'un DOM propre (React Testing Library) et d'un
// localStorage vide (AuthContext/CurrencyContext y stockent token/user/devise
// — sans ce nettoyage, un test pourrait lire l'état laissé par le précédent).
afterEach(() => {
  cleanup();
  localStorage.clear();
});
