import type { TranslationSchema } from "./fr";
import admin from "./zones/pt/admin";
import base from "./zones/pt/base";
import landing from "./zones/pt/landing";
import manager from "./zones/pt/manager";
import partage from "./zones/pt/partage";
import tenant from "./zones/pt/tenant";

/**
 * Tous les textes en pt, réunis : les six zones de `zones/pt/` fusionnées. Le site, lui, ne charge que `zones/pt/base` au
 * démarrage et chaque autre zone avec les pages qui s'en servent (voir i18n/index.ts) ; ce fichier-ci sert aux outils et aux tests,
 * qui ont besoin de la langue entière, et vérifie à la compilation que les zones recomposent exactement le même ensemble de textes.
 */
const pt: TranslationSchema = {
  ...base,
  ...landing,
  admin: { ...base.admin, ...admin.admin },
  manager: { ...manager.manager, ...partage.manager },
  owner: partage.owner,
  tenant: { ...base.tenant, ...tenant.tenant },
};

export default pt;
