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

describe("ErrorBoundary — langue", () => {
  it("affiche son message de secours dans la langue de l'interface", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { changerLangue } = await import("../i18n");
    await changerLangue("en");
    try {
      render(
        <ErrorBoundary>
          <Bomb />
        </ErrorBoundary>
      );
      expect(screen.getByText("Something went wrong")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Reload the page" })).toBeInTheDocument();
    } finally {
      await changerLangue("fr");
    }
  });

  describe("fichier de l'application disparu après un déploiement", () => {
    const recharger = vi.fn();

    function FichierDisparu(): never {
      throw new TypeError("Failed to fetch dynamically imported module: https://www.immoplatformpro.com/assets/LoginPage-CTQ4Vm4-.js");
    }

    beforeEach(() => {
      sessionStorage.clear();
      recharger.mockReset();
      Object.defineProperty(window, "location", { value: { ...window.location, reload: recharger }, writable: true });
    });

    it("recharge la page d'elle-même, sans le signaler à Sentry", () => {
      render(
        <ErrorBoundary>
          <FichierDisparu />
        </ErrorBoundary>
      );

      expect(recharger).toHaveBeenCalledTimes(1);
      expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it("n'insiste pas : si on vient de recharger, affiche le message de secours et signale l'erreur", () => {
      sessionStorage.setItem("rechargement-apres-deploiement", String(Date.now()));

      render(
        <ErrorBoundary>
          <FichierDisparu />
        </ErrorBoundary>
      );

      expect(recharger).not.toHaveBeenCalled();
      expect(screen.getByText("Une erreur est survenue")).toBeInTheDocument();
      expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    });

    it("ne recharge pas pour une erreur ordinaire", () => {
      render(
        <ErrorBoundary>
          <Bomb />
        </ErrorBoundary>
      );

      expect(recharger).not.toHaveBeenCalled();
    });
  });
});
