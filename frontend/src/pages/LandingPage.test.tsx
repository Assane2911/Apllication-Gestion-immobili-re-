import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { ThemeProvider } from "../context/ThemeContext";
import { AuthProvider } from "../context/AuthContext";
import { changerLangue } from "../i18n";
import en from "../i18n/locales/en";
import es from "../i18n/locales/es";
import fr from "../i18n/locales/fr";
import pt from "../i18n/locales/pt";
import LandingPage from "./LandingPage";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function renderPage() {
  return render(
    <MemoryRouter>
      <ThemeProvider><AuthProvider>
        <LandingPage />
      </AuthProvider></ThemeProvider>
    </MemoryRouter>
  );
}

describe("LandingPage", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
  });

  it("affiche l'accroche principale et le badge de la version", () => {
    renderPage();
    expect(screen.getByText("Nouvelle Version 2.0 • 15 jours d'essai gratuit offert sans engagement")).toBeInTheDocument();
    expect(screen.getByText("La gestion locative")).toBeInTheDocument();
    expect(screen.getByText("réinventée & automatisée.")).toBeInTheDocument();
  });

  it("annonce la disponibilité prochaine de l'app mobile sur l'App Store et Google Play", () => {
    renderPage();
    expect(screen.getByText("Bientôt disponible sur l'App Store et Google Play")).toBeInTheDocument();
  });

  it("définit un titre d'onglet et une meta description propres à la page", () => {
    renderPage();
    expect(document.title).toBe("ImmoPlatform Pro — Gestion locative et immobilière intelligente");
    expect(document.querySelector('meta[name="description"]')?.getAttribute("content")).toBe(
      "Quittances PDF automatiques, signature électronique des baux, relances automatiques, tableau de bord en temps réel. Essai gratuit de 15 jours sans engagement."
    );
  });

  it("expose les données structurées Organization et SoftwareApplication", () => {
    renderPage();
    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map((el) =>
      JSON.parse(el.innerHTML)
    );
    expect(scripts.some((s) => s["@type"] === "Organization")).toBe(true);
    expect(scripts.some((s) => s["@type"] === "SoftwareApplication")).toBe(true);
  });

  // Régression. La durée réelle de l'essai (auth.controller.ts::register,
  // trialEndsAt = +15 jours) était annoncée à "15 jours" partout sauf sur le
  // bouton "Essai" de la barre de navigation et les 3 CTA de tarifs, restés à
  // "10j" — une coquille qui promettait au visiteur un essai plus court que
  // ce que son inscription lui accorde réellement.
  it("annonce partout la même durée d'essai (15 jours), y compris sur les CTA de tarifs", () => {
    renderPage();

    expect(screen.getByRole("link", { name: "Essai 15j gratuit →" })).toBeInTheDocument();
    expect(screen.queryByText(/10j/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /essai 15j/i }).length).toBeGreaterThanOrEqual(3);
  });

  it("propose la connexion et l'essai gratuit vers /inscription quand personne n'est connecté", () => {
    renderPage();
    const trialLinks = screen.getAllByRole("link", { name: /essai/i });
    expect(trialLinks.some((link) => link.getAttribute("href") === "/inscription")).toBe(true);
    expect(screen.getByRole("link", { name: "Se connecter" })).toHaveAttribute("href", "/login");
  });

  it("propose d'accéder à son espace au lieu de se connecter quand un gestionnaire est déjà authentifié", () => {
    localStorage.setItem("token", "tok_123");
    localStorage.setItem(
      "user",
      JSON.stringify({ id: "mgr-1", email: "agence@test.local", role: "MANAGER", tenantId: null, tenantName: null }),
    );
    renderPage();
    expect(screen.getByRole("link", { name: "Accéder à mon espace →" })).toHaveAttribute("href", "/dashboard");
    expect(screen.queryByRole("link", { name: "Se connecter" })).not.toBeInTheDocument();
  });

  // Régression. Le second bouton de l'accroche annonçait « Tester en mode
  // démo » et menait à /login, où deux comptes de démonstration remplissaient
  // le formulaire. Ces comptes ont été retirés — leur mot de passe était écrit
  // en clair dans le code du frontend, donc servi au navigateur de chaque
  // visiteur. Le bouton promettait dès lors une porte qui n'existe plus.
  it("ne promet plus de mode démo dans l'accroche", () => {
    renderPage();

    expect(screen.queryByText(/mode démo/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/démo/i)).not.toBeInTheDocument();
  });

  it("propose les tarifs comme seconde entrée de l'accroche", () => {
    renderPage();

    const bouton = screen.getByRole("link", { name: "Voir les tarifs" });
    expect(bouton).toHaveAttribute("href", "#pricing");
  });

  /**
   * Les cartes de formules de l'accueil reprennent EXACTEMENT les lignes de la page Abonnement du gestionnaire
   * (mêmes clés de traduction, voir data/lignesFormules.ts) : elles ne peuvent plus diverger. Auparavant, l'accueil
   * gardait un texte à part, resté en arrière de celui de la page Abonnement.
   */
  it("affiche, pour chaque formule, les mêmes lignes que la page Abonnement du gestionnaire", () => {
    renderPage();
    const cartes = ["Starter", "Professionnel", "Agence & Multi-Comptes"].map((nom) => {
      const entete = screen.getByText(nom, { selector: "span.uppercase" });
      return within(entete.closest("div")!.parentElement!);
    });
    const [starter, pro, agence] = cartes;

    expect(starter.getByText("Jusqu'à 5 biens immobiliers")).toBeInTheDocument();
    expect(starter.getByText("Support standard par email")).toBeInTheDocument();
    expect(starter.queryByText("Support prioritaire : réponse sous un jour ouvré")).not.toBeInTheDocument();

    expect(pro.getByText("Tout ce qui est inclus dans Starter")).toBeInTheDocument();
    expect(pro.getByText("Jusqu'à 25 biens immobiliers")).toBeInTheDocument();
    expect(pro.getByText("Rappels automatiques par email ; WhatsApp en cours de mise en service")).toBeInTheDocument();
    expect(pro.getByText("Support prioritaire : réponse sous un jour ouvré")).toBeInTheDocument();
    expect(pro.getByText("Signature électronique des baux et des états des lieux")).toBeInTheDocument();
    expect(pro.getByText("Marque blanche : logo, tampon et en-tête de l'agence")).toBeInTheDocument();
    expect(pro.getByText("Messagerie directe avec les locataires")).toBeInTheDocument();
    expect(starter.queryByText("Messagerie directe avec les locataires")).not.toBeInTheDocument();

    expect(agence.getByText("Tout ce qui est inclus dans Professionnel")).toBeInTheDocument();
    expect(agence.getByText("Biens immobiliers illimités")).toBeInTheDocument();
    expect(agence.getByText("Export comptable avancé (grand livre, FEC, SYSCOHADA)")).toBeInTheDocument();
    expect(agence.queryByText("Support prioritaire : réponse sous un jour ouvré")).not.toBeInTheDocument();
  });

  it("affiche les sections fonctionnalités et tarifs", () => {
    renderPage();
    expect(screen.getByText("Quittances & Baux en PDF")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Des formules simples et transparentes", level: 2 })).toBeInTheDocument();
  });

  /**
   * Régression a11y : le contenu de la page (hero, fonctionnalités, tarifs...)
   * ne vivait dans aucun repère de landmark — un lecteur d'écran n'avait aucun
   * moyen d'aller directement au contenu principal en sautant la navigation.
   */
  it("place le contenu principal dans un repère <main>", () => {
    renderPage();
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  /**
   * Régression a11y : le titre de chaque ligne du comparatif sautait de h2
   * (titre de la section) directement à h4, sans h3 intermédiaire.
   */
  it("titre chaque ligne du comparatif avec un niveau de titre h3, pas h4", () => {
    renderPage();
    expect(
      screen.getByRole("heading", { level: 3, name: "Avis d'échéance & Relances de loyer" })
    ).toBeInTheDocument();
  });

  // Le comparatif « Gestion traditionnelle vs ImmoPlatform Pro », les maquettes du produit et les liens légaux du pied
  // de page étaient écrits en dur en français : un visiteur qui avait choisi une autre langue voyait le reste de la page
  // traduit, mais ces blocs restaient en français.
  describe("blocs autrefois écrits en dur", () => {
    const FRANCAIS_RESIDUEL = [
      "Gestion Traditionnelle",
      "Comparatif & Valeur Ajoutée",
      "Recommandé",
      "Fonctionnalité & Processus",
      "Temps administratif",
      "Flux net",
      "Loyer de septembre",
      "Mentions légales",
      "Confidentialité",
      "Quittances de loyer automatiques",
      "Démarrer 15 jours d'essai gratuit",
    ];

    it.each([
      ["en", ["Comparison & Added Value", "Traditional management (Excel / paper)", "Automatic rent receipts", "Net flow", "September rent", "Legal notice"]],
      ["pt", ["Comparação e Valor Acrescentado", "Gestão tradicional (Excel / papel)", "Recibos de renda automáticos", "Fluxo líquido", "Renda de setembro", "Aviso legal"]],
      ["es", ["Comparativa y valor añadido", "Gestión tradicional (Excel / papel)", "Recibos de alquiler automáticos", "Flujo neto", "Alquiler de septiembre", "Aviso legal"]],
    ])("affiche le comparatif, les maquettes et le pied de page en « %s », sans reste de français", async (langue, attendus) => {
      await changerLangue(langue);
      try {
        const { container } = renderPage();
        const texte = container.textContent ?? "";
        for (const phrase of attendus) expect(texte).toContain(phrase);
        for (const reste of FRANCAIS_RESIDUEL) expect(texte).not.toContain(reste);
      } finally {
        await changerLangue("fr");
      }
    });

    it("garde le comparatif en français pour un visiteur francophone", () => {
      const { container } = renderPage();
      const texte = container.textContent ?? "";
      for (const phrase of ["Comparatif & Valeur Ajoutée", "Gestion Traditionnelle (Excel / Papier)", "Recommandé", "Flux net", "Mentions légales", "CGU & CGV"]) {
        expect(texte).toContain(phrase);
      }
    });
  });
});

/**
 * La plateforme n'atteste la conformité d'aucun document : un bail ou une quittance est un écrit de l'agence, et le
 * compte-rendu de gestion est informatif. La page d'accueil et les descriptions du site (Google, réseaux) décrivent ce que
 * fait l'outil, sans promettre de document « certifié » ni de « format officiel ».
 */
describe("LandingPage — aucune promesse de certification", () => {
  it.each([
    ["fr", fr],
    ["en", en],
    ["es", es],
    ["pt", pt],
  ])("%s : ni la page d'accueil ni la description du site ne parlent de certification", (_langue, textes) => {
    const promesse = /certifi|certificad|offici/i;
    // Les textes seulement : le nom d'une clé (`roi.certified`) n'est jamais affiché.
    const valeurs = (n: unknown): string[] => (typeof n === "string" ? [n] : n && typeof n === "object" ? Object.values(n).flatMap(valeurs) : []);
    expect(valeurs(textes.landing).filter((v) => promesse.test(v))).toEqual([]);
    expect(valeurs(textes.seo.landing).filter((v) => promesse.test(v))).toEqual([]);
  });
});

/**
 * Le jour d'échéance dépend du pays de l'agence (le dernier jour du mois au Sénégal, le 5 ailleurs) et se règle sur chaque
 * bail : la page d'accueil ne peut plus promettre « une échéance stricte au 5 ».
 */
describe("LandingPage — jour d'échéance", () => {
  it.each([
    ["fr", fr],
    ["en", en],
    ["es", es],
    ["pt", pt],
  ])("%s : le comparatif ne fixe pas l'échéance au 5", (_langue, textes) => {
    expect(textes.landing.compare.rows.reminders.immoplatform).not.toMatch(/\b5(th|º|\s?e)?\b|\bcinco\b/i);
  });
});
