import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError } from "axios";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import type { TeamMember } from "../../types";
import AgencySettingsPage from "./AgencySettingsPage";

// La section du paiement en ligne charge sa propre ressource : ici, elle volerait la première réponse simulée de la page.
vi.mock("../../components/SectionPaiementEnLigne", () => ({ default: () => null }));

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});
const mockedApi = vi.mocked(api, { deep: true });

/**
 * « Mon équipe » : inviter, renvoyer une invitation et révoquer l'accès d'un collaborateur, quand le serveur refuse ou que le
 * propriétaire se ravise. Révoquer coupe la connexion d'une personne : un refus de la confirmation ne doit rien envoyer, et une
 * erreur ne doit jamais faire disparaître la personne de la liste comme si l'accès était coupé.
 */
const membres: TeamMember[] = [
  { id: "c1", email: "awa@test.local", createdAt: "2026-09-01T00:00:00.000Z", role: "READ_ONLY", status: "ACTIVE" },
  { id: "c2", email: "moussa@test.local", createdAt: "2026-09-02T00:00:00.000Z", role: "ACCOUNTANT", status: "PENDING" },
];

function erreurServeur(message: string) {
  return new AxiosError("Request failed", "ERR_BAD_REQUEST", undefined, undefined, {
    status: 403,
    statusText: "Forbidden",
    data: { error: message },
    headers: {},
    config: {} as never,
  });
}

function renderPage() {
  return render(
    <AuthProvider>
      <MemoryRouter>
        <AgencySettingsPage />
      </MemoryRouter>
    </AuthProvider>
  );
}

beforeEach(() => {
  for (const m of Object.values(mockedApi)) (m as ReturnType<typeof vi.fn>).mockReset?.();
  localStorage.clear();
  localStorage.setItem("user", JSON.stringify({ id: "mgr-1", email: "proprio@test.local", role: "MANAGER", subscription: { plan: "ENTERPRISE" } }));
  mockedApi.get.mockImplementation(async (url: string) => {
    if (url === "/team") return { data: membres };
    if (url === "/agency") return { data: { id: "a", userId: "mgr-1", agencyName: "Agence", siretOrId: "", address: "", phone: "", email: "a@a.fr", legalNotice: "" } };
    return { data: { calculeLe: "2026-09-24T00:00:00.000Z", durees: {}, fichesSansBail: [], bauxClosDepuisLongtemps: [], leadsAnciens: [], total: 0 } };
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.spyOn(window, "alert").mockImplementation(() => {});
});

describe("Mon équipe : liste, invitation, renvoi et révocation", () => {
  it("la liste ne se charge pas : l'erreur du serveur est affichée", async () => {
    mockedApi.get.mockImplementation(async (url: string) => {
      if (url === "/team") throw erreurServeur("Seul le gestionnaire propriétaire peut voir l'équipe.");
      return { data: { id: "a", userId: "mgr-1", agencyName: "Agence", siretOrId: "", address: "", phone: "", email: "a@a.fr", legalNotice: "", calculeLe: "2026-09-24T00:00:00.000Z", durees: {}, fichesSansBail: [], bauxClosDepuisLongtemps: [], leadsAnciens: [], total: 0 } };
    });
    renderPage();

    expect(await screen.findByText("Seul le gestionnaire propriétaire peut voir l'équipe.")).toBeInTheDocument();
  });

  it("invitation refusée : l'erreur du serveur est affichée et l'adresse saisie reste là pour corriger", async () => {
    mockedApi.post.mockRejectedValueOnce(erreurServeur("Cette adresse appartient déjà à un compte."));
    const user = userEvent.setup();
    renderPage();
    await screen.findByLabelText("Rôle de awa@test.local");

    await user.type(screen.getByLabelText("Email du collaborateur"), "deja@test.local");
    await user.click(screen.getByRole("button", { name: "Inviter" }));

    expect(await screen.findByText("Cette adresse appartient déjà à un compte.")).toBeInTheDocument();
    expect(screen.getByLabelText("Email du collaborateur")).toHaveValue("deja@test.local");
    expect(screen.getByRole("button", { name: "Inviter" })).toBeEnabled();
  });

  it("invitation réussie : un message de confirmation s'affiche et le champ est vidé", async () => {
    mockedApi.post.mockResolvedValueOnce({ data: {} });
    const user = userEvent.setup();
    renderPage();
    await screen.findByLabelText("Rôle de awa@test.local");

    await user.type(screen.getByLabelText("Email du collaborateur"), "nouveau@test.local");
    await user.click(screen.getByRole("button", { name: "Inviter" }));

    expect(await screen.findByText("Invitation envoyée à nouveau@test.local.")).toBeInTheDocument();
    expect(screen.getByLabelText("Email du collaborateur")).toHaveValue("");
  });

  describe("renvoyer une invitation en attente", () => {
    it("réussi : confirme à qui l'invitation est repartie", async () => {
      mockedApi.post.mockResolvedValueOnce({ data: {} });
      const user = userEvent.setup();
      renderPage();

      await user.click(await screen.findByRole("button", { name: "Renvoyer l'invitation à moussa@test.local" }));

      await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith("/team/c2/resend"));
      expect(await screen.findByText("Invitation renvoyée à moussa@test.local.")).toBeInTheDocument();
    });

    it("refusé : l'erreur du serveur est affichée", async () => {
      mockedApi.post.mockRejectedValueOnce(erreurServeur("Cette invitation a déjà été utilisée."));
      const user = userEvent.setup();
      renderPage();

      await user.click(await screen.findByRole("button", { name: "Renvoyer l'invitation à moussa@test.local" }));

      expect(await screen.findByText("Cette invitation a déjà été utilisée.")).toBeInTheDocument();
    });
  });

  describe("révoquer l'accès d'un collaborateur", () => {
    it("confirmation refusée : rien n'est envoyé et la personne reste dans la liste", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(false);
      const user = userEvent.setup();
      renderPage();
      await screen.findByLabelText("Rôle de awa@test.local");

      await user.click(screen.getAllByRole("button", { name: "Révoquer" })[0]);

      expect(window.confirm).toHaveBeenCalled();
      expect(mockedApi.delete).not.toHaveBeenCalled();
      expect(screen.getByLabelText("Rôle de awa@test.local")).toBeInTheDocument();
    });

    it("confirmé : la bonne personne est révoquée et disparaît de la liste, pas l'autre", async () => {
      mockedApi.delete.mockResolvedValueOnce({ data: {} });
      const user = userEvent.setup();
      renderPage();
      await screen.findByLabelText("Rôle de awa@test.local");

      await user.click(screen.getAllByRole("button", { name: "Révoquer" })[0]);

      await waitFor(() => expect(mockedApi.delete).toHaveBeenCalledWith("/team/c1"));
      await waitFor(() => expect(screen.queryByLabelText("Rôle de awa@test.local")).not.toBeInTheDocument());
      expect(screen.getByLabelText("Rôle de moussa@test.local")).toBeInTheDocument();
    });

    it("refusé par le serveur : l'erreur est montrée et la personne reste dans la liste (son accès n'est PAS coupé)", async () => {
      mockedApi.delete.mockRejectedValueOnce(erreurServeur("Impossible de révoquer le dernier gestionnaire de l'agence."));
      const user = userEvent.setup();
      renderPage();
      await screen.findByLabelText("Rôle de awa@test.local");

      await user.click(screen.getAllByRole("button", { name: "Révoquer" })[0]);

      await waitFor(() => expect(window.alert).toHaveBeenCalledWith("Impossible de révoquer le dernier gestionnaire de l'agence."));
      expect(screen.getByLabelText("Rôle de awa@test.local")).toBeInTheDocument();
    });
  });
});
