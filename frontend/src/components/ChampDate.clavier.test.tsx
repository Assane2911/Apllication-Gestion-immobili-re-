import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChampDate from "./ChampDate";

/**
 * Le calendrier de l'application, utilisé dans tous les formulaires : il doit se piloter entièrement au clavier (flèches, pages,
 * Tab, Échap), ne jamais laisser choisir un jour hors des bornes, rendre le focus au champ en se fermant, et ne s'ouvrir que sur
 * l'icône. Une date saisie de travers dans un bail ou une quittance se retrouve sur des documents légaux.
 */

function Formulaire(props: { required?: boolean; min?: string; max?: string; disabled?: boolean; readOnly?: boolean; valeur?: string; onClick?: React.MouseEventHandler<HTMLInputElement> }) {
  const [v, setV] = useState(props.valeur ?? "2026-12-15");
  return (
    <ChampDate
      aria-label="Du"
      value={v}
      required={props.required}
      min={props.min}
      max={props.max}
      disabled={props.disabled}
      readOnly={props.readOnly}
      onClick={props.onClick}
      onChange={(e) => setV(e.target.value)}
    />
  );
}

const champ = () => screen.getByLabelText("Du") as HTMLInputElement;
const ouvrir = () => fireEvent.click(champ(), { clientX: 10 });
const jourFocus = () => (document.activeElement as HTMLElement | null)?.getAttribute("data-jour");
const flecher = (touche: string) => fireEvent.keyDown(document.activeElement as HTMLElement, { key: touche });
const titreMois = () => document.querySelector("[aria-live='polite']")?.textContent?.toLowerCase();

describe("ChampDate : clavier, bornes et placement", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q === "(pointer: fine)", media: q, addEventListener() {}, removeEventListener() {} }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe("à l'ouverture", () => {
    it("le focus va au jour du champ, qui est le seul dans l'ordre de tabulation et le seul marqué choisi", () => {
      render(<Formulaire />);

      ouvrir();

      expect(jourFocus()).toBe("2026-12-15");
      expect(screen.getByRole("button", { name: "15" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "15" })).toHaveAttribute("tabindex", "0");
      expect(screen.getByRole("button", { name: "16" })).toHaveAttribute("tabindex", "-1");
      expect(screen.getByRole("button", { name: "16" })).toHaveAttribute("aria-pressed", "false");
      expect(titreMois()).toContain("décembre 2026");
    });

    it("la semaine commence le lundi : décembre 2026 débute un mardi, donc une case vide précède le 1er", () => {
      render(<Formulaire />);
      ouvrir();

      const grille = screen.getByRole("button", { name: "1" }).parentElement as HTMLElement;
      expect(grille.children[0].tagName).toBe("SPAN");
      expect(grille.children[1]).toBe(screen.getByRole("button", { name: "1" }));
    });

    it("« aujourd'hui » est signalé pour les lecteurs d'écran", () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 11, 10, 10, 0, 0));
      render(<Formulaire />);

      ouvrir();

      expect(screen.getByRole("button", { name: "10" })).toHaveAttribute("aria-current", "date");
      expect(screen.getByRole("button", { name: "11" })).not.toHaveAttribute("aria-current");
    });

    it("un champ vide ouvre le calendrier sur le mois d'aujourd'hui", () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2027, 2, 9, 10, 0, 0));
      render(<Formulaire valeur="" />);

      ouvrir();

      expect(titreMois()).toContain("mars 2027");
      expect(jourFocus()).toBe("2027-03-09");
    });
  });

  describe("flèches et pages", () => {
    it("les flèches déplacent le jour actif d'un jour (gauche, droite) ou d'une semaine (haut, bas)", () => {
      render(<Formulaire />);
      ouvrir();

      flecher("ArrowRight");
      expect(jourFocus()).toBe("2026-12-16");
      flecher("ArrowDown");
      expect(jourFocus()).toBe("2026-12-23");
      flecher("ArrowUp");
      flecher("ArrowUp");
      expect(jourFocus()).toBe("2026-12-09");
      flecher("ArrowLeft");
      expect(jourFocus()).toBe("2026-12-08");
    });

    it("sortir du mois par une flèche change de mois, et le titre suit", () => {
      render(<Formulaire valeur="2026-12-28" />);
      ouvrir();

      flecher("ArrowDown");

      expect(jourFocus()).toBe("2027-01-04");
      expect(titreMois()).toContain("janvier 2027");
    });

    it("PageSuivante et PagePrécédente changent de mois en gardant le quantième (plafonné à 28)", () => {
      render(<Formulaire valeur="2026-12-31" />);
      ouvrir();

      flecher("PageDown");
      expect(titreMois()).toContain("janvier 2027");
      expect(jourFocus()).toBe("2027-01-28");

      flecher("PageUp");
      flecher("PageUp");
      expect(titreMois()).toContain("novembre 2026");
      expect(jourFocus()).toBe("2026-11-28");
    });

    it("une autre touche ne bouge pas le jour actif", () => {
      render(<Formulaire />);
      ouvrir();

      flecher("a");

      expect(jourFocus()).toBe("2026-12-15");
    });

    it("les boutons « mois précédent » et « mois suivant » changent le mois affiché", () => {
      render(<Formulaire />);
      ouvrir();

      fireEvent.click(screen.getByRole("button", { name: "Mois suivant" }));
      expect(titreMois()).toContain("janvier 2027");
      fireEvent.click(screen.getByRole("button", { name: "Mois précédent" }));
      fireEvent.click(screen.getByRole("button", { name: "Mois précédent" }));
      expect(titreMois()).toContain("novembre 2026");
    });
  });

  describe("fermeture", () => {
    it("Tab referme le calendrier et rend le focus au champ (sans passer au suivant)", () => {
      render(<Formulaire />);
      ouvrir();

      // fireEvent renvoie false quand le gestionnaire a annulé l'événement : Tab ne doit pas faire passer au champ suivant.
      const nonAnnule = fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Tab" });

      expect(nonAnnule).toBe(false);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(document.activeElement).toBe(champ());
    });

    it("Échap rend aussi le focus au champ", () => {
      render(<Formulaire />);
      ouvrir();

      flecher("Escape");

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(document.activeElement).toBe(champ());
    });

    it("un clic en dehors referme le calendrier, un clic dedans le laisse ouvert", () => {
      render(<Formulaire />);
      ouvrir();

      fireEvent.pointerDown(screen.getByRole("dialog"));
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      fireEvent.pointerDown(document.body);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("un second clic sur l'icône referme le calendrier", () => {
      render(<Formulaire />);
      ouvrir();
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      fireEvent.pointerDown(champ());
      ouvrir();

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  describe("ouverture sur l'icône seulement", () => {
    const rect = { left: 0, top: 100, right: 200, bottom: 130, width: 200, height: 30, x: 0, y: 100, toJSON() {} } as DOMRect;

    it("un clic au milieu du champ (saisie au clavier) n'ouvre pas le calendrier, un clic sur l'icône l'ouvre", () => {
      render(<Formulaire />);
      champ().getBoundingClientRect = () => rect;

      fireEvent.click(champ(), { clientX: 60 });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      fireEvent.click(champ(), { clientX: 190 });
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("un champ désactivé ou en lecture seule ne s'ouvre jamais", () => {
      const { unmount } = render(<Formulaire disabled />);
      ouvrir();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      unmount();

      render(<Formulaire readOnly />);
      ouvrir();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("le gestionnaire de clic du parent est appelé, et s'il annule l'événement le calendrier ne s'ouvre pas", () => {
      const parent = vi.fn((e: React.MouseEvent) => e.preventDefault());
      render(<Formulaire onClick={parent} />);

      ouvrir();

      expect(parent).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  describe("bornes, « Aujourd'hui » et « Effacer »", () => {
    it("les flèches s'arrêtent au dernier jour permis : un jour hors bornes ne prend jamais le focus et ne se choisit pas", () => {
      render(<Formulaire min="2026-12-05" max="2026-12-28" />);
      ouvrir();

      for (let i = 0; i < 14; i++) flecher("ArrowRight");

      expect(jourFocus()).toBe("2026-12-28");
      expect(screen.getByRole("button", { name: "29" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "28" })).toBeEnabled();
      fireEvent.click(screen.getByRole("button", { name: "29" }));
      expect(champ().value).toBe("2026-12-15");
    });

    it("« Aujourd'hui » pose la date du jour, referme le calendrier et rend le focus au champ", () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 11, 10, 10, 0, 0));
      render(<Formulaire />);
      ouvrir();

      fireEvent.click(screen.getByRole("button", { name: "Aujourd'hui" }));

      expect(champ().value).toBe("2026-12-10");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(document.activeElement).toBe(champ());
    });

    it("« Aujourd'hui » est désactivé quand le jour d'aujourd'hui est hors des bornes", () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 5, 1, 10, 0, 0));
      render(<Formulaire min="2026-12-05" max="2026-12-28" />);
      ouvrir();

      expect(screen.getByRole("button", { name: "Aujourd'hui" })).toBeDisabled();
    });

    it("« Effacer » vide le champ, rend le focus, et n'existe pas pour un champ obligatoire", () => {
      const { unmount } = render(<Formulaire />);
      ouvrir();
      fireEvent.click(screen.getByRole("button", { name: "Effacer" }));
      expect(champ().value).toBe("");
      expect(document.activeElement).toBe(champ());
      unmount();

      render(<Formulaire required />);
      ouvrir();
      expect(screen.queryByRole("button", { name: "Effacer" })).not.toBeInTheDocument();
    });
  });

  describe("placement", () => {
    const placer = (rect: Partial<DOMRect>, hauteurFenetre = 768, largeurFenetre = 1024) => {
      vi.stubGlobal("innerHeight", hauteurFenetre);
      vi.stubGlobal("innerWidth", largeurFenetre);
      render(<Formulaire />);
      champ().getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {}, ...rect }) as DOMRect;
      // Le calendrier ne s'ouvre que sur l'icône, à l'extrémité droite du champ.
      fireEvent.click(champ(), { clientX: (rect.right ?? 0) - 5 });
      return (screen.getByRole("dialog") as HTMLElement).style;
    };

    it("s'ouvre sous le champ quand il y a la place", () => {
      const style = placer({ top: 100, bottom: 130, left: 50, right: 250 });

      expect(style.top).toBe("134px");
      expect(style.left).toBe("50px");
    });

    it("s'ouvre au-dessus du champ quand il n'y a pas la place dessous", () => {
      const style = placer({ top: 700, bottom: 730, left: 50, right: 250 });

      expect(style.top).toBe("356px");
    });

    it("reste dans la fenêtre à droite comme à gauche", () => {
      expect(placer({ top: 100, bottom: 130, left: 1000, right: 1020 }).left).toBe("728px");
    });
  });
});
