import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { changerLangue } from "../i18n";
import ScannedContractModal from "./ScannedContractModal";

afterEach(async () => {
  await changerLangue("fr");
});

describe("ScannedContractModal", () => {
  it("affiche ses boutons dans la langue de l'interface (français)", () => {
    render(<ScannedContractModal title="Bail scanné" fileUrl="https://stockage.test/bail.pdf" onClose={() => {}} />);

    expect(screen.getByText("Imprimer")).toBeInTheDocument();
    expect(screen.getByText("Télécharger")).toBeInTheDocument();
    expect(screen.getByText("Plein écran")).toBeInTheDocument();
    expect(screen.getByText("Document PDF numérisé")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fermer" })).toBeInTheDocument();
  });

  it("n'affiche plus du français quand l'interface est en anglais", async () => {
    await changerLangue("en");
    render(<ScannedContractModal title="Scanned lease" fileUrl="https://stockage.test/bail.jpg" onClose={() => {}} />);

    expect(screen.getByText("Print")).toBeInTheDocument();
    expect(screen.getByText("Download")).toBeInTheDocument();
    expect(screen.getByText("Full screen")).toBeInTheDocument();
    expect(screen.getByText("High-resolution image / photo scan")).toBeInTheDocument();
    expect(screen.queryByText("Imprimer")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });
});
