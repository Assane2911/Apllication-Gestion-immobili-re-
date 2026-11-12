import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import SectionDroitsPersonnes from "./SectionDroitsPersonnes";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});
const mocked = vi.mocked(api, { deep: true });

beforeEach(() => {
  mocked.get.mockReset();
  mocked.post.mockReset();
  URL.createObjectURL = vi.fn(() => "blob:test");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.restoreAllMocks());

const rendre = () => render(<SectionDroitsPersonnes numero="07" />);
const bouton = (nom: RegExp) => screen.getByRole("button", { name: nom });

describe("SectionDroitsPersonnes", () => {
  it("désactive l'export et l'anonymisation tant qu'aucun e-mail ni téléphone n'est saisi", async () => {
    rendre();
    expect(bouton(/Exporter ses données/)).toBeDisabled();
    expect(bouton(/Anonymiser ses données/)).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Adresse e-mail"), "awa@example.com");
    expect(bouton(/Exporter ses données/)).toBeEnabled();
    expect(bouton(/Anonymiser ses données/)).toBeEnabled();
  });

  it("exporte par e-mail (téléphone omis), télécharge le fichier et le confirme", async () => {
    const clic = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    mocked.get.mockResolvedValueOnce({ data: new Blob(["{}"]) });
    rendre();

    await userEvent.type(screen.getByLabelText("Adresse e-mail"), " awa@example.com ");
    await userEvent.click(bouton(/Exporter ses données/));

    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith("/personnes/export", { params: { email: "awa@example.com" }, responseType: "blob" }));
    expect(clic).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("status")).toHaveTextContent(/tout ce que votre agence détient/);
  });

  it("exporte par téléphone seul", async () => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    mocked.get.mockResolvedValueOnce({ data: new Blob(["{}"]) });
    rendre();

    await userEvent.type(screen.getByLabelText("Téléphone"), "+221 77 000 11 22");
    await userEvent.click(bouton(/Exporter ses données/));

    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith("/personnes/export", { params: { phone: "+221 77 000 11 22" }, responseType: "blob" }));
  });

  it("affiche le message du serveur, lu dans le corps (blob) de l'erreur, quand rien n'est détenu", async () => {
    const corps = new Blob([JSON.stringify({ error: "Aucune donnée détenue pour cette personne.", code: "PERSON_DATA_NOT_FOUND" })], { type: "application/json" });
    mocked.get.mockRejectedValueOnce({ isAxiosError: true, response: { status: 404, data: corps } });
    rendre();

    await userEvent.type(screen.getByLabelText("Adresse e-mail"), "inconnu@example.com");
    await userEvent.click(bouton(/Exporter ses données/));

    expect(await screen.findByRole("alert")).toHaveTextContent("Aucune donnée détenue pour cette personne.");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("anonymise après confirmation, et annonce combien de garants et de demandes sont touchés", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mocked.post.mockResolvedValueOnce({ data: { garants: 2, prospects: 1 } });
    rendre();

    await userEvent.type(screen.getByLabelText("Adresse e-mail"), "awa@example.com");
    await userEvent.click(bouton(/Anonymiser ses données/));

    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith("/personnes/anonymiser", { email: "awa@example.com" }));
    expect(await screen.findByRole("status")).toHaveTextContent("2 garant(s) et 1 demande(s) de prospect anonymisés");
  });

  it("n'anonymise pas quand on refuse la confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    rendre();

    await userEvent.type(screen.getByLabelText("Adresse e-mail"), "awa@example.com");
    await userEvent.click(bouton(/Anonymiser ses données/));

    expect(mocked.post).not.toHaveBeenCalled();
  });
});
