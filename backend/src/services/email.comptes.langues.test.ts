import { describe, expect, it } from "vitest";
import {
  accountAlreadyExistsEmail,
  emailVerificationEmail,
  googleWelcomeEmail,
  ownerInvitationEmail,
  passwordResetEmail,
  teamInvitationEmail,
} from "./email.service";
import type { Langue } from "../utils/langue";

/**
 * Premier lot de l'internationalisation des e-mails : les six e-mails de compte (confirmation d'adresse, mot de passe
 * oublié, invitations, bienvenue Google, compte déjà existant). Avant, ils partaient en français pour tout le monde,
 * y compris pour quelqu'un qui utilisait l'application en anglais, en espagnol ou en portugais.
 *
 * Le français reste la langue par défaut et son texte ne change pas.
 */
const LANGUES: Langue[] = ["fr", "en", "es", "pt"];
const URL = "https://exemple.test/lien?token=abc123";

/** Mots qui trahissent un reste de français dans une autre langue (hors marque et noms propres). */
const MOTS_FRANCAIS = /\b(Bonjour|vous|votre|Votre|valable|mot de passe|Cliquez|Merci|ignorer|compte|automatiquement|gestion immobilière)\b/;

const modeles: Array<{ nom: string; fabrique: (l?: Langue) => { subject: string; html: string } }> = [
  { nom: "confirmation d'adresse", fabrique: (l) => emailVerificationEmail({ verifyUrl: URL, langue: l }) },
  { nom: "mot de passe oublié", fabrique: (l) => passwordResetEmail({ resetUrl: URL, langue: l }) },
  { nom: "invitation de collaborateur", fabrique: (l) => teamInvitationEmail({ agencyName: "Agence Soleil", ownerName: "Awa Sow", inviteUrl: URL, langue: l }) },
  { nom: "invitation de propriétaire", fabrique: (l) => ownerInvitationEmail({ ownerName: "Awa Sow", agencyName: "Agence Soleil", inviteUrl: URL, langue: l }) },
  { nom: "bienvenue Google", fabrique: (l) => googleWelcomeEmail({ appUrl: URL, trialDays: 15, langue: l }) },
  { nom: "compte déjà existant", fabrique: (l) => accountAlreadyExistsEmail({ loginUrl: URL + "&a=1", resetUrl: URL + "&b=2", langue: l }) },
];

describe.each(modeles)("e-mail « $nom »", ({ fabrique }) => {
  it("sans langue, reste en français", () => {
    const { subject, html } = fabrique();
    expect(html).toContain("Cet email a été envoyé automatiquement");
    expect(subject.length).toBeGreaterThan(5);
    expect(fabrique("fr")).toEqual({ subject, html });
  });

  it.each(["en", "es", "pt"] as const)("en %s : texte traduit, sans reste de français", (langue) => {
    const { subject, html } = fabrique(langue);
    const texte = (subject + " " + html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
    expect(texte).not.toMatch(MOTS_FRANCAIS);
    expect(html).not.toContain("Cet email a été envoyé automatiquement");
  });

  it("chaque langue donne un sujet et un corps différents des autres", () => {
    const sujets = new Set(LANGUES.map((l) => fabrique(l).subject));
    const corps = new Set(LANGUES.map((l) => fabrique(l).html));
    expect(sujets.size).toBe(4);
    expect(corps.size).toBe(4);
  });

  it("le lien est présent dans toutes les langues", () => {
    for (const langue of LANGUES) expect(fabrique(langue).html).toContain("https://exemple.test/lien?token=abc123");
  });
});

describe("contenu qui dépend d'une valeur", () => {
  it("la durée de l'essai gratuit apparaît dans chaque langue", () => {
    for (const langue of LANGUES) expect(googleWelcomeEmail({ appUrl: URL, trialDays: 15, langue }).html).toContain("15");
  });

  it("l'invitation nomme l'agence et la personne qui invite, échappées dans le corps et brutes dans le sujet", () => {
    for (const langue of LANGUES) {
      const { subject, html } = teamInvitationEmail({ agencyName: "Martin & Fils", ownerName: "<b>Awa</b>", inviteUrl: URL, langue });
      expect(subject).toContain("Martin & Fils");
      expect(subject).not.toContain("&amp;");
      expect(html).toContain("Martin &amp; Fils");
      expect(html).toContain("&lt;b&gt;Awa&lt;/b&gt;");
      expect(html).not.toContain("<b>Awa</b>");
    }
  });

  it("sans nom d'agence ni de gestionnaire, un libellé par défaut dans la langue de l'e-mail", () => {
    const fr = teamInvitationEmail({ inviteUrl: URL, langue: "fr" });
    expect(fr.subject).toContain("Votre gestionnaire");
    expect(fr.subject).toContain("Votre agence");
    const en = teamInvitationEmail({ inviteUrl: URL, langue: "en" });
    expect(en.subject).toContain("Your manager");
    expect(en.subject).toContain("Your agency");
    expect(en.subject).not.toMatch(/Votre/);
    const owner = ownerInvitationEmail({ ownerName: "Awa", inviteUrl: URL, langue: "pt" });
    expect(owner.subject).toContain("Sua agência");
  });

  it("le compte déjà existant garde ses deux liens distincts, échappés", () => {
    for (const langue of LANGUES) {
      const { html } = accountAlreadyExistsEmail({ loginUrl: 'https://x.test/login?a=1&b="2"', resetUrl: "https://x.test/reset", langue });
      expect(html).toContain("https://x.test/login?a=1&amp;b=&quot;2&quot;");
      expect(html).toContain("https://x.test/reset");
    }
  });

  it("un sujet ne contient jamais de retour à la ligne", () => {
    for (const langue of LANGUES) {
      for (const { fabrique } of modeles) expect(fabrique(langue).subject).not.toMatch(/[\r\n]/);
    }
  });
});
