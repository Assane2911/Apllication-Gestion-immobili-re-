import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import StatCard from "./StatCard";

describe("StatCard", () => {
  it("affiche le libellé, le chiffre et l'indication", () => {
    render(<StatCard label="Biens immobiliers" value={8} hint="2 disponible(s)" />);
    expect(screen.getByText("Biens immobiliers")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("2 disponible(s)")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("devient un raccourci vers la page de détail quand `to` est donné", () => {
    render(
      <MemoryRouter>
        <StatCard label="Factures en retard" value={2} to="/invoices" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: /Factures en retard/ })).toHaveAttribute("href", "/invoices");
  });

  it("trace une jauge bornée entre 0 et 100", () => {
    const { rerender } = render(<StatCard label="Taux d'occupation" value="62%" progress={62} />);
    expect(screen.getByRole("progressbar", { name: "Taux d'occupation" })).toHaveAttribute("aria-valuenow", "62");
    rerender(<StatCard label="Taux d'occupation" value="120%" progress={120} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    rerender(<StatCard label="Taux d'occupation" value="0%" />);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});
