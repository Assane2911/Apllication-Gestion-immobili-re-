import { readFileSync } from "node:fs";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import BoutonSuggestion from "./BoutonSuggestion";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { post: vi.fn() } };
});

const poster = api.post as unknown as ReturnType<typeof vi.fn>;

function monter(chemin = "/factures") {
  return render(
    <MemoryRouter initialEntries={[chemin]}>
      <BoutonSuggestion />
    </MemoryRouter>
  );
}

/**
 * Ce bouton n'a de valeur que s'il ne coûte rien à utiliser. Les tests
 * tiennent donc deux choses : le geste est court (ouvrir, écrire, envoyer),
 * et le contexte part tout seul — sinon l'administration reçoit des remarques
 * qu'elle ne peut pas situer.
 */
describe("Bouton de suggestion", () => {
  beforeEach(() => {
    poster.mockReset();
    poster.mockResolvedValue({ data: { id: "s1" } });
  });

  it("n'ouvre rien tant qu'on ne le demande pas", () => {
    monter();

    expect(screen.getByRole("button", { name: /suggestion/i })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("envoie le message ET la page d'où il part", async () => {
    // Le point central : une remarque sur les factures écrite depuis les
    // factures se comprend sans aller-retour. Sans le chemin, l'administration
    // reçoit « ça ne marche pas » sans savoir de quoi il s'agit.
    monter("/factures");
    await userEvent.click(screen.getByRole("button", { name: /suggestion/i }));

    await userEvent.type(screen.getByRole("textbox"), "Pouvoir filtrer les factures par bien");
    await userEvent.click(screen.getByRole("button", { name: /^envoyer$/i }));

    await waitFor(() => expect(poster).toHaveBeenCalledTimes(1));
    expect(poster).toHaveBeenCalledWith("/suggestions", {
      message: "Pouvoir filtrer les factures par bien",
      page: "/factures",
    });
  });

  it("confirme l'envoi au lieu de laisser croire que rien ne s'est passé", async () => {
    monter();
    await userEvent.click(screen.getByRole("button", { name: /suggestion/i }));
    await userEvent.type(screen.getByRole("textbox"), "Ajouter un export comptable");
    await userEvent.click(screen.getByRole("button", { name: /^envoyer$/i }));

    expect(await screen.findByText(/bien arrivé/i)).toBeInTheDocument();
    // Le champ est vidé : « autre chose » doit repartir d'une page blanche,
    // pas du message déjà envoyé.
    await userEvent.click(screen.getByRole("button", { name: /autre chose/i }));
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("montre l'échec plutôt que de perdre le message en silence", async () => {
    // `apiErrorMessage` ne lit le message du serveur que sur une VRAIE erreur
    // axios (`isAxiosError`) ; un objet quelconque retomberait sur le message
    // générique et le test ne prouverait plus rien.
    poster.mockRejectedValue(
      Object.assign(new Error("Requête refusée"), {
        isAxiosError: true,
        response: { data: { error: "Service indisponible" } },
      })
    );
    monter();
    await userEvent.click(screen.getByRole("button", { name: /suggestion/i }));
    await userEvent.type(screen.getByRole("textbox"), "Une idée qui compte");
    await userEvent.click(screen.getByRole("button", { name: /^envoyer$/i }));

    expect(await screen.findByText(/service indisponible/i)).toBeInTheDocument();
    // Le texte reste là : l'utilisateur peut réessayer sans le réécrire.
    expect(screen.getByRole("textbox")).toHaveValue("Une idée qui compte");
  });

  it("se referme avec Échap, comme toute chose qui s'ouvre", async () => {
    monter();
    await userEvent.click(screen.getByRole("button", { name: /suggestion/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("ne demande rien d'autre que le texte", async () => {
    // Chaque champ obligatoire supplémentaire est une raison de renoncer, et
    // une idée qu'on renonce à écrire ne vaut rien. Ce test est là pour qu'un
    // ajout de champ soit un choix explicite, pas une dérive.
    monter();
    await userEvent.click(screen.getByRole("button", { name: /suggestion/i }));

    const dialogue = screen.getByRole("dialog");
    expect(dialogue.querySelectorAll("textarea")).toHaveLength(1);
    expect(dialogue.querySelectorAll("input, select")).toHaveLength(0);
  });

  it("est monté dans les trois espaces, sinon il n'existe pour personne", () => {
    // Un composant parfait qu'aucun écran n'affiche ne vaut rien. Le montage
    // se fait dans les layouts, hors de portée d'un test de composant : on lit
    // donc la source, ce qui est moins élégant mais couvre le seul oubli qui
    // rendrait tout le reste inutile.
    for (const espace of ["ManagerLayout", "TenantLayout", "OwnerLayout"]) {
      const source = readFileSync(`src/components/${espace}.tsx`, "utf-8");
      expect(source, `${espace} n'affiche pas le bouton de suggestion`).toContain("<BoutonSuggestion />");
    }
  });
});
