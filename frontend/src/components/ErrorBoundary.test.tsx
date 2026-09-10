import * as Sentry from "@sentry/react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ErrorBoundary from "./ErrorBoundary";

vi.mock("@sentry/react", () => ({
  captureException: vi.fn(),
}));

function Bomb(): never {
  throw new Error("boom");
}

describe("ErrorBoundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // React logue l'erreur interceptée sur console.error (comportement normal
    // d'un error boundary) — on l'étouffe pour ne pas polluer la sortie du test.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("affiche normalement ses enfants tant qu'aucune erreur ne survient", () => {
    render(
      <ErrorBoundary>
        <p>Contenu normal</p>
      </ErrorBoundary>
    );

    expect(screen.getByText("Contenu normal")).toBeInTheDocument();
  });

  it("affiche un message de secours et remonte l'erreur à Sentry si un enfant plante au rendu", () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );

    expect(screen.getByText("Une erreur est survenue")).toBeInTheDocument();
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), expect.anything());
  });

  it("le bouton recharge la page", async () => {
    const reloadSpy = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, reload: reloadSpy },
      writable: true,
    });

    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );

    await userEvent.setup().click(screen.getByRole("button", { name: "Recharger la page" }));
    expect(reloadSpy).toHaveBeenCalled();
  });
});
