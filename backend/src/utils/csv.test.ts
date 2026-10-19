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

  // Un FEC en Latin-1 ne sait pas écrire ’ (l'apostrophe typographique que le clavier d'un iPhone
  // met par défaut), œ, € ni les tirets longs : ils sortaient en « ? » (« d?urgence », « c?ur »).
  it("remplace les signes typographiques courants par leur équivalent Latin-1 plutôt que par « ? »", () => {
    expect(versLatin1Fec("Réparation d’urgence").toString("latin1")).toBe("Réparation d'urgence");
    expect(versLatin1Fec("Travaux – cœur de l’immeuble").toString("latin1")).toBe("Travaux - coeur de l'immeuble");
    expect(versLatin1Fec("Œuvre « club » “spécial”…").toString("latin1")).toBe('OEuvre « club » "spécial"...');
    expect(versLatin1Fec("Franchise 150 €").toString("latin1")).toBe("Franchise 150 EUR");
  });

  // Un texte collé depuis un Mac ou un iPhone peut décomposer « é » en « e » + accent combinant (U+0301),
  // que Latin-1 ne contient pas : « réparation » sortait en « re?paration ».
  it("recompose les lettres accentuées décomposées avant d'encoder", () => {
    const decompose = "re\u0301paration d'e\u0301te\u0301";
    expect(versLatin1Fec(decompose).toString("latin1")).toBe("réparation d'été");
  });
});
