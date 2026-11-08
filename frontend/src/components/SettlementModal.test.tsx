import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import type { Contract, LeaseSettlement, SettlementPreview } from "../types";
import SettlementModal from "./SettlementModal";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } };
});
vi.mock("../context/currency", () => ({
  useCurrency: () => ({ formatMoney: (m: number, d?: string | null) => `${m} ${d ?? ""}`.trim() }),
}));
const mockedApi = vi.mocked(api, { deep: true });

const bail = { id: "c1", property: { title: "Studio A" }, tenant: { firstName: "Awa", lastName: "Sow" } } as unknown as Contract;

const apercu = (extra: Partial<SettlementPreview> = {}): SettlementPreview => ({
  currency: "EUR",
  exitDate: "2026-06-10T00:00:00.000Z",
  lastMonthMode: "FULL",
  depositAmount: 1000,
  deductions: [],
  deductionsTotal: 0,
  restitutionEnregistree: true,
  depositRefunded: 0,
  lignes: [{ periodMonth: 5, periodYear: 2026, amount: 500, retenu: 500, paid: 0, due: 500, credit: 0 }],
  unpaidTotal: 500,
  creditTotal: 0,
  facturesApresSortie: 0,
  balance: 500,
  etatDesLieuxDeSortie: true,
  contractStatus: "ACTIVE",
  ...extra,
});

const solde = (extra: Partial<LeaseSettlement> = {}): LeaseSettlement => ({
  id: "s1",
  contractId: "c1",
  reference: "SOLDE-2026-ABCD1234",
  currency: "EUR",
  exitDate: "2026-06-10T00:00:00.000Z",
  lastMonthMode: "FULL",
  depositAmount: 1000,
  deductionsTotal: 0,
  depositRefunded: 0,
  unpaidTotal: 500,
  creditTotal: 0,
  balance: 500,
  emailSentAt: null,
  settledAt: null,
  createdAt: "2026-06-11T00:00:00.000Z",
  ...extra,
});

function brancher(opts: { preview?: SettlementPreview; soldes?: LeaseSettlement[] } = {}) {
  mockedApi.get.mockImplementation(async (url: string) => {
    if (url.endsWith("/settlement/preview")) return { data: opts.preview ?? apercu() };
    if (url.endsWith("/settlements")) return { data: opts.soldes ?? [] };
    return { data: "<html>Solde</html>" };
  });
}

beforeEach(() => {
  mockedApi.get.mockReset();
  mockedApi.post.mockReset();
});

describe("SettlementModal", () => {
  it("montre le calcul et le solde à restituer", async () => {
    brancher();
    render(<SettlementModal contract={bail} onChange={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText("500 EUR à restituer au locataire")).toBeInTheDocument();
    expect(screen.getByText("− 500 EUR")).toBeInTheDocument();
  });

  it("signale un solde négatif comme un reste dû, et l'absence de restitution du dépôt", async () => {
    brancher({ preview: apercu({ balance: -250, restitutionEnregistree: false }) });
    render(<SettlementModal contract={bail} onChange={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText("250 EUR restant dus par le locataire")).toBeInTheDocument();
    expect(screen.getByText(/restitution du dépôt n'est pas encore enregistrée/)).toBeInTheDocument();
  });

  it("explique que les loyers impayés ne se compensent avec le dépôt que s'ils sont saisis comme retenue, quand le dépôt est déjà rendu", async () => {
    brancher({ preview: apercu({ depositRefunded: 850, deductionsTotal: 150, balance: -500 }) });
    render(<SettlementModal contract={bail} onChange={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText(/Le dépôt a déjà été rendu au locataire/)).toBeInTheDocument();
  });

  it("n'affiche pas cette explication tant que le dépôt n'a pas été rendu", async () => {
    brancher();
    render(<SettlementModal contract={bail} onChange={vi.fn()} onClose={vi.fn()} />);
    await screen.findByText("500 EUR à restituer au locataire");
    expect(screen.queryByText(/Le dépôt a déjà été rendu au locataire/)).not.toBeInTheDocument();
  });

  it("recalcule avec le prorata quand le gestionnaire le choisit", async () => {
    const user = userEvent.setup();
    brancher();
    render(<SettlementModal contract={bail} onChange={vi.fn()} onClose={vi.fn()} />);
    await screen.findByText("500 EUR à restituer au locataire");
    await user.selectOptions(screen.getByLabelText("Dernier mois"), "PRORATA");
    await waitFor(() =>
      expect(mockedApi.get).toHaveBeenCalledWith("/contracts/c1/settlement/preview", expect.objectContaining({ params: { lastMonth: "PRORATA" } }))
    );
  });

  it("n'envoie aucun e-mail par défaut, et l'envoie quand la case est cochée", async () => {
    const user = userEvent.setup();
    brancher();
    mockedApi.post.mockResolvedValue({ data: solde({ emailEnvoye: true }) });
    const onChange = vi.fn();
    render(<SettlementModal contract={bail} onChange={onChange} onClose={vi.fn()} />);
    await screen.findByText("500 EUR à restituer au locataire");

    await user.click(screen.getByRole("button", { name: "Émettre le solde" }));
    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith("/contracts/c1/settlements", { lastMonthMode: "FULL", sendEmail: false }));
    expect(onChange).toHaveBeenCalled();

    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Émettre le solde" }));
    await waitFor(() => expect(mockedApi.post).toHaveBeenLastCalledWith("/contracts/c1/settlements", { lastMonthMode: "FULL", sendEmail: true }));
  });

  it("liste les soldes émis et marque un solde comme réglé", async () => {
    const user = userEvent.setup();
    brancher({ soldes: [solde()] });
    mockedApi.post.mockResolvedValue({ data: solde({ settledAt: "2026-06-20T00:00:00.000Z" }) });
    render(<SettlementModal contract={bail} onChange={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText("SOLDE-2026-ABCD1234")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Marquer comme soldé" }));
    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith("/contracts/c1/settlements/s1/settle"));
  });
});
