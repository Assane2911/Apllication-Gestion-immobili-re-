import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import AbonnementCalendrier, { adresseDuFlux, adresseWebcal } from "./AbonnementCalendrier";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), defaults: { baseURL: "https://api.test/api" } } };
});
const mockedApi = vi.mocked(api, { deep: true });
const JETON = "A".repeat(43);

const ouvrir = async () => {
  const user = userEvent.setup();
  render(<AbonnementCalendrier />);
  await user.click(screen.getByRole("button", { name: /Synchroniser avec mon calendrier/ }));
  return user;
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedApi.get.mockResolvedValue({ data: { active: false, createdAt: null, lastUsedAt: null, hideTenantNames: false } } as never);
});

describe("adresses du flux", () => {
  it("compose l'adresse absolue à partir de la base de l'API, et la version webcal", () => {
    expect(adresseDuFlux("/agenda/ics/x.ics")).toBe("https://api.test/api/agenda/ics/x.ics");
    expect(adresseWebcal("https://api.test/api/agenda/ics/x.ics")).toBe("webcal://api.test/api/agenda/ics/x.ics");
    expect(adresseWebcal("http://localhost:4000/api/agenda/ics/x.ics")).toBe("webcal://localhost:4000/api/agenda/ics/x.ics");
  });
});

describe("AbonnementCalendrier", () => {
  it("reste fermé sans rien charger tant qu'on ne l'ouvre pas", () => {
    render(<AbonnementCalendrier />);
    expect(screen.getByRole("button", { name: /Synchroniser avec mon calendrier/ })).toHaveAttribute("aria-expanded", "false");
    expect(mockedApi.get).not.toHaveBeenCalled();
  });

  it("propose de créer le lien quand il n'y en a pas, puis l'affiche une fois avec copie, ouverture et avertissement", async () => {
    mockedApi.post.mockResolvedValue({ data: { token: JETON, path: `/agenda/ics/${JETON}.ics`, active: true, createdAt: "2026-06-15T08:00:00.000Z", lastUsedAt: null, hideTenantNames: false } } as never);
    const user = await ouvrir();

    await user.click(await screen.findByRole("button", { name: "Créer mon lien d'abonnement" }));

    const champ = (await screen.findByLabelText("Lien d'abonnement")) as HTMLInputElement;
    expect(champ.value).toBe(`https://api.test/api/agenda/ics/${JETON}.ics`);
    expect(champ).toHaveAttribute("readonly");
    expect(screen.getByRole("link", { name: "Ouvrir dans mon calendrier" })).toHaveAttribute("href", `webcal://api.test/api/agenda/ics/${JETON}.ics`);
    expect(screen.getByText(/ne sera plus affiché/)).toBeInTheDocument();
    expect(screen.getByText(/Toute personne qui possède ce lien voit vos échéances/)).toBeInTheDocument();
    expect(screen.getByText(/Google Agenda : « Autres agendas »/)).toBeInTheDocument();
    expect(mockedApi.post).toHaveBeenCalledWith("/agenda/feed");
  });

  it("n'affiche jamais le jeton d'un lien déjà créé : seulement son ancienneté et sa dernière lecture", async () => {
    mockedApi.get.mockResolvedValue({ data: { active: true, createdAt: "2026-06-01T00:00:00.000Z", lastUsedAt: "2026-06-14T00:00:00.000Z", hideTenantNames: false } } as never);
    await ouvrir();

    expect(await screen.findByText(/Lien actif depuis le/)).toBeInTheDocument();
    expect(screen.getByText(/Dernière lecture par un calendrier/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Lien d'abonnement")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Créer mon lien d'abonnement" })).not.toBeInTheDocument();
  });

  it("dit qu'aucun calendrier n'a encore lu le lien", async () => {
    mockedApi.get.mockResolvedValue({ data: { active: true, createdAt: "2026-06-01T00:00:00.000Z", lastUsedAt: null, hideTenantNames: false } } as never);
    await ouvrir();
    expect(await screen.findByText("Aucun calendrier ne l'a encore lu.")).toBeInTheDocument();
  });

  it("demande confirmation avant de régénérer, annonce que l'ancien lien cessera de fonctionner, et n'appelle rien si on annule", async () => {
    mockedApi.get.mockResolvedValue({ data: { active: true, createdAt: "2026-06-01T00:00:00.000Z", lastUsedAt: null, hideTenantNames: false } } as never);
    mockedApi.post.mockResolvedValue({ data: { token: JETON, path: `/agenda/ics/${JETON}.ics`, active: true, createdAt: "2026-06-15T08:00:00.000Z", lastUsedAt: null, hideTenantNames: false } } as never);
    const user = await ouvrir();

    await user.click(await screen.findByRole("button", { name: "Générer un nouveau lien" }));
    expect(screen.getByRole("alert")).toHaveTextContent("L'ancien lien cessera de fonctionner");
    expect(mockedApi.post).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Annuler" }));
    expect(mockedApi.post).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Générer un nouveau lien" }));
    await user.click(screen.getByRole("button", { name: "Confirmer" }));
    expect(await screen.findByLabelText("Lien d'abonnement")).toBeInTheDocument();
    expect(mockedApi.post).toHaveBeenCalledTimes(1);
  });

  it("désactive le lien après confirmation, puis propose d'en créer un nouveau", async () => {
    mockedApi.get.mockResolvedValue({ data: { active: true, createdAt: "2026-06-01T00:00:00.000Z", lastUsedAt: null, hideTenantNames: false } } as never);
    mockedApi.delete.mockResolvedValue({ data: undefined } as never);
    const user = await ouvrir();

    await user.click(await screen.findByRole("button", { name: "Désactiver le lien" }));
    expect(mockedApi.delete).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirmer" }));

    await waitFor(() => expect(mockedApi.delete).toHaveBeenCalledWith("/agenda/feed"));
    expect(await screen.findByRole("button", { name: "Créer mon lien d'abonnement" })).toBeInTheDocument();
  });

  it("affiche l'erreur du serveur sans rien casser", async () => {
    mockedApi.post.mockRejectedValue(new Error("boom"));
    const user = await ouvrir();

    await user.click(await screen.findByRole("button", { name: "Créer mon lien d'abonnement" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByLabelText("Lien d'abonnement")).not.toBeInTheDocument();
  });

  describe("sans noms de locataires", () => {
    const lienActif = (hideTenantNames: boolean) =>
      mockedApi.get.mockResolvedValue({ data: { active: true, createdAt: "2026-06-01T00:00:00.000Z", lastUsedAt: null, hideTenantNames } } as never);

    it("affiche la case selon le réglage enregistré, avec ce qui reste visible", async () => {
      lienActif(true);
      await ouvrir();

      const case_ = await screen.findByRole("checkbox", { name: "Ne pas afficher le nom des locataires dans mon calendrier" });
      expect(case_).toBeChecked();
      expect(screen.getByText(/Seul le nom du locataire est retiré/)).toBeInTheDocument();
    });

    it("enregistre le choix au clic et garde l'état renvoyé par le serveur", async () => {
      lienActif(false);
      mockedApi.put.mockResolvedValue({ data: { active: true, createdAt: "2026-06-01T00:00:00.000Z", lastUsedAt: null, hideTenantNames: true } } as never);
      const user = await ouvrir();

      const case_ = await screen.findByRole("checkbox", { name: /Ne pas afficher le nom des locataires/ });
      expect(case_).not.toBeChecked();
      await user.click(case_);

      await waitFor(() => expect(mockedApi.put).toHaveBeenCalledWith("/agenda/feed", { hideTenantNames: true }));
      await waitFor(() => expect(case_).toBeChecked());
    });

    it("revient à l'état précédent et affiche l'erreur si le serveur refuse : la case ne ment pas", async () => {
      lienActif(false);
      mockedApi.put.mockRejectedValue(new Error("boom"));
      const user = await ouvrir();

      const case_ = await screen.findByRole("checkbox", { name: /Ne pas afficher le nom des locataires/ });
      await user.click(case_);

      expect(await screen.findByRole("alert")).toBeInTheDocument();
      expect(case_).not.toBeChecked();
    });

    it("ne propose pas la case tant qu'il n'y a pas de lien", async () => {
      await ouvrir();
      await screen.findByRole("button", { name: "Créer mon lien d'abonnement" });
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    });

    it("garde le réglage affiché après la création d'un nouveau lien", async () => {
      lienActif(true);
      mockedApi.post.mockResolvedValue({ data: { token: JETON, path: `/agenda/ics/${JETON}.ics`, active: true, createdAt: "2026-06-15T08:00:00.000Z", lastUsedAt: null, hideTenantNames: true } } as never);
      const user = await ouvrir();

      await user.click(await screen.findByRole("button", { name: "Générer un nouveau lien" }));
      await user.click(screen.getByRole("button", { name: "Confirmer" }));

      expect(await screen.findByLabelText("Lien d'abonnement")).toBeInTheDocument();
      expect(screen.getByRole("checkbox", { name: /Ne pas afficher le nom des locataires/ })).toBeChecked();
    });
  });
});
