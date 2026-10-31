import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ThemeProvider } from "../context/ThemeContext";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { AuthProvider } from "../context/AuthContext";
import RegisterPage from "./RegisterPage";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

// Même double minimal que LoginPage.test.tsx — voir son commentaire.
vi.mock("../components/GoogleSignInButton", () => ({
  default: ({
    onCredential,
    onError,
  }: {
    onCredential: (credential: string) => void;
    onError?: () => void;
  }) => (
    <div>
      <button type="button" onClick={() => onCredential("fake-google-credential")}>
        Simuler connexion Google
      </button>
      <button type="button" onClick={() => onError?.()}>
        Simuler échec script Google
      </button>
    </div>
  ),
}));

const mockedApi = vi.mocked(api, { deep: true });

function renderPage(initialEntry = "/inscription") {
  return render(
    <ThemeProvider><MemoryRouter initialEntries={[initialEntry]}>
      <AuthProvider>
        <Routes>
          <Route path="/inscription" element={<RegisterPage />} />
          <Route path="/dashboard" element={<p>Espace gestionnaire</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter></ThemeProvider>
  );
}

async function fillForm(user: ReturnType<typeof userEvent.setup>, password = "Password123!", confirm = password, pays: string | null = "SN") {
  await user.type(screen.getByLabelText("Email"), "nouvelle-agence@test.local");
  await user.type(screen.getByLabelText("Mot de passe"), password);
  await user.type(screen.getByLabelText("Confirmer le mot de passe"), confirm);
  if (pays) await user.selectOptions(screen.getByLabelText("Pays de l'agence"), pays);
}

describe("RegisterPage", () => {
  beforeEach(() => {
    mockedApi.post.mockReset();
  });

  it("affiche le formulaire d'inscription", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Créer un compte" })).toBeInTheDocument();
  });

  it("refuse si les deux mots de passe ne correspondent pas, sans appeler l'API", async () => {
    const user = userEvent.setup();
    renderPage();

    await fillForm(user, "Password123!", "Autrechose1!");
    await user.click(screen.getByRole("button", { name: "Créer mon compte" }));

    expect(await screen.findByText("Les deux mots de passe ne correspondent pas.")).toBeInTheDocument();
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it("refuse un mot de passe trop court, sans appeler l'API", async () => {
    const user = userEvent.setup();
    renderPage();

    await fillForm(user, "court12", "court12");
    await user.click(screen.getByRole("button", { name: "Créer mon compte" }));

    expect(await screen.findByText("Le mot de passe doit contenir au moins 8 caractères.")).toBeInTheDocument();
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it("inscrit le gestionnaire et affiche l'écran d'attente de confirmation", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValueOnce({ data: { pendingVerification: true, email: "nouvelle-agence@test.local" } });
    renderPage();

    await fillForm(user);
    await user.click(screen.getByRole("button", { name: "Créer mon compte" }));

    expect(await screen.findByText("Vérifiez votre boîte mail")).toBeInTheDocument();
    expect(mockedApi.post).toHaveBeenCalledWith("/auth/register", {
      email: "nouvelle-agence@test.local",
      password: "Password123!",
      country: "SN",
    });
  });

  /**
   * Le pays de l'agence fixe les règles de location qui lui sont appliquées et la devise de son compte : il se choisit
   * à l'inscription, parmi la France et les huit pays de l'UEMOA, et ne se change plus ensuite.
   */
  it("propose la France et les huit pays de l'UEMOA, et rien d'autre", () => {
    renderPage();

    const select = screen.getByLabelText("Pays de l'agence") as HTMLSelectElement;
    const valeurs = Array.from(select.options).map((o) => o.value);

    expect(valeurs[0]).toBe("");
    expect(valeurs.slice(1).sort()).toEqual(["BF", "BJ", "CI", "FR", "GW", "ML", "NE", "SN", "TG"]);
  });

  it("refuse l'inscription sans pays, sans appeler l'API", async () => {
    const user = userEvent.setup();
    renderPage();

    await fillForm(user, "Password123!", "Password123!", null);
    await user.click(screen.getByRole("button", { name: "Créer mon compte" }));

    expect(await screen.findByText("Choisissez le pays de votre agence.")).toBeInTheDocument();
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it("annonce que le pays ne pourra plus être modifié", () => {
    renderPage();

    expect(screen.getByText(/Il ne pourra pas être modifié ensuite/)).toBeInTheDocument();
  });

  it("envoie le pays choisi (la France)", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValueOnce({ data: { pendingVerification: true } });
    renderPage();

    await fillForm(user, "Password123!", "Password123!", "FR");
    await user.click(screen.getByRole("button", { name: "Créer mon compte" }));

    await screen.findByText("Vérifiez votre boîte mail");
    expect(mockedApi.post).toHaveBeenCalledWith("/auth/register", expect.objectContaining({ country: "FR" }));
  });

  it("affiche l'erreur du serveur (ex: email déjà utilisé)", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockRejectedValueOnce({
      response: { data: { error: "Cet email est déjà utilisé" } },
      isAxiosError: true,
    });
    renderPage();

    await fillForm(user);
    await user.click(screen.getByRole("button", { name: "Créer mon compte" }));

    expect(await screen.findByText("Cet email est déjà utilisé")).toBeInTheDocument();
  });

  it("ne montre pas le bouton Google si VITE_GOOGLE_CLIENT_ID n'est pas configuré", () => {
    renderPage();
    expect(screen.queryByRole("button", { name: "Simuler connexion Google" })).not.toBeInTheDocument();
  });

  it("pré-remplit le code de parrainage depuis le lien partagé (?ref=CODE)", () => {
    renderPage("/inscription?ref=ab12cd34");
    expect(screen.getByLabelText("Code de parrainage (facultatif)")).toHaveValue("AB12CD34");
  });

  it("envoie le code de parrainage saisi à l'inscription", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValueOnce({ data: { pendingVerification: true } });
    renderPage();

    await fillForm(user);
    await user.type(screen.getByLabelText("Code de parrainage (facultatif)"), "parrain1");
    await user.click(screen.getByRole("button", { name: "Créer mon compte" }));

    expect(await screen.findByText("Vérifiez votre boîte mail")).toBeInTheDocument();
    expect(mockedApi.post).toHaveBeenCalledWith("/auth/register", {
      email: "nouvelle-agence@test.local",
      password: "Password123!",
      country: "SN",
      referralCode: "PARRAIN1",
    });
  });
});

describe("RegisterPage — inscription avec Google (VITE_GOOGLE_CLIENT_ID configuré)", () => {
  beforeEach(() => {
    mockedApi.post.mockReset();
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "test-client-id.apps.googleusercontent.com");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("affiche le bouton Google", () => {
    renderPage();
    expect(screen.getByRole("button", { name: "Simuler connexion Google" })).toBeInTheDocument();
  });

  it("crée le compte gestionnaire via Google (email déjà vérifié) et redirige directement, sans écran d'attente", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValueOnce({
      data: {
        token: "tok_google_reg",
        user: { id: "mgr-google-2", email: "nouvelle-agence-google@test.local", role: "MANAGER" },
      },
    });
    renderPage();

    await user.click(screen.getByRole("button", { name: "Simuler connexion Google" }));

    await waitFor(() => expect(screen.getByText("Espace gestionnaire")).toBeInTheDocument());
    expect(mockedApi.post).toHaveBeenCalledWith("/auth/google", { credential: "fake-google-credential" });
    expect(screen.queryByText("Vérifiez votre boîte mail")).not.toBeInTheDocument();
  });

  // Le code du lien de parrainage (?ref=) ou saisi dans le champ était ignoré dans ce parcours : le parrain ne recevait
  // jamais ses jours pour un filleul inscrit avec Google.
  it("transmet le code de parrainage (lien ou champ) à l'inscription Google", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValueOnce({
      data: { token: "tok_google_ref", user: { id: "mgr-google-3", email: "filleul@test.local", role: "MANAGER" } },
    });
    renderPage("/inscription?ref=ab12cd34");

    await user.click(screen.getByRole("button", { name: "Simuler connexion Google" }));

    await waitFor(() => expect(screen.getByText("Espace gestionnaire")).toBeInTheDocument());
    expect(mockedApi.post).toHaveBeenCalledWith("/auth/google", { credential: "fake-google-credential", referralCode: "AB12CD34" });
  });

  it("affiche l'erreur du serveur si la connexion Google est refusée", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockRejectedValueOnce({
      response: {
        data: { error: "La connexion avec Google est réservée aux comptes gestionnaire", code: "GOOGLE_LOGIN_WRONG_ROLE" },
      },
      isAxiosError: true,
    });
    renderPage();

    await user.click(screen.getByRole("button", { name: "Simuler connexion Google" }));

    expect(await screen.findByText("La connexion avec Google est réservée aux comptes gestionnaire")).toBeInTheDocument();
  });

  it("affiche un message d'erreur si le script Google échoue à charger", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Simuler échec script Google" }));

    expect(await screen.findByText("La connexion avec Google a échoué. Réessayez.")).toBeInTheDocument();
  });

  /** Régression a11y : le formulaire ne vivait dans aucun repère <main>. */
  it("place le formulaire d'inscription dans un repère <main>", () => {
    renderPage();
    expect(screen.getByRole("main")).toBeInTheDocument();
  });
  it("un utilisateur déjà connecté qui revient sur /inscription est renvoyé vers son espace, sans formulaire", () => {
    localStorage.setItem("user", JSON.stringify({ id: "mgr-1", email: "agence@test.local", role: "MANAGER" }));
    renderPage();

    expect(screen.getByText("Espace gestionnaire")).toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });
});
