import { Capacitor } from "@capacitor/core";
import { AxiosError, AxiosHeaders } from "axios";
import { describe, expect, it } from "vitest";
import { api, apiErrorCode, apiErrorMessage, fileUrl, liste } from "./client";
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

  /**
   * Régression : sans réponse serveur (le serveur n'a jamais été atteint),
   * `err.message` retombait sur le texte brut d'axios ("Network Error",
   * "timeout of 20000ms exceeded") — en ANGLAIS, quelle que soit la langue
   * choisie par l'utilisateur, faute de champ `error` serveur à traduire.
   */
  it("traduit une erreur réseau (serveur injoignable) plutôt que d'afficher le texte brut d'axios", () => {
    const err = new AxiosError("Network Error", "ERR_NETWORK");
    expect(apiErrorMessage(err)).toBe(
      "Impossible de contacter le serveur. Vérifiez votre connexion internet et réessayez."
    );
  });

  it("traduit un timeout plutôt que d'afficher le texte brut d'axios", () => {
    const err = new AxiosError("timeout of 20000ms exceeded", "ECONNABORTED");
    expect(apiErrorMessage(err)).toBe(
      "Le serveur met trop de temps à répondre. Vérifiez votre connexion et réessayez."
    );
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

/**
 * Depuis la migration vers un cookie httpOnly (voir backend/src/utils/authCookie.ts
 * et AuthContext.tsx), le web ne doit plus jamais poser d'en-tête Authorization
 * lu depuis localStorage : le cookie accompagne déjà la requête via
 * withCredentials. Seule l'app mobile Capacitor, qui n'a pas de cookie
 * cross-site fiable, continue de porter le jeton dans l'en-tête.
 */
describe("intercepteur de requête (authentification)", () => {
  async function headersEnvoyees() {
    let captures: unknown;
    await api.get("/quelque-chose", {
      adapter: async (config) => {
        captures = config.headers;
        return { data: {}, status: 200, statusText: "OK", headers: {}, config };
      },
    });
    return captures as Record<string, string>;
  }

  afterEach(() => {
    localStorage.removeItem("token");
    vi.restoreAllMocks();
  });

  it("envoie toujours withCredentials (le cookie httpOnly doit accompagner la requête)", () => {
    expect(api.defaults.withCredentials).toBe(true);
  });

  it("web : n'attache pas d'en-tête Authorization, même si un token traîne encore en localStorage", async () => {
    localStorage.setItem("token", "un-jeton-quelconque");
    const headers = await headersEnvoyees();
    expect(headers.Authorization).toBeUndefined();
  });

  it("natif (Capacitor) : attache l'en-tête Authorization depuis le token en localStorage", async () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    localStorage.setItem("token", "jeton-natif");
    const headers = await headersEnvoyees();
    expect(headers.Authorization).toBe("Bearer jeton-natif");
  });
});
