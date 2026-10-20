import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { describe, expect, it } from "vitest";
import HistoriqueProvider from "../context/HistoriqueContext";
import EcranChargement from "./EcranChargement";
import LogoAnime from "./LogoAnime";

/**
 * L'écran affiché pendant le chargement d'une page : le logo se dessine (maison, « P », cheminée) au lieu d'un
 * simple rond qui tourne, et deux boutons « Retour » / « Suivant » évitent de rester coincé sur une page lente.
 */

/** Une application minimale : deux pages, un lien pour naviguer, l'écran de chargement en dessous. */
function Application() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return (
    <div>
      <p data-testid="chemin">{pathname}</p>
      <button onClick={() => navigate("/a")}>aller en A</button>
      <button onClick={() => navigate("/b")}>aller en B</button>
      <button onClick={() => navigate("/c", { replace: true })}>remplacer par C</button>
      <EcranChargement />
    </div>
  );
}

function rendre(entree = "/") {
  return render(
    <MemoryRouter initialEntries={[entree]}>
      <HistoriqueProvider>
        <Routes>
          <Route path="*" element={<Application />} />
        </Routes>
      </HistoriqueProvider>
    </MemoryRouter>
  );
}

const chemin = () => screen.getByTestId("chemin").textContent;

describe("EcranChargement", () => {
  it("annonce le chargement aux lecteurs d'écran et montre le logo animé", () => {
    rendre();
    const ecran = screen.getByRole("status");
    expect(within(ecran).getByText("Chargement…")).toBeInTheDocument();
    expect(ecran.querySelector("svg[aria-hidden='true']")).not.toBeNull();
  });

  it("« Suivant » est inactif tant qu'on n'est pas revenu en arrière", () => {
    rendre();
    expect(screen.getByRole("button", { name: /Suivant/ })).toBeDisabled();
  });

  it("« Retour » ramène à la page précédente, puis « Suivant » rejoue le pas en avant", async () => {
    const user = userEvent.setup();
    rendre("/");
    await user.click(screen.getByRole("button", { name: "aller en A" }));
    await user.click(screen.getByRole("button", { name: "aller en B" }));
    expect(chemin()).toBe("/b");
    expect(screen.getByRole("button", { name: /Suivant/ })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /Retour/ }));
    expect(chemin()).toBe("/a");
    expect(screen.getByRole("button", { name: /Suivant/ })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: /Suivant/ }));
    expect(chemin()).toBe("/b");
    expect(screen.getByRole("button", { name: /Suivant/ })).toBeDisabled();
  });

  it("une nouvelle page ouverte après un retour efface l'avant : « Suivant » redevient inactif", async () => {
    const user = userEvent.setup();
    rendre("/");
    await user.click(screen.getByRole("button", { name: "aller en A" }));
    await user.click(screen.getByRole("button", { name: /Retour/ }));
    expect(screen.getByRole("button", { name: /Suivant/ })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "aller en B" }));
    expect(screen.getByRole("button", { name: /Suivant/ })).toBeDisabled();
  });

  it("remplacer la page courante ne crée pas d'étape à rejouer", async () => {
    const user = userEvent.setup();
    rendre("/");
    await user.click(screen.getByRole("button", { name: "remplacer par C" }));
    expect(chemin()).toBe("/c");
    expect(screen.getByRole("button", { name: /Suivant/ })).toBeDisabled();
  });

  it("sans page précédente, « Retour » ramène à l'accueil plutôt que de ne rien faire", async () => {
    const user = userEvent.setup();
    rendre("/une/page/lente");
    expect(screen.getByRole("button", { name: /Retour/ })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: /Retour/ }));
    expect(chemin()).toBe("/");
  });

  it("hors fournisseur d'historique, l'écran fonctionne quand même (Suivant inactif)", () => {
    render(
      <MemoryRouter>
        <EcranChargement />
      </MemoryRouter>
    );
    expect(screen.getByRole("button", { name: /Suivant/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Retour/ })).toBeEnabled();
  });
});

describe("LogoAnime", () => {
  it("dessine la maison avec son « P », la barre de gauche et la cheminée, chacune révélée par son propre masque", () => {
    const { container } = render(<LogoAnime />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("aria-hidden", "true");
    for (const classe of ["logo-anime-principal", "logo-anime-barre", "logo-anime-cheminee"]) {
      expect(svg.querySelector(`.${classe}`), classe).not.toBeNull();
    }
    expect(svg.querySelectorAll("mask").length).toBe(2);
  });

  it("deux logos sur la même page n'entrent pas en conflit (identifiants uniques)", () => {
    const { container } = render(
      <>
        <LogoAnime />
        <LogoAnime />
      </>
    );
    const ids = Array.from(container.querySelectorAll("mask, linearGradient")).map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[A-Za-z0-9_-]+$/.test(id))).toBe(true);
  });

  it("les animations sont réservées aux personnes qui n'ont pas demandé de réduire les mouvements", () => {
    const css = readFileSync(resolve(__dirname, "../index.css"), "utf8");
    const bloc = css.match(/@media \(prefers-reduced-motion: no-preference\)\s*\{([\s\S]*?)\n\}/);
    expect(bloc, "bloc prefers-reduced-motion: no-preference").not.toBeNull();
    for (const classe of ["logo-anime-principal", "logo-anime-barre", "logo-anime-cheminee", "logo-anime-ensemble"]) {
      expect(bloc![1]).toContain(`.${classe}`);
    }
    // Hors de ce bloc, aucune règle `animation:` ne touche le logo : mouvement réduit = logo fixe et complet.
    const horsBloc = css.replace(bloc![0], "");
    expect(horsBloc).not.toMatch(/\.logo-anime[^{]*\{[^}]*animation:/);
  });
});

