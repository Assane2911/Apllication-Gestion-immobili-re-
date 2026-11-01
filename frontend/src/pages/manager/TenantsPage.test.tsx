import { render, screen, waitFor, within } from "@testing-library/react";
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

  /**
   * Régression a11y : la colonne d'actions du tableau (modifier/supprimer par
   * ligne) n'avait aucun texte accessible sur son en-tête — un lecteur
   * d'écran annonçait une colonne muette plutôt que "Actions".
   */
  it("donne un nom accessible à la colonne d'actions du tableau", async () => {
    mockedApi.get.mockResolvedValueOnce(paginated([tenant()]));
    renderPage();

    await waitFor(() => expect(screen.getAllByText("Awa Diallo").length).toBeGreaterThan(0));
    expect(screen.getByRole("columnheader", { name: "Actions" })).toBeInTheDocument();
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
    await user.type(fields.phone, "77 122 33 44");
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
    // Le champ téléphone joint désormais l'indicatif du pays sélectionné (le
    // Sénégal par défaut) : c'est ce numéro international, et non la saisie
    // locale, qui part au serveur — le seul format que WhatsApp accepte.
    expect(entries.phone).toBe("+221771223344");
    expect(entries.email).toBe("moussa@example.com");
    expect((entries.idDocument as File).name).toBe("carte-identite.pdf");

    await waitFor(() => expect(screen.queryByRole("button", { name: "Enregistrer" })).not.toBeInTheDocument());
  });

  /**
   * Les e-mails d'un locataire (avis d'échéance, rappels, relances, quittance) partent dans la langue de sa fiche :
   * le gestionnaire la choisit ici. Par défaut, celle de son interface.
   */
  describe("langue des e-mails du locataire", () => {
    const champLangue = (container: HTMLElement) => container.querySelector("#tenant-language") as HTMLSelectElement;

    async function ouvrirCreation() {
      const user = userEvent.setup();
      mockedApi.get.mockResolvedValueOnce(paginated([]));
      const rendu = renderPage();
      // Le libellé du bouton suit la langue de l'interface.
      const { default: i18n } = await import("../../i18n");
      const ajouter = i18n.t("manager.tenants.addBtn");
      await waitFor(() => expect(screen.getAllByRole("button", { name: ajouter }).length).toBeGreaterThan(0));
      await user.click(screen.getAllByRole("button", { name: ajouter })[0]);
      return { user, ...rendu };
    }

    it("propose les quatre langues, chacune écrite dans sa propre langue", async () => {
      const { container } = await ouvrirCreation();
      const options = Array.from(champLangue(container).options).map((o) => [o.value, o.textContent]);
      expect(options).toEqual([
        ["fr", "Français"],
        ["en", "English"],
        ["pt", "Português"],
        ["es", "Español"],
      ]);
      expect(screen.getByText("Langue des e-mails")).toBeInTheDocument();
    });

    it("à la création, prend la langue de l'interface", async () => {
      const { container } = await ouvrirCreation();
      expect(champLangue(container).value).toBe("fr");
    });

    it("à la création, prend la langue de l'interface quand ce n'est pas le français", async () => {
      const { changerLangue } = await import("../../i18n");
      await changerLangue("pt");
      try {
        const { container } = await ouvrirCreation();
        expect(champLangue(container).value).toBe("pt");
      } finally {
        await changerLangue("fr");
      }
    });

    it("envoie la langue choisie avec la fiche", async () => {
      const { user, container } = await ouvrirCreation();
      mockedApi.post.mockResolvedValueOnce({ data: { id: "ten-new" } });
      mockedApi.get.mockResolvedValueOnce(paginated([]));

      const fields = getFormFields();
      await user.type(fields.firstName, "Moussa");
      await user.type(fields.lastName, "Traoré");
      await user.type(fields.phone, "77 122 33 44");
      await user.type(fields.email, "moussa@example.com");
      await user.selectOptions(champLangue(container), "en");
      await user.click(screen.getByRole("button", { name: "Enregistrer" }));

      await waitFor(() => expect(mockedApi.post).toHaveBeenCalledTimes(1));
      expect(formDataEntries(mockedApi.post.mock.calls[0][1] as FormData).language).toBe("en");
    });

    it("à la modification, montre la langue enregistrée sur la fiche", async () => {
      const user = userEvent.setup();
      mockedApi.get.mockResolvedValueOnce(paginated([tenant({ language: "es" })]));
      const { container } = renderPage();
      await waitFor(() => expect(screen.getAllByRole("button", { name: "Modifier" }).length).toBeGreaterThan(0));
      await user.click(screen.getAllByRole("button", { name: "Modifier" })[0]);

      expect(champLangue(container).value).toBe("es");
    });

    it("à la modification d'une fiche d'avant (sans langue), montre le français", async () => {
      const user = userEvent.setup();
      mockedApi.get.mockResolvedValueOnce(paginated([tenant({ language: null })]));
      const { container } = renderPage();
      await waitFor(() => expect(screen.getAllByRole("button", { name: "Modifier" }).length).toBeGreaterThan(0));
      await user.click(screen.getAllByRole("button", { name: "Modifier" })[0]);

      expect(champLangue(container).value).toBe("fr");
    });
  });

  // Le serveur est une fonction Vercel (4,5 Mo de requête au plus) : un PDF trop lourd ne peut pas partir, et ne
  // se réduit pas. Sans ce contrôle, l'utilisateur attendait puis voyait une erreur générique.
  it("refuse tout de suite une pièce d'identité PDF trop lourde, avec un message lisible", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce(paginated([]));

    const { container } = renderPage();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "+ Ajouter un locataire" }).length).toBeGreaterThan(0));
    await user.click(screen.getAllByRole("button", { name: "+ Ajouter un locataire" })[0]);

    const lourd = new File(["pdf"], "carte.pdf", { type: "application/pdf" });
    Object.defineProperty(lourd, "size", { value: 6 * 1024 * 1024 });
    await user.upload(container.querySelector('input[type="file"]') as HTMLInputElement, lourd);

    expect(await screen.findByText("Ce fichier est trop volumineux (max 4 Mo). Réessayez avec un fichier plus léger.")).toBeInTheDocument();
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

  /**
   * Régression : le bouton "Créer l'accès" n'avait aucun état "en cours" —
   * contrairement au formulaire principal (bouton "Enregistrer" désactivé
   * via `saving`). Un double clic (ou un réseau lent) pouvait donc envoyer
   * deux POST /portal-account pour le même locataire.
   */
  it("ne crée l'accès portail qu'une seule fois même en cas de double clic", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce(paginated([tenant({ id: "ten-1", userId: null })]));
    let resolvePost!: (value: { data: unknown }) => void;
    mockedApi.post.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePost = resolve;
      })
    );

    renderPage();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Créer l'accès" }).length).toBeGreaterThan(0));
    await user.click(screen.getAllByRole("button", { name: "Créer l'accès" })[0]);
    await waitFor(() => expect(screen.getByText("Créer l'accès portail pour Awa Diallo")).toBeInTheDocument());
    await user.type(screen.getByRole("textbox"), "temp1234");

    const submitButton = screen.getAllByRole("button", { name: "Créer l'accès" })[0];
    await user.click(submitButton);
    // Le bouton passe en "Enregistrement..." et devient inatteignable : ce
    // second clic, avant que la promesse ne se résolve, ne doit rien envoyer.
    await user.click(submitButton);

    resolvePost({ data: {} });
    mockedApi.get.mockResolvedValueOnce(paginated([tenant({ id: "ten-1", userId: "user-1" })]));
    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledTimes(1));
  });

  describe("score de fiabilité", () => {
    it("affiche le score et son niveau quand assez de factures ont été prises en compte", async () => {
      mockedApi.get.mockResolvedValueOnce(
        paginated([
          tenant({ fiabilite: { score: 92, niveau: "excellent", payeATemps: 11, payeEnRetard: 1, enRetardActuel: 0 } }),
        ])
      );
      renderPage();

      await waitFor(() => expect(screen.getAllByText("92/100 · Excellent").length).toBeGreaterThan(0));
    });

    it("affiche 'Historique insuffisant' sans chiffre quand il n'y a pas encore assez de factures échues", async () => {
      mockedApi.get.mockResolvedValueOnce(
        paginated([tenant({ fiabilite: { score: null, niveau: "insuffisant", payeATemps: 1, payeEnRetard: 0, enRetardActuel: 0 } })])
      );
      renderPage();

      await waitFor(() => expect(screen.getAllByText("Historique insuffisant").length).toBeGreaterThan(0));
    });
  });

  /**
   * Droit à l'effacement. L'API refuse de SUPPRIMER un locataire dès qu'un
   * contrat existe — on ne détruit pas des pièces comptables — ce qui ne
   * laissait au gestionnaire aucune réponse à donner au locataire qui le
   * demande. L'anonymisation est cette réponse, et elle doit être clairement
   * distincte de la suppression dans l'interface.
   */
  describe("anonymisation (droit à l'effacement)", () => {
    it("appelle la route d'anonymisation après confirmation, puis recharge la liste", async () => {
      mockedApi.get.mockResolvedValueOnce(paginated([tenant()]));
      mockedApi.post.mockResolvedValueOnce({ data: { success: true } });
      mockedApi.get.mockResolvedValueOnce(paginated([tenant({ anonymizedAt: "2026-09-24T10:00:00.000Z" })]));
      const confirmer = vi.spyOn(window, "confirm").mockReturnValue(true);
      renderPage();
      const user = userEvent.setup();

      // La page rend le tableau (desktop) ET les cartes (mobile) : chaque
      // locataire apparaît donc deux fois dans le DOM de test.
      await screen.findAllByText("Awa Diallo");
      await user.click(screen.getAllByRole("button", { name: "Anonymiser" })[0]);

      await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith("/tenants/ten-1/anonymiser"));
      confirmer.mockRestore();
    });

    it("n'appelle rien si le gestionnaire annule la confirmation", async () => {
      mockedApi.get.mockResolvedValueOnce(paginated([tenant()]));
      const confirmer = vi.spyOn(window, "confirm").mockReturnValue(false);
      renderPage();
      const user = userEvent.setup();

      // La page rend le tableau (desktop) ET les cartes (mobile) : chaque
      // locataire apparaît donc deux fois dans le DOM de test.
      await screen.findAllByText("Awa Diallo");
      await user.click(screen.getAllByRole("button", { name: "Anonymiser" })[0]);

      expect(mockedApi.post).not.toHaveBeenCalled();
      confirmer.mockRestore();
    });

    it("n'offre plus l'action sur une fiche déjà anonymisée", async () => {
      mockedApi.get.mockResolvedValueOnce(paginated([tenant({ anonymizedAt: "2026-09-24T10:00:00.000Z" })]));
      renderPage();

      await screen.findAllByText("Anonymisé");
      expect(screen.queryByRole("button", { name: "Anonymiser" })).not.toBeInTheDocument();
    });
  });
});

/**
 * Audit axe-core (WCAG 2.2, critère 2.5.8) : sur téléphone, les actions des cartes (Modifier, Exporter…) faisaient
 * 16 px de haut, sous les 24 px minimum. `py-1` porte la cible à 24 px ; `-my-1` annule l'espace ajouté pour que la
 * carte ne grandisse pas.
 */
describe("TenantsPage — cibles des actions des cartes (téléphone)", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
  });

  it("chaque action d'une carte mesure au moins 24 px de haut sans agrandir la carte", async () => {
    mockedApi.get.mockResolvedValueOnce(paginated([tenant()]));
    const { container } = renderPage();
    await waitFor(() => expect(screen.getAllByText("Awa Diallo").length).toBeGreaterThan(0));

    const cartes = container.querySelector<HTMLElement>(".sm\\:hidden.space-y-3");
    expect(cartes).not.toBeNull();
    // Sur deux lignes, les cases de 24 px ne doivent pas se chevaucher : 8 px d'écart entre les lignes (gap-y-2) pour
    // des cases qui débordent de 4 px (-my-1) de chaque côté.
    const rangee = within(cartes!).getByRole("button", { name: "Anonymiser" }).closest(".flex-wrap");
    expect(rangee?.className).toMatch(/\bgap-y-2\b/);
    const actions = within(cartes!).getAllByRole("button");
    expect(actions.length).toBeGreaterThanOrEqual(3);
    for (const action of actions) {
      expect(action.className, action.textContent ?? "").toMatch(/\bpy-1\b/);
      expect(action.className, action.textContent ?? "").toMatch(/(^|\s)-my-1(\s|$)/);
    }
  });

  describe("synthèse, recherche, filtres et export", () => {
    const fiab = (niveau: "excellent" | "bon" | "moyen" | "risque" | "insuffisant", score: number | null, enRetardActuel = 0) => ({ score, niveau, payeATemps: 3, payeEnRetard: 1, enRetardActuel });
    const parc = [
      tenant({ id: "t1", firstName: "Awa", lastName: "Diallo", userId: "u1", idDocument: "x", fiabilite: fiab("excellent", 95) }),
      tenant({ id: "t2", firstName: "Moussa", lastName: "Ba", phone: "+221 77 111 22 33", email: "moussa@example.com", fiabilite: fiab("risque", 25, 1) }),
      tenant({ id: "t3", firstName: "Élodie", lastName: "Sow", email: "elodie@example.com", idDocument: "y", fiabilite: fiab("bon", 80) }),
      tenant({ id: "t4", firstName: "Ibrahima", lastName: "Fall", email: "ibra@example.com", fiabilite: fiab("insuffisant", null) }),
    ];

    async function afficher() {
      mockedApi.get.mockResolvedValue(paginated(parc));
      renderPage();
      await screen.findByRole("table");
    }

    const noms = () => within(screen.getByRole("table")).getAllByRole("row").slice(1).map((r) => r.textContent ?? "");

    it("résume les accès au portail, les pièces d'identité et les fiabilités à surveiller", async () => {
      await afficher();
      const synthese = screen.getByLabelText("Synthèse des locataires");
      expect(within(synthese).getByText("1 / 4")).toBeInTheDocument(); // portail
      expect(within(synthese).getByText("2 / 4")).toBeInTheDocument(); // pièces d'identité
      expect(within(synthese).getByText("3 sans accès")).toBeInTheDocument();
      expect(within(synthese).getByText("2 manquante(s)")).toBeInTheDocument();
      expect(within(synthese).getByText("retard de paiement ou risque")).toBeInTheDocument();
    });

    it("filtre les locataires à surveiller, sans accès ou sans pièce d'identité", async () => {
      const user = userEvent.setup();
      await afficher();
      const filtres = screen.getByRole("group", { name: "Filtrer les locataires" });

      await user.click(within(filtres).getByRole("button", { name: /À surveiller\s*1/ }));
      expect(noms()).toHaveLength(1);
      expect(noms()[0]).toContain("Moussa Ba");

      await user.click(within(filtres).getByRole("button", { name: /Sans accès portail\s*3/ }));
      expect(noms()).toHaveLength(3);

      await user.click(within(filtres).getByRole("button", { name: /Sans pièce d'identité\s*2/ }));
      expect(noms().map((n) => n.includes("Moussa") || n.includes("Ibrahima"))).toEqual([true, true]);
    });

    it("cherche par nom, sans tenir compte des accents, ou par numéro", async () => {
      const user = userEvent.setup();
      await afficher();
      await user.type(screen.getByRole("searchbox"), "elodie");
      expect(noms()).toHaveLength(1);
      expect(noms()[0]).toContain("Élodie Sow");

      await user.clear(screen.getByRole("searchbox"));
      await user.type(screen.getByRole("searchbox"), "111 22");
      expect(noms()).toHaveLength(1);
      expect(noms()[0]).toContain("Moussa Ba");
    });

    it("trie par fiabilité : les scores les plus bas d'abord, ceux sans score à la fin", async () => {
      const user = userEvent.setup();
      await afficher();
      await user.selectOptions(screen.getByLabelText("Trier par"), "Fiabilité (à surveiller d'abord)");
      const ordre = noms().map((n) => ["Moussa", "Élodie", "Awa", "Ibrahima"].find((prenom) => n.includes(prenom)));
      expect(ordre).toEqual(["Moussa", "Élodie", "Awa", "Ibrahima"]);
    });

    it("rend le téléphone et l'email cliquables", async () => {
      await afficher();
      const tableau = screen.getByRole("table");
      expect(within(tableau).getByRole("link", { name: "+221 77 111 22 33" })).toHaveAttribute("href", "tel:+221771112233");
      expect(within(tableau).getByRole("link", { name: "moussa@example.com" })).toHaveAttribute("href", "mailto:moussa@example.com");
    });

    it("exporte les locataires affichés en CSV, sans les fiches anonymisées", async () => {
      const user = userEvent.setup();
      let blob: Blob | undefined;
      Object.defineProperty(URL, "createObjectURL", { value: (b: Blob) => ((blob = b), "blob:test"), configurable: true });
      Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true });
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
      await afficher();
      await user.type(screen.getByRole("searchbox"), "moussa");
      await user.click(screen.getByRole("button", { name: "Exporter en CSV" }));
      const texte = await new Promise<string>((resolve) => {
        const lecteur = new FileReader();
        lecteur.onload = () => resolve(String(lecteur.result));
        lecteur.readAsText(blob!);
      });
      const lignes = texte.split("\n");
      expect(lignes).toHaveLength(2);
      expect(lignes[1]).toContain('"Moussa Ba"');
      expect(lignes[1]).toContain('"moussa@example.com";"Non";25');
    });
  });

  it("génère un mot de passe provisoire pour l'accès au portail, et le copie", async () => {
    const user = userEvent.setup();
    const ecrire = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText: ecrire }, configurable: true });
    mockedApi.get.mockResolvedValue(paginated([tenant()]));
    renderPage();

    await user.click(await screen.findAllByRole("button", { name: "Créer l'accès" }).then((b) => b[0]));
    expect(screen.queryByRole("button", { name: "Copier" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Générer" }));

    const champ = screen.getByLabelText("Mot de passe temporaire") as HTMLInputElement;
    expect(champ.value).toHaveLength(12);
    await user.click(screen.getByRole("button", { name: "Copier" }));
    expect(ecrire).toHaveBeenCalledWith(champ.value);
    expect(await screen.findByRole("button", { name: "Copié" })).toBeInTheDocument();
  });
});
