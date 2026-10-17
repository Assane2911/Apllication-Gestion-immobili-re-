import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { CurrencyContext } from "../context/currency";
import type { FormalNotice, FormalNoticeDue } from "../types";
import FormalNoticeModal from "./FormalNoticeModal";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { post: vi.fn() } };
});
const mockedApi = vi.mocked(api, { deep: true });
const devise = { formatMoney: (n: number, c?: string) => `${n} ${c ?? "EUR"}` } as never;

const bail: FormalNoticeDue = { contractId: "c1", propertyTitle: "Studio A", tenantName: "Awa Sow", currency: "XOF", unpaidCount: 2, alreadyClaimedCount: 0, totalDue: 900000, oldestDueDate: "2026-07-01", daysLate: 90 };
const emise = (extra: Partial<FormalNotice> = {}): FormalNotice => ({ id: "n1", contractId: "c1", reference: "MED-2026-001", totalDue: 900000, currency: "XOF", deadlineDays: 8, emailSentAt: "2026-10-17T10:00:00Z", guarantorsNotified: 0, createdAt: "2026-10-17T10:00:00Z", emailEnvoye: true, ...extra });

function afficher() {
  render(
    <CurrencyContext.Provider value={devise}>
      <FormalNoticeModal bail={bail} onOpenDocument={vi.fn()} onIssued={vi.fn()} onClose={vi.fn()} />
    </CurrencyContext.Provider>
  );
}

beforeEach(() => mockedApi.post.mockReset());

describe("FormalNoticeModal — copie aux garants", () => {
  it("dit combien de garants ont reçu la copie", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValueOnce({ data: emise({ guarantorsNotified: 2 }) });
    afficher();
    await user.click(screen.getByRole("checkbox", { name: "Adresser une copie aux garants" }));
    await user.click(screen.getByRole("button", { name: "Émettre la mise en demeure" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Copie envoyée à 2 garant(s).");
  });

  it("avertit quand la copie demandée n'a atteint aucun garant", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValueOnce({ data: emise({ guarantorsNotified: 0 }) });
    afficher();
    await user.click(screen.getByRole("checkbox", { name: "Adresser une copie aux garants" }));
    await user.click(screen.getByRole("button", { name: "Émettre la mise en demeure" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Aucun garant n'a reçu la copie");
  });

  it("ne parle pas des garants quand la copie n'a pas été demandée", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValueOnce({ data: emise() });
    afficher();
    await user.click(screen.getByRole("button", { name: "Émettre la mise en demeure" }));
    expect(await screen.findByRole("status")).not.toHaveTextContent(/garant/i);
  });
});
