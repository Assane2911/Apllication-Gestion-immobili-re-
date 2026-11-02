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
