import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TeamMember } from "../types";
import MembreEquipe from "./MembreEquipe";

const membre = (overrides: Partial<TeamMember> = {}): TeamMember => ({
  id: "m1",
  email: "awa@exemple.com",
  createdAt: "2026-10-01T00:00:00.000Z",
  role: "AGENT",
  status: "ACTIVE",
  ...overrides,
});

function afficher(m: TeamMember, surRenvoi = vi.fn()) {
  render(
    <ul>
      <MembreEquipe member={m} onChangeRole={vi.fn()} onRemove={vi.fn()} onResend={surRenvoi} />
    </ul>
  );
  return surRenvoi;
}

describe("MembreEquipe", () => {
  it("un collaborateur actif n'a pas de bouton de renvoi", () => {
    afficher(membre());
    expect(screen.getByText("Actif")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Renvoyer/ })).not.toBeInTheDocument();
  });

  it("une invitation en attente peut être renvoyée", async () => {
    const surRenvoi = afficher(membre({ status: "PENDING", expired: false }));
    expect(screen.getByText("Invitation envoyée")).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "Renvoyer l'invitation à awa@exemple.com" }));

    expect(surRenvoi).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" }));
  });

  it("une invitation expirée est signalée comme telle, avec le même bouton", () => {
    afficher(membre({ status: "PENDING", expired: true }));
    expect(screen.getByText("Invitation expirée")).toBeInTheDocument();
    expect(screen.queryByText("Invitation envoyée")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Renvoyer l'invitation/ })).toBeInTheDocument();
  });
});
