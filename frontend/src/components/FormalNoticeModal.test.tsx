import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { AuthContext } from "../context/auth";
import type { AuthContextValue } from "../context/auth";
import { CurrencyContext } from "../context/currency";
import type { AuthUser, FormalNotice, FormalNoticeDue } from "../types";
import FormalNoticeModal from "./FormalNoticeModal";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { post: vi.fn() } };
});
const mockedApi = vi.mocked(api, { deep: true });
const devise = { formatMoney: (n: number, c?: string) => `${n} ${c ?? "EUR"}` } as never;

const bail: FormalNoticeDue = { contractId: "c1", propertyTitle: "Studio A", tenantName: "Awa Sow", currency: "XOF", unpaidCount: 2, alreadyClaimedCount: 0, totalDue: 900000, oldestDueDate: "2026-07-01", daysLate: 90 };
const emise = (extra: Partial<FormalNotice> = {}): FormalNotice => ({ id: "n1", contractId: "c1", reference: "MED-2026-001", totalDue: 900000, currency: "XOF", deadlineDays: 8, emailSentAt: "2026-10-17T10:00:00Z", guarantorsNotified: 0, createdAt: "2026-10-17T10:00:00Z", emailEnvoye: true, ...extra });

function auth(pays: string | null | undefined): AuthContextValue {
  const user = { id: "m1", email: "m@test.local", role: "MANAGER", country: pays } as AuthUser;
  const refus = (): never => {
    throw new Error("not implemented in this test");
  };
  return { user, loading: false, login: refus, register: refus, loginWithGoogle: refus, verifyTwoFactor: refus, verifyEmail: refus, logout: async () => {}, refreshUser: async () => user };
}

function afficher(extra: Partial<FormalNoticeDue> = {}, pays: string | null | undefined = null) {
  render(
    <AuthContext.Provider value={auth(pays)}>
      <CurrencyContext.Provider value={devise}>
        <FormalNoticeModal bail={{ ...bail, ...extra }} onOpenDocument={vi.fn()} onIssued={vi.fn()} onClose={vi.fn()} />
      </CurrencyContext.Provider>
    </AuthContext.Provider>
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

describe("FormalNoticeModal — agence injoignable", () => {
  it("prévient, avant l'émission, que le courrier ne dira pas comment joindre l'agence", () => {
    afficher({ agencyReachable: false });
    expect(screen.getByRole("note")).toHaveTextContent("ni téléphone ni email");
    expect(screen.getByRole("note")).toHaveTextContent("Mon Agence");
    expect(screen.getByRole("button", { name: "Émettre la mise en demeure" })).toBeEnabled();
  });

  it.each([[true], [undefined]])("ne dit rien quand l'agence est joignable ou l'information absente (%s)", (agencyReachable) => {
    afficher({ agencyReachable });
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});

/**
 * Le délai proposé est celui du pays de l'agence (voir data/reglesPays.ts) : au Sénégal, la loi demande une mise en demeure de
 * trente jours (COCC, art. 571) ; ailleurs, 8 jours comme avant. Le gestionnaire peut le changer.
 */
describe("FormalNoticeModal — délai proposé selon le pays", () => {
  it("Sénégal : 30 jours, envoyés tels quels", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValueOnce({ data: emise() });
    afficher({}, "SN");

    expect(screen.getByLabelText("Délai de paiement (jours)")).toHaveValue(30);
    await user.click(screen.getByRole("button", { name: "Émettre la mise en demeure" }));

    expect(mockedApi.post).toHaveBeenCalledWith("/contracts/c1/formal-notices", expect.objectContaining({ deadlineDays: 30 }));
  });

  it.each(["FR", "CI", null])("pays %s : 8 jours, comme avant", (pays) => {
    afficher({}, pays);

    expect(screen.getByLabelText("Délai de paiement (jours)")).toHaveValue(8);
  });

  it("le gestionnaire reste libre de choisir un autre délai", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValueOnce({ data: emise() });
    afficher({}, "SN");

    const champ = screen.getByLabelText("Délai de paiement (jours)");
    await user.clear(champ);
    await user.type(champ, "15");
    await user.click(screen.getByRole("button", { name: "Émettre la mise en demeure" }));

    expect(mockedApi.post).toHaveBeenCalledWith("/contracts/c1/formal-notices", expect.objectContaining({ deadlineDays: 15 }));
  });
});
