import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { describe, expect, it } from "vitest";
import HistoriqueProvider from "./HistoriqueContext";
import { useHistorique } from "./historique";

/**
 * Le navigateur sait reculer et avancer, mais pas s'il reste une page DEVANT : sans ce suivi, « Suivant » resterait
 * actif sans mener nulle part. Le fournisseur suit les pages visitées (une clé unique par page) comme le fait un
 * navigateur : une nouvelle page efface l'avant, un remplacement ne crée pas d'étape.
 */
function Sonde() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { peutReculer, peutAvancer } = useHistorique();
  return (
    <div>
      <p data-testid="chemin">{pathname}</p>
      <p data-testid="etat">{`${peutReculer ? "reculer" : "-"}|${peutAvancer ? "avancer" : "-"}`}</p>
      <button onClick={() => navigate("/a")}>aller en A</button>
      <button onClick={() => navigate("/b")}>aller en B</button>
      <button onClick={() => navigate("/c", { replace: true })}>remplacer par C</button>
      <button onClick={() => navigate(-1)}>reculer</button>
      <button onClick={() => navigate(1)}>avancer</button>
    </div>
  );
}

function rendre(avecFournisseur = true) {
  const contenu = (
    <Routes>
      <Route path="*" element={<Sonde />} />
    </Routes>
  );
  return render(<MemoryRouter initialEntries={["/"]}>{avecFournisseur ? <HistoriqueProvider>{contenu}</HistoriqueProvider> : contenu}</MemoryRouter>);
}

const etat = () => screen.getByTestId("etat").textContent;
const chemin = () => screen.getByTestId("chemin").textContent;

describe("HistoriqueContext", () => {
  it("au départ, il n'y a ni page avant ni page après", () => {
    rendre();
    expect(etat()).toBe("-|-");
  });

  it("reculer puis avancer : « après » n'existe que quand on est revenu en arrière", async () => {
    const user = userEvent.setup();
    rendre();
    await user.click(screen.getByRole("button", { name: "aller en A" }));
    await user.click(screen.getByRole("button", { name: "aller en B" }));
    expect(chemin()).toBe("/b");
    expect(etat()).toBe("reculer|-");

    await user.click(screen.getByRole("button", { name: "reculer" }));
    expect(chemin()).toBe("/a");
    expect(etat()).toBe("reculer|avancer");

    await user.click(screen.getByRole("button", { name: "avancer" }));
    expect(chemin()).toBe("/b");
    expect(etat()).toBe("reculer|-");
  });

  it("une nouvelle page ouverte après un retour efface l'avant", async () => {
    const user = userEvent.setup();
    rendre();
    await user.click(screen.getByRole("button", { name: "aller en A" }));
    await user.click(screen.getByRole("button", { name: "reculer" }));
    expect(etat()).toBe("-|avancer");
    await user.click(screen.getByRole("button", { name: "aller en B" }));
    expect(etat()).toBe("reculer|-");
  });

  it("remplacer la page courante ne crée pas d'étape à rejouer", async () => {
    const user = userEvent.setup();
    rendre();
    await user.click(screen.getByRole("button", { name: "remplacer par C" }));
    expect(chemin()).toBe("/c");
    expect(etat()).toBe("-|-");
  });

  it("hors fournisseur, rien n'est supposé : ni reculer ni avancer", () => {
    rendre(false);
    expect(etat()).toBe("-|-");
  });
});
