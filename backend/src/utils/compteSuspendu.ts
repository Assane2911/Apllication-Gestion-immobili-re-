// Partagé par middleware/auth.ts et controllers/auth.controller.ts (qui
// s'importent déjà l'un l'autre : un module neutre évite d'aggraver ce cycle).
export const CODE_COMPTE_SUSPENDU = "ACCOUNT_SUSPENDED";
export const MESSAGE_COMPTE_SUSPENDU =
  "Votre compte est suspendu. Contactez le support de la plateforme pour en savoir plus.";

// Accès d'un collaborateur suspendu parce que l'agence n'est plus sur la formule Entreprise (voir middleware/auth.ts). Rien n'est effacé :
// le compte du collaborateur est conservé, et l'accès revient dès que l'agence repasse en formule Entreprise.
// Code d'erreur : COLLABORATOR_PLAN_REQUIRED (écrit en clair aux points d'appel, pour que le contrôle de traduction le retrouve).
export const MESSAGE_COLLABORATEUR_FORMULE =
  "L'agence n'est plus sur la formule Agence & Multi-Comptes : l'accès des collaborateurs est suspendu. Il reviendra dès que l'agence repasse sur cette formule.";
