import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Initiales from "./Initiales";

describe("Initiales", () => {
  it("affiche les initiales du prénom et du nom, en majuscules, sans les annoncer aux lecteurs d'écran", () => {
    const { container } = render(<Initiales prenom="mariama" nom="sarr" />);
    expect(container.textContent).toBe("MS");
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  it("tient avec un nom manquant ou vide", () => {
    expect(render(<Initiales prenom="Ousmane" nom={null} />).container.textContent).toBe("O");
    expect(render(<Initiales prenom="  " nom="" />).container.textContent).toBe("?");
  });
});
