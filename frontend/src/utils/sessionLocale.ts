/**
 * Indice « une session web a été ouverte » (l'authentification, elle, voyage dans un cookie httpOnly illisible
 * d'ici). Sa présence autorise l'appel de `/auth/me` au chargement ; son absence l'évite pour un simple visiteur.
 * Il doit disparaître dès que la session s'arrête, par déconnexion OU par expiration : voir api/client.ts et
 * context/AuthContext.tsx.
 */
export const SESSION_HINT_KEY = "hasSession";
