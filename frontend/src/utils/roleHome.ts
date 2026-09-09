import type { Role } from "../types";

/**
 * Page d'accueil propre à chaque rôle après connexion (ou lien "Mon espace"
 * pour un utilisateur déjà connecté). Centralisé ici car utilisé à plusieurs
 * endroits (redirection post-connexion, page d'accueil, garde de route) qui
 * doivent tous rester cohérents entre eux.
 */
export function homePathForRole(role: Role): string {
  if (role === "MANAGER") return "/dashboard";
  if (role === "ADMIN") return "/admin";
  return "/portail";
}
