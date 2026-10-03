import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetAnalyticsStateForTests } from "../utils/analytics";
import CookieConsentBanner from "./CookieConsentBanner";

function renderBanner() {
  return render(
    <MemoryRouter initialEntries={["/landing"]}>
      <CookieConsentBanner />
    </MemoryRouter>
  );
}

describe("CookieConsentBanner", () => {
  beforeEach(() => {
    localStorage.clear();
    _resetAnalyticsStateForTests();
    document.head.querySelectorAll("script[src*='googletagmanager']").forEach((el) => el.remove());
    delete window.gtag;
    delete window.dataLayer;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("ne s'affiche jamais tant qu'aucun ID de mesure n'est configuré", () => {
    vi.stubEnv("VITE_GA_MEASUREMENT_ID", "");
    renderBanner();
    expect(screen.queryByText(/Google Analytics/)).not.toBeInTheDocument();
  });

  it("s'affiche quand un ID est configuré et qu'aucun choix n'a encore été fait", () => {
    vi.stubEnv("VITE_GA_MEASUREMENT_ID", "G-TEST123");
    renderBanner();
    expect(screen.getByText(/Google Analytics/)).toBeInTheDocument();
  });

  it("ne réaffiche pas le bandeau si un choix est déjà enregistré", () => {
    vi.stubEnv("VITE_GA_MEASUREMENT_ID", "G-TEST123");
    localStorage.setItem("cookie_consent", "rejected");
    renderBanner();
    expect(screen.queryByText(/Google Analytics/)).not.toBeInTheDocument();
  });

  it("charge Google Analytics et masque le bandeau après acceptation", async () => {
    vi.stubEnv("VITE_GA_MEASUREMENT_ID", "G-TEST123");
    const user = userEvent.setup();
    renderBanner();

    await user.click(screen.getByRole("button", { name: "Accepter" }));

    expect(localStorage.getItem("cookie_consent")).toBe("accepted");
    expect(document.head.querySelector("script[src*='googletagmanager']")).not.toBeNull();
    expect(screen.queryByText(/Google Analytics/)).not.toBeInTheDocument();
  });

  it("n'appelle jamais Google Analytics en cas de refus", async () => {
    vi.stubEnv("VITE_GA_MEASUREMENT_ID", "G-TEST123");
    const user = userEvent.setup();
    renderBanner();

    await user.click(screen.getByRole("button", { name: "Refuser" }));

    expect(localStorage.getItem("cookie_consent")).toBe("rejected");
    expect(document.head.querySelector("script[src*='googletagmanager']")).toBeNull();
  });

  it("recharge Google Analytics silencieusement si le consentement a déjà été accepté lors d'une visite précédente", () => {
    vi.stubEnv("VITE_GA_MEASUREMENT_ID", "G-TEST123");
    localStorage.setItem("cookie_consent", "accepted");

    renderBanner();

    expect(document.head.querySelector("script[src*='googletagmanager']")).not.toBeNull();
    expect(screen.queryByText(/Google Analytics/)).not.toBeInTheDocument();
  });
});
