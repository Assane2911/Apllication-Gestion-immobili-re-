import { render, screen, waitFor } from "@testing-library/react";
import { Component, Suspense, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { lazyWithReload } from "./lazyWithReload";

const RELOAD_FLAG_KEY = "chunk_load_reload_attempted";

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
    expect(sessionStorage.getItem(RELOAD_FLAG_KEY)).toBe("1");
    expect(onError).not.toHaveBeenCalled();
  });

  it("propage l'erreur normalement si un deuxième chunk échoue dans la même session", async () => {
    sessionStorage.setItem(RELOAD_FLAG_KEY, "1");
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
});
