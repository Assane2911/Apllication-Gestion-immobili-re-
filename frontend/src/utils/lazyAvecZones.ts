import type { ComponentType, LazyExoticComponent } from "react";
import { chargerZones, type Zone } from "../i18n";
import { lazyWithReload } from "./lazyWithReload";

/**
 * Comme lazyWithReload, et charge EN PARALLÈLE les zones de textes dont la page a besoin (voir i18n/index.ts) : le navigateur
 * télécharge le fichier de la page et ses textes en même temps, et la page ne s'affiche qu'une fois les deux là.
 *
 * Les zones à déclarer sont celles dont la page (et les composants qu'elle utilise) lit des clés ; zones.test.ts le vérifie.
 */
export function lazyAvecZones<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
  zones: readonly Zone[]
): LazyExoticComponent<T> {
  return lazyWithReload(async () => {
    const [module] = await Promise.all([factory(), chargerZones(zones)]);
    return module;
  });
}
