import axios from "axios";

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export const api = axios.create({ baseURL: `${API_URL}/api` });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
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
    return err.response?.data?.error ?? err.message;
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
