import "@testing-library/jest-dom/vitest";
import { demanderToutesLesZones } from "../i18n"; // initialise i18next une fois pour tous les tests (pages/composants traduits)
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Le site charge les textes zone par zone, avec chaque page (voir i18n/index.ts) ; un test affiche une page ou un composant sans
// passer par le routeur : il a besoin de toutes les zones. Que chaque page déclare les siennes est vérifié par i18n/zones.test.ts.
await demanderToutesLesZones();

// jsdom n'implémente pas IntersectionObserver (utilisé par <Reveal> et
// useInView pour les animations d'apparition au scroll) — sans ce stub,
// tout composant qui s'en sert plante au montage avec une ReferenceError.
// Le stub n'appelle jamais son callback : le contenu reste simplement dans
// son état initial (invisible visuellement via une classe CSS), ce qui ne
// gêne pas les tests puisqu'ils interrogent le DOM, pas le rendu visuel.
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = IntersectionObserverStub;

// Chaque test doit repartir d'un DOM propre (React Testing Library) et d'un
// localStorage vide (AuthContext/CurrencyContext y stockent token/user/devise
// — sans ce nettoyage, un test pourrait lire l'état laissé par le précédent).
afterEach(() => {
  cleanup();
  localStorage.clear();
});
