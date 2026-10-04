import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetAnalyticsStateForTests } from "../utils/analytics";
import { _resetLinkedInStateForTests } from "../utils/linkedinInsight";
import { _resetMetaPixelStateForTests } from "../utils/metaPixel";
import CookieConsentBanner from "./CookieConsentBanner";

function renderBanner() {
  return render(
    <MemoryRouter initialEntries={["/landing"]}>
      <CookieConsentBanner />
    </MemoryRouter>
  );
}

function nettoyerScriptsTraceurs() {
  document.head.querySelectorAll("script[src*='googletagmanager'], script[src*='fbevents'], script[src*='licdn']").forEach((el) => el.remove());
  delete window.gtag;
  delete window.dataLayer;
  delete window.fbq;
  delete window._fbq;
  delete window.lintrk;
  delete window._linkedin_partner_id;
  delete window._linkedin_data_partner_ids;
}

describe("CookieConsentBanner", () => {
  beforeEach(() => {
    localStorage.clear();
    _resetAnalyticsStateForTests();
    _resetMetaPixelStateForTests();
    _resetLinkedInStateForTests();
    nettoyerScriptsTraceurs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("ne s'affiche jamais si aucun des trois traceurs n'est configuré", () => {
    vi.stubEnv("VITE_GA_MEASUREMENT_ID", "");
    vi.stubEnv("VITE_META_PIXEL_ID", "");
    vi.stubEnv("VITE_LINKEDIN_PARTNER_ID", "");
    renderBanner();
    expect(screen.queryByText(/Google Analytics/)).not.toBeInTheDocument();
  });

  it("s'affiche dès qu'un seul des trois traceurs est configuré", () => {
    vi.stubEnv("VITE_GA_MEASUREMENT_ID", "");
    vi.stubEnv("VITE_META_PIXEL_ID", "123456789");
    vi.stubEnv("VITE_LINKEDIN_PARTNER_ID", "");
    renderBanner();
    expect(screen.getByText(/Google Analytics/)).toBeInTheDocument();
  });

  it("ne réaffiche pas le bandeau si un choix est déjà enregistré", () => {
    vi.stubEnv("VITE_GA_MEASUREMENT_ID", "G-TEST123");
    localStorage.setItem("cookie_consent", "rejected");
    renderBanner();
    expect(screen.queryByText(/Google Analytics/)).not.toBeInTheDocument();
  });

  it("charge les trois traceurs configurés et masque le bandeau après acceptation", async () => {
    vi.stubEnv("VITE_GA_MEASUREMENT_ID", "G-TEST123");
    vi.stubEnv("VITE_META_PIXEL_ID", "123456789");
    vi.stubEnv("VITE_LINKEDIN_PARTNER_ID", "1234567");
    const user = userEvent.setup();
    renderBanner();

    await user.click(screen.getByRole("button", { name: "Accepter" }));

    expect(localStorage.getItem("cookie_consent")).toBe("accepted");
    expect(document.head.querySelector("script[src*='googletagmanager']")).not.toBeNull();
    expect(document.head.querySelector("script[src*='fbevents']")).not.toBeNull();
    expect(document.head.querySelector("script[src*='licdn']")).not.toBeNull();
    expect(screen.queryByText(/Google Analytics/)).not.toBeInTheDocument();
  });

  it("n'appelle aucun des trois traceurs en cas de refus", async () => {
    vi.stubEnv("VITE_GA_MEASUREMENT_ID", "G-TEST123");
    vi.stubEnv("VITE_META_PIXEL_ID", "123456789");
    vi.stubEnv("VITE_LINKEDIN_PARTNER_ID", "1234567");
    const user = userEvent.setup();
    renderBanner();

    await user.click(screen.getByRole("button", { name: "Refuser" }));

    expect(localStorage.getItem("cookie_consent")).toBe("rejected");
    expect(document.head.querySelector("script[src*='googletagmanager']")).toBeNull();
    expect(document.head.querySelector("script[src*='fbevents']")).toBeNull();
    expect(document.head.querySelector("script[src*='licdn']")).toBeNull();
  });

  it("recharge les traceurs silencieusement si le consentement a déjà été accepté lors d'une visite précédente", () => {
    vi.stubEnv("VITE_GA_MEASUREMENT_ID", "G-TEST123");
    vi.stubEnv("VITE_META_PIXEL_ID", "123456789");
    vi.stubEnv("VITE_LINKEDIN_PARTNER_ID", "1234567");
    localStorage.setItem("cookie_consent", "accepted");

    renderBanner();

    expect(document.head.querySelector("script[src*='googletagmanager']")).not.toBeNull();
    expect(document.head.querySelector("script[src*='fbevents']")).not.toBeNull();
    expect(document.head.querySelector("script[src*='licdn']")).not.toBeNull();
    expect(screen.queryByText(/Google Analytics/)).not.toBeInTheDocument();
  });
});
