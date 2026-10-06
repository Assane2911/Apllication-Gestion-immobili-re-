import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { ReferralInfo } from "../../types";
import ReferralPage from "./ReferralPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function referralInfo(overrides: Partial<ReferralInfo> = {}): ReferralInfo {
  return {
    referralCode: "A1B2C3D4",
    referralUrl: "https://app.test/inscription?ref=A1B2C3D4",
    rewardDays: 15,
    totalReferred: 3,
    ...overrides,
  };
}

function renderPage() {
  return render(<ReferralPage />);
}

describe("ReferralPage (manager)", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
  });

  it("affiche le code de parrainage, le lien et le nombre de filleuls", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: referralInfo() });
    renderPage();

    await waitFor(() => expect(screen.getByText("A1B2C3D4")).toBeInTheDocument());
    expect(screen.getByText("https://app.test/inscription?ref=A1B2C3D4")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("copie le code de parrainage dans le presse-papiers", async () => {
    // L'ordre compte : userEvent.setup() installe SON PROPRE stub de
    // navigator.clipboard — le définir après, comme ici, l'écraserait par
    // celui qu'on vient tout juste de poser (voir SubscriptionPage.test.tsx,
    // même motif).
    const user = userEvent.setup();
    const ecrirePressePapiers = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: ecrirePressePapiers },
      configurable: true,
    });
    mockedApi.get.mockResolvedValueOnce({ data: referralInfo() });
    renderPage();

    await waitFor(() => expect(screen.getByText("A1B2C3D4")).toBeInTheDocument());
    await user.click(screen.getAllByRole("button", { name: "Copier" })[0]);

    expect(ecrirePressePapiers).toHaveBeenCalledWith("A1B2C3D4");
    expect(await screen.findByText("Copié !")).toBeInTheDocument();
  });

  it("copie le lien de parrainage dans le presse-papiers", async () => {
    const user = userEvent.setup();
    const ecrirePressePapiers = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: ecrirePressePapiers },
      configurable: true,
    });
    mockedApi.get.mockResolvedValueOnce({ data: referralInfo() });
    renderPage();

    await waitFor(() => expect(screen.getByText("A1B2C3D4")).toBeInTheDocument());
    await user.click(screen.getAllByRole("button", { name: "Copier" })[1]);

    expect(ecrirePressePapiers).toHaveBeenCalledWith("https://app.test/inscription?ref=A1B2C3D4");
  });

  it("affiche une erreur de chargement avec un bouton réessayer", async () => {
    mockedApi.get.mockRejectedValueOnce({ response: { data: { error: "Erreur serveur" } }, isAxiosError: true });
    renderPage();

    expect(await screen.findByText("Erreur serveur")).toBeInTheDocument();

    mockedApi.get.mockResolvedValueOnce({ data: referralInfo() });
    await userEvent.setup().click(screen.getByRole("button", { name: "Réessayer" }));

    await waitFor(() => expect(screen.getByText("A1B2C3D4")).toBeInTheDocument());
  });
});
