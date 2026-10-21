import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HistoriqueProvider from "../context/HistoriqueContext";
import { enregistrerCoucheRetour } from "../utils/couchesRetour";
import { useBoutonRetourAndroid } from "./useBoutonRetourAndroid";

const { addListener, exitApp, retirer, plateforme } = vi.hoisted(() => ({
  addListener: vi.fn(),
  exitApp: vi.fn(),
  retirer: vi.fn(),
  plateforme: { natif: true, nom: "android" },
}));

vi.mock("@capacitor/app", () => ({ App: { addListener, exitApp } }));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => plateforme.natif, getPlatform: () => plateforme.nom },
}));

/**
 * Le bouton retour d'Android : refermer d'abord ce qui recouvre la page (menu, fenêtre), puis reculer dans
 * l'historique de l'application, et ne quitter l'application que depuis la première page. Dès qu'un écouteur est
 * posé, Capacitor n'applique plus son comportement par défaut (reculer dans la WebView, sinon quitter) : c'est à ce
 * hook de tout décider.
 */
function Application() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  useBoutonRetourAndroid();
  return (
    <div>
      <p data-testid="chemin">{pathname}</p>
      <button onClick={() => navigate("/a")}>aller en A</button>
    </div>
  );
}

function rendre() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <HistoriqueProvider>
        <Routes>
          <Route path="*" element={<Application />} />
        </Routes>
      </HistoriqueProvider>
    </MemoryRouter>
  );
}

/** Simule l'appui sur le bouton retour du téléphone. */
async function appuyerSurRetour() {
  const surRetour = addListener.mock.calls.find(([evenement]) => evenement === "backButton")![1] as (e: { canGoBack: boolean }) => void;
  surRetour({ canGoBack: true });
}

beforeEach(() => {
  addListener.mockReset();
  exitApp.mockReset();
  retirer.mockReset();
  addListener.mockImplementation(async () => ({ remove: retirer }));
  plateforme.natif = true;
  plateforme.nom = "android";
});

const chemin = () => screen.getByTestId("chemin").textContent;

describe("useBoutonRetourAndroid", () => {
  it("n'écoute rien dans un navigateur ni sur iOS : le comportement du système reste intact", () => {
    plateforme.natif = false;
    rendre().unmount();
    plateforme.natif = true;
    plateforme.nom = "ios";
    rendre().unmount();
    expect(addListener).not.toHaveBeenCalled();
  });

  it("depuis une page de l'application, recule d'une page", async () => {
    const user = userEvent.setup();
    rendre();
    await user.click(screen.getByRole("button", { name: "aller en A" }));
    expect(chemin()).toBe("/a");

    await appuyerSurRetour();
    expect(await screen.findByText("/")).toBeInTheDocument();
    expect(exitApp).not.toHaveBeenCalled();
  });

  it("depuis la première page, quitte l'application", async () => {
    rendre();
    await appuyerSurRetour();
    expect(exitApp).toHaveBeenCalledTimes(1);
    expect(chemin()).toBe("/");
  });

  it("une fenêtre ou un menu ouvert est refermé d'abord, sans changer de page ni quitter", async () => {
    const user = userEvent.setup();
    rendre();
    await user.click(screen.getByRole("button", { name: "aller en A" }));
    const fermer = vi.fn();
    const retirerCouche = enregistrerCoucheRetour(fermer);

    await appuyerSurRetour();
    expect(fermer).toHaveBeenCalledTimes(1);
    expect(chemin()).toBe("/a");
    expect(exitApp).not.toHaveBeenCalled();

    retirerCouche();
    await appuyerSurRetour();
    expect(await screen.findByText("/")).toBeInTheDocument();
  });

  it("retire son écouteur quand l'application se démonte, même si la pose n'était pas terminée", async () => {
    const vue = rendre();
    vue.unmount();
    await Promise.resolve();
    await Promise.resolve();
    expect(retirer).toHaveBeenCalledTimes(1);
  });
});
