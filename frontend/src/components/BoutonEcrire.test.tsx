import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import BoutonEcrire from "./BoutonEcrire";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { post: vi.fn() } };
});
const mockedApi = vi.mocked(api, { deep: true });

const EMAIL = "agence@test.local";

beforeEach(() => {
  vi.clearAllMocks();
});

/** Ouvre la fenêtre et remplit l'objet et le message. */
async function ecrire(user: ReturnType<typeof userEvent.setup>, objet = "Votre annonce", message = "Pouvez-vous ajouter une photo ?") {
  await user.click(screen.getByRole("button", { name: `Écrire à ${EMAIL}` }));
  await user.type(screen.getByLabelText("Objet"), objet);
  await user.type(screen.getByLabelText("Message"), message);
}

describe("BoutonEcrire", () => {
  it("n'est pas un lien « mailto: » : rien ne s'ouvre hors de la page, et la fenêtre n'existe qu'une fois ouverte", async () => {
    const user = userEvent.setup();
    render(<BoutonEcrire userId="u1" email={EMAIL} />);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector('a[href^="mailto:"]')).toBeNull();

    await user.click(screen.getByRole("button", { name: `Écrire à ${EMAIL}` }));

    expect(screen.getByRole("dialog", { name: `Écrire à ${EMAIL}` })).toBeInTheDocument();
    expect(screen.getByText(/les réponses arrivent sur votre adresse d'administrateur/)).toBeInTheDocument();
  });

  it("n'envoie rien tant que l'objet et le message ne sont pas écrits", async () => {
    const user = userEvent.setup();
    render(<BoutonEcrire userId="u1" email={EMAIL} />);

    await user.click(screen.getByRole("button", { name: `Écrire à ${EMAIL}` }));
    expect(screen.getByRole("button", { name: "Envoyer" })).toBeDisabled();
    await user.type(screen.getByLabelText("Objet"), "Bonjour");
    expect(screen.getByRole("button", { name: "Envoyer" })).toBeDisabled();
    await user.type(screen.getByLabelText("Message"), "Un message");
    expect(screen.getByRole("button", { name: "Envoyer" })).toBeEnabled();
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it("envoie le message au compte depuis la plateforme et annonce qu'il est parti", async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { success: true } });
    const user = userEvent.setup();
    render(<BoutonEcrire userId="u1" email={EMAIL} />);

    await ecrire(user);
    await user.click(screen.getByRole("button", { name: "Envoyer" }));

    expect(await screen.findByRole("status")).toHaveTextContent(`Message envoyé à ${EMAIL}.`);
    expect(mockedApi.post).toHaveBeenCalledWith("/admin/users/u1/message", { subject: "Votre annonce", message: "Pouvez-vous ajouter une photo ?" });

    // Deux boutons « Fermer » : la croix du bandeau et celui du bas de la fenêtre.
    await user.click(screen.getAllByRole("button", { name: "Fermer" })[1]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("dit pourquoi le message n'est pas parti, garde le texte écrit et laisse réessayer", async () => {
    mockedApi.post.mockRejectedValueOnce(
      new AxiosError("Bad Gateway", "ERR_BAD_RESPONSE", undefined, undefined, {
        status: 502,
        data: { error: "Le message n'a pas pu être envoyé.", code: "ADMIN_MESSAGE_SEND_FAILED" },
      } as never)
    );
    const user = userEvent.setup();
    render(<BoutonEcrire userId="u1" email={EMAIL} />);

    await ecrire(user);
    await user.click(screen.getByRole("button", { name: "Envoyer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Le message n'a pas pu être envoyé");
    expect(screen.getByLabelText("Message")).toHaveValue("Pouvez-vous ajouter une photo ?");
    expect(screen.getByRole("button", { name: "Envoyer" })).toBeEnabled();
  });

  it("en variante « lien », affiche l'action nommée par la page", async () => {
    const user = userEvent.setup();
    render(<BoutonEcrire userId="u1" email={EMAIL} variante="lien" libelle="Écrire à l'auteur" />);

    await user.click(screen.getByRole("button", { name: "Écrire à l'auteur" }));

    expect(screen.getByRole("dialog", { name: `Écrire à ${EMAIL}` })).toBeInTheDocument();
  });
});
