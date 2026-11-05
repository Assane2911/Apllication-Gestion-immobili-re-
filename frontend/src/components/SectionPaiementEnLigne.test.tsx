import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import SectionPaiementEnLigne from "./SectionPaiementEnLigne";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});
const mocked = vi.mocked(api, { deep: true });

const compte = (surcharge: Record<string, unknown> = {}) => ({
  configure: false,
  enabled: false,
  mode: "test",
  currency: "XOF",
  tokenLast4: "",
  disponible: true,
  ...surcharge,
});

beforeEach(() => {
  mocked.get.mockReset();
  mocked.put.mockReset();
  mocked.patch.mockReset();
  mocked.delete.mockReset();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("SectionPaiementEnLigne", () => {
  it("propose le formulaire quand l'agence n'a pas de compte, et enregistre les identifiants saisis", async () => {
    mocked.get.mockResolvedValue({ data: compte() });
    mocked.put.mockResolvedValue({ data: compte({ configure: true, enabled: true, mode: "live", tokenLast4: "9876" }) });
    render(<SectionPaiementEnLigne numero="06" lectureSeule={false} />);

    const principale = await screen.findByLabelText(/Clé principale/);
    await userEvent.type(principale, "master-key-123");
    await userEvent.type(screen.getByLabelText(/Clé privée/), "private-key-123");
    await userEvent.type(screen.getByLabelText(/Jeton/), "token-xx-9876");
    await userEvent.selectOptions(screen.getByLabelText("Mode"), "live");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer le compte" }));

    await waitFor(() =>
      expect(mocked.put).toHaveBeenCalledWith("/agency/payment-account", {
        masterKey: "master-key-123",
        privateKey: "private-key-123",
        token: "token-xx-9876",
        mode: "live",
        currency: "XOF",
        enabled: true,
      })
    );
    expect(await screen.findByText("Compte de paiement enregistré.")).toBeInTheDocument();
    // Les identifiants disparaissent de l'écran : on ne voit plus que la fin du jeton.
    expect(screen.queryByLabelText(/Clé principale/)).not.toBeInTheDocument();
    expect(screen.getByText(/jeton se terminant par …9876/)).toBeInTheDocument();
  });

  it("n'affiche jamais les identifiants d'un compte existant, seulement la fin du jeton", async () => {
    mocked.get.mockResolvedValue({ data: compte({ configure: true, enabled: true, mode: "test", tokenLast4: "4321" }) });
    render(<SectionPaiementEnLigne numero="06" lectureSeule={false} />);

    expect(await screen.findByText("Actif")).toBeInTheDocument();
    expect(screen.getByText(/jeton se terminant par …4321/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Clé principale/)).not.toBeInTheDocument();
    expect(screen.getByText(/Mode test : aucun vrai paiement/)).toBeInTheDocument();
  });

  it("suspend le compte", async () => {
    mocked.get.mockResolvedValue({ data: compte({ configure: true, enabled: true, tokenLast4: "4321" }) });
    mocked.patch.mockResolvedValue({ data: compte({ configure: true, enabled: false, tokenLast4: "4321" }) });
    render(<SectionPaiementEnLigne numero="06" lectureSeule={false} />);

    await userEvent.click(await screen.findByRole("button", { name: "Suspendre" }));

    expect(mocked.patch).toHaveBeenCalledWith("/agency/payment-account", { enabled: false });
    expect(await screen.findByText("Suspendu")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Réactiver" })).toBeInTheDocument();
  });

  it("supprime le compte après confirmation", async () => {
    mocked.get.mockResolvedValue({ data: compte({ configure: true, enabled: true, tokenLast4: "4321" }) });
    mocked.delete.mockResolvedValue({ data: undefined });
    render(<SectionPaiementEnLigne numero="06" lectureSeule={false} />);

    await userEvent.click(await screen.findByRole("button", { name: "Supprimer le compte" }));

    expect(window.confirm).toHaveBeenCalled();
    expect(mocked.delete).toHaveBeenCalledWith("/agency/payment-account");
    expect(await screen.findByText("Compte de paiement supprimé.")).toBeInTheDocument();
    expect(await screen.findByLabelText(/Clé principale/)).toBeInTheDocument();
  });

  it("ne supprime rien si l'agence refuse la confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    mocked.get.mockResolvedValue({ data: compte({ configure: true, enabled: true, tokenLast4: "4321" }) });
    render(<SectionPaiementEnLigne numero="06" lectureSeule={false} />);

    await userEvent.click(await screen.findByRole("button", { name: "Supprimer le compte" }));

    expect(mocked.delete).not.toHaveBeenCalled();
  });

  it("n'offre pas le formulaire tant que la plateforme ne sait pas chiffrer les identifiants", async () => {
    mocked.get.mockResolvedValue({ data: compte({ disponible: false }) });
    render(<SectionPaiementEnLigne numero="06" lectureSeule={false} />);

    expect(await screen.findByText(/pas encore ouverte sur la plateforme/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Clé principale/)).not.toBeInTheDocument();
  });

  it("est en lecture seule pour un collaborateur", async () => {
    mocked.get.mockResolvedValue({ data: compte({ configure: true, enabled: true, tokenLast4: "4321" }) });
    render(<SectionPaiementEnLigne numero="06" lectureSeule />);

    expect(await screen.findByText("Actif")).toBeInTheDocument();
    expect(screen.getByText(/Seul le propriétaire de l'agence peut modifier ce compte/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Suspendre" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Supprimer le compte" })).not.toBeInTheDocument();
  });

  it("affiche l'erreur du serveur sans casser la page", async () => {
    mocked.get.mockResolvedValue({ data: compte() });
    mocked.put.mockRejectedValue({ isAxiosError: true, response: { status: 400, data: { error: "Jeton : valeur trop courte" } } });
    render(<SectionPaiementEnLigne numero="06" lectureSeule={false} />);

    await userEvent.type(await screen.findByLabelText(/Clé principale/), "master-key-123");
    await userEvent.type(screen.getByLabelText(/Clé privée/), "private-key-123");
    await userEvent.type(screen.getByLabelText(/Jeton/), "token-xx-9876");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer le compte" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("tolère une réponse inattendue", async () => {
    mocked.get.mockResolvedValue({ data: { echeances: [] } });
    render(<SectionPaiementEnLigne numero="06" lectureSeule={false} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Réponse inattendue du serveur");
  });
});
