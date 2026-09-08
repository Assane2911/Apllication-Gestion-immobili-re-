import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Chaque test doit repartir d'un DOM propre (React Testing Library) et d'un
// localStorage vide (AuthContext/CurrencyContext y stockent token/user/devise
// — sans ce nettoyage, un test pourrait lire l'état laissé par le précédent).
afterEach(() => {
  cleanup();
  localStorage.clear();
});
