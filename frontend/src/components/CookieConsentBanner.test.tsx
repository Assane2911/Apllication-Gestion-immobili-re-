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

    await user.click(screen.getByRole("button", { name: "Tout accepter" }));

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

    await user.click(screen.getByRole("button", { name: "Tout refuser" }));

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
      expect(screen.getByRole("button", { name: "Tout accepter" })).toBeInTheDocument();
      vi.restoreAllMocks();
    });

    it("un refus ancien de plus de 6 mois est redemandé", () => {
      TOUS();
      localStorage.setItem("cookie_consent", "rejected");
      localStorage.setItem("cookie_consent_date", String(Date.now() - 200 * 86_400_000));
      renderBanner();
      expect(screen.getByRole("button", { name: "Tout accepter" })).toBeInTheDocument();
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
      expect(screen.queryByRole("button", { name: "Tout accepter" })).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Gérer mes cookies" }));
      await user.click(screen.getByRole("button", { name: "Tout accepter" }));

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
      await user.click(screen.getByRole("button", { name: "Tout refuser" }));

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

  /**
   * Un seul bouton couvrait la mesure d'audience ET le reciblage publicitaire (Meta, LinkedIn). La CNIL recommande de laisser choisir
   * finalité par finalité : « Tout refuser », « Tout accepter » et « Personnaliser », qui montre une case par finalité, décochée.
   */
  describe("choix par finalité", () => {
    const TOUS = () => {
      vi.stubEnv("VITE_GA_MEASUREMENT_ID", "G-TEST123");
      vi.stubEnv("VITE_META_PIXEL_ID", "123456789");
      vi.stubEnv("VITE_LINKEDIN_PARTNER_ID", "1234567");
    };
    const scripts = () => ({
      google: document.head.querySelector("script[src*='googletagmanager']") !== null,
      meta: document.head.querySelector("script[src*='fbevents']") !== null,
      linkedin: document.head.querySelector("script[src*='licdn']") !== null,
    });

    it("« Personnaliser » montre une case par finalité, toutes décochées", async () => {
      TOUS();
      const user = userEvent.setup();
      renderBanner();
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Personnaliser" }));

      expect(screen.getByRole("checkbox", { name: /Mesure d'audience/ })).not.toBeChecked();
      expect(screen.getByRole("checkbox", { name: /Publicité et reciblage/ })).not.toBeChecked();
    });

    it("n'accepter que la mesure d'audience charge Google, ni Meta ni LinkedIn", async () => {
      TOUS();
      const user = userEvent.setup();
      renderBanner();
      await user.click(screen.getByRole("button", { name: "Personnaliser" }));
      await user.click(screen.getByRole("checkbox", { name: /Mesure d'audience/ }));
      await user.click(screen.getByRole("button", { name: "Enregistrer mon choix" }));

      expect(localStorage.getItem("cookie_consent")).toBe("audience");
      expect(scripts()).toEqual({ google: true, meta: false, linkedin: false });
    });

    it("n'accepter que la publicité charge Meta et LinkedIn, pas Google", async () => {
      TOUS();
      const user = userEvent.setup();
      renderBanner();
      await user.click(screen.getByRole("button", { name: "Personnaliser" }));
      await user.click(screen.getByRole("checkbox", { name: /Publicité et reciblage/ }));
      await user.click(screen.getByRole("button", { name: "Enregistrer mon choix" }));

      expect(localStorage.getItem("cookie_consent")).toBe("publicite");
      expect(scripts()).toEqual({ google: false, meta: true, linkedin: true });
    });

    it("enregistrer sans rien cocher vaut un refus : rien n'est chargé", async () => {
      TOUS();
      const user = userEvent.setup();
      renderBanner();
      await user.click(screen.getByRole("button", { name: "Personnaliser" }));
      await user.click(screen.getByRole("button", { name: "Enregistrer mon choix" }));

      expect(localStorage.getItem("cookie_consent")).toBe("rejected");
      expect(scripts()).toEqual({ google: false, meta: false, linkedin: false });
    });

    it("un choix partiel déjà enregistré recharge seulement sa finalité, sans bandeau", () => {
      TOUS();
      localStorage.setItem("cookie_consent", "audience");
      renderBanner();
      expect(scripts()).toEqual({ google: true, meta: false, linkedin: false });
      expect(screen.queryByRole("button", { name: "Tout accepter" })).not.toBeInTheDocument();
    });

    it("rouvert, le bandeau montre le choix en cours ; retirer une finalité efface les cookies et recharge la page", async () => {
      TOUS();
      const user = userEvent.setup();
      const recharger = vi.fn();
      Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, reload: recharger } });
      document.cookie = "_fbp=fb.1.1.1; path=/";
      localStorage.setItem("cookie_consent", "accepted");
      render(
        <MemoryRouter initialEntries={["/landing"]}>
          <CookieConsentBanner />
          <LienGererCookies />
        </MemoryRouter>
      );

      await user.click(screen.getByRole("button", { name: "Gérer mes cookies" }));
      await user.click(screen.getByRole("button", { name: "Personnaliser" }));
      expect(screen.getByRole("checkbox", { name: /Mesure d'audience/ })).toBeChecked();
      expect(screen.getByRole("checkbox", { name: /Publicité et reciblage/ })).toBeChecked();

      await user.click(screen.getByRole("checkbox", { name: /Publicité et reciblage/ }));
      await user.click(screen.getByRole("button", { name: "Enregistrer mon choix" }));

      expect(localStorage.getItem("cookie_consent")).toBe("audience");
      expect(document.cookie).not.toContain("_fbp=");
      expect(recharger).toHaveBeenCalledTimes(1);
    });

    it("n'ajouter une finalité qu'à un choix existant ne recharge pas la page (rien n'est retiré)", async () => {
      TOUS();
      const user = userEvent.setup();
      const recharger = vi.fn();
      Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, reload: recharger } });
      localStorage.setItem("cookie_consent", "audience");
      render(
        <MemoryRouter initialEntries={["/landing"]}>
          <CookieConsentBanner />
          <LienGererCookies />
        </MemoryRouter>
      );
      await user.click(screen.getByRole("button", { name: "Gérer mes cookies" }));
      await user.click(screen.getByRole("button", { name: "Personnaliser" }));
      await user.click(screen.getByRole("checkbox", { name: /Publicité et reciblage/ }));
      await user.click(screen.getByRole("button", { name: "Enregistrer mon choix" }));

      expect(localStorage.getItem("cookie_consent")).toBe("accepted");
      expect(scripts()).toEqual({ google: true, meta: true, linkedin: true });
      expect(recharger).not.toHaveBeenCalled();
    });

    it("sans traceur publicitaire configuré, il n'y a qu'une finalité : pas de « Personnaliser », ni de case publicité", () => {
      vi.stubEnv("VITE_GA_MEASUREMENT_ID", "G-TEST123");
      vi.stubEnv("VITE_META_PIXEL_ID", "");
      vi.stubEnv("VITE_LINKEDIN_PARTNER_ID", "");
      renderBanner();
      expect(screen.queryByRole("button", { name: "Personnaliser" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Tout accepter" })).toBeInTheDocument();
    });
  });
});
