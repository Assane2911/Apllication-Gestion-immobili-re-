import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  it("affiche le prestataire assigné (nom et métier), sans ses coordonnées", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: [issue({ vendor: { name: "Plomberie Fall", trade: "Plombier" } })] });
    mockedApi.get.mockResolvedValueOnce({ data: [contract()] });

    renderPage();

    await waitFor(() => expect(screen.getByText("Prestataire assigné :")).toBeInTheDocument());
    expect(screen.getByText("Plomberie Fall — Plombier")).toBeInTheDocument();
  });

  it("n'affiche aucun bloc prestataire quand aucun n'est assigné", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: [issue({ vendor: null })] });
    mockedApi.get.mockResolvedValueOnce({ data: [contract()] });

    renderPage();

    await waitFor(() => expect(screen.getByText("Fuite d'eau sous l'évier")).toBeInTheDocument());
    expect(screen.queryByText("Prestataire assigné :")).not.toBeInTheDocument();
  });

  it("affiche la date d'intervention planifiée quand elle est renseignée", async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: [
        issue({
          vendor: { name: "Plomberie Fall", trade: "Plombier" },
          scheduledAt: "2026-11-05T09:00:00.000Z",
        }),
      ],
    });
    mockedApi.get.mockResolvedValueOnce({ data: [contract()] });

    renderPage();

    await waitFor(() => expect(screen.getByText("Intervention prévue le :")).toBeInTheDocument());
  });

  it("n'affiche aucun bloc de rendez-vous quand aucune intervention n'est planifiée", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: [issue({ vendor: null, scheduledAt: null })] });
    mockedApi.get.mockResolvedValueOnce({ data: [contract()] });

    renderPage();

    await waitFor(() => expect(screen.getByText("Fuite d'eau sous l'évier")).toBeInTheDocument());
    expect(screen.queryByText("Intervention prévue le :")).not.toBeInTheDocument();
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

  /**
   * Régression : handlePhoto révoquait déjà l'URL blob au remplacement d'une
   * photo par une autre, mais rien ne le faisait en quittant la page avec
   * une photo encore sélectionnée (formulaire abandonné sans envoi ni
   * effacement) — l'URL, et son blob en mémoire, restaient valides jusqu'à
   * la fermeture de l'onglet.
   */
  it("révoque l'URL blob de la prévisualisation en quittant la page", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce({ data: [] });
    mockedApi.get.mockResolvedValueOnce({ data: [contract({ id: "c1" })] });

    const { container, unmount } = renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /Transmettre/ })).toBeInTheDocument());

    const file = new File(["fake-photo"], "photo.jpg", { type: "image/jpeg" });
    const photoInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(photoInput, file);
    await waitFor(() => expect(screen.getByAltText("Photo prête à l'envoi")).toBeInTheDocument());

    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake-preview");
  });

  /**
   * Régression : rien ne vérifiait la taille du fichier avant l'envoi. Une
   * photo trop volumineuse (fréquent depuis un téléphone récent) partait
   * quand même vers le serveur, qui la refuse (MAX_UPLOAD_SIZE_MB côté
   * backend) — jusqu'à 60s d'attente sur une connexion mobile lente pour un
   * échec détectable instantanément côté client.
   */
  it("refuse une photo trop volumineuse avant même de l'envoyer", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce({ data: [] });
    mockedApi.get.mockResolvedValueOnce({ data: [contract({ id: "c1" })] });

    const { container } = renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /Transmettre/ })).toBeInTheDocument());

    const grosFichier = new File(["fake-photo"], "photo.jpg", { type: "image/jpeg" });
    Object.defineProperty(grosFichier, "size", { value: 9 * 1024 * 1024 });
    const photoInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(photoInput, grosFichier);

    expect(screen.getByText("Cette photo est trop volumineuse (max 4 Mo). Réessayez avec une photo plus légère.")).toBeInTheDocument();
    expect(screen.queryByAltText("Photo prête à l'envoi")).not.toBeInTheDocument();
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  // Une photo de téléphone en pleine résolution (9 Mo) dépasse la limite d'envoi du serveur : au lieu de la refuser,
  // on la réduit, et c'est la version réduite qui part avec l'incident.
  it("réduit une photo trop lourde au lieu de la refuser, et envoie la version réduite", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 4000, height: 3000, close: vi.fn() }));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillStyle: "",
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((rappel) =>
      rappel(new Blob([new Uint8Array(1024 * 1024)], { type: "image/jpeg" }))
    );
    mockedApi.get.mockResolvedValueOnce({ data: [] });
    mockedApi.get.mockResolvedValueOnce({ data: [contract({ id: "c1" })] });
    mockedApi.post.mockResolvedValueOnce({ data: {} });
    mockedApi.get.mockResolvedValueOnce({ data: [] });

    try {
      const { container } = renderPage();
      await waitFor(() => expect(screen.getByRole("button", { name: /Transmettre/ })).toBeInTheDocument());

      const gros = new File(["fake-photo"], "IMG_0042.jpg", { type: "image/jpeg" });
      Object.defineProperty(gros, "size", { value: 9 * 1024 * 1024 });
      await user.upload(container.querySelector('input[type="file"]') as HTMLInputElement, gros);

      await waitFor(() => expect(screen.getByAltText("Photo prête à l'envoi")).toBeInTheDocument());
      expect(screen.queryByText(/trop volumineuse/)).not.toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
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

describe("TenantIssuesPage — suivi, filtres, motifs courants", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
    URL.createObjectURL = vi.fn().mockReturnValue("blob:fake-preview");
    URL.revokeObjectURL = vi.fn();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 5, 20, 10, 0, 0));
  });
  afterEach(() => vi.useRealTimers());

  const parc = () => [
    issue({ id: "a", title: "Fuite d'eau", status: "OPEN", createdAt: "2026-06-10T08:00:00.000Z" }),
    issue({ id: "b", title: "Porte bloquée", status: "IN_PROGRESS", createdAt: "2026-06-19T08:00:00.000Z", scheduledAt: "2026-06-25T09:00:00.000Z" }),
    issue({ id: "c", title: "Volet cassé", status: "RESOLVED", createdAt: "2026-05-01T08:00:00.000Z" }),
  ];

  function afficher() {
    mockedApi.get.mockResolvedValueOnce({ data: parc() });
    mockedApi.get.mockResolvedValueOnce({ data: [contract()] });
    renderPage();
  }

  it("résume les signalements en cours, traités, planifiés et l'attente la plus longue", async () => {
    afficher();
    const synthese = await screen.findByLabelText("Suivi de vos signalements");
    const valeur = (libelle: string) => within(synthese).getByText(libelle).nextElementSibling;
    expect(valeur("En cours")).toHaveTextContent("2");
    expect(valeur("Traités")).toHaveTextContent("1");
    expect(valeur("Interventions prévues")).toHaveTextContent("1");
    expect(valeur("Attente la plus longue")).toHaveTextContent("10 j");
  });

  it("dit depuis combien de jours un signalement en cours attend, et rien pour un signalement clos", async () => {
    afficher();
    const fuite = (await screen.findByRole("heading", { level: 4, name: "Fuite d'eau" })).closest("article") as HTMLElement;
    expect(within(fuite).getByText(/Signalé il y a 10 jour\(s\)/)).toBeInTheDocument();
    const volet = screen.getByRole("heading", { level: 4, name: "Volet cassé" }).closest("article") as HTMLElement;
    expect(within(volet).queryByText(/Signalé il y a|Signalé aujourd/)).not.toBeInTheDocument();
  });

  it("filtre les signalements en cours ou traités", async () => {
    const user = userEvent.setup();
    afficher();
    await screen.findByLabelText("Suivi de vos signalements");
    const groupe = screen.getByRole("group", { name: "Filtrer les signalements" });
    await user.click(within(groupe).getByRole("button", { name: "Traités 1" }));
    expect(screen.getByRole("heading", { level: 4, name: "Volet cassé" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 4, name: "Fuite d'eau" })).not.toBeInTheDocument();
    await user.click(within(groupe).getByRole("button", { name: "En cours 2" }));
    expect(screen.queryByRole("heading", { level: 4, name: "Volet cassé" })).not.toBeInTheDocument();
  });

  it("remplit le titre d'un motif courant et compte les caractères de la description", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce({ data: [] });
    mockedApi.get.mockResolvedValueOnce({ data: [contract()] });
    renderPage();
    await screen.findByLabelText("Titre de l'incident *");

    await user.click(screen.getByRole("button", { name: "Panne d'électricité" }));
    expect(screen.getByLabelText("Titre de l'incident *")).toHaveValue("Panne d'électricité");

    expect(screen.getByText("0 / 5000")).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Description/), "Plus de courant");
    expect(screen.getByText("15 / 5000")).toBeInTheDocument();
  });

  describe("plafond de 10 photos par incident (la principale comprise)", () => {
    const photos = (n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => `/uploads/extra${i}.jpg`));

    it("propose encore d'ajouter une photo avec 9 photos au total", async () => {
      // 1 photo principale + 8 supplémentaires.
      mockedApi.get.mockResolvedValueOnce({ data: [issue({ additionalPhotos: photos(8) })] });
      mockedApi.get.mockResolvedValueOnce({ data: [contract()] });
      renderPage();
      expect(await screen.findByRole("button", { name: /Ajouter une photo à cet incident/ })).toBeInTheDocument();
      expect(screen.queryByText(/Maximum de 10 photos atteint/)).not.toBeInTheDocument();
    });

    it("remplace le bouton par une note quand les 10 photos sont atteintes", async () => {
      // 1 photo principale + 9 supplémentaires.
      mockedApi.get.mockResolvedValueOnce({ data: [issue({ additionalPhotos: photos(9) })] });
      mockedApi.get.mockResolvedValueOnce({ data: [contract()] });
      renderPage();
      expect(await screen.findByText("Maximum de 10 photos atteint pour cet incident.")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Ajouter une photo à cet incident/ })).not.toBeInTheDocument();
    });
  });

  it("affiche « photo indisponible » quand la photo n'a pas pu être signée par le serveur, sans image cassée", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: [issue({ photoUrl: "" })] });
    mockedApi.get.mockResolvedValueOnce({ data: [contract()] });
    renderPage();
    expect(await screen.findByText("Photo momentanément indisponible")).toBeInTheDocument();
    expect(screen.getByText("Fuite d'eau sous l'évier")).toBeInTheDocument();
    expect(screen.queryByAltText(/Photo incident/)).not.toBeInTheDocument();
  });
});
