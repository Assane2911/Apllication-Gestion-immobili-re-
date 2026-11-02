import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Message } from "../types";
import FilDeMessages from "./FilDeMessages";

function message(o: Partial<Message> = {}): Message {
  return { id: "m", contractId: "c", senderId: "s", senderRole: "MANAGER", content: "Bonjour", isRead: true, createdAt: "2026-11-02T10:00:00.000Z", ...o };
}

function afficher(messages: Message[]) {
  return render(
    <FilDeMessages
      messages={messages}
      roleMoi="TENANT"
      libelleMoi="Vous"
      libelleAutre="Gestionnaire"
      libelleLu="Lu"
      libelleEnvoye="Envoyé"
      chargement={false}
      libelleChargement="Chargement…"
      libelleVide="Aucun message"
    />
  );
}

describe("FilDeMessages — messages vocaux", () => {
  it("affiche un lecteur pour un vocal et le texte pour un message écrit", () => {
    const { container } = afficher([
      message({ id: "a", content: "", audioUrl: "https://stockage.test/a.webm", audioDurationSec: 42 }),
      message({ id: "b", content: "Bonne journée", createdAt: "2026-11-02T11:00:00.000Z" }),
    ]);
    expect(container.querySelectorAll("audio")).toHaveLength(1);
    expect(screen.getByText("0:00 / 0:42")).toBeInTheDocument();
    expect(screen.getByText("Bonne journée")).toBeInTheDocument();
  });

  it("dit qu'un vocal est indisponible quand son fichier a été effacé, sans bulle vide", () => {
    afficher([message({ content: "", audioUrl: null, audioDurationSec: 30 })]);
    expect(screen.getByText("Enregistrement indisponible.")).toBeInTheDocument();
  });

  it("garde les vocaux de la personne qui lit à droite, avec l'état Lu / Envoyé", () => {
    afficher([message({ senderRole: "TENANT", content: "", audioUrl: "https://stockage.test/a.webm", audioDurationSec: 5, isRead: false })]);
    expect(screen.getByText(/Envoyé/)).toBeInTheDocument();
    expect(screen.getByText("Vous")).toBeInTheDocument();
  });
});

describe("FilDeMessages — défilement lors d'une actualisation", () => {
  const props = {
    roleMoi: "TENANT" as const,
    libelleMoi: "Vous",
    libelleAutre: "Gestionnaire",
    libelleLu: "Lu",
    libelleEnvoye: "Envoyé",
    chargement: false,
    libelleChargement: "Chargement…",
    libelleVide: "Aucun message",
  };
  const fil = (n: number, extra: Partial<Message> = {}) =>
    Array.from({ length: n }, (_, i) => message({ id: `m${i}`, content: `msg ${i}`, createdAt: `2026-11-02T10:0${i}:00.000Z`, ...(i === n - 1 ? extra : {}) }));

  /** Une zone de 300 px de haut qui en contient 1000 : on observe `scrollTop` comme le ferait le navigateur. */
  function zoneDe(conteneur: HTMLElement, scrollTop: number) {
    const zone = conteneur.querySelector('[role="log"]') as HTMLDivElement;
    Object.defineProperty(zone, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(zone, "clientHeight", { configurable: true, value: 300 });
    zone.scrollTop = scrollTop;
    return zone;
  }

  it("s'ouvre sur le message le plus récent", () => {
    const { container } = render(<FilDeMessages {...props} messages={fil(3)} />);
    const zone = container.querySelector('[role="log"]') as HTMLDivElement;
    expect(zone.scrollTop).toBe(zone.scrollHeight);
  });

  it("descend à l'arrivée d'un message quand le lecteur est en bas", () => {
    const { container, rerender } = render(<FilDeMessages {...props} messages={fil(3)} />);
    const zone = zoneDe(container, 700); // 1000 - 700 - 300 = 0 : tout en bas
    rerender(<FilDeMessages {...props} messages={fil(4)} />);
    expect(zone.scrollTop).toBe(1000);
  });

  it("laisse en paix celui qui relit l'historique quand un message arrive", () => {
    const { container, rerender } = render(<FilDeMessages {...props} messages={fil(3)} />);
    const zone = zoneDe(container, 100); // loin du bas
    rerender(<FilDeMessages {...props} messages={fil(4)} />);
    expect(zone.scrollTop).toBe(100);
  });

  it("descend toujours pour le message qu'on vient d'envoyer soi-même", () => {
    const { container, rerender } = render(<FilDeMessages {...props} messages={fil(3)} />);
    const zone = zoneDe(container, 100);
    rerender(<FilDeMessages {...props} messages={fil(4, { senderRole: "TENANT" })} />);
    expect(zone.scrollTop).toBe(1000);
  });

  it("ne défile pas quand seul l'état d'un message change (« Lu », lien d'un vocal)", () => {
    const { container, rerender } = render(<FilDeMessages {...props} messages={fil(3, { senderRole: "TENANT", isRead: false })} />);
    const zone = zoneDe(container, 100);
    rerender(<FilDeMessages {...props} messages={fil(3, { senderRole: "TENANT", isRead: true })} />);
    expect(zone.scrollTop).toBe(100);
  });

  it("annonce les nouveaux messages aux lecteurs d'écran (zone de journal)", () => {
    render(<FilDeMessages {...props} messages={fil(1)} />);
    expect(screen.getByRole("log")).toBeInTheDocument();
  });
});
