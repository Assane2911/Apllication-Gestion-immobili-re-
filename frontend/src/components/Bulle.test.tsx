import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import Bulle from "./Bulle";

/**
 * Donne le focus comme le ferait la touche Tab. Un focus donné par programme après une action à la souris n'est PAS
 * un focus clavier (`:focus-visible`, comme dans un vrai navigateur) : on simule donc d'abord la touche.
 */
function focusClavier(element: HTMLElement) {
  fireEvent.keyDown(document.body, { key: "Tab" });
  act(() => element.focus());
}

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

    focusClavier(screen.getByRole("button"));

    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("se referme avec Échap, comme toute chose qui s'ouvre", () => {
    render(
      <Bulle texte="Relance ce locataire">
        <button type="button">Relancer</button>
      </Bulle>
    );
    const declencheur = screen.getByRole("button");
    focusClavier(declencheur);

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
    focusClavier(declencheur);
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

    focusClavier(declencheur);
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

  it("se lit sans effort : texte de 14 px", () => {
    render(
      <Bulle texte="Exporte les données">
        <button type="button">Exporter</button>
      </Bulle>
    );
    focusClavier(screen.getByRole("button"));

    const classes = screen.getByRole("tooltip").className;
    expect(classes).toContain("text-sm");
    expect(classes).not.toContain("text-xs");
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
    focusClavier(screen.getByRole("button"));

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
      focusClavier(screen.getByRole("button"));

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
      focusClavier(screen.getByRole("button"));

      expect(screen.getByRole("tooltip").style.left).toBe("8px");
    });

    it("dessine une pointe vers l'élément décrit, invisible des lecteurs d'écran", () => {
      mesures({ top: 300, left: 400 });
      render(
        <Bulle texte="Ouvre la liste">
          <button type="button">Liste</button>
        </Bulle>
      );
      focusClavier(screen.getByRole("button"));

      const pointe = screen.getByRole("tooltip").querySelector("[aria-hidden='true']");
      expect(pointe).not.toBeNull();
    });
  });
});

/**
 * Sur un écran tactile, il n'y a pas de survol : le navigateur imite pourtant `mouseenter` et le focus à chaque
 * appui, et aucun `mouseleave` ne vient fermer la bulle. Elle restait donc affichée par-dessus l'écran, jusqu'au
 * prochain appui ailleurs, en recouvrant les boutons voisins. Les libellés sont déjà visibles sur téléphone : la
 * bulle ne s'y ouvre pas. Un écran qui sait survoler (souris) garde le comportement habituel.
 */
describe("Bulle d'information — écran tactile", () => {
  afterEach(() => vi.unstubAllGlobals());

  function simulerPointeur(peutSurvoler: boolean) {
    vi.stubGlobal("matchMedia", (requete: string) => ({
      matches: requete === "(hover: none)" ? !peutSurvoler : false,
      media: requete,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    }));
  }

  it("ne s'ouvre pas quand le navigateur imite un survol après un appui", () => {
    simulerPointeur(false);
    render(
      <Bulle texte="Bascule entre l'affichage clair et l'affichage sombre.">
        <button type="button">Thème</button>
      </Bulle>
    );
    const bouton = screen.getByRole("button");

    fireEvent.mouseEnter(bouton.parentElement!);
    focusClavier(bouton);

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(bouton).not.toHaveAttribute("aria-describedby");
  });

  it("garde son comportement avec une souris", () => {
    simulerPointeur(true);
    render(
      <Bulle texte="Ouvre la liste de vos locataires">
        <button type="button">Locataires</button>
      </Bulle>
    );

    fireEvent.mouseEnter(screen.getByRole("button").parentElement!);

    expect(screen.getByRole("tooltip")).toHaveTextContent("Ouvre la liste de vos locataires");
  });
});

/**
 * Le focus d'un clic ne doit pas ouvrir la bulle, et la bulle ne doit pas survivre à la fenêtre qu'on quitte.
 *
 * Constaté : on clique un bouton (il garde le focus), la souris s'éloigne (la bulle se ferme), on quitte la page ou
 * l'onglet puis on revient — le navigateur redonne alors le focus au bouton, la bulle s'ouvre sans que rien ne la
 * désigne, et aucun événement de sortie de souris ne vient plus la fermer : elle restait affichée.
 */
describe("Bulle d'information : focus d'un clic et fenêtre quittée", () => {
  afterEach(() => vi.restoreAllMocks());

  it("ne s'ouvre pas quand le navigateur redonne le focus à un bouton cliqué à la souris", async () => {
    render(
      <Bulle texte="Ouvre la liste de vos locataires">
        <button type="button">Locataires</button>
      </Bulle>
    );
    const bouton = screen.getByRole("button");
    const utilisateur = userEvent.setup();
    await utilisateur.click(bouton);
    await utilisateur.unhover(bouton);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(bouton).toHaveFocus();

    // L'onglet est quitté puis retrouvé : le navigateur déclenche de nouveau « focus » sur l'élément qui l'a gardé.
    fireEvent.focus(bouton);

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("s'ouvre toujours au focus clavier (Tab)", async () => {
    render(
      <Bulle texte="Ouvre la liste de vos locataires">
        <button type="button">Locataires</button>
      </Bulle>
    );

    await userEvent.setup().tab();

    expect(screen.getByRole("tooltip")).toHaveTextContent("Ouvre la liste de vos locataires");
  });

  it("se ferme quand la fenêtre perd le focus (on quitte la page ou l'application)", () => {
    render(
      <Bulle texte="Ouvre la liste de vos locataires">
        <button type="button">Locataires</button>
      </Bulle>
    );
    focusClavier(screen.getByRole("button"));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.blur(window);

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("se ferme quand la page passe en arrière-plan (autre onglet, écran verrouillé)", () => {
    render(
      <Bulle texte="Ouvre la liste de vos locataires">
        <button type="button">Locataires</button>
      </Bulle>
    );
    fireEvent.mouseEnter(screen.getByRole("button").parentElement!);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");

    fireEvent(document, new Event("visibilitychange"));

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("ne se ferme pas quand la page redevient visible (rien à fermer, rien à rouvrir)", () => {
    render(
      <Bulle texte="Ouvre la liste de vos locataires">
        <button type="button">Locataires</button>
      </Bulle>
    );
    fireEvent.mouseEnter(screen.getByRole("button").parentElement!);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");

    fireEvent(document, new Event("visibilitychange"));

    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("revient au retour dans la fenêtre pour un focus clavier : le focus y est vraiment", () => {
    render(
      <Bulle texte="Ouvre la liste de vos locataires">
        <button type="button">Locataires</button>
      </Bulle>
    );
    const bouton = screen.getByRole("button");
    focusClavier(bouton);
    fireEvent.blur(window);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    fireEvent.focus(bouton);

    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });
});
