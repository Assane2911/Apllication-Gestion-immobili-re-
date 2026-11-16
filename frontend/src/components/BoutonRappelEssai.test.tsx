import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import BoutonRappelEssai from "./BoutonRappelEssai";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { post: vi.fn() } };
});
const mockedApi = vi.mocked(api, { deep: true });

const EMAIL = "agence-port@test.local";
const rendre = () => render(<BoutonRappelEssai managerId="mgr-1" email={EMAIL} />);
const enveloppe = () => screen.getByRole("button", { name: `Envoyer un rappel de fin d'essai à ${EMAIL}` });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("BoutonRappelEssai", () => {
  it("demande confirmation avant d'écrire à un client, et n'envoie rien tant qu'on n'a pas confirmé", async () => {
    const user = userEvent.setup();
    rendre();

    await user.click(enveloppe());

    expect(screen.getByText(`Envoyer le rappel à ${EMAIL} ?`)).toBeInTheDocument();
    expect(mockedApi.post).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Annuler" }));
    expect(enveloppe()).toBeInTheDocument();
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it("envoie le rappel depuis la plateforme (pas de lien mailto) et annonce qu'il est parti", async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { success: true } });
    const user = userEvent.setup();
    rendre();

    await user.click(enveloppe());
    await user.click(screen.getByRole("button", { name: "Envoyer" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Rappel envoyé");
    expect(mockedApi.post).toHaveBeenCalledWith("/admin/managers/mgr-1/trial-reminder");
    expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
  });

  it("dit pourquoi le rappel n'est pas parti et laisse réessayer", async () => {
    mockedApi.post.mockRejectedValueOnce(
      new AxiosError("Bad Gateway", "ERR_BAD_RESPONSE", undefined, undefined, {
        status: 502,
        data: { error: "Le rappel n'a pas pu être envoyé.", code: "TRIAL_REMINDER_SEND_FAILED" },
      } as never)
    );
    const user = userEvent.setup();
    rendre();

    await user.click(enveloppe());
    await user.click(screen.getByRole("button", { name: "Envoyer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Le rappel n'a pas pu être envoyé");
    expect(enveloppe()).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("montre une infobulle au survol de l'enveloppe", async () => {
    const user = userEvent.setup();
    rendre();

    await user.hover(enveloppe());

    expect(await screen.findByRole("tooltip")).toHaveTextContent(`Envoyer un rappel de fin d'essai à ${EMAIL}`);
  });
});
