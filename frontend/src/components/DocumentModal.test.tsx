import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { api } from "../api/client";
import DocumentModal from "./DocumentModal";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function documentAffiche(titre: string) {
  return screen.queryByTitle(titre) as HTMLIFrameElement | null;
}

describe("DocumentModal", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
  });

  it("affiche le document demandé", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: "<p>Quittance de mars</p>" });
    render(<DocumentModal title="Quittance" docUrl="/documents/receipt/a" onClose={() => {}} />);

    await waitFor(() => expect(documentAffiche("Quittance")).not.toBeNull());
    expect(documentAffiche("Quittance")!.getAttribute("srcdoc")).toContain("Quittance de mars");
  });

  /**
   * Régression : le contenu précédent n'était jamais effacé. En changeant de
   * document sans fermer la modale, l'ancien restait affiché pendant le
   * chargement du nouveau ; et si le nouveau échouait, c'était l'ancien qui
   * restait sous le message d'erreur — un bail ou une quittance qui n'est pas
   * celui qu'on a demandé.
   */
  it("n'affiche plus l'ancien document quand le nouveau ne se charge pas", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: "<p>Quittance de mars</p>" });
    const { rerender } = render(<DocumentModal title="Document" docUrl="/documents/receipt/a" onClose={() => {}} />);
    await waitFor(() => expect(documentAffiche("Document")).not.toBeNull());

    mockedApi.get.mockRejectedValueOnce(new Error("Accès refusé"));
    rerender(<DocumentModal title="Document" docUrl="/documents/receipt/b" onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText(/Accès refusé|erreur|Error/i)).toBeInTheDocument());
    expect(documentAffiche("Document")).toBeNull();
  });

  it("retire l'ancien document pendant le chargement du suivant", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: "<p>Quittance de mars</p>" });
    const { rerender } = render(<DocumentModal title="Document" docUrl="/documents/receipt/a" onClose={() => {}} />);
    await waitFor(() => expect(documentAffiche("Document")).not.toBeNull());

    mockedApi.get.mockReturnValueOnce(new Promise(() => {}));
    rerender(<DocumentModal title="Document" docUrl="/documents/receipt/b" onClose={() => {}} />);

    await waitFor(() => expect(documentAffiche("Document")).toBeNull());
  });
});
