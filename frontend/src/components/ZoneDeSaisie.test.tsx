import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installerFauxMicro, type FauxMicro } from "../test/fauxMicro";
import ZoneDeSaisie from "./ZoneDeSaisie";

let micro: FauxMicro | null = null;
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
});
afterEach(() => {
  micro?.restaurer();
  micro = null;
  vi.restoreAllMocks();
});

function afficher(props: Partial<React.ComponentProps<typeof ZoneDeSaisie>> = {}) {
  return render(
    <ZoneDeSaisie
      valeur=""
      onChange={() => undefined}
      onSubmit={(e) => e.preventDefault()}
      envoi={false}
      libelleChamp="Écrivez votre message..."
      libelleEnvoyer="Envoyer"
      libelleEnvoi="Envoi…"
      indice="Entrée pour envoyer"
      {...props}
    />
  );
}

async function enregistrer(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Enregistrer un message vocal" }));
  await screen.findByText("Enregistrement");
  await act(async () => {
    await new Promise((r) => setTimeout(r, 1100));
  });
  await user.click(screen.getByRole("button", { name: "Terminer" }));
}

describe("ZoneDeSaisie — message vocal", () => {
  it("n'affiche pas de micro quand le vocal n'est pas activé, ni quand le navigateur ne sait pas enregistrer", () => {
    micro = installerFauxMicro();
    const { unmount } = afficher();
    expect(screen.queryByRole("button", { name: "Enregistrer un message vocal" })).not.toBeInTheDocument();
    unmount();

    micro.restaurer();
    micro = null;
    afficher({ onEnvoyerVocal: async () => undefined });
    expect(screen.queryByRole("button", { name: "Enregistrer un message vocal" })).not.toBeInTheDocument();
  });

  it("enregistre, laisse réécouter, puis envoie le vocal et revient à la saisie", async () => {
    const user = userEvent.setup();
    micro = installerFauxMicro();
    const envoyer = vi.fn(async () => undefined);
    afficher({ onEnvoyerVocal: envoyer });

    await enregistrer(user);
    expect(await screen.findByText("Réécoutez avant d'envoyer")).toBeInTheDocument();
    // Pendant la réécoute, le texte n'est plus proposé : un seul geste à la fois.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(envoyer).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Envoyer le vocal" }));
    expect(envoyer).toHaveBeenCalledTimes(1);
    const enregistrement = (envoyer.mock.calls[0] as unknown as [{ duree: number; type: string; blob: Blob }])[0];
    expect(enregistrement.type).toBe("audio/webm");
    expect(enregistrement.duree).toBeGreaterThanOrEqual(1);
    expect(await screen.findByRole("textbox")).toBeInTheDocument();
  });

  it("garde l'enregistrement et affiche l'erreur quand l'envoi échoue", async () => {
    const user = userEvent.setup();
    micro = installerFauxMicro();
    const envoyer = vi.fn(async () => {
      throw { isAxiosError: true, response: { data: { error: "Messagerie réservée à la formule Professionnel" } } };
    });
    afficher({ onEnvoyerVocal: envoyer });

    await enregistrer(user);
    await user.click(await screen.findByRole("button", { name: "Envoyer le vocal" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Messagerie réservée à la formule Professionnel");
    // Réessayer reste possible : l'enregistrement n'est pas perdu.
    expect(screen.getByRole("button", { name: "Envoyer le vocal" })).toBeEnabled();
    expect(screen.getByText("Réécoutez avant d'envoyer")).toBeInTheDocument();
  });

  it("annule un enregistrement en cours et relâche le micro", async () => {
    const user = userEvent.setup();
    micro = installerFauxMicro();
    afficher({ onEnvoyerVocal: async () => undefined });

    await user.click(screen.getByRole("button", { name: "Enregistrer un message vocal" }));
    await screen.findByText("Enregistrement");
    await user.click(screen.getByRole("button", { name: "Annuler" }));
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(micro.pistes[0].stop).toHaveBeenCalled();
  });

  it("supprime l'enregistrement réécouté sans rien envoyer", async () => {
    const user = userEvent.setup();
    micro = installerFauxMicro();
    const envoyer = vi.fn(async () => undefined);
    afficher({ onEnvoyerVocal: envoyer });

    await enregistrer(user);
    await user.click(await screen.findByRole("button", { name: "Supprimer" }));
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(envoyer).not.toHaveBeenCalled();
  });

  it("explique un micro refusé sans bloquer la saisie de texte", async () => {
    const user = userEvent.setup();
    micro = installerFauxMicro({ refuser: { name: "NotAllowedError" } });
    afficher({ onEnvoyerVocal: async () => undefined });

    await user.click(screen.getByRole("button", { name: "Enregistrer un message vocal" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Le micro est bloqué");
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });
});
