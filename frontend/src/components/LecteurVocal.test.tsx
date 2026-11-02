import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LecteurVocal from "./LecteurVocal";

let lectures: Array<{ element: HTMLMediaElement; rate: number }> = [];

beforeEach(() => {
  lectures = [];
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
    lectures.push({ element: this, rate: this.playbackRate });
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) {
    this.dispatchEvent(new Event("pause"));
  });
  Object.defineProperty(HTMLMediaElement.prototype, "paused", { configurable: true, get: () => !lectures.length || false });
});
afterEach(() => vi.restoreAllMocks());

describe("LecteurVocal", () => {
  it("n'a pas de lecture automatique et affiche la durée du message", () => {
    const { container } = render(<LecteurVocal url="https://stockage.test/a.webm" duree={83} />);
    expect(container.querySelector("audio")).toHaveAttribute("preload", "none");
    expect(container.querySelector("audio")).not.toHaveAttribute("autoplay");
    expect(screen.getByText("0:00 / 1:23")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Écouter le message vocal" })).toBeInTheDocument();
  });

  it("lance la lecture, passe le bouton en pause, puis revient à l'écoute à la fin", async () => {
    const user = userEvent.setup();
    const { container } = render(<LecteurVocal url="https://stockage.test/a.webm" duree={30} />);
    await user.click(screen.getByRole("button", { name: "Écouter le message vocal" }));
    expect(lectures).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Mettre en pause" })).toBeInTheDocument();

    fireEvent.ended(container.querySelector("audio")!);
    expect(screen.getByRole("button", { name: "Écouter le message vocal" })).toBeInTheDocument();
  });

  it("change la vitesse de lecture : 1×, 1,5×, 2×, puis revient à 1×", async () => {
    const user = userEvent.setup();
    const { container } = render(<LecteurVocal url="https://stockage.test/a.webm" duree={30} />);
    const audio = container.querySelector("audio")!;
    const bouton = () => screen.getByRole("button", { name: /Vitesse de lecture/ });
    expect(bouton()).toHaveTextContent("1×");
    await user.click(bouton());
    expect(bouton()).toHaveTextContent("1.5×");
    expect(audio.playbackRate).toBe(1.5);
    await user.click(bouton());
    expect(bouton()).toHaveTextContent("2×");
    await user.click(bouton());
    expect(bouton()).toHaveTextContent("1×");
  });

  it("déplace la lecture avec la barre de progression, accessible au clavier", () => {
    const { container } = render(<LecteurVocal url="https://stockage.test/a.webm" duree={60} />);
    const barre = screen.getByRole("slider", { name: "Position dans le message vocal" });
    fireEvent.change(barre, { target: { value: "20" } });
    expect(container.querySelector("audio")!.currentTime).toBe(20);
    expect(barre).toHaveAttribute("aria-valuetext", "0:20 / 1:00");
  });

  it("dit que l'enregistrement est indisponible sans adresse, ou si le fichier ne se charge pas", () => {
    const { rerender, container } = render(<LecteurVocal url={null} duree={12} />);
    expect(screen.getByText("Enregistrement indisponible.")).toBeInTheDocument();
    expect(container.querySelector("audio")).toBeNull();

    rerender(<LecteurVocal url="https://stockage.test/expire.webm" duree={12} />);
    expect(container.querySelector("audio")).not.toBeNull();
    fireEvent.error(container.querySelector("audio")!);
    expect(screen.getByText("Enregistrement indisponible.")).toBeInTheDocument();
  });

  it("met en pause le message qui jouait quand on en lance un autre", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <>
        <LecteurVocal url="https://stockage.test/a.webm" duree={30} />
        <LecteurVocal url="https://stockage.test/b.webm" duree={30} />
      </>
    );
    const [a, b] = Array.from(container.querySelectorAll("audio"));
    const pause = HTMLMediaElement.prototype.pause as unknown as ReturnType<typeof vi.fn>;
    const boutons = screen.getAllByRole("button", { name: "Écouter le message vocal" });
    await user.click(boutons[0]);
    pause.mockClear();
    Object.defineProperty(a, "paused", { configurable: true, value: false });
    Object.defineProperty(b, "paused", { configurable: true, value: true });
    await user.click(boutons[1]);
    expect(pause.mock.contexts).toContain(a);
  });
});
