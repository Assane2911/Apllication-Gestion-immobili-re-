// Partagé par middleware/auth.ts et controllers/auth.controller.ts (qui
// s'importent déjà l'un l'autre : un module neutre évite d'aggraver ce cycle).
export const CODE_COMPTE_SUSPENDU = "ACCOUNT_SUSPENDED";
export const MESSAGE_COMPTE_SUSPENDU =
  "Votre compte est suspendu. Contactez le support de la plateforme pour en savoir plus.";
