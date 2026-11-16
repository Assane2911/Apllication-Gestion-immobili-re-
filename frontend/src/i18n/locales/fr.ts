import admin from "./zones/fr/admin";
import base from "./zones/fr/base";
import landing from "./zones/fr/landing";
import manager from "./zones/fr/manager";
import partage from "./zones/fr/partage";
import tenant from "./zones/fr/tenant";

/**
 * Tous les textes en fr, réunis : les six zones de `zones/fr/` fusionnées. Le site, lui, ne charge que `zones/fr/base` au
 * démarrage et chaque autre zone avec les pages qui s'en servent (voir i18n/index.ts) ; ce fichier-ci sert aux outils et aux tests,
 * qui ont besoin de la langue entière, et vérifie à la compilation que les zones recomposent exactement le même ensemble de textes.
 */
const fr = {
  ...base,
  ...landing,
  admin: { ...base.admin, ...admin.admin },
  manager: { ...manager.manager, ...partage.manager },
  owner: partage.owner,
  tenant: { ...base.tenant, ...tenant.tenant },
};

export default fr;
export type TranslationSchema = typeof fr;
