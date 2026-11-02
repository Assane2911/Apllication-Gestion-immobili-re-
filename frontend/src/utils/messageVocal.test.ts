import { afterEach, describe, expect, it } from "vitest";
import { installerFauxMicro, type FauxMicro } from "../test/fauxMicro";
import { choisirTypeEnregistrement, classerErreurMicro, enregistrementPossible, estVocal, extensionEnregistrement, formaterDuree } from "./messageVocal";

describe("messageVocal", () => {
  let micro: FauxMicro | null = null;
  afterEach(() => {
    micro?.restaurer();
    micro = null;
  });

  it("formate la durée", () => {
    expect(formaterDuree(0)).toBe("0:00");
    expect(formaterDuree(59.6)).toBe("1:00");
    expect(formaterDuree(125)).toBe("2:05");
    expect(formaterDuree(-1)).toBe("0:00");
  });

  it("choisit le premier format que le navigateur sait enregistrer", () => {
    micro = installerFauxMicro();
    expect(choisirTypeEnregistrement()).toBe("audio/webm;codecs=opus");
  });

  it("sait dire si l'enregistrement est possible", () => {
    expect(enregistrementPossible()).toBe(false);
    micro = installerFauxMicro();
    expect(enregistrementPossible()).toBe(true);
  });

  it("classe les échecs d'ouverture du micro", () => {
    expect(classerErreurMicro(Object.assign(new Error(), { name: "NotAllowedError" }))).toBe("denied");
    expect(classerErreurMicro(Object.assign(new Error(), { name: "NotFoundError" }))).toBe("notFound");
    expect(classerErreurMicro(Object.assign(new Error(), { name: "NotReadableError" }))).toBe("busy");
    expect(classerErreurMicro(Object.assign(new Error(), { name: "NotSupportedError" }))).toBe("unsupported");
    expect(classerErreurMicro(new Error("autre"))).toBe("unknown");
    expect(classerErreurMicro(null)).toBe("unknown");
  });

  it("donne l'extension d'après le type", () => {
    expect(extensionEnregistrement("audio/webm")).toBe("webm");
    expect(extensionEnregistrement("audio/mp4")).toBe("m4a");
    expect(extensionEnregistrement("audio/ogg")).toBe("ogg");
  });

  it("reconnaît un message vocal, même dont le fichier a été effacé", () => {
    expect(estVocal({ audioDurationSec: 12 })).toBe(true);
    expect(estVocal({ isVoice: true })).toBe(true);
    expect(estVocal({ audioDurationSec: null })).toBe(false);
    expect(estVocal({})).toBe(false);
  });
});
