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

  it("retombe sur un message traduit si le backend n'a pas renvoyé de champ 'error' : jamais le texte brut d'axios", () => {
    const err = axiosErrorWithResponse({});
    expect(apiErrorMessage(err)).toBe("Une erreur inattendue est survenue. Réessayez dans un instant.");
  });

  it("renvoie un message générique pour une erreur qui n'est pas une erreur axios", () => {
    expect(apiErrorMessage(new Error("boom"))).toBe("Une erreur inattendue est survenue. Réessayez dans un instant.");
    expect(apiErrorMessage("chaine quelconque")).toBe("Une erreur inattendue est survenue. Réessayez dans un instant.");
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

describe("intercepteur de réponse 401", () => {
  type Rejeteur = (error: unknown) => Promise<never>;
  // Les gestionnaires enregistrés par api.interceptors.response.use, lus tels quels.
  const rejeteur = (): Rejeteur =>
    (api.interceptors.response as unknown as { handlers: Array<{ rejected: Rejeteur }> }).handlers[0].rejected;

  function stubLocation(pathname: string) {
    const location = { pathname, href: "" };
    vi.stubGlobal("location", location);
    return location;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("vide la session et renvoie vers /login sur un 401 ordinaire", async () => {
    const location = stubLocation("/dashboard");
    localStorage.setItem("token", "t");
    await expect(rejeteur()(axiosErrorWithResponse({ error: "Token invalide" }, 401))).rejects.toBeDefined();
    expect(localStorage.getItem("token")).toBeNull();
    expect(location.href).toBe("/login");
  });

  it("oublie aussi l'indice de session : sans cela, chaque page publique rappelait /auth/me et finissait sur /login", async () => {
    stubLocation("/dashboard");
    localStorage.setItem("hasSession", "1");
    localStorage.setItem("user", "{}");
    await expect(rejeteur()(axiosErrorWithResponse({ error: "Token invalide" }, 401))).rejects.toBeDefined();
    expect(localStorage.getItem("hasSession")).toBeNull();
    expect(localStorage.getItem("user")).toBeNull();
  });

  it("un 401 de la vérification de session (/auth/me) ne chasse pas un visiteur d'une page publique vers /login", async () => {
    // Lien « mot de passe oublié » ou de vérification d'email ouvert après l'expiration d'une ancienne session.
    for (const page of ["/mot-de-passe-oublie", "/reinitialiser-mot-de-passe", "/verifier-email", "/vitrine", "/cgu", "/landing"]) {
      const location = stubLocation(page);
      localStorage.setItem("hasSession", "1");
      const erreur = Object.assign(axiosErrorWithResponse({ error: "Token invalide" }, 401), { config: { url: "/auth/me" } });
      await expect(rejeteur()(erreur)).rejects.toBeDefined();
      expect(location.href, page).toBe("");
      expect(localStorage.getItem("hasSession"), page).toBeNull();
    }
  });

  it("renvoie vers /login?suspended=1 quand le compte est suspendu", async () => {
    const location = stubLocation("/dashboard");
    await expect(
      rejeteur()(axiosErrorWithResponse({ error: "Compte suspendu", code: "ACCOUNT_SUSPENDED" }, 401))
    ).rejects.toBeDefined();
    expect(location.href).toBe("/login?suspended=1");
  });

  it("ne redirige pas quand on est déjà sur /login", async () => {
    const location = stubLocation("/login");
    await expect(
      rejeteur()(axiosErrorWithResponse({ error: "Compte suspendu", code: "ACCOUNT_SUSPENDED" }, 401))
    ).rejects.toBeDefined();
    expect(location.href).toBe("");
  });
});

describe("intercepteur de réponse : erreur d'un téléchargement (responseType blob)", () => {
  type Rejeteur = (error: unknown) => Promise<never>;
  const rejeteur = (): Rejeteur =>
    (api.interceptors.response as unknown as { handlers: Array<{ rejected: Rejeteur }> }).handlers[0].rejected;
  const blobJson = (corps: unknown) => new Blob([JSON.stringify(corps)], { type: "application/json" });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Une requête `responseType: "blob"` (export FEC, grand livre, RGPD...) reçoit AUSSI son erreur sous forme
  // de Blob : `err.response.data.error` était alors indéfini, et le gestionnaire voyait « Une erreur inattendue »
  // au lieu de « réservé à la formule Agence » ou du refus de son rôle.
  it("restitue le message du serveur quand l'erreur d'un téléchargement arrive en Blob", async () => {
    const message = "Cette fonctionnalité est réservée à la formule Agence & Multi-Comptes ou supérieure.";
    const erreur = await rejeteur()(axiosErrorWithResponse(blobJson({ error: message }), 403)).catch((e) => e);

    expect(apiErrorMessage(erreur)).toBe(message);
  });

  it("garde la réponse telle quelle quand le Blob n'est pas du JSON", async () => {
    const html = new Blob(["<html>Bad Gateway</html>"], { type: "text/html" });
    const erreur = await rejeteur()(axiosErrorWithResponse(html, 502)).catch((e) => e);

    expect(apiErrorMessage(erreur)).toBe("Une erreur inattendue est survenue. Réessayez dans un instant.");
  });

  it("reconnaît un compte suspendu même quand la réponse 401 arrive en Blob", async () => {
    const location = { pathname: "/fiscal", href: "" };
    vi.stubGlobal("location", location);

    await rejeteur()(axiosErrorWithResponse(blobJson({ error: "Compte suspendu", code: "ACCOUNT_SUSPENDED" }), 401)).catch(() => undefined);

    expect(location.href).toBe("/login?suspended=1");
  });
});

describe("apiErrorMessage — langue", () => {
  it("donne le message de repli dans la langue choisie", async () => {
    const { changerLangue } = await import("../i18n");
    await changerLangue("en");
    try {
      expect(apiErrorMessage(axiosErrorWithResponse({}))).toBe("An unexpected error occurred. Please try again in a moment.");
      expect(apiErrorMessage("quelconque")).toBe("An unexpected error occurred. Please try again in a moment.");
    } finally {
      await changerLangue("fr");
    }
  });
});

describe("apiErrorMessage — code d'erreur du serveur", () => {
  // Le serveur écrit ses messages en français : pour les parcours critiques il envoie aussi un CODE,
  // que le frontend traduit dans la langue choisie. Le texte du serveur ne sert plus qu'en secours.
  async function dans(langue: string, corps: unknown) {
    const { changerLangue } = await import("../i18n");
    await changerLangue(langue);
    try {
      return apiErrorMessage(axiosErrorWithResponse(corps, 401));
    } finally {
      await changerLangue("fr");
    }
  }

  it("traduit un code connu dans la langue de l'interface", async () => {
    const corps = { error: "Email ou mot de passe incorrect", code: "INVALID_CREDENTIALS" };
    expect(await dans("en", corps)).toBe("Incorrect email or password");
    expect(await dans("pt", corps)).toBe("E-mail ou palavra-passe incorretos");
    expect(await dans("es", corps)).toBe("Correo electrónico o contraseña incorrectos");
    expect(await dans("fr", corps)).toBe("Email ou mot de passe incorrect");
  });

  it("insère les valeurs envoyées par le serveur (nom de la formule requise)", async () => {
    const corps = { error: "…formule Pro…", code: "PLAN_REQUIRED", params: { plan: "Pro" } };
    expect(await dans("en", corps)).toBe("This feature is reserved for the Pro plan or higher. Upgrade your plan to access it.");
  });

  it("traduit les erreurs de validation avec les champs en cause, accordés au nombre", async () => {
    const un = { error: "Requête invalide : données manquantes ou incorrectes (champ concerné : email).", code: "VALIDATION_ERROR_FIELD", params: { fields: "email" } };
    const deux = { error: "…", code: "VALIDATION_ERROR_FIELDS", params: { fields: "email, rent" } };
    expect(await dans("fr", un)).toBe("Requête invalide : données manquantes ou incorrectes (champ concerné : email).");
    expect(await dans("en", un)).toBe("Invalid request: missing or incorrect data (field concerned: email).");
    expect(await dans("pt", deux)).toBe("Pedido inválido: dados em falta ou incorretos (campos em causa: email, rent).");
    expect(await dans("es", deux)).toBe("Solicitud no válida: datos que faltan o son incorrectos (campos afectados: email, rent).");
  });

  it("traduit les refus métier courants, valeurs comprises (bornes, périodes, plafonds)", async () => {
    const revision = { error: "…", code: "REVISION_PERCENT_RANGE", params: { min: -50, max: 100 } };
    expect(await dans("en", revision)).toBe("The percentage must be between -50% and 100%.");
    const periode = { error: "…", code: "REVISION_MONTH_ALREADY_PAID", params: { period: "10/2026" } };
    expect(await dans("es", periode)).toBe("El alquiler de 10/2026 ya está cobrado: elija un mes posterior.");
    const plafond = { error: "…", code: "PROPERTY_LIMIT_REACHED", params: { max: 5 } };
    expect(await dans("pt", plafond)).toBe("Atingiu o limite de 5 imóveis do seu plano atual. Mude para um plano superior para adicionar mais.");
    expect(await dans("fr", { error: "…", code: "ACCOUNT_ALREADY_SUSPENDED" })).toBe("Ce compte est déjà suspendu");
  });

  it("retombe sur le message du serveur quand le code est inconnu ou absent", async () => {
    expect(await dans("en", { error: "Message du serveur", code: "CODE_QUI_NEXISTE_PAS" })).toBe("Message du serveur");
    expect(await dans("en", { error: "Message du serveur" })).toBe("Message du serveur");
  });
});
