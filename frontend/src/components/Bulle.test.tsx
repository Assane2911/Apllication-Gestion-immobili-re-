import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
});
