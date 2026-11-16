import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetAnalyticsStateForTests } from "../utils/analytics";
import { _resetLinkedInStateForTests } from "../utils/linkedinInsight";
import { _resetMetaPixelStateForTests } from "../utils/metaPixel";
import CookieConsentBanner from "./CookieConsentBanner";
import LienGererCookies from "./LienGererCookies";

function renderBanner(chemin = "/landing") {
  // MemoryRouter ne touche pas à l'adresse du navigateur, que les traceurs lisent au chargement : on les aligne.
  window.history.pushState({}, "", chemin);
  return render(
    <MemoryRouter initialEntries={[chemin]}>
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

  it("sur une page de l'application : GA4 et Meta coupés, LinkedIn non chargé", () => {
    vi.stubEnv("VITE_GA_MEASUREMENT_ID", "G-TEST123");
    vi.stubEnv("VITE_META_PIXEL_ID", "123456789");
    vi.stubEnv("VITE_LINKEDIN_PARTNER_ID", "1234567");
    localStorage.setItem("cookie_consent", "accepted");

    renderBanner("/dashboard");

    expect((window as unknown as Record<string, unknown>)["ga-disable-G-TEST123"]).toBe(true);
    expect(window.fbq!.queue!.filter((a) => (a as unknown[])[0] === "track")).toEqual([]);
    expect(window.fbq!.queue![window.fbq!.queue!.length - 1]).toEqual(["consent", "revoke"]);
    expect(document.head.querySelector("script[src*='licdn']")).toBeNull();
  });

  describe("changer d'avis et robustesse", () => {
    const TOUS = () => {
      vi.stubEnv("VITE_GA_MEASUREMENT_ID", "G-TEST123");
      vi.stubEnv("VITE_META_PIXEL_ID", "123456789");
      vi.stubEnv("VITE_LINKEDIN_PARTNER_ID", "1234567");
    };

    it("ne plante pas quand le stockage du navigateur est interdit : le bandeau se montre simplement", () => {
      TOUS();
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("SecurityError");
      });
      renderBanner();
      expect(screen.getByRole("button", { name: "Accepter" })).toBeInTheDocument();
      vi.restoreAllMocks();
    });

    it("un refus ancien de plus de 6 mois est redemandé", () => {
      TOUS();
      localStorage.setItem("cookie_consent", "rejected");
      localStorage.setItem("cookie_consent_date", String(Date.now() - 200 * 86_400_000));
      renderBanner();
      expect(screen.getByRole("button", { name: "Accepter" })).toBeInTheDocument();
    });

    it("« Gérer mes cookies » rouvre le bandeau même si un choix est enregistré, et un accord après un refus charge les traceurs", async () => {
      TOUS();
      const user = userEvent.setup();
      localStorage.setItem("cookie_consent", "rejected");
      render(
        <MemoryRouter initialEntries={["/landing"]}>
          <CookieConsentBanner />
          <LienGererCookies />
        </MemoryRouter>
      );
      expect(screen.queryByRole("button", { name: "Accepter" })).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Gérer mes cookies" }));
      await user.click(screen.getByRole("button", { name: "Accepter" }));

      expect(localStorage.getItem("cookie_consent")).toBe("accepted");
      expect(document.head.querySelector("script[src*='googletagmanager']")).not.toBeNull();
    });

    it("retirer un accord efface les cookies de traceurs et recharge la page", async () => {
      TOUS();
      const user = userEvent.setup();
      const recharger = vi.fn();
      Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, reload: recharger } });
      document.cookie = "_ga=GA1.1.1; path=/";
      localStorage.setItem("cookie_consent", "accepted");
      render(
        <MemoryRouter initialEntries={["/landing"]}>
          <CookieConsentBanner />
          <LienGererCookies />
        </MemoryRouter>
      );

      await user.click(screen.getByRole("button", { name: "Gérer mes cookies" }));
      await user.click(screen.getByRole("button", { name: "Refuser" }));

      expect(localStorage.getItem("cookie_consent")).toBe("rejected");
      expect(document.cookie).not.toContain("_ga=");
      expect(recharger).toHaveBeenCalledTimes(1);
    });

    it("le lien « Gérer mes cookies » n'existe pas tant qu'aucun traceur n'est configuré", () => {
      vi.stubEnv("VITE_GA_MEASUREMENT_ID", "");
      vi.stubEnv("VITE_META_PIXEL_ID", "");
      vi.stubEnv("VITE_LINKEDIN_PARTNER_ID", "");
      render(<LienGererCookies />);
      expect(screen.queryByRole("button", { name: "Gérer mes cookies" })).not.toBeInTheDocument();
    });
  });
});
