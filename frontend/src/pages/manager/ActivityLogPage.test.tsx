import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { ActivityLogEntry } from "../../types";
import ActivityLogPage from "./ActivityLogPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function entry(overrides: Partial<ActivityLogEntry> = {}): ActivityLogEntry {
  return {
    id: "log-1",
    actorId: "mgr-1",
    actorRole: "MANAGER",
    actorLabel: "Agence du Port",
    action: "CREATE",
    entityType: "property",
    entityId: "prop-1",
    entityLabel: "Bien",
    details: "Création du bien Studio Centre-ville",
    createdAt: "2026-08-15T10:30:00.000Z",
    ...overrides,
  };
}

function reponse(items: ActivityLogEntry[], extra: { page?: number; total?: number; totalPages?: number } = {}) {
  return { data: { items, page: 1, pageSize: 20, total: items.length, totalPages: 1, ...extra } };
}

describe("ActivityLogPage", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
  });

  it("affiche les entrées du journal d'activité", async () => {
    mockedApi.get.mockResolvedValueOnce(reponse([entry()]));
    render(<ActivityLogPage />);

    await waitFor(() => expect(screen.getByText("Création du bien Studio Centre-ville")).toBeInTheDocument());
    expect(screen.getByText("Agence du Port")).toBeInTheDocument();
    expect(screen.getByText("Bien")).toBeInTheDocument();
  });

  it("affiche un état vide quand aucune activité n'a été enregistrée", async () => {
    mockedApi.get.mockResolvedValueOnce(reponse([]));
    render(<ActivityLogPage />);

    await waitFor(() => expect(screen.getByText("Aucune activité pour l'instant")).toBeInTheDocument());
  });

  it("filtre par catégorie et relance l'appel avec le paramètre entityType", async () => {
    mockedApi.get.mockResolvedValueOnce(reponse([entry()]));
    render(<ActivityLogPage />);
    await waitFor(() => expect(screen.getByText("Création du bien Studio Centre-ville")).toBeInTheDocument());

    mockedApi.get.mockResolvedValueOnce(reponse([entry({ entityType: "issue", entityLabel: "Incident" })]));
    await userEvent.setup().selectOptions(screen.getByLabelText("Filtrer par catégorie"), "issue");

    await waitFor(() =>
      expect(mockedApi.get).toHaveBeenLastCalledWith("/activity-log", {
        params: { page: 1, pageSize: 20, entityType: "issue" },
        signal: expect.anything(),
      })
    );
  });

  it("affiche une erreur avec un bouton pour réessayer en cas d'échec de chargement", async () => {
    mockedApi.get.mockRejectedValueOnce({
      response: { data: { error: "Erreur serveur" } },
      isAxiosError: true,
    });
    render(<ActivityLogPage />);

    await waitFor(() => expect(screen.getByText("Erreur serveur")).toBeInTheDocument());

    mockedApi.get.mockResolvedValueOnce(reponse([entry()]));
    await userEvent.setup().click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(screen.getByText("Création du bien Studio Centre-ville")).toBeInTheDocument());
  });

  it("pagine le journal : page suivante, et retour à la page 1 quand le filtre change", async () => {
    mockedApi.get.mockResolvedValueOnce(reponse([entry()], { total: 45, totalPages: 3 }));
    render(<ActivityLogPage />);
    await waitFor(() => expect(screen.getByText("Création du bien Studio Centre-ville")).toBeInTheDocument());
    expect(mockedApi.get).toHaveBeenLastCalledWith("/activity-log", { params: { page: 1, pageSize: 20 }, signal: expect.anything() });

    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce(
      reponse([entry({ id: "log-2", details: "Entrée plus ancienne" })], { page: 2, total: 45, totalPages: 3 })
    );
    await user.click(screen.getByRole("button", { name: /suivant|next/i }));
    await waitFor(() => expect(screen.getByText("Entrée plus ancienne")).toBeInTheDocument());
    expect(mockedApi.get).toHaveBeenLastCalledWith("/activity-log", { params: { page: 2, pageSize: 20 }, signal: expect.anything() });

    mockedApi.get.mockResolvedValueOnce(reponse([entry({ entityType: "issue" })], { total: 1 }));
    await user.selectOptions(screen.getByLabelText("Filtrer par catégorie"), "issue");
    await waitFor(() =>
      expect(mockedApi.get).toHaveBeenLastCalledWith("/activity-log", {
        params: { page: 1, pageSize: 20, entityType: "issue" },
        signal: expect.anything(),
      })
    );
  });
});
