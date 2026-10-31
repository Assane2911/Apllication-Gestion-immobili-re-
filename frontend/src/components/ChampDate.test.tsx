import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChampDate from "./ChampDate";

function Formulaire({ required = false }: { required?: boolean }) {
  const [v, setV] = useState("2026-12-15");
  return <ChampDate aria-label="Du" value={v} required={required} min="2026-12-05" max="2026-12-28" onChange={(e) => setV(e.target.value)} />;
}

describe("ChampDate", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q === "(pointer: fine)", media: q, addEventListener() {}, removeEventListener() {} }));
  });
  afterEach(() => vi.unstubAllGlobals());

  const ouvrir = () => fireEvent.click(screen.getByLabelText("Du"), { clientX: 10 });

  it("reste un champ date natif, et le clic sur l'icône ouvre le calendrier du plan", () => {
    render(<Formulaire />);
    const champ = screen.getByLabelText("Du") as HTMLInputElement;
    expect(champ.type).toBe("date");
    expect(champ.value).toBe("2026-12-15");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    ouvrir();
    expect(screen.getByRole("dialog", { name: "Choisir une date" })).toBeInTheDocument();
  });

  it("choisir un jour met à jour le champ et referme le calendrier", () => {
    render(<Formulaire />);
    ouvrir();
    fireEvent.click(screen.getByRole("button", { name: "20" }));
    expect((screen.getByLabelText("Du") as HTMLInputElement).value).toBe("2026-12-20");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("les jours hors de min/max ne se choisissent pas", () => {
    render(<Formulaire />);
    ouvrir();
    expect(screen.getByRole("button", { name: "3" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "30" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "10" })).toBeEnabled();
  });

  it("Échap referme le calendrier sans propager la touche à la fenêtre modale", () => {
    const surTouche = vi.fn();
    document.addEventListener("keydown", surTouche);
    render(<Formulaire />);
    ouvrir();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(surTouche).not.toHaveBeenCalled();
    document.removeEventListener("keydown", surTouche);
  });

  it("« Effacer » vide le champ, sauf s'il est obligatoire", () => {
    const { unmount } = render(<Formulaire />);
    ouvrir();
    fireEvent.click(screen.getByRole("button", { name: "Effacer" }));
    expect((screen.getByLabelText("Du") as HTMLInputElement).value).toBe("");
    unmount();
    render(<Formulaire required />);
    ouvrir();
    expect(screen.queryByRole("button", { name: "Effacer" })).not.toBeInTheDocument();
  });

  it("sur écran tactile, le sélecteur natif garde la main", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
    render(<Formulaire />);
    ouvrir();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
