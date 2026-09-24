import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import ChampTelephone from "./ChampTelephone";

/**
 * Un numéro sans indicatif ne part jamais sur WhatsApp : `versE164` refuse —
 * à raison — de deviner le pays de « 0600000000 ». Le rappel partait alors
 * par email seul, sans trace de la raison. Ce champ déplace la question au
 * moment de la saisie ; ces tests vérifient qu'il y répond sans jamais
 * supposer à la place du gestionnaire.
 */
function Hote({ initial = "" }: { initial?: string }) {
  const [valeur, setValeur] = useState(initial);
  return (
    <div>
      <ChampTelephone id="tel" value={valeur} onChange={setValeur} />
      <output data-testid="enregistre">{valeur}</output>
    </div>
  );
}

const saisie = () => screen.getByRole("textbox") as HTMLInputElement;
const pays = () => screen.getByRole("combobox") as HTMLSelectElement;
const enregistre = () => screen.getByTestId("enregistre").textContent;

describe("Champ téléphone avec indicatif", () => {
  it("compose un numéro international à partir du pays choisi et du numéro local", () => {
    render(<Hote />);

    fireEvent.change(saisie(), { target: { value: "77 842 29 93" } });

    // Sénégal présélectionné : marché principal de la plateforme.
    expect(pays().value).toBe("SN");
    expect(enregistre()).toBe("+221778422993");
  });

  it("retire le zéro de mise en route là où il disparaît à l'international", () => {
    render(<Hote />);

    fireEvent.change(pays(), { target: { value: "FR" } });
    fireEvent.change(saisie(), { target: { value: "06 12 34 56 78" } });

    expect(enregistre()).toBe("+33612345678");
    // Ce que l'utilisateur a tapé reste affiché tel quel : le 0 retiré au
    // calcul ne doit pas disparaître sous ses doigts.
    expect(saisie().value).toBe("06 12 34 56 78");
  });

  it("garde le zéro de tête là où il fait partie du numéro", () => {
    // Contre-épreuve de la règle précédente. Depuis le passage à dix chiffres,
    // un numéro ivoirien commence réellement par 07 : l'enlever appellerait
    // quelqu'un d'autre.
    render(<Hote />);

    fireEvent.change(pays(), { target: { value: "CI" } });
    fireEvent.change(saisie(), { target: { value: "07 01 23 45 67" } });

    expect(enregistre()).toBe("+2250701234567");
  });

  it("relit une valeur déjà enregistrée en séparant l'indicatif du numéro", () => {
    render(<Hote initial="+221778422993" />);

    expect(pays().value).toBe("SN");
    expect(saisie().value).toBe("778422993");
  });

  it("ne devine aucun indicatif pour une valeur héritée qui n'en porte pas", () => {
    // Le cœur du sujet : attribuer « France » à un 06 parce qu'il y ressemble
    // enverrait le rappel à un inconnu, et l'erreur ne se verrait qu'à la
    // réception. On demande donc, et on ne touche à rien entre-temps.
    render(<Hote initial="0600000000" />);

    expect(pays().value).toBe("");
    expect(saisie().value).toBe("0600000000");
    expect(enregistre()).toBe("0600000000");
    expect(screen.getByText(/n'indique aucun pays/i)).toBeInTheDocument();
  });

  it("recompose le numéro quand on change de pays sans le retaper", () => {
    render(<Hote initial="+221778422993" />);

    fireEvent.change(pays(), { target: { value: "ML" } });

    expect(enregistre()).toBe("+223778422993");
  });

  it("affiche ce qui sera enregistré, pour qu'un indicatif fautif se voie avant l'envoi", () => {
    render(<Hote />);

    fireEvent.change(saisie(), { target: { value: "77 842 29 93" } });

    expect(screen.getByText(/Sera enregistré : \+221778422993/)).toBeInTheDocument();
  });
});
