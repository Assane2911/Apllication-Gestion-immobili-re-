import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { ThemeProvider } from "../context/ThemeContext";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { AuthProvider } from "../context/AuthContext";
import LoginPage from "./LoginPage";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

// GoogleSignInButton a ses propres tests (chargement du script Google
// Identity Services, callback...) — ici on ne teste que le câblage de
// LoginPage autour de lui : un double minimal suffit, piloté par deux
// boutons qui déclenchent onCredential / onError sur simple clic.
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

function renderPage(entree = "/login") {
  return render(
    <ThemeProvider><MemoryRouter initialEntries={[entree]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/dashboard" element={<p>Espace gestionnaire</p>} />
          <Route path="/portail" element={<p>Espace locataire</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter></ThemeProvider>
  );
}

// Le bouton « Retour » de l'application (et celui d'Android) fait un navigate(-1) : ce petit composant tient la place
// de la page d'arrivée pour savoir où l'on retombe en reculant.
function PageAvecRetour({ titre }: { titre: string }) {
  const navigate = useNavigate();
  return (
    <div>
      <p>{titre}</p>
      <button type="button" onClick={() => navigate(-1)}>
        Reculer
      </button>
    </div>
  );
}

function renderDepuisLaLanding() {
  return render(
    <ThemeProvider><MemoryRouter initialEntries={["/landing", "/login"]} initialIndex={1}>
      <AuthProvider>
        <Routes>
          <Route path="/landing" element={<p>Page d'accueil</p>} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/dashboard" element={<PageAvecRetour titre="Espace gestionnaire" />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter></ThemeProvider>
  );
}

describe("LoginPage", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
  });

  it("affiche le formulaire de connexion", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Gestion Immobilière" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Mot de passe")).toBeInTheDocument();
  });

  it("explique la suspension quand l'intercepteur renvoie ici avec ?suspended=1", () => {
    renderPage("/login?suspended=1");
    expect(
      screen.getByText("Votre compte est suspendu. Contactez le support de la plateforme pour en savoir plus.")
    ).toBeInTheDocument();
  });

  it("explique la déconnexion à l'inactivité quand on arrive avec ?inactif=1", () => {
    renderPage("/login?inactif=1");
    expect(
      screen.getByText("Vous avez été déconnecté après une période d'inactivité. Reconnectez-vous pour continuer.")
    ).toBeInTheDocument();
  });

  it("confirme la déconnexion volontaire quand on arrive avec ?deconnecte=1, sans la présenter comme une erreur", () => {
    renderPage("/login?deconnecte=1");
    const message = screen.getByRole("status");
    expect(message).toHaveTextContent("Vous avez été déconnecté. À bientôt !");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("n'affiche pas ce message à l'arrivée normale, ni après une déconnexion pour inactivité", () => {
    const { unmount } = renderPage();
    expect(screen.queryByText(/À bientôt/)).not.toBeInTheDocument();
    unmount();
    renderPage("/login?inactif=1");
    expect(screen.queryByText(/À bientôt/)).not.toBeInTheDocument();
  });

  it("le message s'efface quand on commence une nouvelle connexion", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockRejectedValueOnce(new Error("réseau"));
    renderPage("/login?deconnecte=1");
    expect(screen.getByRole("status")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Email"), "agence@test.local");
    await user.type(screen.getByLabelText("Mot de passe"), "Password123!");
    await user.click(screen.getByRole("button", { name: /Se connecter/ }));
    expect(screen.queryByText("Vous avez été déconnecté. À bientôt !")).not.toBeInTheDocument();
  });

  it("n'affiche aucun message d'erreur à l'arrivée normale sur la page", () => {
    renderPage();
    expect(screen.queryByText(/suspendu/)).not.toBeInTheDocument();
  });

  it("connecte le gestionnaire et redirige vers son tableau de bord", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValueOnce({
      data: {
        token: "tok_123",
        user: { id: "mgr-1", email: "agence@test.local", role: "MANAGER" },
      },
    });
    renderPage();

    await user.type(screen.getByLabelText("Email"), "agence@test.local");
    await user.type(screen.getByLabelText("Mot de passe"), "Password123!");
    await user.click(screen.getByRole("button", { name: "Se connecter" }));

    await waitFor(() => expect(screen.getByText("Espace gestionnaire")).toBeInTheDocument());
    expect(mockedApi.post).toHaveBeenCalledWith("/auth/login", { email: "agence@test.local", password: "Password123!" });
    // Web : la session voyage dans le cookie httpOnly posé par le serveur, pas
    // dans localStorage (voir AuthContext.tsx / AuthContext.native.test.tsx
    // pour le comportement de l'app mobile Capacitor).
    expect(localStorage.getItem("token")).toBeNull();
  });

  it("redirige un locataire vers son portail", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValueOnce({
      data: {
        token: "tok_456",
        user: { id: "tenant-1", email: "locataire@test.local", role: "TENANT" },
      },
    });
    renderPage();

    await user.type(screen.getByLabelText("Email"), "locataire@test.local");
    await user.type(screen.getByLabelText("Mot de passe"), "Password123!");
    await user.click(screen.getByRole("button", { name: "Se connecter" }));

    await waitFor(() => expect(screen.getByText("Espace locataire")).toBeInTheDocument());
  });

  it("affiche l'erreur du serveur en cas d'échec", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockRejectedValueOnce({
      response: { data: { error: "Email ou mot de passe incorrect" } },
      isAxiosError: true,
    });
    renderPage();

    await user.type(screen.getByLabelText("Email"), "agence@test.local");
    await user.type(screen.getByLabelText("Mot de passe"), "mauvais-mdp");
    await user.click(screen.getByRole("button", { name: "Se connecter" }));

    await waitFor(() => expect(screen.getByText("Email ou mot de passe incorrect")).toBeInTheDocument());
  });

  it("propose de renvoyer l'email de confirmation quand le compte n'est pas vérifié", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockRejectedValueOnce({
      response: { data: { error: "Confirme ton email avant de te connecter", code: "EMAIL_NOT_VERIFIED" } },
      isAxiosError: true,
    });
    renderPage();

    await user.type(screen.getByLabelText("Email"), "pas-encore-verifie@test.local");
    await user.type(screen.getByLabelText("Mot de passe"), "Password123!");
    await user.click(screen.getByRole("button", { name: "Se connecter" }));

    const resendButton = await screen.findByRole("button", { name: "Renvoyer l'email de confirmation" });

    mockedApi.post.mockResolvedValueOnce({ data: { success: true } });
    await user.click(resendButton);

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith("/auth/resend-verification", { email: "pas-encore-verifie@test.local" })
    );
    expect(await screen.findByText(/Email renvoyé/)).toBeInTheDocument();
  });

  it("ne montre pas le bouton Google si VITE_GOOGLE_CLIENT_ID n'est pas configuré", () => {
    renderPage();
    expect(screen.queryByRole("button", { name: "Simuler connexion Google" })).not.toBeInTheDocument();
  });
});

describe("LoginPage — double authentification (2FA)", () => {
  beforeEach(() => {
    mockedApi.post.mockReset();
  });

  it("affiche l'étape du code quand le serveur répond twoFactorRequired, sans naviguer", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValueOnce({ data: { twoFactorRequired: true, pendingToken: "jeton-intermediaire" } });
    renderPage();

    await user.type(screen.getByLabelText("Email"), "2fa@test.local");
    await user.type(screen.getByLabelText("Mot de passe"), "Password123!");
    await user.click(screen.getByRole("button", { name: "Se connecter" }));

    expect(await screen.findByLabelText("Code de vérification")).toBeInTheDocument();
    expect(screen.queryByText("Espace gestionnaire")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });

  it("valide le code et redirige vers le tableau de bord", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValueOnce({ data: { twoFactorRequired: true, pendingToken: "jeton-intermediaire" } });
    renderPage();
    await user.type(screen.getByLabelText("Email"), "2fa@test.local");
    await user.type(screen.getByLabelText("Mot de passe"), "Password123!");
    await user.click(screen.getByRole("button", { name: "Se connecter" }));
    await screen.findByLabelText("Code de vérification");

    mockedApi.post.mockResolvedValueOnce({
      data: { token: "tok_final", user: { id: "mgr-1", email: "2fa@test.local", role: "MANAGER" } },
    });
    await user.type(screen.getByLabelText("Code de vérification"), "123456");
    await user.click(screen.getByRole("button", { name: "Vérifier" }));

    await waitFor(() => expect(screen.getByText("Espace gestionnaire")).toBeInTheDocument());
    expect(mockedApi.post).toHaveBeenLastCalledWith("/auth/2fa/verify-login", {
      pendingToken: "jeton-intermediaire",
      code: "123456",
    });
  });

  it("affiche l'erreur du serveur pour un code incorrect, sans quitter l'étape 2FA", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValueOnce({ data: { twoFactorRequired: true, pendingToken: "jeton-intermediaire" } });
    renderPage();
    await user.type(screen.getByLabelText("Email"), "2fa@test.local");
    await user.type(screen.getByLabelText("Mot de passe"), "Password123!");
    await user.click(screen.getByRole("button", { name: "Se connecter" }));
    await screen.findByLabelText("Code de vérification");

    mockedApi.post.mockRejectedValueOnce({
      response: { data: { error: "Code invalide ou expiré." } },
      isAxiosError: true,
    });
    await user.type(screen.getByLabelText("Code de vérification"), "000000");
    await user.click(screen.getByRole("button", { name: "Vérifier" }));

    expect(await screen.findByText("Code invalide ou expiré.")).toBeInTheDocument();
    expect(screen.getByLabelText("Code de vérification")).toBeInTheDocument();
  });

  it("le bouton « Retour à la connexion » revient au formulaire email/mot de passe", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValueOnce({ data: { twoFactorRequired: true, pendingToken: "jeton-intermediaire" } });
    renderPage();
    await user.type(screen.getByLabelText("Email"), "2fa@test.local");
    await user.type(screen.getByLabelText("Mot de passe"), "Password123!");
    await user.click(screen.getByRole("button", { name: "Se connecter" }));
    await screen.findByLabelText("Code de vérification");

    await user.click(screen.getByRole("button", { name: "Retour à la connexion" }));

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.queryByLabelText("Code de vérification")).not.toBeInTheDocument();
  });
});

describe("LoginPage — connexion avec Google (VITE_GOOGLE_CLIENT_ID configuré)", () => {
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

  it("connecte le gestionnaire via Google et redirige vers son tableau de bord", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValueOnce({
      data: {
        token: "tok_google_1",
        user: { id: "mgr-google-1", email: "gestionnaire@test.local", role: "MANAGER" },
      },
    });
    renderPage();

    await user.click(screen.getByRole("button", { name: "Simuler connexion Google" }));

    await waitFor(() => expect(screen.getByText("Espace gestionnaire")).toBeInTheDocument());
    expect(mockedApi.post).toHaveBeenCalledWith("/auth/google", { credential: "fake-google-credential" });
    expect(localStorage.getItem("token")).toBeNull();
  });

  it("affiche l'erreur du serveur si la connexion Google est refusée (ex: compte non gestionnaire)", async () => {
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
  it("place le formulaire de connexion dans un repère <main>", () => {
    renderPage();
    expect(screen.getByRole("main")).toBeInTheDocument();
  });
  it("après la connexion, reculer ne ramène pas au formulaire : la page de connexion ne reste pas dans l'historique", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValueOnce({
      data: { token: "tok_123", user: { id: "mgr-1", email: "agence@test.local", role: "MANAGER" } },
    });
    renderDepuisLaLanding();

    await user.type(screen.getByLabelText("Email"), "agence@test.local");
    await user.type(screen.getByLabelText("Mot de passe"), "Password123!");
    await user.click(screen.getByRole("button", { name: "Se connecter" }));
    await waitFor(() => expect(screen.getByText("Espace gestionnaire")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Reculer" }));

    expect(screen.getByText("Page d'accueil")).toBeInTheDocument();
    expect(screen.queryByLabelText("Mot de passe")).not.toBeInTheDocument();
  });

  it("après la validation du second facteur, la page de connexion ne reste pas non plus dans l'historique", async () => {
    const user = userEvent.setup();
    mockedApi.post
      .mockResolvedValueOnce({ data: { twoFactorRequired: true, pendingToken: "pending-1" } })
      .mockResolvedValueOnce({
        data: { token: "tok_2fa", user: { id: "mgr-1", email: "agence@test.local", role: "MANAGER" } },
      });
    renderDepuisLaLanding();

    await user.type(screen.getByLabelText("Email"), "agence@test.local");
    await user.type(screen.getByLabelText("Mot de passe"), "Password123!");
    await user.click(screen.getByRole("button", { name: "Se connecter" }));
    await user.type(await screen.findByLabelText(/code/i), "123456");
    await user.click(screen.getByRole("button", { name: /vérifier|valider|confirmer/i }));
    await waitFor(() => expect(screen.getByText("Espace gestionnaire")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Reculer" }));

    expect(screen.getByText("Page d'accueil")).toBeInTheDocument();
  });

  it("un utilisateur déjà connecté qui revient sur /login est renvoyé vers son espace, sans formulaire de connexion", () => {
    localStorage.setItem("user", JSON.stringify({ id: "mgr-1", email: "agence@test.local", role: "MANAGER" }));
    renderPage();

    expect(screen.getByText("Espace gestionnaire")).toBeInTheDocument();
    expect(screen.queryByLabelText("Mot de passe")).not.toBeInTheDocument();
  });
});
