import { AxiosError, AxiosHeaders } from "axios";
import { describe, expect, it } from "vitest";
import { apiErrorCode, apiErrorMessage, fileUrl } from "./client";

describe("fileUrl", () => {
  it("renvoie null si aucun chemin n'est fourni", () => {
    expect(fileUrl(null)).toBeNull();
    expect(fileUrl(undefined)).toBeNull();
    expect(fileUrl("")).toBeNull();
  });

  it("renvoie une URL absolue (http/https) telle quelle", () => {
    expect(fileUrl("https://xyz.supabase.co/storage/v1/object/public/img.png")).toBe(
      "https://xyz.supabase.co/storage/v1/object/public/img.png"
    );
    expect(fileUrl("http://example.com/a.png")).toBe("http://example.com/a.png");
  });

  it("préfixe un chemin relatif avec API_URL (compatibilité)", () => {
    expect(fileUrl("/uploads/a.png")).toBe("http://localhost:4000/uploads/a.png");
  });
});

function axiosErrorWithResponse(data: unknown, status = 400): AxiosError {
  return new AxiosError("Request failed", "ERR_BAD_REQUEST", undefined, undefined, {
    data,
    status,
    statusText: "Bad Request",
    headers: new AxiosHeaders(),
    config: { headers: new AxiosHeaders() },
  });
}

describe("apiErrorMessage", () => {
  it("extrait le message d'erreur renvoyé par le backend", () => {
    const err = axiosErrorWithResponse({ error: "Email ou mot de passe incorrect" });
    expect(apiErrorMessage(err)).toBe("Email ou mot de passe incorrect");
  });

  it("retombe sur le message générique axios si le backend n'a pas renvoyé de champ 'error'", () => {
    const err = axiosErrorWithResponse({});
    expect(apiErrorMessage(err)).toBe("Request failed");
  });

  it("renvoie un message générique pour une erreur qui n'est pas une erreur axios", () => {
    expect(apiErrorMessage(new Error("boom"))).toBe("Une erreur inattendue est survenue");
    expect(apiErrorMessage("chaine quelconque")).toBe("Une erreur inattendue est survenue");
  });
});

describe("apiErrorCode", () => {
  it("extrait le code d'erreur métier renvoyé par le backend", () => {
    const err = axiosErrorWithResponse({ error: "...", code: "EMAIL_NOT_VERIFIED" });
    expect(apiErrorCode(err)).toBe("EMAIL_NOT_VERIFIED");
  });

  it("renvoie undefined si absent ou si ce n'est pas une erreur axios", () => {
    expect(apiErrorCode(axiosErrorWithResponse({}))).toBeUndefined();
    expect(apiErrorCode(new Error("boom"))).toBeUndefined();
  });
});
