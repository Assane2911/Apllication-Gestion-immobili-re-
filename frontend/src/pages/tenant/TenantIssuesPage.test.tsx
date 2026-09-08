import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import type { Contract, IssueReport } from "../../types";
import TenantIssuesPage from "./TenantIssuesPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function contract(overrides: Partial<Contract> = {}): Contract {
  return {
    id: "c1",
    property: { title: "Studio Centre-ville", address: "1 rue de la Paix" },
    ...overrides,
  } as unknown as Contract;
}

function issue(overrides: Partial<IssueReport> = {}): IssueReport {
  return {
    id: "iss-1",
    contractId: "c1",
    tenantId: "ten-1",
    title: "Fuite d'eau sous l'évier",
    description: "Ça goutte depuis ce matin.",
    photoUrl: "/uploads/photo1.jpg",
    additionalPhotos: null,
    status: "OPEN",
    managerNote: null,
    createdAt: "2026-06-15T10:30:00.000Z",
    ...overrides,
  };
}

function formDataEntries(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  fd.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function renderPage() {
  return render(
    <AuthProvider>
      <TenantIssuesPage />
    </AuthProvider>
  );
}

describe("TenantIssuesPage", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
    URL.createObjectURL = vi.fn().mockReturnValue("blob:fake-preview");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(window, "alert").mockImplementation(() => {});
  });

  it("affiche l'historique des signalements avec galerie photos et statut", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: [issue({ additionalPhotos: JSON.stringify(["/uploads/photo2.jpg"]) })] });
    mockedApi.get.mockResolvedValueOnce({ data: [contract()] });

    renderPage();

    await waitFor(() => expect(screen.getByText("Fuite d'eau sous l'évier")).toBeInTheDocument());
    expect(screen.getByText("Ça goutte depuis ce matin.")).toBeInTheDocument();
    expect(screen.getByText("Ouvert")).toBeInTheDocument();
    expect(screen.getByAltText("Photo incident 1")).toBeInTheDocument();
    expect(screen.getByAltText("Photo incident 2")).toBeInTheDocument();
  });

  it("affiche la réponse du gestionnaire quand elle existe", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: [issue({ managerNote: "Un plombier passera demain matin." })] });
    mockedApi.get.mockResolvedValueOnce({ data: [contract()] });

    renderPage();

    await waitFor(() => expect(screen.getByText("Un plombier passera demain matin.")).toBeInTheDocument());
    expect(screen.getByText("Réponse de l'agence :")).toBeInTheDocument();
  });

  it("affiche un message quand il n'y a aucun signalement", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: [] });
    mockedApi.get.mockResolvedValueOnce({ data: [contract()] });

    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Aucun incident signalé. Tous vos équipements sont opérationnels !")).toBeInTheDocument()
    );
  });

  it("affiche une erreur de chargement avec un bouton réessayer", async () => {
    mockedApi.get.mockRejectedValueOnce({
      response: { data: { error: "Erreur serveur" } },
      isAxiosError: true,
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("Erreur serveur")).toBeInTheDocument());

    mockedApi.get.mockResolvedValueOnce({ data: [] });
    mockedApi.get.mockResolvedValueOnce({ data: [contract()] });
    await userEvent.setup().click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() =>
      expect(screen.getByText("Aucun incident signalé. Tous vos équipements sont opérationnels !")).toBeInTheDocument()
    );
  });

  it("le sélecteur de logement n'apparaît que si le locataire a plusieurs contrats actifs", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: [] });
    mockedApi.get.mockResolvedValueOnce({ data: [contract({ id: "c1" })] });
    renderPage();

    await waitFor(() => expect(screen.getByRole("button", { name: /Transmettre/ })).toBeInTheDocument());
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("empêche l'envoi du signalement sans photo jointe", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce({ data: [] });
    mockedApi.get.mockResolvedValueOnce({ data: [contract()] });
    renderPage();

    await waitFor(() => expect(screen.getByRole("button", { name: /Transmettre/ })).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText(/Fuite d'eau sous le lavabo/), "Serrure bloquée");
    await user.type(screen.getByPlaceholderText(/Expliquez ce qui s'est passé/), "Impossible d'ouvrir la porte du salon.");
    await user.click(screen.getByRole("button", { name: /Transmettre/ }));

    expect(screen.getByText("Merci de prendre ou joindre une photo du problème")).toBeInTheDocument();
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it("signale un nouvel incident : envoie le bon FormData avec la photo", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce({ data: [] });
    mockedApi.get.mockResolvedValueOnce({ data: [contract({ id: "c1" })] });
    mockedApi.post.mockResolvedValueOnce({ data: { id: "iss-new" } });
    mockedApi.get.mockResolvedValueOnce({ data: [issue({ id: "iss-new" })] });
    mockedApi.get.mockResolvedValueOnce({ data: [contract({ id: "c1" })] });

    const { container } = renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /Transmettre/ })).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText(/Fuite d'eau sous le lavabo/), "Serrure bloquée");
    await user.type(screen.getByPlaceholderText(/Expliquez ce qui s'est passé/), "Impossible d'ouvrir la porte du salon.");

    const file = new File(["fake-photo"], "photo.jpg", { type: "image/jpeg" });
    const photoInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(photoInput, file);

    await waitFor(() => expect(screen.getByAltText("Photo prête à l'envoi")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Transmettre/ }));

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledTimes(1));
    const [url, formData] = mockedApi.post.mock.calls[0];
    expect(url).toBe("/issues");
    const entries = formDataEntries(formData as FormData);
    expect(entries.contractId).toBe("c1");
    expect(entries.title).toBe("Serrure bloquée");
    expect(entries.description).toBe("Impossible d'ouvrir la porte du salon.");
    expect((entries.photo as File).name).toBe("photo.jpg");
  });

  it("ajoute une photo supplémentaire à un incident existant", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce({ data: [issue({ id: "iss-1" })] });
    mockedApi.get.mockResolvedValueOnce({ data: [contract()] });
    mockedApi.post.mockResolvedValueOnce({ data: {} });
    mockedApi.get.mockResolvedValueOnce({
      data: [issue({ id: "iss-1", additionalPhotos: JSON.stringify(["/uploads/photo2.jpg"]) })],
    });
    mockedApi.get.mockResolvedValueOnce({ data: [contract()] });

    const { container } = renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /Ajouter une photo à cet incident/ })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Ajouter une photo à cet incident/ }));

    const file = new File(["fake-photo-2"], "photo2.jpg", { type: "image/jpeg" });
    // Le 1er input file est celui du formulaire de nouveau signalement, le 2e
    // celui de l'ajout de photo à l'incident existant.
    const fileInputs = container.querySelectorAll('input[type="file"]');
    await user.upload(fileInputs[1] as HTMLInputElement, file);

    await user.click(screen.getByRole("button", { name: "Valider l'ajout de photo" }));

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledTimes(1));
    const [url, formData] = mockedApi.post.mock.calls[0];
    expect(url).toBe("/issues/iss-1/photo");
    expect((formDataEntries(formData as FormData).photo as File).name).toBe("photo2.jpg");
  });
});
