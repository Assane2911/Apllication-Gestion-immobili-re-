import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthContext } from "../../context/auth";
import type { AuthContextValue } from "../../context/auth";
import { CurrencyProvider } from "../../context/CurrencyContext";
import type { AuthUser, Contract, PaginatedResponse, Property, Tenant } from "../../types";
import ContractsPage from "./ContractsPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

/**
 * Règles du pays de l'agence sur le formulaire de bail (voir data/reglesPays.ts). Au Sénégal : droit applicable prérempli,
 * échéance en fin de mois, bail de 36 mois, et des rappels non bloquants (caution, échéance, durée). Ailleurs, rien ne change
 * (le COCC est un code sénégalais, pas un texte de l'UEMOA).
 */
const DAY_MS = 24 * 60 * 60 * 1000;

const propriete = (surcharge: Partial<Property> = {}): Property =>
  ({ id: "prop-1", title: "Appartement Plateau", address: "1 rue Carnot", surface: 60, rent: 200000, currency: "XOF", status: "AVAILABLE", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", ...surcharge }) as Property;
const locataire = (): Tenant => ({ id: "ten-1", firstName: "Awa", lastName: "Diallo", phone: "0600000000", email: "awa@example.com", createdAt: "2026-01-01T00:00:00.000Z" }) as Tenant;
const bail = (surcharge: Partial<Contract> = {}): Contract =>
  ({
    id: "c1", propertyId: "prop-1", tenantId: "ten-1", rent: 200000, deposit: 400000, currency: "XOF",
    startDate: "2026-01-01T00:00:00.000Z", endDate: new Date(Date.now() + 5 * DAY_MS).toISOString(), status: "ACTIVE",
    signedByManagerAt: null, signedByTenantAt: null, leaseType: "HABITATION",
    property: { title: "Appartement Plateau" }, tenant: { firstName: "Awa", lastName: "Diallo" },
    ...surcharge,
  }) as unknown as Contract;

const page = <T,>(items: T[]): { data: PaginatedResponse<T> } => ({ data: { items, page: 1, pageSize: 20, total: items.length, totalPages: 1 } });

function charger(contrats: Contract[] = []) {
  mockedApi.get.mockResolvedValueOnce(page(contrats));
  mockedApi.get.mockResolvedValueOnce(page([propriete()]));
  mockedApi.get.mockResolvedValueOnce(page([locataire()]));
  mockedApi.get.mockResolvedValueOnce({ data: [] });
}

function noop(): never {
  throw new Error("not implemented in this test");
}

function rendre(pays: string | null | undefined) {
  const user = { id: "m1", email: "m@test.local", role: "MANAGER", country: pays } as AuthUser;
  const auth: AuthContextValue = { user, loading: false, login: noop, register: noop, loginWithGoogle: noop, verifyTwoFactor: noop, verifyEmail: noop, logout: async () => {}, refreshUser: async () => user };
  return render(
    <AuthContext.Provider value={auth}>
      <CurrencyProvider>
        <ContractsPage />
      </CurrencyProvider>
    </AuthContext.Provider>
  );
}

async function ouvrirNouveauBail() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /Nouveau contrat/ }));
  return user;
}

const TITRE_RAPPELS = "À vérifier au regard du droit sénégalais";

describe("ContractsPage — règles du Sénégal", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "alert").mockImplementation(() => {});
  });

  it("préremplit le droit applicable (COCC) et l'échéance en fin de mois", async () => {
    charger();
    rendre("SN");
    await ouvrirNouveauBail();

    expect(screen.getByLabelText("Jour d'échéance du loyer")).toHaveValue("31");
    expect((screen.getByLabelText(/Droit applicable/) as HTMLInputElement).value).toContain("Code des obligations civiles et commerciales");
  });

  it("propose une fin de bail à trois ans (comme le renouvellement : début + 36 mois) dès que le début est saisi", async () => {
    charger();
    const { container } = rendre("SN");
    await ouvrirNouveauBail();

    const dates = container.querySelectorAll('input[type="date"]');
    fireEvent.change(dates[0], { target: { value: "2026-03-01" } });

    expect((dates[1] as HTMLInputElement).value).toBe("2029-03-01");
  });

  it("ne réécrit pas une fin de bail que le gestionnaire a choisie lui-même", async () => {
    charger();
    const { container } = rendre("SN");
    await ouvrirNouveauBail();

    const dates = container.querySelectorAll('input[type="date"]');
    fireEvent.change(dates[0], { target: { value: "2026-03-01" } });
    fireEvent.change(dates[1], { target: { value: "2027-03-01" } });
    fireEvent.change(dates[0], { target: { value: "2026-04-01" } });

    expect((dates[1] as HTMLInputElement).value).toBe("2027-03-01");
  });

  it("un bail conforme (3 ans, fin de mois, caution de 2 mois) ne reçoit aucun rappel", async () => {
    charger();
    const { container } = rendre("SN");
    const user = await ouvrirNouveauBail();

    await user.selectOptions(screen.getByLabelText("Bien"), "prop-1");
    fireEvent.change(container.querySelectorAll('input[type="date"]')[0], { target: { value: "2026-03-01" } });

    expect(screen.queryByText(TITRE_RAPPELS)).not.toBeInTheDocument();
  });

  it("rappelle, sans bloquer, qu'une caution de plus de deux mois dépasse le décret pour un loyer d'au plus 500 000 FCFA", async () => {
    charger();
    const { container } = rendre("SN");
    const user = await ouvrirNouveauBail();

    await user.selectOptions(screen.getByLabelText("Bien"), "prop-1");
    fireEvent.change(container.querySelectorAll('input[type="date"]')[0], { target: { value: "2026-03-01" } });
    fireEvent.change(screen.getByLabelText("Dépôt de garantie"), { target: { value: "500000" } });

    expect(screen.getByText(TITRE_RAPPELS)).toBeInTheDocument();
    expect(screen.getByText(/ne peut pas excéder deux mois de loyer/)).toBeInTheDocument();
    // Non bloquant : le bouton de création reste actif.
    expect(screen.getByRole("button", { name: "Créer le contrat" })).toBeEnabled();
  });

  it("rappelle que le loyer est payable à la fin du mois si un autre jour d'échéance est choisi", async () => {
    charger();
    const { container } = rendre("SN");
    const user = await ouvrirNouveauBail();

    await user.selectOptions(screen.getByLabelText("Bien"), "prop-1");
    fireEvent.change(container.querySelectorAll('input[type="date"]')[0], { target: { value: "2026-03-01" } });
    await user.selectOptions(screen.getByLabelText("Jour d'échéance du loyer"), "5");

    expect(screen.getByText(/payable à la fin du mois de jouissance/)).toBeInTheDocument();
  });

  it("rappelle qu'un bail d'habitation dure trois ans renouvelables ou est à durée indéterminée", async () => {
    charger();
    const { container } = rendre("SN");
    const user = await ouvrirNouveauBail();

    await user.selectOptions(screen.getByLabelText("Bien"), "prop-1");
    const dates = container.querySelectorAll('input[type="date"]');
    fireEvent.change(dates[0], { target: { value: "2026-03-01" } });
    fireEvent.change(dates[1], { target: { value: "2027-03-01" } });

    expect(screen.getByText(/trois ans, renouvelables par périodes de trois ans, ou pour une durée indéterminée/)).toBeInTheDocument();
  });

  it("un bail commercial n'est pas concerné : le droit prérempli et les rappels disparaissent", async () => {
    charger();
    const { container } = rendre("SN");
    const user = await ouvrirNouveauBail();

    await user.selectOptions(screen.getByLabelText("Bien"), "prop-1");
    const dates = container.querySelectorAll('input[type="date"]');
    fireEvent.change(dates[0], { target: { value: "2026-03-01" } });
    fireEvent.change(dates[1], { target: { value: "2027-03-01" } });
    expect(screen.getByText(TITRE_RAPPELS)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Type de bail"), "COMMERCIAL");

    expect(screen.queryByText(TITRE_RAPPELS)).not.toBeInTheDocument();
    expect((screen.getByLabelText(/Droit applicable/) as HTMLInputElement).value).toBe("");
  });

  it("n'efface pas un droit applicable que le gestionnaire a lui-même saisi en changeant de type de bail", async () => {
    charger();
    rendre("SN");
    const user = await ouvrirNouveauBail();

    const droit = screen.getByLabelText(/Droit applicable/) as HTMLInputElement;
    await user.clear(droit);
    await user.type(droit, "Droit OHADA");
    await user.selectOptions(screen.getByLabelText("Type de bail"), "COMMERCIAL");

    expect(droit.value).toBe("Droit OHADA");
  });

  it("renouvelle un bail d'habitation pour 36 mois", async () => {
    charger([bail()]);
    mockedApi.post.mockResolvedValueOnce({ data: {} });
    charger([bail()]);
    rendre("SN");

    const user = userEvent.setup();
    await user.click((await screen.findAllByRole("button", { name: /Renouveler/ }))[0]);

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith("/contracts/c1/renew", { months: 36 }));
  });

  it("renouvelle un bail commercial pour 12 mois, même au Sénégal", async () => {
    charger([bail({ leaseType: "COMMERCIAL" })]);
    mockedApi.post.mockResolvedValueOnce({ data: {} });
    charger([bail({ leaseType: "COMMERCIAL" })]);
    rendre("SN");

    const user = userEvent.setup();
    await user.click((await screen.findAllByRole("button", { name: /Renouveler/ }))[0]);

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith("/contracts/c1/renew", { months: 12 }));
  });
});

describe("ContractsPage — hors du Sénégal, le comportement d'avant", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "alert").mockImplementation(() => {});
  });

  it.each(["NE", null, undefined])("pays %s : échéance le 5, aucun droit prérempli, aucune fin proposée, aucun rappel", async (pays) => {
    charger();
    const { container } = rendre(pays);
    const user = await ouvrirNouveauBail();

    expect(screen.getByLabelText("Jour d'échéance du loyer")).toHaveValue("5");
    expect((screen.getByLabelText(/Droit applicable/) as HTMLInputElement).value).toBe("");

    await user.selectOptions(screen.getByLabelText("Bien"), "prop-1");
    const dates = container.querySelectorAll('input[type="date"]');
    fireEvent.change(dates[0], { target: { value: "2026-03-01" } });
    fireEvent.change(screen.getByLabelText("Dépôt de garantie"), { target: { value: "9000000" } });

    expect((dates[1] as HTMLInputElement).value).toBe("");
    expect(screen.queryByText(TITRE_RAPPELS)).not.toBeInTheDocument();
  });

  it("renouvelle pour 12 mois hors de la France et du Sénégal", async () => {
    charger([bail({ currency: "EUR" })]);
    mockedApi.post.mockResolvedValueOnce({ data: {} });
    charger([bail({ currency: "EUR" })]);
    rendre("NE");

    const user = userEvent.setup();
    await user.click((await screen.findAllByRole("button", { name: /Renouveler/ }))[0]);

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith("/contracts/c1/renew", { months: 12 }));
  });
});

describe("ContractsPage — règles du Mali (décret n° 2016-0482/P-RM)", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
  });

  it("préremplit le droit malien, sans imposer ni échéance ni durée, et sans rappel", async () => {
    charger();
    const { container } = rendre("ML");
    const user = await ouvrirNouveauBail();

    expect((screen.getByLabelText(/Droit applicable/) as HTMLInputElement).value).toContain("Décret n° 2016-0482/P-RM du 7 juillet 2016");
    expect(screen.getByLabelText("Jour d'échéance du loyer")).toHaveValue("5");
    await user.selectOptions(screen.getByLabelText("Bien"), "prop-1");
    fireEvent.change(container.querySelectorAll('input[type="date"]')[0], { target: { value: "2026-03-01" } });
    fireEvent.change(screen.getByLabelText("Dépôt de garantie"), { target: { value: "9000000" } });
    expect((container.querySelectorAll('input[type="date"]')[1] as HTMLInputElement).value).toBe("");
    expect(screen.queryByText(/À vérifier au regard/)).not.toBeInTheDocument();
  });
});

describe("ContractsPage — règles de la Guinée-Bissau (Lei do Inquilinato)", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
  });

  it("préremplit le droit bissau-guinéen, sans imposer ni durée ni plafond, et sans rappel", async () => {
    charger();
    const { container } = rendre("GW");
    const user = await ouvrirNouveauBail();

    expect((screen.getByLabelText(/Droit applicable/) as HTMLInputElement).value).toContain("Decreto n.º 13-A/89, de 9 de Junho");
    expect(screen.getByLabelText("Jour d'échéance du loyer")).toHaveValue("5");
    await user.selectOptions(screen.getByLabelText("Bien"), "prop-1");
    fireEvent.change(container.querySelectorAll('input[type="date"]')[0], { target: { value: "2026-03-01" } });
    fireEvent.change(screen.getByLabelText("Dépôt de garantie"), { target: { value: "9000000" } });
    expect((container.querySelectorAll('input[type="date"]')[1] as HTMLInputElement).value).toBe("");
    expect(screen.queryByText(/À vérifier au regard/)).not.toBeInTheDocument();
  });
});

describe("ContractsPage — règles du Togo (décret n° 2022-001/PR)", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
  });

  it("préremplit le droit togolais et rappelle, sans bloquer, un dépôt cumulé de plus de six mois de loyer", async () => {
    charger();
    rendre("TG");
    const user = await ouvrirNouveauBail();

    expect((screen.getByLabelText(/Droit applicable/) as HTMLInputElement).value).toContain("Décret n° 2022-001/PR du 5 janvier 2022");
    await user.selectOptions(screen.getByLabelText("Bien"), "prop-1");
    fireEvent.change(screen.getByLabelText("Loyer mensuel"), { target: { value: "200000" } });
    fireEvent.change(screen.getByLabelText("Dépôt de garantie"), { target: { value: "1200000" } });
    expect(screen.queryByText("À vérifier au regard du droit togolais")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Dépôt de garantie"), { target: { value: "1400000" } });
    expect(screen.getByText("À vérifier au regard du droit togolais")).toBeInTheDocument();
    expect(screen.getByText(/soit six mois au total/)).toBeInTheDocument();
    expect(screen.getByText(/s'applique d'abord dans le Grand Lomé/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Créer le contrat" })).toBeEnabled();
  });
});

describe("ContractsPage — règles du Bénin (loi n° 2022-30)", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
  });

  it("préremplit le droit béninois et rappelle, sans bloquer, un cautionnement de plus de trois mois de loyer", async () => {
    charger();
    rendre("BJ");
    const user = await ouvrirNouveauBail();

    expect((screen.getByLabelText(/Droit applicable/) as HTMLInputElement).value).toContain("Loi n° 2022-30 du 20 décembre 2022");
    await user.selectOptions(screen.getByLabelText("Bien"), "prop-1");
    fireEvent.change(screen.getByLabelText("Loyer mensuel"), { target: { value: "200000" } });
    fireEvent.change(screen.getByLabelText("Dépôt de garantie"), { target: { value: "600000" } });
    expect(screen.queryByText("À vérifier au regard du droit béninois")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Dépôt de garantie"), { target: { value: "800000" } });
    expect(screen.getByText("À vérifier au regard du droit béninois")).toBeInTheDocument();
    expect(screen.getByText(/ne peut pas excéder trois mois de loyer/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Créer le contrat" })).toBeEnabled();
  });
});

describe("ContractsPage — règles du Burkina Faso (loi n° 103-2015/CNT)", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
  });

  it("préremplit le droit burkinabè et rappelle, sans bloquer, un dépôt de plus de deux mois de loyer", async () => {
    charger();
    rendre("BF");
    const user = await ouvrirNouveauBail();

    expect((screen.getByLabelText(/Droit applicable/) as HTMLInputElement).value).toContain("Loi n° 103-2015/CNT");
    await user.selectOptions(screen.getByLabelText("Bien"), "prop-1");
    fireEvent.change(screen.getByLabelText("Loyer mensuel"), { target: { value: "200000" } });
    fireEvent.change(screen.getByLabelText("Dépôt de garantie"), { target: { value: "600000" } });

    expect(screen.getByText("À vérifier au regard du droit burkinabè")).toBeInTheDocument();
    expect(screen.getByText(/ne peut pas être supérieur à deux mois de loyer/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Créer le contrat" })).toBeEnabled();
  });
});

describe("ContractsPage — règles de la Côte d'Ivoire (loi n° 2019-576)", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "alert").mockImplementation(() => {});
  });

  it("préremplit le droit ivoirien, sans imposer ni échéance ni durée", async () => {
    charger();
    const { container } = rendre("CI");
    await ouvrirNouveauBail();

    expect((screen.getByLabelText(/Droit applicable/) as HTMLInputElement).value).toContain("Loi n° 2019-576 du 26 juin 2019");
    expect(screen.getByLabelText("Jour d'échéance du loyer")).toHaveValue("5");
    fireEvent.change(container.querySelectorAll('input[type="date"]')[0], { target: { value: "2026-03-01" } });
    expect((container.querySelectorAll('input[type="date"]')[1] as HTMLInputElement).value).toBe("");
  });

  it("rappelle un dépôt de garantie supérieur à deux mois de loyer, sans bloquer", async () => {
    charger();
    rendre("CI");
    const user = await ouvrirNouveauBail();

    await user.selectOptions(screen.getByLabelText("Bien"), "prop-1");
    fireEvent.change(screen.getByLabelText("Loyer mensuel"), { target: { value: "200000" } });
    fireEvent.change(screen.getByLabelText("Dépôt de garantie"), { target: { value: "600000" } });

    expect(screen.getByText("À vérifier au regard du droit ivoirien")).toBeInTheDocument();
    expect(screen.getByText(/ne peut pas excéder deux mois de loyer/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Créer le contrat" })).toBeEnabled();
  });
});

describe("ContractsPage — règles de la France (loi du 6 juillet 1989)", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "alert").mockImplementation(() => {});
  });

  it("propose le droit français et une fin de bail à trois ans, sans échéance imposée", async () => {
    charger();
    const { container } = rendre("FR");
    await ouvrirNouveauBail();

    expect((screen.getByLabelText(/Droit applicable/) as HTMLInputElement).value).toBe("Loi n° 89-462 du 6 juillet 1989 tendant à améliorer les rapports locatifs");
    fireEvent.change(container.querySelectorAll('input[type="date"]')[0], { target: { value: "2026-03-01" } });
    expect((container.querySelectorAll('input[type="date"]')[1] as HTMLInputElement).value).toBe("2029-03-01");
  });

  it("rappelle un dépôt de garantie supérieur à un mois de loyer, sans bloquer", async () => {
    charger();
    rendre("FR");
    const user = await ouvrirNouveauBail();

    await user.selectOptions(screen.getByLabelText("Bien"), "prop-1");
    fireEvent.change(screen.getByLabelText("Loyer mensuel"), { target: { value: "800" } });
    fireEvent.change(screen.getByLabelText("Dépôt de garantie"), { target: { value: "1600" } });

    expect(screen.getByText("À vérifier au regard de la loi française")).toBeInTheDocument();
    expect(screen.getByText(/ne peut pas dépasser un mois de loyer en principal/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Créer le contrat" })).toBeEnabled();
  });

  it("renouvelle un bail d'habitation pour 36 mois", async () => {
    charger([bail({ currency: "EUR" })]);
    mockedApi.post.mockResolvedValueOnce({ data: {} });
    charger([bail({ currency: "EUR" })]);
    rendre("FR");

    const user = userEvent.setup();
    await user.click((await screen.findAllByRole("button", { name: /Renouveler/ }))[0]);

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith("/contracts/c1/renew", { months: 36 }));
  });
});
