import { describe, expect, it } from "vitest";
import { versLatin1Fec } from "./csv";

describe("versLatin1Fec", () => {
  // Régression : le FEC n'accepte que l'ISO-8859-1 (arrêté du 29 juillet
  // 2013), jamais l'UTF-8 — un caractère accentué encodé sur deux octets
  // (comme le fait `res.send()` d'Express par défaut) fait échouer un
  // validateur FEC strict.
  it("encode un caractère accentué sur un seul octet Latin-1, pas deux octets UTF-8", () => {
    const buffer = versLatin1Fec("café");

    // "café" en UTF-8 ferait 5 octets (é = 0xC3 0xA9) ; en Latin-1, 4 octets (é = 0xE9).
    expect(buffer).toHaveLength(4);
    expect(Array.from(buffer)).toEqual([0x63, 0x61, 0x66, 0xe9]);
  });

  it("encode plusieurs caractères français courants correctement", () => {
    const buffer = versLatin1Fec("Impôts, entretien & réparations");
    expect(buffer.toString("latin1")).toBe("Impôts, entretien & réparations");
  });

  it("remplace un caractère hors Latin-1 par '?' plutôt que de le tronquer silencieusement", () => {
    const buffer = versLatin1Fec("Villa 😀 Ngor");
    expect(buffer.toString("latin1")).toBe("Villa ? Ngor");
  });

  it("laisse le texte purement ASCII inchangé", () => {
    const buffer = versLatin1Fec("Loyer 3/2026 - Awa Sow");
    expect(buffer.toString("latin1")).toBe("Loyer 3/2026 - Awa Sow");
  });
});
