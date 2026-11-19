import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import SignatureModal from "./SignatureModal";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { post: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

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

/**
 * Le tracé et l'envoi de la signature : ce que l'utilisateur fait réellement avec cette fenêtre. Seuls les titres étaient
 * testés (58 % du fichier couvert) : une signature envoyée vide, ou qui ne partirait pas vers la bonne route, serait passée
 * inaperçue. jsdom ne dessine pas : on remplace le contexte 2D par un espion, et `toDataURL` par une image connue.
 */
describe("SignatureModal : tracé, effacement et envoi", () => {
  const contexte = {
    lineWidth: 0,
    lineCap: "",
    lineJoin: "",
    strokeStyle: "",
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    clearRect: vi.fn(),
  };
  const IMAGE = "data:image/png;base64,SIGNATURE-DE-TEST";

  beforeEach(() => {
    for (const fonction of [contexte.beginPath, contexte.moveTo, contexte.lineTo, contexte.stroke, contexte.clearRect]) fonction.mockReset();
    mockedApi.post.mockReset();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(contexte as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(IMAGE);
    // Le cadre est décalé de (10, 20) dans la page : les coordonnées tracées sont relatives à lui.
    vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 10, top: 20, right: 470, bottom: 200, width: 460, height: 180, x: 10, y: 20, toJSON: () => ({}) });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function monter(surcharges: { onSuccess?: () => void; onClose?: () => void } = {}) {
    const onSuccess = surcharges.onSuccess ?? vi.fn();
    const onClose = surcharges.onClose ?? vi.fn();
    const { container } = render(<SignatureModal signUrl="/contracts/c1/sign" title="Studio Plateau" onSuccess={onSuccess} onClose={onClose} />);
    const canvas = container.ownerDocument.querySelector("canvas") as HTMLCanvasElement;
    return { canvas, onSuccess, onClose };
  }

  const valider = () => screen.getByRole("button", { name: "Valider ma signature" });

  it("règle l'épaisseur et la couleur du trait au montage", () => {
    monter();
    expect(contexte.lineWidth).toBe(2.5);
    expect(contexte.lineCap).toBe("round");
    expect(contexte.strokeStyle).toBe("#0f172a");
  });

  it("refuse de valider un cadre vide : message d'erreur, et rien n'est envoyé", async () => {
    monter();
    await userEvent.click(valider());

    expect(screen.getByRole("alert")).toHaveTextContent("Veuillez apposer votre signature sur le cadre avant de valider.");
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it("affiche « Signez ici » tant que rien n'est tracé, puis le retire dès le premier trait", () => {
    const { canvas } = monter();
    expect(screen.getByText("Signez ici")).toBeInTheDocument();

    fireEvent.mouseDown(canvas, { clientX: 50, clientY: 70 });

    expect(screen.queryByText("Signez ici")).not.toBeInTheDocument();
  });

  it("trace à la souris, en coordonnées relatives au cadre, et seulement bouton enfoncé", () => {
    const { canvas } = monter();

    fireEvent.mouseMove(canvas, { clientX: 30, clientY: 40 });
    expect(contexte.lineTo).not.toHaveBeenCalled(); // pas de trait sans appui

    fireEvent.mouseDown(canvas, { clientX: 50, clientY: 70 });
    expect(contexte.beginPath).toHaveBeenCalledTimes(1);
    expect(contexte.moveTo).toHaveBeenCalledWith(40, 50); // 50-10, 70-20

    fireEvent.mouseMove(canvas, { clientX: 60, clientY: 90 });
    expect(contexte.lineTo).toHaveBeenCalledWith(50, 70);
    expect(contexte.stroke).toHaveBeenCalledTimes(1);
  });

  it("arrête de tracer au relâchement du bouton, et quand le pointeur quitte le cadre", () => {
    const { canvas } = monter();
    fireEvent.mouseDown(canvas, { clientX: 50, clientY: 70 });
    fireEvent.mouseUp(canvas);
    fireEvent.mouseMove(canvas, { clientX: 60, clientY: 90 });
    expect(contexte.lineTo).not.toHaveBeenCalled();

    fireEvent.mouseDown(canvas, { clientX: 50, clientY: 70 });
    fireEvent.mouseLeave(canvas);
    fireEvent.mouseMove(canvas, { clientX: 60, clientY: 90 });
    expect(contexte.lineTo).not.toHaveBeenCalled();
  });

  it("trace aussi au doigt (écran tactile), avec les mêmes coordonnées relatives", () => {
    const { canvas } = monter();

    fireEvent.touchStart(canvas, { touches: [{ clientX: 110, clientY: 120 }] });
    expect(contexte.moveTo).toHaveBeenCalledWith(100, 100);

    fireEvent.touchMove(canvas, { touches: [{ clientX: 130, clientY: 140 }] });
    expect(contexte.lineTo).toHaveBeenCalledWith(120, 120);

    fireEvent.touchEnd(canvas);
    fireEvent.touchMove(canvas, { touches: [{ clientX: 150, clientY: 160 }] });
    expect(contexte.lineTo).toHaveBeenCalledTimes(1);
  });

  it("« Effacer » vide le cadre, remet « Signez ici », et une signature vide est de nouveau refusée", async () => {
    const { canvas } = monter();
    fireEvent.mouseDown(canvas, { clientX: 50, clientY: 70 });
    expect(screen.queryByText("Signez ici")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Effacer" }));

    expect(contexte.clearRect).toHaveBeenCalledWith(0, 0, 460, 180);
    expect(screen.getByText("Signez ici")).toBeInTheDocument();

    await userEvent.click(valider());
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it("envoie l'image du cadre à la route de signature, puis prévient le parent", async () => {
    mockedApi.post.mockResolvedValue({ data: {} });
    const { canvas, onSuccess } = monter();
    fireEvent.mouseDown(canvas, { clientX: 50, clientY: 70 });

    await userEvent.click(valider());

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(mockedApi.post).toHaveBeenCalledWith("/contracts/c1/sign", { signatureDataUrl: IMAGE });
  });

  it("pendant l'envoi : bouton « Validation... » désactivé, fenêtre non fermable ; puis le bouton revient", async () => {
    let terminer: (valeur: unknown) => void = () => {};
    mockedApi.post.mockReturnValue(new Promise((resolve) => (terminer = resolve)));
    const { canvas, onSuccess } = monter();
    fireEvent.mouseDown(canvas, { clientX: 50, clientY: 70 });

    await userEvent.click(valider());

    const enCours = await screen.findByRole("button", { name: "Validation..." });
    expect(enCours).toBeDisabled();

    await act(async () => terminer({ data: {} }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Valider ma signature" })).toBeEnabled();
  });

  it("affiche l'erreur du serveur, ne prévient pas le parent, et laisse réessayer", async () => {
    mockedApi.post.mockRejectedValue({ isAxiosError: true, response: { data: { error: "Ce bail est déjà signé." } } });
    const { canvas, onSuccess } = monter();
    fireEvent.mouseDown(canvas, { clientX: 50, clientY: 70 });

    await userEvent.click(valider());

    expect(await screen.findByRole("alert")).toHaveTextContent("Ce bail est déjà signé.");
    expect(onSuccess).not.toHaveBeenCalled();
    expect(valider()).toBeEnabled();
  });

  it("« Annuler » ferme la fenêtre sans rien envoyer", async () => {
    const { onClose } = monter();
    await userEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(onClose).toHaveBeenCalled();
    expect(mockedApi.post).not.toHaveBeenCalled();
  });
});
