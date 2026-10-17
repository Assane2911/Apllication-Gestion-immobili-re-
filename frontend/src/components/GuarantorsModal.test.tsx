import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { CurrencyContext } from "../context/currency";
import type { Guarantor } from "../types";
import GuarantorsModal from "./GuarantorsModal";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});
const mockedApi = vi.mocked(api, { deep: true });
const devise = { formatMoney: (n: number, c?: string) => `${n} ${c ?? "EUR"}` } as never;

function garant(extra: Partial<Guarantor> = {}): Guarantor {
  return { id: "g1", contractId: "c1", civility: "M", firstName: "Ibrahima", lastName: "Fall", phone: "+221771234567", email: "ib@example.com", address: "Dakar", maxAmount: 1500000, notes: null, ...extra };
}

function afficher(verrouille = false) {
  const onChange = vi.fn();
  render(
    <CurrencyContext.Provider value={devise}>
      <GuarantorsModal contractId="c1" currency="XOF" verrouille={verrouille} onChange={onChange} onClose={vi.fn()} />
    </CurrencyContext.Provider>
  );
  return { onChange };
}

beforeEach(() => {
  mockedApi.get.mockReset();
  mockedApi.post.mockReset();
  mockedApi.put.mockReset();
  mockedApi.delete.mockReset();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("GuarantorsModal", () => {
  it("liste les garants avec contact et montant garanti", async () => {
    mockedApi.get.mockResolvedValue({ data: [garant()] });
    afficher();
    expect(await screen.findByText(/Ibrahima Fall/)).toBeInTheDocument();
    expect(screen.getByText("+221771234567 · ib@example.com · Dakar")).toBeInTheDocument();
    expect(screen.getByText("Montant maximal garanti : 1500000 XOF")).toBeInTheDocument();
  });

  it("ajoute un garant : téléphone international, champs vides envoyés à null", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [garant()] });
    mockedApi.post.mockResolvedValueOnce({ data: garant() });
    const { onChange } = afficher();

    await user.click(await screen.findByRole("button", { name: "+ Ajouter un garant" }));
    await user.type(screen.getByLabelText("Prénom"), "Ibrahima");
    await user.type(screen.getByLabelText("Nom"), "Fall");
    await user.type(screen.getByLabelText("Téléphone"), "771234567");
    await user.type(screen.getByLabelText("Montant maximal garanti (facultatif)"), "1500000");
    await user.click(screen.getByRole("button", { name: "Enregistrer le garant" }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(mockedApi.post).toHaveBeenCalledWith("/contracts/c1/guarantors", {
      civility: null,
      firstName: "Ibrahima",
      lastName: "Fall",
      phone: "+221771234567",
      email: null,
      address: null,
      maxAmount: 1500000,
      notes: null,
    });
  });

  it("modifie et retire un garant", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValue({ data: [garant()] });
    mockedApi.put.mockResolvedValueOnce({ data: garant({ lastName: "Ndiaye" }) });
    mockedApi.delete.mockResolvedValueOnce({});
    afficher();

    await user.click(await screen.findByRole("button", { name: "Modifier Ibrahima" }));
    expect(screen.getByLabelText("Nom")).toHaveValue("Fall");
    await user.clear(screen.getByLabelText("Nom"));
    await user.type(screen.getByLabelText("Nom"), "Ndiaye");
    await user.click(screen.getByRole("button", { name: "Enregistrer le garant" }));
    await waitFor(() => expect(mockedApi.put).toHaveBeenCalledWith("/contracts/c1/guarantors/g1", expect.objectContaining({ lastName: "Ndiaye", maxAmount: 1500000 })));

    await user.click(screen.getByRole("button", { name: "Retirer Ibrahima" }));
    await waitFor(() => expect(mockedApi.delete).toHaveBeenCalledWith("/contracts/c1/guarantors/g1"));
  });

  it("bail signé : consultation seule, sans ajout ni modification", async () => {
    mockedApi.get.mockResolvedValue({ data: [garant()] });
    afficher(true);
    expect(await screen.findByText(/Ibrahima Fall/)).toBeInTheDocument();
    expect(screen.getByText(/signé par le locataire/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ Ajouter un garant" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Modifier Ibrahima" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retirer Ibrahima" })).not.toBeInTheDocument();
  });

  it("affiche le refus du serveur", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValue({ data: [] });
    mockedApi.post.mockRejectedValueOnce({ isAxiosError: true, response: { data: { error: "Un bail compte au plus 5 garants." } } });
    afficher();
    await user.click(await screen.findByRole("button", { name: "+ Ajouter un garant" }));
    await user.type(screen.getByLabelText("Prénom"), "A");
    await user.type(screen.getByLabelText("Nom"), "B");
    await user.type(screen.getByLabelText("Téléphone"), "771234567");
    await user.click(screen.getByRole("button", { name: "Enregistrer le garant" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("au plus 5 garants");
  });

  it("accepte un plafond saisi avec des espaces et une virgule", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValue({ data: [] });
    mockedApi.post.mockResolvedValueOnce({ data: garant() });
    afficher();
    await user.click(await screen.findByRole("button", { name: "+ Ajouter un garant" }));
    await user.type(screen.getByLabelText("Prénom"), "A");
    await user.type(screen.getByLabelText("Nom"), "B");
    await user.type(screen.getByLabelText("Téléphone"), "771234567");
    await user.type(screen.getByLabelText("Montant maximal garanti (facultatif)"), "1 500 000,50");
    await user.click(screen.getByRole("button", { name: "Enregistrer le garant" }));
    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith("/contracts/c1/guarantors", expect.objectContaining({ maxAmount: 1500000.5 })));
  });

  it("refuse un plafond illisible au lieu de l'enregistrer sans plafond", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValue({ data: [] });
    afficher();
    await user.click(await screen.findByRole("button", { name: "+ Ajouter un garant" }));
    await user.type(screen.getByLabelText("Prénom"), "A");
    await user.type(screen.getByLabelText("Nom"), "B");
    await user.type(screen.getByLabelText("Téléphone"), "771234567");
    await user.type(screen.getByLabelText("Montant maximal garanti (facultatif)"), "un million");
    await user.click(screen.getByRole("button", { name: "Enregistrer le garant" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Montant maximal garanti illisible");
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it("prévient qu'un garant sans email ne recevra aucun courrier", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValue({ data: [] });
    afficher();
    await user.click(await screen.findByRole("button", { name: "+ Ajouter un garant" }));
    expect(screen.getByLabelText("Email (facultatif)")).toHaveAccessibleDescription(/ne recevra ni relance ni copie de mise en demeure/);
  });
});
