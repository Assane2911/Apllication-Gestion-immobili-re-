import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "../../context/ThemeContext";
import { describe, expect, it } from "vitest";
import { COMPANY } from "../../legal/companyInfo";
import CGUPage from "./CGUPage";

describe("CGUPage", () => {
  it("affiche le titre et les sections principales", () => {
    render(
      <ThemeProvider><MemoryRouter>
        <CGUPage />
      </MemoryRouter></ThemeProvider>
    );

    expect(screen.getByRole("heading", { name: "Conditions Générales d'Utilisation et de Vente", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("1. Objet")).toBeInTheDocument();
    expect(screen.getByText("3. Formules d'abonnement et essai gratuit")).toBeInTheDocument();
  });

  it("énonce le droit applicable comme un choix distinct du pays de l'éditeur", () => {
    render(
      <ThemeProvider><MemoryRouter>
        <CGUPage />
      </MemoryRouter></ThemeProvider>
    );

    // Le droit applicable (choix contractuel) ne se déduit pas du pays du siège : l'éditeur est américain.
    expect(COMPANY.country).toBe("États-Unis");
    expect(COMPANY.governingLaw).toBe("droit français");
    expect(screen.getByText(/sont soumises au droit français/)).toBeInTheDocument();
    expect(screen.queryByText(/droit États-Unis/)).not.toBeInTheDocument();
  });

  it("définit un titre d'onglet propre à la page", () => {
    render(
      <ThemeProvider><MemoryRouter>
        <CGUPage />
      </MemoryRouter></ThemeProvider>
    );

    expect(document.title).toBe("Conditions Générales d'Utilisation et de Vente | ImmoPlatform Pro");
  });

  it("annonce le guide de démarrage dans l'essai gratuit, comme dans l'accompagnement de la formule Entreprise", () => {
    render(
      <ThemeProvider><MemoryRouter>
        <CGUPage />
      </MemoryRouter></ThemeProvider>
    );

    expect(screen.getByText(/essai gratuite de 15 jours[\s\S]*guide de démarrage/)).toBeInTheDocument();
  });

  it("nomme les formules comme le reste de l'application : Starter, Professionnel, Agence & Multi-Comptes", () => {
    render(
      <ThemeProvider><MemoryRouter>
        <CGUPage />
      </MemoryRouter></ThemeProvider>
    );

    expect(screen.getByText("Starter")).toBeInTheDocument();
    expect(screen.getByText("Professionnel")).toBeInTheDocument();
    expect(screen.getByText("Agence & Multi-Comptes")).toBeInTheDocument();
    expect(screen.queryByText("Pro Agence")).not.toBeInTheDocument();
    expect(screen.queryByText("Entreprise")).not.toBeInTheDocument();
  });

  it("décrit chaque formule comme les cartes de l'application : support prioritaire et fonctionnalités dans Professionnel, Agence reprenant Professionnel", () => {
    render(
      <ThemeProvider><MemoryRouter>
        <CGUPage />
      </MemoryRouter></ThemeProvider>
    );

    const pro = screen.getByText("Professionnel").closest("li")!;
    const agence = screen.getByText("Agence & Multi-Comptes").closest("li")!;

    for (const terme of [/jusqu'à 25 biens/, /signature électronique/, /suivi des dépenses/, /marque blanche/, /messagerie/, /support prioritaire \(réponse\s+sous un jour ouvré\)/]) {
      expect(pro.textContent ?? "", String(terme)).toMatch(terme);
    }
    expect(agence.textContent ?? "").toMatch(/tout ce qui est inclus dans Professionnel/);
    expect(agence.textContent ?? "").toMatch(/biens illimités/);
    expect(agence.textContent ?? "").not.toMatch(/support prioritaire/);
  });
});
