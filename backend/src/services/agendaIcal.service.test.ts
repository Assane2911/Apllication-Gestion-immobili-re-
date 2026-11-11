import { describe, expect, it } from "vitest";
import type { EvenementAgenda } from "./agenda.service";
import { echapperTexte, genererIcs, replier } from "./agendaIcal.service";

// Barre oblique inverse construite à part : plus lisible que des séquences d'échappement doublées dans les attentes.
const BS = String.fromCharCode(92);
const MAINTENANT = new Date(Date.UTC(2026, 10, 11, 18, 30, 5));

const evenement = (surcharge: Partial<EvenementAgenda> = {}): EvenementAgenda => ({
  id: "RENT_DUE:abc",
  type: "RENT_DUE",
  date: new Date(Date.UTC(2026, 10, 20)),
  enRetard: false,
  propertyId: "p1",
  propertyTitle: "Villa Baobab",
  contractId: "c1",
  tenantName: "Awa Sow",
  amount: 300,
  currency: "EUR",
  label: null,
  ...surcharge,
});

const lignesDe = (ics: string) => ics.split("\r\n");

describe("echapperTexte", () => {
  it("échappe la barre oblique inverse, le point-virgule et la virgule", () => {
    expect(echapperTexte(`a${BS}b;c,d`)).toBe(`a${BS}${BS}b${BS};c${BS},d`);
  });

  it("remplace les sauts de ligne et caractères de contrôle : impossible d'y glisser une propriété", () => {
    const piege = "Villa\r\nATTENDEE:mailto:pirate@example.com\nEND:VEVENT";
    const texte = echapperTexte(piege);
    expect(texte).not.toMatch(/[\r\n]/);
    expect(texte).toBe("Villa ATTENDEE:mailto:pirate@example.com END:VEVENT");
  });
});

describe("replier", () => {
  it("laisse intacte une ligne de 75 octets ou moins", () => {
    const ligne = "X".repeat(75);
    expect(replier(ligne)).toBe(ligne);
  });

  it("replie au-delà de 75 octets : chaque ligne tient dans 75 octets, la suite commence par une espace, et le texte se reconstitue", () => {
    const ligne = `SUMMARY:${"abcdefghij".repeat(20)}`;
    const replie = replier(ligne);
    const morceaux = replie.split("\r\n");
    expect(morceaux.length).toBeGreaterThan(1);
    for (const m of morceaux) expect(Buffer.byteLength(m, "utf8")).toBeLessThanOrEqual(75);
    for (const m of morceaux.slice(1)) expect(m.startsWith(" ")).toBe(true);
    expect(morceaux.map((m, i) => (i === 0 ? m : m.slice(1))).join("")).toBe(ligne);
  });

  it("ne coupe jamais un caractère multi-octets", () => {
    const ligne = `SUMMARY:${"é€😀".repeat(40)}`;
    const replie = replier(ligne);
    const morceaux = replie.split("\r\n");
    for (const m of morceaux) expect(Buffer.byteLength(m, "utf8")).toBeLessThanOrEqual(75);
    expect(morceaux.map((m, i) => (i === 0 ? m : m.slice(1))).join("")).toBe(ligne);
    expect(replie).not.toContain("�");
  });
});

describe("genererIcs", () => {
  it("produit un calendrier valide : en-têtes, fins de ligne CRLF, un VEVENT par échéance", () => {
    const ics = genererIcs([evenement(), evenement({ id: "LEASE_END:z", type: "LEASE_END" })], { maintenant: MAINTENANT });
    const lignes = lignesDe(ics);
    expect(lignes[0]).toBe("BEGIN:VCALENDAR");
    expect(lignes).toContain("VERSION:2.0");
    expect(lignes).toContain("METHOD:PUBLISH");
    expect(lignes[lignes.length - 2]).toBe("END:VCALENDAR");
    expect(lignes[lignes.length - 1]).toBe("");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics.match(/END:VEVENT/g)).toHaveLength(2);
    // Aucun saut de ligne nu : tout est en CRLF.
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("donne à chaque échéance une journée entière, sans décalage de fuseau, avec un identifiant stable", () => {
    const ics = genererIcs([evenement({ date: new Date(Date.UTC(2026, 11, 31)) })], { maintenant: MAINTENANT });
    expect(ics).toContain("DTSTART;VALUE=DATE:20261231");
    expect(ics).toContain("DTEND;VALUE=DATE:20270101");
    expect(ics).toContain("DTSTAMP:20261111T183005Z");
    expect(ics).toContain("UID:RENT_DUE:abc@immoplatform.agenda");
    expect(ics).toContain("TRANSP:TRANSPARENT");
    expect(genererIcs([evenement()], { maintenant: MAINTENANT })).toBe(genererIcs([evenement()], { maintenant: MAINTENANT }));
  });

  it("écrit le bien, le locataire et le reste dû dans la langue du gestionnaire", () => {
    const fr = genererIcs([evenement()], { langue: "fr", maintenant: MAINTENANT });
    expect(fr).toContain("SUMMARY:Loyer dû — Villa Baobab — Awa Sow");
    expect(fr).toMatch(/DESCRIPTION:Reste dû : 300/);

    const en = genererIcs([evenement()], { langue: "en", maintenant: MAINTENANT });
    expect(en).toContain("SUMMARY:Rent due — Villa Baobab — Awa Sow");
    expect(en).toMatch(/DESCRIPTION:Amount outstanding: /);

    expect(genererIcs([evenement()], { langue: "es", maintenant: MAINTENANT })).toContain("SUMMARY:Alquiler pendiente — ");
    expect(genererIcs([evenement()], { langue: "pt", maintenant: MAINTENANT })).toContain("SUMMARY:Renda em dívida — ");
  });

  it("signale ce qui est en retard dans le titre, sans changer sa date", () => {
    const ics = genererIcs([evenement({ enRetard: true, date: new Date(Date.UTC(2026, 4, 5)) })], { langue: "fr", maintenant: MAINTENANT });
    expect(ics).toContain("SUMMARY:[En retard] Loyer dû");
    expect(ics).toContain("DTSTART;VALUE=DATE:20260505");
  });

  it("décrit assurance, document, sortie et révision avec leur libellé", () => {
    const ics = genererIcs(
      [
        evenement({ id: "INSURANCE_EXPIRY:1", type: "INSURANCE_EXPIRY", tenantName: null, amount: null, currency: null, label: "AXA" }),
        evenement({ id: "DOCUMENT_EXPIRY:1", type: "DOCUMENT_EXPIRY", propertyTitle: null, amount: null, currency: null, label: "Diagnostic gaz" }),
        evenement({ id: "EXIT:1", type: "EXIT", amount: null, currency: null, label: "Mutation" }),
        evenement({ id: "RENT_REVISION:1", type: "RENT_REVISION", amount: 520 }),
      ],
      { langue: "fr", maintenant: MAINTENANT }
    );
    expect(ics).toContain("DESCRIPTION:Assureur : AXA");
    expect(ics).toContain("DESCRIPTION:Document : Diagnostic gaz");
    expect(ics).toContain("DESCRIPTION:Motif : Mutation");
    expect(ics).toMatch(/DESCRIPTION:Nouveau loyer : 520/);
  });

  it("neutralise les noms piégés : aucune propriété injectée, virgules et points-virgules échappés", () => {
    const ics = genererIcs(
      [evenement({ propertyTitle: "Villa; Baobab, Dakar", tenantName: "Awa\r\nATTENDEE:mailto:pirate@example.com", label: "x" })],
      { maintenant: MAINTENANT }
    );
    const lignes = lignesDe(ics);
    expect(lignes.some((l) => l.startsWith("ATTENDEE"))).toBe(false);
    expect(ics).toContain(`Villa${BS}; Baobab${BS}, Dakar`);
  });

  it("garde chaque ligne sous 75 octets, même avec un très long titre", () => {
    const ics = genererIcs([evenement({ propertyTitle: "Résidence ".repeat(30) })], { maintenant: MAINTENANT });
    for (const ligne of lignesDe(ics)) expect(Buffer.byteLength(ligne, "utf8")).toBeLessThanOrEqual(75);
  });

  it("donne un calendrier vide et valide quand il n'y a aucune échéance", () => {
    const ics = genererIcs([], { maintenant: MAINTENANT });
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).not.toContain("BEGIN:VEVENT");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});
