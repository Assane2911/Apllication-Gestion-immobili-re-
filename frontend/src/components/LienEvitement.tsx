import { useTranslation } from "react-i18next";

/** Identifiant du contenu principal : chaque page le pose sur son `<main>` (garde dans accessibilite.test.ts). */
export const ID_CONTENU_PRINCIPAL = "contenu-principal";

/**
 * « Aller au contenu principal » : le premier élément que le clavier atteint, invisible tant qu'il n'a pas le focus.
 *
 * Sans lui, une personne qui navigue au clavier ou avec un lecteur d'écran traverse tout le menu (une quinzaine de liens dans
 * l'espace gestionnaire) à CHAQUE page avant d'arriver au contenu (WCAG 2.4.1, contourner les blocs).
 *
 * Le clic est pris en charge ici plutôt que laissé à l'ancre `#…` : un lien à ancre ajouterait une entrée à l'historique du
 * navigateur (et fausserait le bouton « Retour » de l'application, voir HistoriqueContext) ; on déplace simplement le focus.
 */
export default function LienEvitement() {
  const { t } = useTranslation();

  function aller(e: React.MouseEvent<HTMLAnchorElement>) {
    const cible = document.getElementById(ID_CONTENU_PRINCIPAL);
    if (!cible) return;
    e.preventDefault();
    cible.focus({ preventScroll: true });
    cible.scrollIntoView?.();
  }

  return (
    <a
      href={`#${ID_CONTENU_PRINCIPAL}`}
      onClick={aller}
      className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:bg-ink-900 focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-white focus:outline-2 focus:outline-offset-2 focus:outline-orange-500"
    >
      {t("common.skipToContent")}
    </a>
  );
}
