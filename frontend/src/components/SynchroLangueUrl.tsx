import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { changerLangue } from "../i18n";
import { langueDuChemin } from "../utils/langueUrl";

/**
 * Une adresse en « /en », « /es » ou « /pt » s'affiche dans sa langue, y compris quand le visiteur arrive depuis un lien (autre
 * langue mémorisée) ou navigue d'une page à l'autre. Au premier chargement la langue est déjà posée par i18n/index.ts ; ceci
 * couvre les changements en cours de navigation et mémorise le choix.
 */
export default function SynchroLangueUrl() {
  const { pathname } = useLocation();
  const langue = langueDuChemin(pathname);
  useEffect(() => {
    if (langue) void changerLangue(langue);
  }, [langue]);
  return null;
}
