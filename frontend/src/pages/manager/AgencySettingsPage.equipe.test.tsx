import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import type { TeamMember } from "../../types";
import AgencySettingsPage from "./AgencySettingsPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});
const mockedApi = vi.mocked(api, { deep: true });

/**
 * Rôles des collaborateurs : le propriétaire choisit un rôle à l'invitation
 * (Agent par défaut, le moins de droits utiles) et peut le modifier ensuite.
 */
const membres: TeamMember[] = [
  { id: "c1", email: "awa@test.local", createdAt: "2026-09-01T00:00:00.000Z", role: "READ_ONLY", status: "ACTIVE" },
  { id: "c2", email: "moussa@test.local", createdAt: "2026-09-02T00:00:00.000Z", role: "ACCOUNTANT", status: "PENDING" },
];

function connecteEnTantQue(utilisateur: Record<string, unknown>) {
  localStorage.setItem(
    "user",
    JSON.stringify({ id: "mgr-1", email: "proprio@test.local", role: "MANAGER", subscription: { plan: "ENTERPRISE" }, ...utilisateur })
  );
}

function renderPage() {
  return render(
    <AuthProvider>
      <MemoryRouter>
        <AgencySettingsPage />
      </MemoryRouter>
    </AuthProvider>
  );
}

beforeEach(() => {
  for (const m of Object.values(mockedApi)) (m as ReturnType<typeof vi.fn>).mockReset?.();
  localStorage.clear();
  mockedApi.get.mockImplementation(async (url: string) => {
    if (url === "/team") return { data: membres };
    if (url === "/agency") return { data: { id: "a", userId: "mgr-1", agencyName: "Agence", siretOrId: "", address: "", phone: "", email: "a@a.fr", legalNotice: "" } };
    return { data: { calculeLe: "2026-09-24T00:00:00.000Z", durees: {}, fichesSansBail: [], bauxClosDepuisLongtemps: [], leadsAnciens: [], total: 0 } };
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("Mon équipe — rôles", () => {
  it("affiche le rôle de chaque collaborateur dans une liste modifiable", async () => {
    connecteEnTantQue({});
    renderPage();

    const awa = await screen.findByLabelText("Rôle de awa@test.local");
    expect(awa).toHaveValue("READ_ONLY");
    expect(screen.getByLabelText("Rôle de moussa@test.local")).toHaveValue("ACCOUNTANT");
  });

  it("invite avec le rôle choisi, Agent par défaut", async () => {
    connecteEnTantQue({});
    mockedApi.post.mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    renderPage();

    await screen.findByLabelText("Rôle de awa@test.local");
    expect(screen.getByLabelText("Rôle")).toHaveValue("AGENT");
    expect(screen.getByText(/Biens, locataires, baux, annonces, messages/)).toBeInTheDocument();

    await user.type(screen.getByLabelText("Email du collaborateur"), "nouveau@test.local");
    await user.selectOptions(screen.getByLabelText("Rôle"), "ACCOUNTANT");
    await user.click(screen.getByRole("button", { name: "Inviter" }));

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith("/team", { email: "nouveau@test.local", role: "ACCOUNTANT" }));
  });

  it("change le rôle d'un collaborateur existant", async () => {
    connecteEnTantQue({});
    mockedApi.patch.mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    renderPage();

    const liste = await screen.findByLabelText("Rôle de awa@test.local");
    await user.selectOptions(liste, "AGENT");

    await waitFor(() => expect(mockedApi.patch).toHaveBeenCalledWith("/team/c1/role", { role: "AGENT" }));
    expect(liste).toHaveValue("AGENT");
  });

  it("revient à l'ancien rôle et signale l'erreur si le serveur refuse", async () => {
    connecteEnTantQue({});
    mockedApi.patch.mockRejectedValue({ response: { data: { error: "Seul le gestionnaire propriétaire de l'agence peut gérer l'équipe." } } });
    const user = userEvent.setup();
    renderPage();

    const liste = await screen.findByLabelText("Rôle de awa@test.local");
    await user.selectOptions(liste, "FULL");

    await waitFor(() => expect(liste).toHaveValue("READ_ONLY"));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("ne montre rien de tout cela à un collaborateur", async () => {
    connecteEnTantQue({ collaboratorId: "c9", teamRole: "AGENT" });
    renderPage();

    await screen.findByDisplayValue("Agence");
    expect(screen.queryByLabelText("Rôle")).not.toBeInTheDocument();
    expect(mockedApi.get).not.toHaveBeenCalledWith("/team");
  });
});
