import type { TranslationSchema } from "./fr";
import admin from "./zones/es/admin";
import base from "./zones/es/base";
import landing from "./zones/es/landing";
import manager from "./zones/es/manager";
import partage from "./zones/es/partage";
import tenant from "./zones/es/tenant";

/**
 * Tous les textes en es, réunis : les six zones de `zones/es/` fusionnées. Le site, lui, ne charge que `zones/es/base` au
 * démarrage et chaque autre zone avec les pages qui s'en servent (voir i18n/index.ts) ; ce fichier-ci sert aux outils et aux tests,
 * qui ont besoin de la langue entière, et vérifie à la compilation que les zones recomposent exactement le même ensemble de textes.
 */
const es: TranslationSchema = {
  ...base,
  ...landing,
  admin: { ...base.admin, ...admin.admin },
  manager: { ...manager.manager, ...partage.manager },
  owner: partage.owner,
  tenant: { ...base.tenant, ...tenant.tenant },
};

export default es;
