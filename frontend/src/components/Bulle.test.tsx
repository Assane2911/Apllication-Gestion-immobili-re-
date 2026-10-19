import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Bulle from "./Bulle";

/**
 * Une aide au survol ne vaut que si elle atteint tout le monde et ne gêne
 * personne. Ces tests tiennent les deux bouts : elle apparaît aussi au
 * clavier, et elle ne s'interpose jamais entre le curseur et ce qu'elle
 * décrit.
 */
describe("Bulle d'information", () => {
  it("reste absente tant que rien n'est survolé", () => {
    render(
      <Bulle texte="Ouvre la liste de vos locataires">
        <button type="button">Locataires</button>
      </Bulle>
    );

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("apparaît au survol et disparaît quand le curseur s'en va", () => {
    render(
      <Bulle texte="Ouvre la liste de vos locataires">
        <button type="button">Locataires</button>
      </Bulle>
    );
    const declencheur = screen.getByRole("button");

    fireEvent.mouseEnter(declencheur.parentElement!);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Ouvre la liste de vos locataires");

    fireEvent.mouseLeave(declencheur.parentElement!);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("apparaît aussi au focus clavier", () => {
    // Le point qui décide si cette aide sert à tout le monde. Réservée à la
    // souris, elle abandonne ceux qui naviguent au clavier — souvent parce
    // qu'ils ne peuvent pas faire autrement.
    render(
      <Bulle texte="Relance ce locataire par email et WhatsApp">
        <button type="button">Relancer</button>
      </Bulle>
    );

    fireEvent.focus(screen.getByRole("button"));

    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("se referme avec Échap, comme toute chose qui s'ouvre", () => {
    render(
      <Bulle texte="Relance ce locataire">
        <button type="button">Relancer</button>
      </Bulle>
    );
    const declencheur = screen.getByRole("button");
    fireEvent.focus(declencheur);

    fireEvent.keyDown(declencheur, { key: "Escape" });

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("relie la bulle à l'élément qu'elle décrit, pour les lecteurs d'écran", () => {
    render(
      <Bulle texte="Exporte les données de ce locataire">
        <button type="button">Exporter</button>
      </Bulle>
    );
    const declencheur = screen.getByRole("button");

    expect(declencheur).not.toHaveAttribute("aria-describedby");
    fireEvent.focus(declencheur);
    expect(declencheur.getAttribute("aria-describedby")).toBe(screen.getByRole("tooltip").id);
  });

  it("s'efface de la mise en page quand on le lui demande", () => {
    // `display: contents` permet d'envelopper un enfant de flex ou de grille
    // sans que la bulle ne s'intercale dans la mise en page — le bouton reste
    // un enfant direct aux yeux du navigateur. L'enveloppe n'ayant alors
    // aucune boîte, c'est l'élément décrit que le composant doit mesurer.
    render(
      <Bulle texte="Bascule entre clair et sombre" className="contents">
        <button type="button">Thème</button>
      </Bulle>
    );
    const declencheur = screen.getByRole("button");

    expect(declencheur.parentElement?.className).toBe("contents");

    fireEvent.focus(declencheur);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Bascule entre clair et sombre");
  });

  it("ne capte jamais le pointeur, pour ne pas gêner le clic qu'elle explique", () => {
    // Une bulle qui s'interpose entre le curseur et son bouton rend ce bouton
    // difficile à cliquer — défaut d'autant plus déroutant qu'il vient de
    // l'aide elle-même.
    render(
      <Bulle texte="Marque cette facture comme réglée">
        <button type="button">Marquer réglée</button>
      </Bulle>
    );
    fireEvent.mouseEnter(screen.getByRole("button").parentElement!);

    expect(screen.getByRole("tooltip").className).toContain("pointer-events-none");
  });

  it("se lit sans effort : texte de 14 px, et claire en thème sombre où une bulle sombre se fondrait", () => {
    render(
      <Bulle texte="Exporte les données">
        <button type="button">Exporter</button>
      </Bulle>
    );
    fireEvent.focus(screen.getByRole("button"));

    const classes = screen.getByRole("tooltip").className;
    expect(classes).toContain("text-sm");
    expect(classes).not.toContain("text-xs");
    expect(classes).toContain("dark:bg-slate-100");
    expect(classes).toContain("dark:text-slate-900");
  });

  it("se ferme avec Échap même quand elle est ouverte à la souris (le focus est ailleurs)", () => {
    render(
      <Bulle texte="Relance ce locataire">
        <button type="button">Relancer</button>
      </Bulle>
    );
    fireEvent.mouseEnter(screen.getByRole("button").parentElement!);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("se ferme quand la fenêtre est redimensionnée plutôt que de rester au mauvais endroit", () => {
    render(
      <Bulle texte="Relance ce locataire">
        <button type="button">Relancer</button>
      </Bulle>
    );
    fireEvent.focus(screen.getByRole("button"));

    fireEvent(window, new Event("resize"));

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  describe("placement dans la fenêtre", () => {
    afterEach(() => vi.restoreAllMocks());

    /** jsdom n'a pas de mise en page : on donne une taille au bouton et à la bulle. */
    function mesures(bouton: { top: number; left: number }) {
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
        const estBulle = this.getAttribute("role") === "tooltip";
        const [w, h, left, top] = estBulle ? [200, 40, 0, 0] : [80, 30, bouton.left, bouton.top];
        return { width: w, height: h, left, top, right: left + w, bottom: top + h, x: left, y: top, toJSON: () => ({}) } as DOMRect;
      });
    }

    it("passe sous un bouton collé au haut de l'écran, au lieu d'être rognée", () => {
      mesures({ top: 4, left: 400 });
      render(
        <Bulle texte="Ouvre la liste">
          <button type="button">Liste</button>
        </Bulle>
      );
      fireEvent.focus(screen.getByRole("button"));

      const bulle = screen.getByRole("tooltip");
      expect(bulle.style.top).toBe("44px"); // bas du bouton (34) + écart (10)
      expect(bulle.style.visibility).toBe("visible");
    });

    it("reste dans la fenêtre pour un bouton collé au bord gauche", () => {
      mesures({ top: 300, left: 0 });
      render(
        <Bulle texte="Ouvre la liste">
          <button type="button">Liste</button>
        </Bulle>
      );
      fireEvent.focus(screen.getByRole("button"));

      expect(screen.getByRole("tooltip").style.left).toBe("8px");
    });

    it("dessine une pointe vers l'élément décrit, invisible des lecteurs d'écran", () => {
      mesures({ top: 300, left: 400 });
      render(
        <Bulle texte="Ouvre la liste">
          <button type="button">Liste</button>
        </Bulle>
      );
      fireEvent.focus(screen.getByRole("button"));

      const pointe = screen.getByRole("tooltip").querySelector("[aria-hidden='true']");
      expect(pointe).not.toBeNull();
    });
  });
});
