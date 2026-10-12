import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import type { Tenant } from "../types";
import CotenantsModal from "./CotenantsModal";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } };
});
const mockedApi = vi.mocked(api, { deep: true });

function locataire(id: string, prenom: string, extra: Partial<Tenant> = {}): Tenant {
  return { id, firstName: prenom, lastName: "Diop", phone: "+221770000000", email: `${prenom.toLowerCase()}@example.com`, createdAt: "2026-01-01T00:00:00.000Z", ...extra } as Tenant;
}
const LOCATAIRES = [locataire("t1", "Awa"), locataire("t2", "Binta"), locataire("t3", "Coumba"), locataire("t4", "Anonyme", { anonymizedAt: "2026-05-01T00:00:00.000Z" })];

function afficher(verrouille = false) {
  const onChange = vi.fn();
  render(<CotenantsModal contractId="c1" titulaireId="t1" locataires={LOCATAIRES} verrouille={verrouille} onChange={onChange} onClose={vi.fn()} />);
  return { onChange };
}

beforeEach(() => {
  mockedApi.get.mockReset();
  mockedApi.post.mockReset();
  mockedApi.delete.mockReset();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("CotenantsModal", () => {
  it("ne propose ni le titulaire, ni un colocataire déjà présent, ni un locataire anonymisé", async () => {
    mockedApi.get.mockResolvedValue({ data: [{ id: "l2", tenant: LOCATAIRES[1] }] });
    afficher();
    expect(await screen.findByText("Binta Diop")).toBeInTheDocument();
    const options = within(screen.getByLabelText("Ajouter un colocataire")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Choisir un locataire…", "Coumba Diop — coumba@example.com"]);
  });

  it("ajoute puis retire un colocataire", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [{ id: "l3", tenant: LOCATAIRES[2] }] }).mockResolvedValueOnce({ data: [] });
    mockedApi.post.mockResolvedValueOnce({ data: {} });
    mockedApi.delete.mockResolvedValueOnce({});
    const { onChange } = afficher();

    await screen.findByText(/Aucun colocataire/);
    await user.selectOptions(screen.getByLabelText("Ajouter un colocataire"), "t3");
    await user.click(screen.getByRole("button", { name: "Ajouter" }));
    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith("/contracts/c1/cotenants", { tenantId: "t3" }));
    expect(await screen.findByText("Coumba Diop")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retirer Coumba" }));
    await waitFor(() => expect(mockedApi.delete).toHaveBeenCalledWith("/contracts/c1/cotenants/l3"));
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("bail signé : consultation seule", async () => {
    mockedApi.get.mockResolvedValue({ data: [{ id: "l2", tenant: LOCATAIRES[1] }] });
    afficher(true);
    expect(await screen.findByText("Binta Diop")).toBeInTheDocument();
    expect(screen.getByText(/signé par le locataire/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Ajouter un colocataire")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retirer Binta" })).not.toBeInTheDocument();
  });

  it("affiche le refus du serveur", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValue({ data: [] });
    mockedApi.post.mockRejectedValueOnce({ isAxiosError: true, response: { data: { error: "Ce locataire est déjà colocataire de ce bail." } } });
    afficher();
    await screen.findByText(/Aucun colocataire/);
    await user.selectOptions(screen.getByLabelText("Ajouter un colocataire"), "t2");
    await user.click(screen.getByRole("button", { name: "Ajouter" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("déjà colocataire");
  });
});
