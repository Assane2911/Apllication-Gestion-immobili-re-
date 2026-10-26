import * as Sentry from "@sentry/react";
import { act, render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ErrorBoundary from "../components/ErrorBoundary";
import { lazyWithReload } from "./lazyWithReload";
import { installerRechargementAutomatique, rechargerUneFois, reinitialiserRechargementPourTests } from "./rechargementApresDeploiement";

vi.mock("@sentry/react", () => ({ captureException: vi.fn() }));

/**
 * Production (Sentry, IMMOPLATFORM-PRO-BACKEND-E) : « Cannot read properties of undefined (reading 'default') » sur
 * /login, après un déploiement. Quand un fichier d'un module chargé à la demande a disparu, Vite émet
 * `vite:preloadError` ; notre écouteur recharge la page et appelle `preventDefault()`. Dans ce cas Vite ne relève plus
 * l'erreur : l'`import()` se résout avec `undefined`. React lisait alors `.default` de `undefined`, l'erreur arrivait à
 * la barrière d'erreurs (écran « Une erreur est survenue » le temps du rechargement) et était envoyée à Sentry comme
 * un défaut de l'application. Ce n'est pas un bug à remonter : la page est déjà en train de se recharger.
 */
describe("lazyWithReload — module absent pendant un rechargement", () => {
  const recharger = vi.fn();
  let erreurConsole: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sessionStorage.clear();
    reinitialiserRechargementPourTests();
    recharger.mockReset();
    vi.mocked(Sentry.captureException).mockClear();
    Object.defineProperty(window, "location", { value: { ...window.location, reload: recharger }, writable: true });
    erreurConsole = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => erreurConsole.mockRestore());

  const Page = () => <p>Page chargée</p>;
  const rendre = (factory: () => Promise<{ default: typeof Page }>) => {
    const Paresseuse = lazyWithReload(factory);
    return render(
      <ErrorBoundary>
        <Suspense fallback={<p>Chargement…</p>}>
          <Paresseuse />
        </Suspense>
      </ErrorBoundary>
    );
  };
  const attendre = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

  it("charge la page normalement quand le module est là", async () => {
    rendre(() => Promise.resolve({ default: Page }));
    await attendre();
    expect(screen.getByText("Page chargée")).toBeInTheDocument();
  });

  it("reste en attente du rechargement, sans écran d'erreur ni signalement à Sentry, quand l'import se résout sans module", async () => {
    installerRechargementAutomatique();
    // Ce que fait Vite : l'échec du préchargement est signalé, l'écouteur le « consomme » (preventDefault) et recharge ;
    // l'`import()` se résout alors avec `undefined`.
    const factory = () => {
      window.dispatchEvent(Object.assign(new Event("vite:preloadError", { cancelable: true }), { payload: new Error("Failed to fetch dynamically imported module") }));
      return Promise.resolve(undefined as unknown as { default: typeof Page });
    };

    rendre(factory);
    await attendre();

    expect(recharger).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/erreur|error/i)).not.toBeInTheDocument();
    expect(screen.getByText("Chargement…")).toBeInTheDocument();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("une erreur ordinaire de chargement, sans rechargement en cours, suit son cours jusqu'à l'écran d'erreur et à Sentry", async () => {
    rechargerUneFois(Date.now() - 1_000); // déjà rechargé il y a une seconde, puis page rechargée : garde-fou actif…
    reinitialiserRechargementPourTests(); // …mais cette page-ci n'a rien lancé
    rendre(() => Promise.reject(new Error("boom")));
    await attendre();
    expect(screen.queryByText("Page chargée")).not.toBeInTheDocument();
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });
});
