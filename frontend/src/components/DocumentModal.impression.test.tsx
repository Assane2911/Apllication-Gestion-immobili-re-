import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import DocumentModal from "./DocumentModal";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

/**
 * Imprimer une quittance ou un bail depuis l'aperçu : le bouton ne sert que lorsqu'un document est affiché, il imprime LA
 * fenêtre du document (pas la page de l'application), et une impression impossible se voit au lieu de se taire. L'iframe qui
 * porte le document reste sans script : un document ne peut jamais exécuter de code dans l'application.
 */

const MESSAGE_ECHEC = "Impression impossible depuis cette fenêtre. Utilisez le menu d'impression de votre navigateur.";
const BOUTON = "Imprimer / Enregistrer PDF";

async function afficherLeDocument() {
  mockedApi.get.mockResolvedValueOnce({ data: "<p>Quittance de mars</p>" });
  const onClose = vi.fn();
  render(<DocumentModal title="Quittance" docUrl="/documents/receipt/a" onClose={onClose} />);
  const iframe = (await screen.findByTitle("Quittance")) as HTMLIFrameElement;
  return { iframe, onClose };
}

/** Remplace la fenêtre du document par des espions, pour observer l'impression sans ouvrir de vraie boîte de dialogue. */
function fenetreDuDocument(iframe: HTMLIFrameElement, print: () => void) {
  const focus = vi.fn();
  Object.defineProperty(iframe, "contentWindow", { value: { focus, print }, configurable: true });
  return { focus };
}

describe("DocumentModal : impression et sécurité de l'aperçu", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
  });

  it("le bouton Imprimer est inactif tant qu'aucun document n'est affiché", () => {
    mockedApi.get.mockReturnValueOnce(new Promise(() => {})); // chargement qui n'aboutit pas
    render(<DocumentModal title="Quittance" docUrl="/documents/receipt/a" onClose={() => {}} />);

    expect(screen.getByRole("button", { name: BOUTON })).toBeDisabled();
  });

  it("le bouton Imprimer reste inactif quand le document ne se charge pas, et l'erreur est annoncée", async () => {
    mockedApi.get.mockRejectedValueOnce({ response: { data: { error: "Document introuvable." } }, isAxiosError: true });
    render(<DocumentModal title="Quittance" docUrl="/documents/receipt/a" onClose={() => {}} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Document introuvable.");
    expect(screen.getByRole("button", { name: BOUTON })).toBeDisabled();
  });

  it("imprime la fenêtre du document (et non la page de l'application) après lui avoir donné le focus", async () => {
    const user = userEvent.setup();
    const { iframe } = await afficherLeDocument();
    const print = vi.fn();
    const { focus } = fenetreDuDocument(iframe, print);
    const imprimerLaPage = vi.spyOn(window, "print").mockImplementation(() => {});

    await user.click(screen.getByRole("button", { name: BOUTON }));

    expect(focus).toHaveBeenCalledTimes(1);
    expect(print).toHaveBeenCalledTimes(1);
    expect(imprimerLaPage).not.toHaveBeenCalled();
    expect(screen.queryByText(MESSAGE_ECHEC)).not.toBeInTheDocument();
  });

  it("une impression impossible se voit : le message d'échec remplace le sous-titre, puis disparaît au clic suivant qui réussit", async () => {
    const user = userEvent.setup();
    const { iframe } = await afficherLeDocument();
    let refuse = true;
    fenetreDuDocument(iframe, () => {
      if (refuse) throw new Error("Blocked by sandbox");
    });

    await user.click(screen.getByRole("button", { name: BOUTON }));
    expect(screen.getByText(MESSAGE_ECHEC)).toBeInTheDocument();

    refuse = false;
    await user.click(screen.getByRole("button", { name: BOUTON }));
    expect(screen.queryByText(MESSAGE_ECHEC)).not.toBeInTheDocument();
  });

  it("fenêtre du document indisponible : le message d'échec s'affiche au lieu d'un clic sans effet", async () => {
    const user = userEvent.setup();
    const { iframe } = await afficherLeDocument();
    Object.defineProperty(iframe, "contentWindow", { value: null, configurable: true });

    await user.click(screen.getByRole("button", { name: BOUTON }));

    expect(screen.getByText(MESSAGE_ECHEC)).toBeInTheDocument();
  });

  it("l'aperçu garde l'accès et les boîtes de dialogue d'impression, mais JAMAIS de script", async () => {
    const { iframe } = await afficherLeDocument();

    const droits = (iframe.getAttribute("sandbox") ?? "").split(/\s+/);
    expect(droits).toContain("allow-same-origin");
    expect(droits).toContain("allow-modals");
    expect(droits).not.toContain("allow-scripts");
  });

  it("fermer l'aperçu prévient le parent", async () => {
    const user = userEvent.setup();
    const { onClose } = await afficherLeDocument();

    await user.click(screen.getByRole("button", { name: "Fermer" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
