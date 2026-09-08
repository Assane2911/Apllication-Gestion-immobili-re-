import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import type { PaginatedResponse, Tenant } from "../../types";
import TenantsPage from "./TenantsPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function tenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: "ten-1",
    firstName: "Awa",
    lastName: "Diallo",
    phone: "0600000000",
    email: "awa@example.com",
    idDocument: null,
    userId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function paginated(items: Tenant[]): { data: PaginatedResponse<Tenant> } {
  return { data: { items, page: 1, pageSize: 20, total: items.length, totalPages: 1 } };
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
      <TenantsPage />
    </AuthProvider>
  );
}

// Les <label> du formulaire ne sont pas associés aux champs (pas de htmlFor) :
// on cible donc les champs par rôle + ordre. Ordre des "textbox" : Prénom,
// Nom, Téléphone, Email (input[type=email] a aussi le rôle "textbox").
function getFormFields() {
  const textboxes = screen.getAllByRole("textbox");
  return {
    firstName: textboxes[0],
    lastName: textboxes[1],
    phone: textboxes[2],
    email: textboxes[3],
  };
}

describe("TenantsPage (manager)", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
    mockedApi.put.mockReset();
    mockedApi.delete.mockReset();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "alert").mockImplementation(() => {});
  });

  it("affiche la liste des locataires (nom, téléphone, email)", async () => {
    mockedApi.get.mockResolvedValueOnce(paginated([tenant()]));
    renderPage();

    await waitFor(() => expect(screen.getAllByText("Awa Diallo").length).toBeGreaterThan(0));
    expect(screen.getAllByText("0600000000").length).toBeGreaterThan(0);
    expect(screen.getAllByText("awa@example.com").length).toBeGreaterThan(0);
  });

  it("affiche l'état vide avec un bouton d'ajout quand il n'y a aucun locataire", async () => {
    mockedApi.get.mockResolvedValueOnce(paginated([]));
    renderPage();

    await waitFor(() => expect(screen.getByText("Aucun locataire pour l'instant")).toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: "+ Ajouter un locataire" }).length).toBeGreaterThan(0);
  });

  it("affiche une erreur de chargement avec un bouton réessayer", async () => {
    mockedApi.get.mockRejectedValueOnce({
      response: { data: { error: "Erreur serveur" } },
      isAxiosError: true,
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("Erreur serveur")).toBeInTheDocument());

    mockedApi.get.mockResolvedValueOnce(paginated([tenant()]));
    await userEvent.setup().click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(screen.getAllByText("Awa Diallo").length).toBeGreaterThan(0));
  });

  it("crée un locataire : envoie un FormData avec les bons champs, y compris la pièce d'identité", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce(paginated([]));
    mockedApi.post.mockResolvedValueOnce({ data: { id: "ten-new" } });
    mockedApi.get.mockResolvedValueOnce(paginated([tenant({ id: "ten-new" })]));

    const { container } = renderPage();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "+ Ajouter un locataire" }).length).toBeGreaterThan(0));
    await user.click(screen.getAllByRole("button", { name: "+ Ajouter un locataire" })[0]);

    const fields = getFormFields();
    await user.type(fields.firstName, "Moussa");
    await user.type(fields.lastName, "Traoré");
    await user.type(fields.phone, "0611223344");
    await user.type(fields.email, "moussa@example.com");

    const file = new File(["fake-id-content"], "carte-identite.pdf", { type: "application/pdf" });
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledTimes(1));
    const [url, formData] = mockedApi.post.mock.calls[0];
    expect(url).toBe("/tenants");
    const entries = formDataEntries(formData as FormData);
    expect(entries.firstName).toBe("Moussa");
    expect(entries.lastName).toBe("Traoré");
    expect(entries.phone).toBe("0611223344");
    expect(entries.email).toBe("moussa@example.com");
    expect((entries.idDocument as File).name).toBe("carte-identite.pdf");

    await waitFor(() => expect(screen.queryByRole("button", { name: "Enregistrer" })).not.toBeInTheDocument());
  });

  it("modifie un locataire existant : pré-remplit le formulaire et envoie une requête PUT", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce(paginated([tenant({ id: "ten-1", firstName: "Awa" })]));
    mockedApi.put.mockResolvedValueOnce({ data: {} });
    mockedApi.get.mockResolvedValueOnce(paginated([tenant({ id: "ten-1", firstName: "Aminata" })]));

    renderPage();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Modifier" }).length).toBeGreaterThan(0));
    await user.click(screen.getAllByRole("button", { name: "Modifier" })[0]);

    const fields = getFormFields();
    const firstNameInput = fields.firstName as HTMLInputElement;
    expect(firstNameInput.value).toBe("Awa");
    await user.clear(firstNameInput);
    await user.type(firstNameInput, "Aminata");

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(mockedApi.put).toHaveBeenCalledTimes(1));
    const [url, formData] = mockedApi.put.mock.calls[0];
    expect(url).toBe("/tenants/ten-1");
    expect(formDataEntries(formData as FormData).firstName).toBe("Aminata");
  });

  it("supprime un locataire après confirmation", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce(paginated([tenant({ id: "ten-1" })]));
    mockedApi.delete.mockResolvedValueOnce({ data: {} });
    mockedApi.get.mockResolvedValueOnce(paginated([]));

    renderPage();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Supprimer" }).length).toBeGreaterThan(0));
    await user.click(screen.getAllByRole("button", { name: "Supprimer" })[0]);

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(mockedApi.delete).toHaveBeenCalledWith("/tenants/ten-1"));
  });

  it("voir la pièce d'identité : récupère une URL signée et ouvre un nouvel onglet", async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    mockedApi.get.mockResolvedValueOnce(paginated([tenant({ id: "ten-1", idDocument: "carte.pdf" })]));
    mockedApi.get.mockResolvedValueOnce({ data: { url: "https://signed.example/carte.pdf" } });

    renderPage();
    await waitFor(() => expect(screen.getAllByRole("button", { name: /Voir/ }).length).toBeGreaterThan(0));
    await user.click(screen.getAllByRole("button", { name: /Voir/ })[0]);

    await waitFor(() => expect(mockedApi.get).toHaveBeenCalledWith("/tenants/ten-1/id-document-url"));
    await waitFor(() =>
      expect(openSpy).toHaveBeenCalledWith("https://signed.example/carte.pdf", "_blank", "noopener,noreferrer")
    );
  });

  it("crée l'accès portail : envoie le mot de passe et affiche la confirmation", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce(paginated([tenant({ id: "ten-1", userId: null })]));
    mockedApi.post.mockResolvedValueOnce({ data: {} });
    mockedApi.get.mockResolvedValueOnce(paginated([tenant({ id: "ten-1", userId: "user-1" })]));

    renderPage();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Créer l'accès" }).length).toBeGreaterThan(0));
    await user.click(screen.getAllByRole("button", { name: "Créer l'accès" })[0]);

    await waitFor(() =>
      expect(screen.getByText("Créer l'accès portail pour Awa Diallo")).toBeInTheDocument()
    );
    const passwordInput = screen.getByRole("textbox");
    await user.type(passwordInput, "temp1234");

    // Le panneau de création d'accès portail est rendu AVANT le tableau/les
    // cartes dans le JSX : son bouton "Créer l'accès" (submit) est donc le
    // premier du DOM, avant les boutons déclencheurs de la liste (toujours
    // affichés côté client tant que tenant.userId n'a pas été rechargé).
    const submitButtons = screen.getAllByRole("button", { name: "Créer l'accès" });
    await user.click(submitButtons[0]);

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith("/tenants/ten-1/portal-account", { password: "temp1234" })
    );
    await waitFor(() =>
      expect(
        screen.getByText("Accès portail créé avec succès. Communiquez l'email et le mot de passe au locataire.")
      ).toBeInTheDocument()
    );
  });
});
