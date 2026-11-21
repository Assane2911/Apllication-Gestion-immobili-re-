import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import AbonnementCalendrier from "./AbonnementCalendrier";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), defaults: { baseURL: "https://api.test/api" } } };
});

const mockedApi = vi.mocked(api, { deep: true });
const JETON = "B".repeat(43);

/**
 * L'abonnement de l'agenda à un calendrier externe : le lien est SECRET et n'est montré qu'à sa création. Ce qui compte ici :
 * quand le serveur échoue, l'état affiché ne doit jamais mentir (un lien refusé n'est pas « créé », une désactivation refusée
 * n'est pas « faite »), et la copie du lien ne doit jamais casser la fenêtre même sans presse-papiers.
 */

function erreurServeur(message: string) {
  return new AxiosError("Request failed", "ERR_BAD_REQUEST", undefined, undefined, {
    status: 500,
    statusText: "Server Error",
    data: { error: message },
    headers: {},
    config: {} as never,
  });
}

const lienActif = () =>
  mockedApi.get.mockResolvedValue({ data: { active: true, createdAt: "2026-06-01T00:00:00.000Z", lastUsedAt: null, hideTenantNames: false } } as never);
const nouveauLien = { data: { token: JETON, path: `/agenda/ics/${JETON}.ics`, active: true, createdAt: "2026-06-15T08:00:00.000Z", lastUsedAt: null, hideTenantNames: false } };

async function ouvrir() {
  const user = userEvent.setup();
  render(<AbonnementCalendrier />);
  await user.click(screen.getByRole("button", { name: /Synchroniser avec mon calendrier/ }));
  return user;
}

describe("AbonnementCalendrier : échecs du serveur et copie du lien", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("lecture de l'état en échec : le message du serveur s'affiche, sans « Chargement… » ni bouton de création", async () => {
    mockedApi.get.mockRejectedValue(erreurServeur("Agenda indisponible."));
    await ouvrir();

    expect(await screen.findByRole("alert")).toHaveTextContent("Agenda indisponible.");
    expect(screen.queryByText("Chargement…")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Créer mon lien d'abonnement" })).not.toBeInTheDocument();
  });

  it("désactivation refusée : l'erreur est montrée et l'abonnement reste actif (aucun faux « désactivé »)", async () => {
    lienActif();
    mockedApi.delete.mockRejectedValue(erreurServeur("Désactivation impossible pour le moment."));
    const user = await ouvrir();

    await user.click(await screen.findByRole("button", { name: "Désactiver le lien" }));
    await user.click(screen.getByRole("button", { name: "Confirmer" }));

    const alertes = await screen.findAllByRole("alert");
    expect(alertes.some((a) => a.textContent?.includes("Désactivation impossible pour le moment."))).toBe(true);
    expect(screen.queryByRole("button", { name: "Créer mon lien d'abonnement" })).not.toBeInTheDocument();
    expect(screen.getByText(/Lien actif depuis le/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmer" })).toBeEnabled();
  });

  it("régénération confirmée : le nouveau lien est montré et la demande de confirmation disparaît", async () => {
    lienActif();
    mockedApi.post.mockResolvedValue(nouveauLien as never);
    const user = await ouvrir();

    await user.click(await screen.findByRole("button", { name: "Générer un nouveau lien" }));
    await user.click(screen.getByRole("button", { name: "Confirmer" }));

    expect(((await screen.findByLabelText("Lien d'abonnement")) as HTMLInputElement).value).toBe(`https://api.test/api/agenda/ics/${JETON}.ics`);
    expect(screen.queryByRole("button", { name: "Confirmer" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Générer un nouveau lien" })).toBeInTheDocument();
  });

  it("régénération refusée : l'erreur est montrée, aucun lien n'est affiché, l'ancien reste en place", async () => {
    lienActif();
    mockedApi.post.mockRejectedValue(erreurServeur("Trop de liens générés."));
    const user = await ouvrir();

    await user.click(await screen.findByRole("button", { name: "Générer un nouveau lien" }));
    await user.click(screen.getByRole("button", { name: "Confirmer" }));

    const alertes = await screen.findAllByRole("alert");
    expect(alertes.some((a) => a.textContent?.includes("Trop de liens générés."))).toBe(true);
    expect(screen.queryByLabelText("Lien d'abonnement")).not.toBeInTheDocument();
    expect(screen.getByText(/Lien actif depuis le/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmer" })).toBeEnabled();
  });

  it("pendant la création : bouton bloqué (un seul lien créé même si on insiste)", async () => {
    mockedApi.get.mockResolvedValue({ data: { active: false, createdAt: null, lastUsedAt: null, hideTenantNames: false } } as never);
    let finir!: (v: unknown) => void;
    mockedApi.post.mockReturnValue(new Promise((resolve) => (finir = resolve)) as never);
    const user = await ouvrir();

    await user.click(await screen.findByRole("button", { name: "Créer mon lien d'abonnement" }));
    const enCours = await screen.findByRole("button", { name: "Création…" });
    expect(enCours).toBeDisabled();
    await user.click(enCours);
    expect(mockedApi.post).toHaveBeenCalledTimes(1);

    await act(async () => finir(nouveauLien));
    expect(await screen.findByLabelText("Lien d'abonnement")).toBeInTheDocument();
  });

  describe("copie du lien", () => {
    async function afficherLaCreation() {
      mockedApi.get.mockResolvedValue({ data: { active: false, createdAt: null, lastUsedAt: null, hideTenantNames: false } } as never);
      mockedApi.post.mockResolvedValue(nouveauLien as never);
      const user = await ouvrir();
      await user.click(await screen.findByRole("button", { name: "Créer mon lien d'abonnement" }));
      await screen.findByLabelText("Lien d'abonnement");
      // userEvent.setup() installe sa propre doublure de presse-papiers : on l'espionne APRÈS son installation.
      const ecrire = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
      return { user, ecrire };
    }

    it("copie l'adresse complète dans le presse-papiers, confirme « Copié ! » puis revient à « Copier » après 1,5 s", async () => {
      const { user, ecrire } = await afficherLaCreation();

      vi.useFakeTimers({ shouldAdvanceTime: true });
      await user.click(screen.getByRole("button", { name: "Copier" }));

      expect(ecrire).toHaveBeenCalledWith(`https://api.test/api/agenda/ics/${JETON}.ics`);
      expect(await screen.findByRole("button", { name: "Copié !" })).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1600);
      });
      await waitFor(() => expect(screen.getByRole("button", { name: "Copier" })).toBeInTheDocument());
    });

    it("presse-papiers refusé : pas de faux « Copié ! », le lien reste affiché pour être sélectionné à la main", async () => {
      const { user, ecrire } = await afficherLaCreation();
      ecrire.mockRejectedValueOnce(new Error("permission refusée"));

      await user.click(screen.getByRole("button", { name: "Copier" }));

      await waitFor(() => expect(ecrire).toHaveBeenCalled());
      expect(screen.queryByRole("button", { name: "Copié !" })).not.toBeInTheDocument();
      expect(screen.getByLabelText("Lien d'abonnement")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });
});
