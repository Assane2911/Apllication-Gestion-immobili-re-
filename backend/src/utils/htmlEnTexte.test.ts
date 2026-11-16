import { describe, expect, it } from "vitest";
import { htmlEnTexte } from "./htmlEnTexte";

describe("htmlEnTexte", () => {
  it("garde le texte, met les liens entre parenthèses et sépare les blocs", () => {
    const html = `<div style="x"><h2>Bonjour&nbsp;Awa</h2><p>Votre loyer de <strong>500&nbsp;€</strong> arrive à échéance.</p><a href="https://app.example/portail?a=1&amp;b=2" style="c">Régler mon loyer →</a></div>`;
    expect(htmlEnTexte(html)).toBe("Bonjour Awa\nVotre loyer de 500 € arrive à échéance.\nRégler mon loyer → (https://app.example/portail?a=1&b=2)");
  });

  it("retire les styles, scripts et commentaires, garde les listes et les retours à la ligne", () => {
    const html = `<style>p{color:red}</style><!-- note --><ul><li>un</li><li>deux</li></ul>ligne<br>suivante<script>alert(1)</script>`;
    expect(htmlEnTexte(html)).toBe("- un\n- deux\n\nligne\nsuivante");
  });

  it("un lien dont l'intitulé est l'adresse n'est pas répété ; mailto garde l'intitulé", () => {
    expect(htmlEnTexte(`<a href="https://a.example/x">https://a.example/x</a>`)).toBe("https://a.example/x");
    expect(htmlEnTexte(`<a href="mailto:a@b.fr">Écrire</a>`)).toBe("Écrire");
  });

  it("ne laisse ni balise ni entité connue, et ne plante pas sur un texte vide", () => {
    expect(htmlEnTexte("")).toBe("");
    expect(htmlEnTexte("<p>a &lt;b&gt; &amp; c &#233; &#x41;</p>")).toBe("a <b> & c é A");
  });
});
