import { Capacitor } from "@capacitor/core";
import axios from "axios";
import i18n from "../i18n";

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

// Sans timeout, une requête vers un backend injoignable restait en attente
// indéfiniment (l'utilisateur ne voyait qu'un spinner figé, sans message,
// parfois plusieurs minutes avant que le navigateur ne coupe lui-même la
// connexion). 20s est largement suffisant pour un appel JSON classique ; les
// envois de fichiers (voir DELAI_UPLOAD_MS plus bas) ont besoin de plus de
// marge et le précisent explicitement à l'appel.
// withCredentials : sur le web, l'authentification voyage désormais dans un
// cookie httpOnly posé par le serveur (voir backend/src/utils/authCookie.ts)
// plutôt que dans un en-tête Authorization lu depuis localStorage — sans ce
// réglage, un navigateur n'attache par défaut aucun cookie à une requête
// cross-origin (frontend et backend sont sur des origines distinctes, y
// compris en production). L'app mobile Capacitor continue de porter son
// jeton dans l'en-tête (voir l'intercepteur ci-dessous) ; ce réglage est
// alors sans effet, faute de cookie posé pour elle.
//
// X-Requested-With : exigé par le backend (middleware/auth.ts, voir
// CSRF_HEADER_NAME) sur toute requête authentifiée par ce cookie — un
// formulaire HTML forgé sur un autre site ne peut jamais poser cet en-tête,
// seul notre propre code JS le peut. Posé ici une fois pour tous les appels,
// plutôt que par appel : aucun n'a de raison de s'en passer.
export const api = axios.create({
  baseURL: `${API_URL}/api`,
  timeout: 20_000,
  withCredentials: true,
  headers: { "X-Requested-With": "XMLHttpRequest" },
});

/**
 * Timeout étendu pour les requêtes qui envoient un fichier (photo, pièce
 * d'identité, contrat scanné) : le corps est plus volumineux (jusqu'à 8 Mo,
 * voir MAX_UPLOAD_SIZE_MB côté backend) et peut prendre plus de temps sur une
 * connexion mobile lente qu'un simple appel JSON.
 */
export const DELAI_UPLOAD_MS = 60_000;

/** Doit rester synchronisé avec MAX_UPLOAD_SIZE_MB (backend/src/middleware/upload.ts). */
export const MAX_UPLOAD_SIZE_MB = 8;

api.interceptors.request.use((config) => {
  // Web : le cookie httpOnly posé à la connexion suit déjà la requête grâce à
  // withCredentials ci-dessus — un en-tête Authorization n'y ajouterait rien
  // et un jeton n'est de toute façon plus stocké dans localStorage sur cette
  // plateforme (voir AuthContext.tsx). L'app native garde l'ancien schéma :
  // un cookie cross-site n'y est pas fiable (voir authCookie.ts côté serveur).
  if (Capacitor.isNativePlatform()) {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      if (!window.location.pathname.startsWith("/login")) {
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);

/**
 * Les images de biens et photos d'incidents sont stockées sur Supabase
 * Storage (bucket public) : le backend renvoie déjà une URL absolue
 * (https://...), on la retourne telle quelle. Le fallback avec API_URL ne
 * sert qu'en compatibilité si un chemin relatif était renvoyé.
 */
export function fileUrl(path?: string | null) {
  if (!path) return null;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${API_URL}${path}`;
}

export function apiErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    if (err.response?.data?.error) return err.response.data.error;
    // Sans ce contrôle, `err.message` retombait sur le texte brut d'axios
    // ("Network Error", "timeout of 20000ms exceeded") — en anglais, quelle
    // que soit la langue choisie par l'utilisateur, faute d'un message serveur
    // à traduire (le serveur n'a jamais été atteint).
    if (err.code === "ECONNABORTED" || /timeout/i.test(err.message)) {
      return i18n.t("common.errors.timeout");
    }
    if (err.code === "ERR_NETWORK") {
      return i18n.t("common.errors.network");
    }
    return err.message;
  }
  return "Une erreur inattendue est survenue";
}

export function apiErrorCode(err: unknown): string | undefined {
  if (axios.isAxiosError(err)) {
    return err.response?.data?.code;
  }
  return undefined;
}

/**
 * Une page de liste qui change de page ou de filtre rapidement (clics
 * successifs, flèches du clavier sur un <select>) déclenchait autant de
 * requêtes qui couraient en parallèle sans qu'aucune n'annule les
 * précédentes : si la première réponse arrivait APRÈS la dernière (réseau
 * plus lent, serveur plus chargé à cet instant), elle écrasait l'affichage
 * avec des données déjà périmées. Chaque page annule désormais sa requête en
 * cours avant d'en relancer une nouvelle (AbortController) ; ce garde
 * distingue cette annulation volontaire d'une vraie erreur réseau, pour ne
 * jamais afficher de message d'erreur sur une requête qu'on a soi-même coupée.
 */
export function isRequestCancelled(err: unknown): boolean {
  return axios.isCancel(err);
}
/**
 * Extrait une liste d'une réponse d'API, en garantissant un tableau.
 *
 * Un écran de cette application affiche presque toujours une liste, et le
 * rendu enchaîne aussitôt sur `.map()` ou `.length`. Si la réponse n'a pas la
 * forme attendue, ces appels lèvent — et comme ils ont lieu PENDANT le rendu,
 * ce n'est pas un message d'erreur qui s'affiche mais l'écran entier qui
 * disparaît, remplacé par la page blanche de l'ErrorBoundary. Une donnée
 * manquante ne doit pas coûter la page.
 *
 * Ce n'est pas une précaution théorique. Le projet expose DEUX formes de
 * réponse pour des listes : certaines routes renvoient un tableau nu
 * (`[...]`), d'autres un objet paginé (`{ items, total, totalPages }`). Les
 * écrans locataire lisent `res.data`, les écrans gestionnaire lisent
 * `res.data.items`. Uniformiser la pagination côté serveur — un changement
 * parfaitement raisonnable — viderait donc la moitié de l'application, sans
 * autre symptôme qu'un écran blanc. C'est exactement ce qui était arrivé à
 * l'écran d'abonnement et à celui des factures du locataire.
 *
 * `cle` désigne le champ à lire dans un objet paginé. Sans elle, on attend un
 * tableau nu. Dans les deux cas, toute autre forme — `undefined`, `null`, un
 * objet d'erreur — donne une liste vide plutôt qu'une exception.
 */
export function liste<T>(donnees: unknown, cle?: string): T[] {
  const source =
    cle && typeof donnees === "object" && donnees !== null
      ? (donnees as Record<string, unknown>)[cle]
      : donnees;

  if (Array.isArray(source)) return source as T[];

  // Une liste vide n'est pas un état anormal (un compte neuf n'a aucun bien) :
  // seule une réponse de forme INATTENDUE mérite une trace. Sans elle, le
  // défaut deviendrait invisible — l'écran afficherait sereinement « aucun
  // élément » alors que le serveur a répondu autre chose.
  if (source !== undefined) {
    console.warn("Réponse inattendue : un tableau était attendu, reçu", source);
  }

  return [];
}
