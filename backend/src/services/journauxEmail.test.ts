import { afterEach, describe, expect, it, vi } from "vitest";
import { sendEmail } from "./email.service";

/**
 * L'application écrivait l'adresse complète du destinataire dans la sortie
 * standard, à chaque email simulé comme à chaque échec SMTP. Ces lignes sont
 * conservées par l'hébergeur, lisibles depuis son tableau de bord et
 * exportables : les journaux devenaient un second fichier de données
 * personnelles, non déclaré, alimenté sans qu'on l'ait décidé.
 *
 * Pour diagnostiquer un envoi, reconnaître une adresse suffit — la lire en
 * entier n'apporte rien.
 */
describe("adresses email dans les journaux", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("n'écrit jamais l'adresse complète, même en mode simulé", async () => {
    // La suite de tests tourne sans SMTP configuré : c'est exactement le
    // chemin « email simulé », celui qui journalisait le plus souvent.
    const trace = vi.spyOn(console, "warn").mockImplementation(() => {});

    await sendEmail("amadou.diallo@exemple.sn", "Quittance de loyer", "<p>Bonjour</p>");

    expect(trace).toHaveBeenCalledTimes(1);
    const ligne = trace.mock.calls[0].join(" ");

    expect(ligne).not.toContain("amadou.diallo@exemple.sn");
    expect(ligne).not.toContain("amadou.diallo");
  });

  it("garde le domaine et la première lettre, de quoi reconnaître sans lire", async () => {
    // Le domaine porte l'information utile au diagnostic : un fournisseur qui
    // refuse en bloc, une adresse mal orthographiée.
    const trace = vi.spyOn(console, "warn").mockImplementation(() => {});

    await sendEmail("amadou.diallo@exemple.sn", "Quittance", "<p>Bonjour</p>");

    const ligne = trace.mock.calls[0].join(" ");
    expect(ligne).toContain("a***@exemple.sn");
  });

  it("ne laisse pas fuir une adresse mal formée", async () => {
    const trace = vi.spyOn(console, "warn").mockImplementation(() => {});

    await sendEmail("pas-une-adresse", "Sujet", "<p>Bonjour</p>");

    const ligne = trace.mock.calls[0].join(" ");
    expect(ligne).not.toContain("pas-une-adresse");
    expect(ligne).toContain("***");
  });
});
