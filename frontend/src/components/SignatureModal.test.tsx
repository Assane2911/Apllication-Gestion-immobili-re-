import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SignatureModal from "./SignatureModal";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { post: vi.fn() } };
});

function afficher(objet?: "bail" | "etatDesLieux") {
  render(<SignatureModal signUrl="/x/1/sign" title="Studio Plateau" objet={objet} onSuccess={vi.fn()} onClose={vi.fn()} />);
}

describe("SignatureModal : ce qui est signé", () => {
  it("parle du bail par défaut", () => {
    afficher();
    expect(screen.getByText("Signature électronique du bail")).toBeInTheDocument();
    expect(screen.getByText(/la signature légale du contrat de bail/)).toBeInTheDocument();
  });

  it("parle de l'état des lieux, et plus du bail, quand c'est lui qu'on signe", () => {
    afficher("etatDesLieux");
    expect(screen.getByText("Signature électronique de l'état des lieux")).toBeInTheDocument();
    expect(screen.getByText(/l'exactitude de l'état des lieux et vous le signez/)).toBeInTheDocument();
    expect(screen.queryByText("Signature électronique du bail")).not.toBeInTheDocument();
    expect(screen.queryByText(/contrat de bail/)).not.toBeInTheDocument();
  });
});
