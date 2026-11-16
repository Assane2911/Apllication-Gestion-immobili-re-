import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import LanguageSwitcher from "../components/LanguageSwitcher";
import Seo from "../components/Seo";
import SynchroLangueUrl from "../components/SynchroLangueUrl";
import { useCheminPublic, useSeoLangues } from "../hooks/useSeoLangues";
import i18n, { changerLangue } from "./index";

/**
 * L'accueil et la vitrine existent en quatre langues, chacune à son adresse (« /en », « /es/vitrine »…) : un moteur de
 * recherche, qui n'a pas de langue mémorisée, n'indexait que le français. Chaque version annonce les autres (hreflang).
 */
afterEach(async () => {
  await changerLangue("fr");
  window.history.pushState({}, "", "/");
});

function PageSeo({ chemin }: { chemin: string }) {
  return <Seo title="Titre" description="Description" {...useSeoLangues(chemin)} />;
}

const liens = (rel: string) => Array.from(document.head.querySelectorAll(`link[rel="${rel}"]`)).map((l) => [l.getAttribute("hreflang"), l.getAttribute("href")]);

describe("balises hreflang et adresse canonique", () => {
  it("une version traduite se déclare elle-même canonique et annonce les quatre versions, le français en x-default", () => {
    render(
      <MemoryRouter initialEntries={["/pt/vitrine"]}>
        <PageSeo chemin="/vitrine" />
      </MemoryRouter>
    );
    expect(document.head.querySelector('link[rel="canonical"]')).toHaveAttribute("href", "https://www.immoplatformpro.com/pt/vitrine");
    expect(liens("alternate")).toEqual([
      ["fr", "https://www.immoplatformpro.com/vitrine"],
      ["en", "https://www.immoplatformpro.com/en/vitrine"],
      ["es", "https://www.immoplatformpro.com/es/vitrine"],
      ["pt", "https://www.immoplatformpro.com/pt/vitrine"],
      ["x-default", "https://www.immoplatformpro.com/vitrine"],
    ]);
  });

  it("l'adresse sans préfixe est le français, même si le visiteur a mémorisé une autre langue", async () => {
    await changerLangue("en");
    render(
      <MemoryRouter initialEntries={["/vitrine"]}>
        <PageSeo chemin="/vitrine" />
      </MemoryRouter>
    );
    expect(document.head.querySelector('link[rel="canonical"]')).toHaveAttribute("href", "https://www.immoplatformpro.com/vitrine");
  });

  it("« /landing » (copie de l'accueil) pointe vers « / », et « /es » vers « /es »", () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={["/landing"]}>
        <PageSeo chemin="/" />
      </MemoryRouter>
    );
    expect(document.head.querySelector('link[rel="canonical"]')).toHaveAttribute("href", "https://www.immoplatformpro.com/");
    unmount();

    render(
      <MemoryRouter initialEntries={["/es"]}>
        <PageSeo chemin="/" />
      </MemoryRouter>
    );
    expect(document.head.querySelector('link[rel="canonical"]')).toHaveAttribute("href", "https://www.immoplatformpro.com/es");
  });

  it("une page sans versions (alternates absent) n'ajoute aucune balise hreflang", () => {
    render(
      <MemoryRouter>
        <Seo title="Titre" canonical="/login" />
      </MemoryRouter>
    );
    expect(liens("alternate")).toEqual([]);
  });
});

function Adresse() {
  const { pathname, search } = useLocation();
  return <p data-testid="adresse">{pathname + search}</p>;
}

describe("le sélecteur de langue suit l'adresse sur les pages traduites", () => {
  async function choisir(depart: string, langue: string) {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[depart]}>
        <LanguageSwitcher />
        <Adresse />
      </MemoryRouter>
    );
    await user.selectOptions(screen.getByRole("combobox"), langue);
  }

  it("la vitrine passe en anglais : « /vitrine » devient « /en/vitrine », la recherche est conservée", async () => {
    await choisir("/vitrine?pays=SN", "en");
    await waitFor(() => expect(screen.getByTestId("adresse")).toHaveTextContent("/en/vitrine?pays=SN"));
    expect(i18n.language).toBe("en");
  });

  it("le retour au français rend l'adresse d'origine", async () => {
    await choisir("/es", "fr");
    await waitFor(() => expect(screen.getByTestId("adresse")).toHaveTextContent(/^\/$/));
  });

  it("d'une langue à l'autre : « /en/vitrine » devient « /pt/vitrine »", async () => {
    await choisir("/en/vitrine", "pt");
    await waitFor(() => expect(screen.getByTestId("adresse")).toHaveTextContent("/pt/vitrine"));
  });

  it("une page qui n'existe qu'en français garde son adresse (connexion, annonce, pages légales)", async () => {
    await choisir("/login", "es");
    await waitFor(() => expect(i18n.language).toBe("es"));
    expect(screen.getByTestId("adresse")).toHaveTextContent("/login");
  });

  it("hors d'un routeur, le sélecteur change la langue sans planter", async () => {
    const user = userEvent.setup();
    render(<LanguageSwitcher />);
    await user.selectOptions(screen.getByRole("combobox"), "pt");
    await waitFor(() => expect(i18n.language).toBe("pt"));
  });
});

describe("langue de l'adresse", () => {
  it("ouvrir « /pt/vitrine » met l'interface en portugais, même avec un autre choix mémorisé", async () => {
    await changerLangue("en");
    render(
      <MemoryRouter initialEntries={["/pt/vitrine"]}>
        <SynchroLangueUrl />
      </MemoryRouter>
    );
    await waitFor(() => expect(i18n.language).toBe("pt"));
  });

  it("une adresse sans préfixe ne change pas la langue choisie", async () => {
    await changerLangue("es");
    render(
      <MemoryRouter initialEntries={["/vitrine"]}>
        <SynchroLangueUrl />
      </MemoryRouter>
    );
    expect(i18n.language).toBe("es");
  });

  it("au démarrage, l'adresse l'emporte sur la langue mémorisée", async () => {
    vi.resetModules();
    localStorage.setItem("app_language", "en");
    window.history.pushState({}, "", "/es/vitrine");
    const module = await import("./index");
    await module.i18nPret;
    expect(module.default.language).toBe("es");
    localStorage.removeItem("app_language");
  });

  it("sans préfixe, c'est le choix mémorisé qui s'applique (comme avant)", async () => {
    vi.resetModules();
    localStorage.setItem("app_language", "pt");
    window.history.pushState({}, "", "/vitrine");
    const module = await import("./index");
    await module.i18nPret;
    expect(module.default.language).toBe("pt");
    localStorage.removeItem("app_language");
  });
});

function Liens() {
  const chemin = useCheminPublic();
  return (
    <ul>
      <li data-testid="vitrine">{chemin("/vitrine")}</li>
      <li data-testid="accueil">{chemin("/landing")}</li>
      <li data-testid="connexion">{chemin("/login")}</li>
      <li data-testid="annonce">{chemin("/vitrine/annonces/abc")}</li>
    </ul>
  );
}

describe("liens entre pages traduites", () => {
  it("sur « /en », les liens vers l'accueil et la vitrine restent en anglais ; les autres pages gardent leur adresse", () => {
    render(
      <MemoryRouter initialEntries={["/en"]}>
        <Liens />
      </MemoryRouter>
    );
    expect(screen.getByTestId("vitrine")).toHaveTextContent("/en/vitrine");
    expect(screen.getByTestId("accueil")).toHaveTextContent("/en");
    expect(screen.getByTestId("connexion")).toHaveTextContent("/login");
    expect(screen.getByTestId("annonce")).toHaveTextContent("/vitrine/annonces/abc");
  });

  it("en français, tout garde son adresse d'origine", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Liens />
      </MemoryRouter>
    );
    expect(screen.getByTestId("vitrine")).toHaveTextContent("/vitrine");
    expect(screen.getByTestId("accueil")).toHaveTextContent("/landing");
  });
});
