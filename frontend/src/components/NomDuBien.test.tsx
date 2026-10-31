import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NomDuBien } from "./PlanLogement";

describe("NomDuBien", () => {
  it("affiche le nom du bien précédé d'un petit plan décoratif", () => {
    const { container } = render(<NomDuBien titre="Villa Almadies" id="bien-1" />);
    expect(screen.getByText("Villa Almadies")).toBeInTheDocument();
    const plan = container.querySelector("svg");
    expect(plan).not.toBeNull();
    expect(plan?.getAttribute("aria-hidden")).toBe("true");
  });

  it("garde toujours le même plan pour un même bien", () => {
    const a = render(<NomDuBien titre="A" id="x-42" />).container.querySelector("path")?.getAttribute("d");
    const b = render(<NomDuBien titre="B" id="x-42" />).container.querySelector("path")?.getAttribute("d");
    expect(a).toBe(b);
  });

  it("ne rend rien quand le bien n'a pas de nom", () => {
    const { container } = render(<NomDuBien titre={undefined} id="bien-1" />);
    expect(container).toBeEmptyDOMElement();
  });
});
