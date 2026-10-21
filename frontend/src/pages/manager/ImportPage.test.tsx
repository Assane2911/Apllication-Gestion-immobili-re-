import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError } from "axios";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import ImportPage from "./ImportPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});
const mockedApi = vi.mocked(api, { deep: true });

const CSV = "titre;adresse;surface;loyer\nStudio A;1 rue X;28;250000\nVilla B;;120;900";

function analyse(overrides: Record<string, unknown> = {}) {
  return {
    type: "properties",
    delimiteur: ";",
    resume: { total: 3, valides: 1, doublons: 1, erreurs: 1 },
    lignes: [
      { ligne: 2, statut: "OK", messages: [], donnees: { title: "Studio A", address: "1 rue X" } },
      { ligne: 3, statut: "ERREUR", messages: ["Adresse manquante ou trop courte (2 caractères minimum)."], donnees: { title: "Villa B", address: "" } },
      { ligne: 4, statut: "DOUBLON", messages: ["Un bien avec ce titre et cette adresse existe déjà."], donnees: { title: "Loft C", address: "8 quai" } },
    ],
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ImportPage />
    </MemoryRouter>
  );
}

async function deposer(user: ReturnType<typeof userEvent.setup>, contenu = CSV, nom = "biens.csv") {
  await user.upload(screen.getByLabelText("Choisir un fichier CSV", { selector: "input" }), new File([contenu], nom, { type: "text/csv" }));
}

beforeEach(() => {
  mockedApi.get.mockReset();
  mockedApi.post.mockReset();
});

describe("ImportPage", () => {
  it("analyse le fichier choisi sans rien importer, et montre le résumé, chaque ligne et les messages", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValueOnce({ data: analyse() });
    renderPage();
    await deposer(user);

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith("/import/preview", { type: "properties", csv: CSV }));
    expect(mockedApi.post).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Studio A — 1 rue X")).toBeInTheDocument();
    expect(screen.getByText("Adresse manquante ou trop courte (2 caractères minimum).")).toBeInTheDocument();
    const lignes = screen.getAllByRole("row");
    expect(within(lignes[1]).getByText("Prête")).toBeInTheDocument();
    expect(within(lignes[2]).getByText("Erreur")).toBeInTheDocument();
    expect(within(lignes[3]).getByText("Doublon")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Importer 1 ligne(s) valide(s)" })).toBeEnabled();
  });

  it("traduit les messages de chaque ligne dans la langue de l'interface, avec la valeur lue dans le fichier", async () => {
    const { changerLangue } = await import("../../i18n");
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValueOnce({
      data: analyse({
        lignes: [
          {
            ligne: 3,
            statut: "ERREUR",
            messages: ["Surface invalide : « abc »."],
            details: [{ code: "IMPORT_ROW_AREA_INVALID", params: { value: "abc" } }],
            donnees: { title: "Loft", address: "8 quai" },
          },
        ],
      }),
    });
    await changerLangue("en");
    try {
      renderPage();
      await user.upload(screen.getByLabelText(/CSV/, { selector: "input" }), new File([CSV], "biens.csv", { type: "text/csv" }));
      expect(await screen.findByText("Invalid area: “abc”.")).toBeInTheDocument();
      expect(screen.queryByText("Surface invalide : « abc ».")).not.toBeInTheDocument();
    } finally {
      await changerLangue("fr");
    }
  });

  it("sans code (ancien serveur) ou avec un code inconnu, le message français du serveur reste affiché", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValueOnce({
      data: analyse({
        lignes: [
          { ligne: 3, statut: "ERREUR", messages: ["Message sans code."], donnees: { title: "A", address: "x" } },
          { ligne: 4, statut: "ERREUR", messages: ["Message au code inconnu."], details: [{ code: "CODE_QUI_NEXISTE_PAS" }], donnees: { title: "B", address: "y" } },
        ],
      }),
    });
    renderPage();
    await deposer(user);

    expect(await screen.findByText("Message sans code.")).toBeInTheDocument();
    expect(screen.getByText("Message au code inconnu.")).toBeInTheDocument();
  });

  it("importe sur confirmation, annonce le résultat et les lignes ignorées", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValueOnce({ data: analyse() });
    mockedApi.post.mockResolvedValueOnce({ data: analyse({ importees: 1 }) });
    renderPage();
    await deposer(user);
    await user.click(await screen.findByRole("button", { name: /Importer 1 ligne/ }));

    await waitFor(() => expect(mockedApi.post).toHaveBeenLastCalledWith("/import", { type: "properties", csv: CSV }));
    expect(await screen.findByText("1 biens importé(s).")).toBeInTheDocument();
    expect(screen.getByText(/1 doublon\(s\) et 1 ligne\(s\) en erreur ont été ignorés/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Voir les biens" })).toHaveAttribute("href", "/properties");
    expect(screen.queryByRole("button", { name: /Importer 1 ligne/ })).not.toBeInTheDocument();
  });

  it("ne propose pas d'importer quand aucune ligne n'est valide", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValueOnce({
      data: analyse({ resume: { total: 1, valides: 0, doublons: 0, erreurs: 1 }, lignes: [{ ligne: 2, statut: "ERREUR", messages: ["x"], donnees: {} }] }),
    });
    renderPage();
    await deposer(user);
    expect(await screen.findByRole("button", { name: "Importer 0 ligne(s) valide(s)" })).toBeDisabled();
  });

  it("affiche l'erreur de format renvoyée par le serveur (colonnes manquantes)", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockRejectedValueOnce(
      new AxiosError("Bad Request", "ERR_BAD_REQUEST", undefined, undefined, { status: 400, data: { error: "Colonnes manquantes : « surface »" } } as never)
    );
    renderPage();
    await deposer(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("Colonnes manquantes");
    expect(screen.queryByRole("button", { name: /Importer/ })).not.toBeInTheDocument();
  });

  it("prévient quand le fichier a un encodage illisible", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValueOnce({ data: analyse() });
    renderPage();
    await deposer(user, "titre;adresse;surface;loyer\nCaf�;1 rue X;28;100");
    expect(await screen.findByText(/caractères illisibles/)).toBeInTheDocument();
  });

  it("changer de type de données repart de zéro et analyse pour le bon type", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValueOnce({ data: analyse() });
    mockedApi.post.mockResolvedValueOnce({
      data: analyse({ type: "tenants", resume: { total: 1, valides: 1, doublons: 0, erreurs: 0 }, lignes: [{ ligne: 2, statut: "OK", messages: [], donnees: { firstName: "Moussa", lastName: "Diop", email: "m@x.com" } }] }),
    });
    renderPage();
    await deposer(user);
    await screen.findByText("Studio A — 1 rue X");

    await user.click(screen.getByRole("radio", { name: "Locataires" }));
    expect(screen.queryByText("Studio A — 1 rue X")).not.toBeInTheDocument();
    expect(screen.getByText(/prénom, nom, téléphone/)).toBeInTheDocument();

    await deposer(user, "prenom;nom;telephone;email\nMoussa;Diop;+221771234567;m@x.com", "locataires.csv");
    await waitFor(() => expect(mockedApi.post).toHaveBeenLastCalledWith("/import/preview", expect.objectContaining({ type: "tenants" })));
    expect(await screen.findByText("Moussa Diop — m@x.com")).toBeInTheDocument();
  });

  it("indique la place restante dans la formule pour les biens", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValueOnce({ data: analyse({ capacite: { maximum: 5, existants: 2, restant: 3 } }) });
    renderPage();
    await deposer(user);
    expect(await screen.findByText(/2 bien\(s\) sur 5 autorisés, 3 place\(s\) restante\(s\)/)).toBeInTheDocument();
  });

  it("télécharge le modèle du type choisi", async () => {
    const user = userEvent.setup();
    URL.createObjectURL = vi.fn().mockReturnValue("blob:x");
    URL.revokeObjectURL = vi.fn();
    mockedApi.get.mockResolvedValueOnce({ data: new Blob(["x"]) });
    renderPage();
    await user.click(screen.getByRole("button", { name: /Télécharger le modèle/ }));
    await waitFor(() => expect(mockedApi.get).toHaveBeenCalledWith("/import/modele/properties", { responseType: "blob" }));
  });

  it("contrats : explique que seul l'avenir est facturé et montre le mois de la première facture de chaque ligne", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValueOnce({
      data: {
        type: "contracts",
        delimiteur: ";",
        resume: { total: 2, valides: 1, doublons: 0, erreurs: 1 },
        lignes: [
          { ligne: 2, statut: "OK", messages: [], donnees: { property: "Studio A", tenantEmail: "m@x.com", premiereFacture: "11/2026" } },
          { ligne: 3, statut: "ERREUR", messages: ["Bien introuvable : « Villa Z »."], donnees: { property: "Villa Z", tenantEmail: "m@x.com", premiereFacture: null } },
        ],
      },
    });
    renderPage();

    await user.click(screen.getByRole("radio", { name: "Contrats" }));
    expect(screen.getByText(/bien \(titre\), email_locataire, loyer/)).toBeInTheDocument();
    expect(screen.getByText(/Seuls les loyers à venir sont facturés/)).toBeInTheDocument();

    await deposer(user, "bien;email_locataire;loyer;depot;debut;fin\nStudio A;m@x.com;1;0;01/01/2026;01/01/2027", "contrats.csv");
    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith("/import/preview", expect.objectContaining({ type: "contracts" })));
    expect(await screen.findByText("Studio A — m@x.com")).toBeInTheDocument();
    expect(screen.getByText("Première facture : 11/2026")).toBeInTheDocument();
    // Une ligne en erreur n'affiche pas de première facture.
    expect(screen.getAllByText(/Première facture/)).toHaveLength(1);
    expect(screen.getByText("Bien introuvable : « Villa Z »."));
  });

  it("contrats : le modèle téléchargé porte le bon nom", async () => {
    const user = userEvent.setup();
    URL.createObjectURL = vi.fn().mockReturnValue("blob:x");
    URL.revokeObjectURL = vi.fn();
    mockedApi.get.mockResolvedValueOnce({ data: new Blob(["x"]) });
    renderPage();
    await user.click(screen.getByRole("radio", { name: "Contrats" }));
    await user.click(screen.getByRole("button", { name: /Télécharger le modèle/ }));
    await waitFor(() => expect(mockedApi.get).toHaveBeenCalledWith("/import/modele/contracts", { responseType: "blob" }));
  });
});
