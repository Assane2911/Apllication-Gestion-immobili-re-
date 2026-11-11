import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import AbonnementCalendrier, { adresseDuFlux, adresseWebcal } from "./AbonnementCalendrier";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), delete: vi.fn(), defaults: { baseURL: "https://api.test/api" } } };
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
  mockedApi.get.mockResolvedValue({ data: { active: false, createdAt: null, lastUsedAt: null } } as never);
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
    mockedApi.post.mockResolvedValue({ data: { token: JETON, path: `/agenda/ics/${JETON}.ics`, active: true, createdAt: "2026-06-15T08:00:00.000Z", lastUsedAt: null } } as never);
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
    mockedApi.get.mockResolvedValue({ data: { active: true, createdAt: "2026-06-01T00:00:00.000Z", lastUsedAt: "2026-06-14T00:00:00.000Z" } } as never);
    await ouvrir();

    expect(await screen.findByText(/Lien actif depuis le/)).toBeInTheDocument();
    expect(screen.getByText(/Dernière lecture par un calendrier/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Lien d'abonnement")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Créer mon lien d'abonnement" })).not.toBeInTheDocument();
  });

  it("dit qu'aucun calendrier n'a encore lu le lien", async () => {
    mockedApi.get.mockResolvedValue({ data: { active: true, createdAt: "2026-06-01T00:00:00.000Z", lastUsedAt: null } } as never);
    await ouvrir();
    expect(await screen.findByText("Aucun calendrier ne l'a encore lu.")).toBeInTheDocument();
  });

  it("demande confirmation avant de régénérer, annonce que l'ancien lien cessera de fonctionner, et n'appelle rien si on annule", async () => {
    mockedApi.get.mockResolvedValue({ data: { active: true, createdAt: "2026-06-01T00:00:00.000Z", lastUsedAt: null } } as never);
    mockedApi.post.mockResolvedValue({ data: { token: JETON, path: `/agenda/ics/${JETON}.ics`, active: true, createdAt: "2026-06-15T08:00:00.000Z", lastUsedAt: null } } as never);
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
    mockedApi.get.mockResolvedValue({ data: { active: true, createdAt: "2026-06-01T00:00:00.000Z", lastUsedAt: null } } as never);
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
});
