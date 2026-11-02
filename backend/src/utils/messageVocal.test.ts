import { describe, expect, it } from "vitest";
import { detecterSignatureAudio, formaterDuree, libelleMessageVocal, normaliserTypeAudio } from "./messageVocal";

describe("messageVocal", () => {
  it("formate la durée en minutes et secondes", () => {
    expect(formaterDuree(0)).toBe("0:00");
    expect(formaterDuree(5)).toBe("0:05");
    expect(formaterDuree(65.4)).toBe("1:05");
    expect(formaterDuree(180)).toBe("3:00");
    expect(formaterDuree(-3)).toBe("0:00");
  });

  it("écrit le libellé d'un vocal dans la langue du destinataire", () => {
    expect(libelleMessageVocal("fr", 42)).toBe("Message vocal (0:42)");
    expect(libelleMessageVocal("en", 42)).toBe("Voice message (0:42)");
    expect(libelleMessageVocal("es", 42)).toBe("Mensaje de voz (0:42)");
    expect(libelleMessageVocal("pt", 42)).toBe("Mensagem de voz (0:42)");
  });

  it("ramène le type déclaré à sa forme de base", () => {
    expect(normaliserTypeAudio("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(normaliserTypeAudio("Audio/WebM")).toBe("audio/webm");
    expect(normaliserTypeAudio("audio/x-m4a")).toBe("audio/mp4");
    expect(normaliserTypeAudio("video/webm")).toBe("audio/webm");
    expect(normaliserTypeAudio("image/png")).toBe("image/png");
  });

  it("reconnaît WebM, Ogg et MP4 d'après les premiers octets, et rien d'autre", () => {
    expect(detecterSignatureAudio(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0]))).toBe("audio/webm");
    expect(detecterSignatureAudio(Buffer.from("OggS\u0000\u0002", "latin1"))).toBe("audio/ogg");
    expect(detecterSignatureAudio(Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from("ftypM4A ", "ascii"), Buffer.alloc(8)]))).toBe("audio/mp4");
    expect(detecterSignatureAudio(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeNull();
    expect(detecterSignatureAudio(Buffer.from("<html>"))).toBeNull();
    expect(detecterSignatureAudio(Buffer.alloc(2))).toBeNull();
  });
});
