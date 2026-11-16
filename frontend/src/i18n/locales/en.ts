import type { TranslationSchema } from "./fr";
import admin from "./zones/en/admin";
import base from "./zones/en/base";
import landing from "./zones/en/landing";
import manager from "./zones/en/manager";
import partage from "./zones/en/partage";
import tenant from "./zones/en/tenant";

/**
 * Tous les textes en en, réunis : les six zones de `zones/en/` fusionnées. Le site, lui, ne charge que `zones/en/base` au
 * démarrage et chaque autre zone avec les pages qui s'en servent (voir i18n/index.ts) ; ce fichier-ci sert aux outils et aux tests,
 * qui ont besoin de la langue entière, et vérifie à la compilation que les zones recomposent exactement le même ensemble de textes.
 */
const en: TranslationSchema = {
  ...base,
  ...landing,
  admin: { ...base.admin, ...admin.admin },
  manager: { ...manager.manager, ...partage.manager },
  owner: partage.owner,
  tenant: { ...base.tenant, ...tenant.tenant },
};

export default en;
