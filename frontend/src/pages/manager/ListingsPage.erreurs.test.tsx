import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError } from "axios";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import { CurrencyProvider } from "../../context/CurrencyContext";
import type { Listing, PaginatedResponse } from "../../types";
import ListingsPage from "./ListingsPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn() } };
});
const mockedApi = vi.mocked(api, { deep: true });

/**
 * Les annonces du gestionnaire (ce qu'il publie sur la vitrine publique) : quand le serveur refuse un enregistrement, une
 * suppression ou une publication, l'erreur doit être montrée et la liste ne doit pas mentir ; les champs facultatifs partent
 * avec le formulaire ; une photo trop lourde est refusée avant l'envoi ; copier le lien ne casse rien sans presse-papiers.
 */

function erreurServeur(message: string) {
  return new AxiosError("Request failed", "ERR_BAD_REQUEST", undefined, undefined, {
    status: 400,
    statusText: "Bad Request",
    data: { error: message },
    headers: {},
    config: {} as never,
  });
}

const annonce = (o: Partial<Listing> = {}): Listing =>
  ({
    id: "list-1", type: "RENT", title: "Appartement 2 pièces vue mer", description: "Bel appartement lumineux proche des commodités.", price: 450, currency: "EUR",
    pricePeriod: "MONTH", surface: 55, rooms: 2, location: "Dakar, Almadies", country: "SN", imageUrl: null, contactPhone: null, contactWhatsapp: null, contactEmail: null,
    status: "PUBLISHED", featured: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", ...o,
  }) as Listing;
const page = (items: Listing[]): { data: PaginatedResponse<Listing> } => ({ data: { items, page: 1, pageSize: 20, total: items.length, totalPages: 1 } });
const entrees = (fd: FormData) => {
  const sortie: Record<string, unknown> = {};
  fd.forEach((valeur, cle) => {
    sortie[cle] = valeur;
  });
  return sortie;
};
const appelsListe = () => mockedApi.get.mock.calls.filter(([url]) => url === "/listings");

function afficher(items: Listing[] = [annonce()]) {
  mockedApi.get.mockResolvedValue(page(items));
  return render(
    <AuthProvider>
      <CurrencyProvider>
        <MemoryRouter>
          <ListingsPage />
        </MemoryRouter>
      </CurrencyProvider>
    </AuthProvider>
  );
}

describe("ListingsPage : refus du serveur, formulaire et partage", () => {
  beforeEach(() => {
    for (const m of Object.values(mockedApi)) (m as ReturnType<typeof vi.fn>).mockReset?.();
    localStorage.clear();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "alert").mockImplementation(() => {});
  });

  describe("formulaire", () => {
    async function ouvrirCreation(user: ReturnType<typeof userEvent.setup>) {
      afficher([]);
      await waitFor(() => expect(screen.getAllByRole("button", { name: "+ Nouvelle annonce" }).length).toBeGreaterThan(0));
      await user.click(screen.getAllByRole("button", { name: "+ Nouvelle annonce" })[0]);
    }

    it("enregistrement refusé : l'erreur est montrée dans le formulaire, qui reste ouvert avec la saisie, et la liste n'est pas rechargée", async () => {
      const user = userEvent.setup();
      await ouvrirCreation(user);
      mockedApi.post.mockRejectedValue(erreurServeur("Votre formule ne permet pas d'autres annonces."));
      await user.type(screen.getByLabelText("Titre"), "Studio meublé");
      await user.type(screen.getByLabelText("Prix"), "300");
      await user.type(screen.getByLabelText("Localisation"), "Abidjan");
      await user.type(screen.getByLabelText("Description"), "Studio calme et sécurisé.");

      await user.click(screen.getByRole("button", { name: "Enregistrer" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Votre formule ne permet pas d'autres annonces.");
      expect(screen.getByLabelText("Titre")).toHaveValue("Studio meublé");
      expect(screen.getByRole("button", { name: "Enregistrer" })).toBeEnabled();
      expect(appelsListe()).toHaveLength(1);
    });

    it("« Annuler » ferme le formulaire sans rien envoyer", async () => {
      const user = userEvent.setup();
      await ouvrirCreation(user);

      await user.click(screen.getByRole("button", { name: "Annuler" }));

      expect(screen.queryByLabelText("Titre")).not.toBeInTheDocument();
      expect(mockedApi.post).not.toHaveBeenCalled();
    });

    it("une photo trop lourde est refusée avant l'envoi : message, champ vidé, rien n'est joint", async () => {
      const user = userEvent.setup();
      await ouvrirCreation(user);
      const champFichier = document.querySelector('input[type="file"]') as HTMLInputElement;

      await user.upload(champFichier, new File([new Uint8Array(5 * 1024 * 1024)], "enorme.jpg", { type: "image/jpeg" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("trop volumineux");
      expect(champFichier.files).toHaveLength(0);
    });

    it("les champs facultatifs remplis partent avec le formulaire : type, période, surface, pièces, statut, contacts", async () => {
      const user = userEvent.setup();
      await ouvrirCreation(user);
      mockedApi.post.mockResolvedValue({ data: { id: "nouvelle" } });
      await user.type(screen.getByLabelText("Titre"), "Villa Almadies");
      await user.type(screen.getByLabelText("Prix"), "250000");
      await user.type(screen.getByLabelText("Localisation"), "Dakar, Almadies");
      await user.type(screen.getByLabelText("Description"), "Grande villa avec jardin.");
      await user.selectOptions(screen.getByLabelText("Type d'annonce"), "SALE");
      await user.selectOptions(screen.getByLabelText("Périodicité du prix"), "ONE_TIME");
      await user.type(screen.getByLabelText("Surface (m²)"), "120.5");
      await user.type(screen.getByLabelText("Nombre de pièces"), "5");
      await user.selectOptions(screen.getByLabelText("Statut"), "DRAFT");
      await user.type(screen.getByLabelText("Email de contact"), "agence@example.com");

      await user.click(screen.getByRole("button", { name: "Enregistrer" }));

      await waitFor(() => expect(mockedApi.post).toHaveBeenCalledTimes(1));
      const envoye = entrees(mockedApi.post.mock.calls[0][1] as FormData);
      expect(envoye).toMatchObject({ type: "SALE", pricePeriod: "ONE_TIME", surface: "120.5", rooms: "5", status: "DRAFT", contactEmail: "agence@example.com" });
    });

    it("les contacts laissés vides ne sont pas envoyés : le serveur lirait une chaîne vide comme une valeur invalide", async () => {
      const user = userEvent.setup();
      await ouvrirCreation(user);
      mockedApi.post.mockResolvedValue({ data: { id: "nouvelle" } });
      await user.type(screen.getByLabelText("Titre"), "Studio");
      await user.type(screen.getByLabelText("Prix"), "300");
      await user.type(screen.getByLabelText("Localisation"), "Dakar");
      await user.type(screen.getByLabelText("Description"), "Studio calme.");

      await user.click(screen.getByRole("button", { name: "Enregistrer" }));

      await waitFor(() => expect(mockedApi.post).toHaveBeenCalledTimes(1));
      const envoye = entrees(mockedApi.post.mock.calls[0][1] as FormData);
      expect(envoye).not.toHaveProperty("contactEmail");
      expect(envoye).not.toHaveProperty("contactPhone");
      expect(envoye).not.toHaveProperty("contactWhatsapp");
      expect(envoye).not.toHaveProperty("surface");
      expect(envoye).not.toHaveProperty("rooms");
      expect(envoye).not.toHaveProperty("image");
    });
  });

  describe("suppression et publication", () => {
    it("suppression : confirmation refusée, rien n'est envoyé", async () => {
      const user = userEvent.setup();
      afficher();
      vi.spyOn(window, "confirm").mockReturnValue(false);
      await screen.findByText("Appartement 2 pièces vue mer");

      await user.click(screen.getByRole("button", { name: "Supprimer" }));

      expect(mockedApi.delete).not.toHaveBeenCalled();
      expect(screen.getByText("Appartement 2 pièces vue mer")).toBeInTheDocument();
    });

    it("suppression refusée par le serveur : l'erreur est montrée, l'annonce reste listée, la liste n'est pas rechargée", async () => {
      const user = userEvent.setup();
      afficher();
      mockedApi.delete.mockRejectedValue(erreurServeur("Cette annonce a des demandes en cours."));
      await screen.findByText("Appartement 2 pièces vue mer");

      await user.click(screen.getByRole("button", { name: "Supprimer" }));

      await waitFor(() => expect(window.alert).toHaveBeenCalledWith("Cette annonce a des demandes en cours."));
      expect(screen.getByText("Appartement 2 pièces vue mer")).toBeInTheDocument();
      expect(appelsListe()).toHaveLength(1);
    });

    it("publication refusée : l'erreur est montrée, le bouton « Publier » se débloque, la liste n'est pas rechargée", async () => {
      const user = userEvent.setup();
      afficher([annonce({ id: "b", title: "Studio Plateau", status: "DRAFT" })]);
      mockedApi.put.mockRejectedValue(erreurServeur("Complétez la description avant de publier."));
      await screen.findByText("Studio Plateau");

      await user.click(screen.getByRole("button", { name: "Publier" }));

      await waitFor(() => expect(window.alert).toHaveBeenCalledWith("Complétez la description avant de publier."));
      expect(screen.getByRole("button", { name: "Publier" })).toBeEnabled();
      expect(appelsListe()).toHaveLength(1);
    });
  });

  describe("partage et recherche", () => {
    it("presse-papiers refusé : pas de faux « Lien copié », l'annonce reste utilisable", async () => {
      const user = userEvent.setup();
      afficher();
      await screen.findByText("Appartement 2 pièces vue mer");
      const ecrire = vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("permission refusée"));

      await user.click(screen.getByRole("button", { name: /Copier le lien/ }));

      await waitFor(() => expect(ecrire).toHaveBeenCalled());
      expect(screen.queryByText("Lien copié")).not.toBeInTheDocument();
    });

    it("recherche sans résultat : le dit, et « Réinitialiser les filtres » ramène la liste", async () => {
      const user = userEvent.setup();
      afficher([
        annonce({ id: "a", title: "Villa Baobab" }),
        annonce({ id: "b", title: "Studio Plateau" }),
        annonce({ id: "c", title: "Atelier Mermoz" }),
        annonce({ id: "d", title: "Loft Sacré-Cœur" }),
      ]);
      await screen.findByText("Villa Baobab");

      await user.type(screen.getByRole("searchbox"), "zzzz");
      expect(screen.getByText("Aucun résultat pour ces critères.")).toBeInTheDocument();
      expect(screen.queryByText("Villa Baobab")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Réinitialiser les filtres" }));

      expect(screen.getByText("Villa Baobab")).toBeInTheDocument();
      expect(screen.getByText("Studio Plateau")).toBeInTheDocument();
      expect(screen.getByRole("searchbox")).toHaveValue("");
    });
  });
});
