import { AxiosError, AxiosHeaders } from "axios";
import { describe, expect, it } from "vitest";
import { apiErrorCode, apiErrorMessage, fileUrl, liste } from "./client";
import { afterEach, beforeEach, vi } from "vitest";

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

describe("liste", () => {
  // console.warn est espionné : la fonction trace les formes inattendues, et
  // une trace non neutralisée ferait échouer la suite sur un bruit de sortie.
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renvoie un tableau nu tel quel", () => {
    const donnees = [{ id: "1" }, { id: "2" }];
    expect(liste(donnees)).toEqual(donnees);
  });

  it("extrait la liste d'une réponse paginée", () => {
    expect(liste({ items: [1, 2], total: 2, totalPages: 1 }, "items")).toEqual([1, 2]);
  });

  // Le cœur de la régression : ces quatre formes faisaient disparaître l'écran
  // entier, car `.map()` et `.length` s'exécutent PENDANT le rendu.
  it("renvoie une liste vide plutôt que de laisser planter le rendu", () => {
    expect(liste(undefined)).toEqual([]);
    expect(liste(null)).toEqual([]);
    expect(liste({ error: "Accès refusé" })).toEqual([]);
    expect(liste("<!DOCTYPE html>")).toEqual([]);
  });

  it("renvoie une liste vide si la clé attendue est absente ou mal formée", () => {
    expect(liste({ total: 0 }, "items")).toEqual([]);
    expect(liste({ items: null }, "items")).toEqual([]);
    expect(liste(undefined, "items")).toEqual([]);
  });

  it("ne confond pas un tableau nu avec une réponse paginée", () => {
    // Une route qui renverrait soudain un tableau nu là où l'écran attend
    // `{ items }` doit donner une liste vide, pas le tableau : c'est le
    // changement de contrat qu'il faut voir, pas masquer.
    expect(liste([1, 2], "items")).toEqual([]);
  });

  it("signale une forme inattendue, mais pas une liste simplement absente", () => {
    const trace = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Une liste absente est un état normal (compte neuf) : aucune trace.
    liste(undefined);
    liste(undefined, "items");
    expect(trace).not.toHaveBeenCalled();

    // Une forme inattendue, elle, doit laisser une trace — sans quoi l'écran
    // afficherait « aucun élément » et le défaut resterait invisible.
    liste({ error: "boom" });
    expect(trace).toHaveBeenCalledTimes(1);
  });
});
