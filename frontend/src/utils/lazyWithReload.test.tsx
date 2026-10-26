import { act, render, screen, waitFor } from "@testing-library/react";
import { Component, Suspense, type ComponentType, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { lazyWithReload } from "./lazyWithReload";
import { installerRechargementAutomatique, reinitialiserRechargementPourTests } from "./rechargementApresDeploiement";

// Le garde-fou est partagé avec l'événement de Vite et le filet d'erreurs (rechargementApresDeploiement.ts).
const RELOAD_FLAG_KEY = "rechargement-apres-deploiement";

/** Petit error boundary de test : capture l'erreur au lieu de laisser vitest la faire remonter. */
class ErrorCatcher extends Component<{ children: ReactNode; onError: (err: unknown) => void }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: unknown) {
    this.props.onError(error);
  }
  render() {
    if (this.state.hasError) return "Erreur";
    return this.props.children;
  }
}

describe("lazyWithReload", () => {
  beforeEach(() => {
    sessionStorage.clear();
    reinitialiserRechargementPourTests();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("affiche le composant normalement quand l'import réussit, sans recharger", async () => {
    const reloadSpy = vi.fn();
    Object.defineProperty(window, "location", { value: { ...window.location, reload: reloadSpy }, writable: true });

    const Composant = lazyWithReload(async () => ({ default: () => <div>Bonjour</div> }));

    render(
      <Suspense fallback="Chargement...">
        <Composant />
      </Suspense>
    );

    await waitFor(() => expect(screen.getByText("Bonjour")).toBeInTheDocument());
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(RELOAD_FLAG_KEY)).toBeNull();
  });

  it("recharge la page une fois si l'import échoue, sans propager l'erreur à l'ErrorBoundary", async () => {
    const reloadSpy = vi.fn();
    Object.defineProperty(window, "location", { value: { ...window.location, reload: reloadSpy }, writable: true });
    const onError = vi.fn();

    const Composant = lazyWithReload(async () => {
      throw new Error("Failed to fetch dynamically imported module");
    });

    render(
      <ErrorCatcher onError={onError}>
        <Suspense fallback="Chargement...">
          <Composant />
        </Suspense>
      </ErrorCatcher>
    );

    await waitFor(() => expect(reloadSpy).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem(RELOAD_FLAG_KEY)).not.toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  it("propage l'erreur normalement si la page vient déjà d'être rechargée (moins d'une minute)", async () => {
    sessionStorage.setItem(RELOAD_FLAG_KEY, String(Date.now()));
    const reloadSpy = vi.fn();
    Object.defineProperty(window, "location", { value: { ...window.location, reload: reloadSpy }, writable: true });
    const onError = vi.fn();

    const Composant = lazyWithReload(async () => {
      throw new Error("Failed to fetch dynamically imported module");
    });

    render(
      <ErrorCatcher onError={onError}>
        <Suspense fallback="Chargement...">
          <Composant />
        </Suspense>
      </ErrorCatcher>
    );

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it("ne recharge qu'UNE fois quand Vite signale d'abord le fichier manquant, puis que l'import échoue", async () => {
    // Vite émet `vite:preloadError`, puis l'import() lui-même échoue : deux mécanismes, un seul rechargement, et
    // aucune erreur affichée le temps que la page se remplace.
    const reloadSpy = vi.fn();
    Object.defineProperty(window, "location", { value: { ...window.location, reload: reloadSpy }, writable: true });
    installerRechargementAutomatique();
    const onError = vi.fn();

    const Composant = lazyWithReload(async () => {
      window.dispatchEvent(new Event("vite:preloadError", { cancelable: true }));
      throw new Error("Failed to fetch dynamically imported module");
    });

    render(
      <ErrorCatcher onError={onError}>
        <Suspense fallback="Chargement...">
          <Composant />
        </Suspense>
      </ErrorCatcher>
    );

    await waitFor(() => expect(reloadSpy).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("un échec sans rapport avec un déploiement (ici une erreur de chargement quelconque) recharge aussi, une fois, comme avant", async () => {
    const reloadSpy = vi.fn();
    Object.defineProperty(window, "location", { value: { ...window.location, reload: reloadSpy }, writable: true });
    const Composant = lazyWithReload(async () => {
      throw new Error("Network error");
    });

    render(
      <ErrorCatcher onError={vi.fn()}>
        <Suspense fallback="Chargement...">
          <Composant />
        </Suspense>
      </ErrorCatcher>
    );

    await waitFor(() => expect(reloadSpy).toHaveBeenCalledTimes(1));
  });

  /**
   * Production (Sentry, IMMOPLATFORM-PRO-BACKEND-E) : « Cannot read properties of undefined (reading 'default') » sur
   * /login après un déploiement. Quand l'écouteur de `vite:preloadError` appelle `preventDefault()` (notre rechargement
   * automatique), Vite ne relève plus l'échec : l'`import()` se résout avec `undefined`. React lisait `.default` dessus,
   * la barrière d'erreurs affichait « Une erreur est survenue » et Sentry recevait un défaut — alors que la page est
   * déjà en train de se recharger.
   */
  it("reste en attente, sans erreur, quand l'import se résout avec undefined pendant le rechargement (preventDefault de Vite)", async () => {
    const reloadSpy = vi.fn();
    Object.defineProperty(window, "location", { value: { ...window.location, reload: reloadSpy }, writable: true });
    installerRechargementAutomatique();
    const onError = vi.fn();

    const Composant = lazyWithReload(async () => {
      window.dispatchEvent(new Event("vite:preloadError", { cancelable: true }));
      return undefined as unknown as { default: ComponentType };
    });

    render(
      <ErrorCatcher onError={onError}>
        <Suspense fallback="Chargement...">
          <Composant />
        </Suspense>
      </ErrorCatcher>
    );

    await waitFor(() => expect(reloadSpy).toHaveBeenCalledTimes(1));
    // Dans `act` : sans cela React ne refait pas le rendu de la page paresseuse.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(onError).not.toHaveBeenCalled();
    expect(screen.getByText("Chargement...")).toBeInTheDocument();
    // En développement, React signale ce défaut par un message de console (« Expected the result of a dynamic import() »)
    // au lieu de lever l'exception de la production : c'est ce signal que l'on surveille ici.
    const modulesAbsents = vi.mocked(console.error).mock.calls.filter((appel) => String(appel[0]).includes("Expected the result of a dynamic import()"));
    expect(modulesAbsents).toHaveLength(0);
  });

  it("un module absent SANS rechargement en cours reste une erreur : rien n'est masqué", async () => {
    const onError = vi.fn();
    const Composant = lazyWithReload(async () => undefined as unknown as { default: ComponentType });

    render(
      <ErrorCatcher onError={onError}>
        <Suspense fallback="Chargement...">
          <Composant />
        </Suspense>
      </ErrorCatcher>
    );

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
  });
});
