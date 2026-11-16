import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { loadGoogleAnalytics, trackPageView } from "../utils/analytics";
import {
  type ChoixCookies,
  effacerCookiesTraceurs,
  enregistrerChoixCookies,
  EVENEMENT_ROUVRIR_CHOIX,
  lireChoixCookies,
  unTraceurEstConfigure,
} from "../utils/consentementCookies";
import { loadLinkedInInsightTag } from "../utils/linkedinInsight";
import { loadMetaPixel, trackMetaPageView } from "../utils/metaPixel";

/**
 * Bandeau de consentement RGPD/CNIL pour la mesure d'audience (GA4) et les
 * pixels de reciblage publicitaire (Meta, LinkedIn). Ne s'affiche que si au
 * moins un identifiant est configuré (VITE_GA_MEASUREMENT_ID,
 * VITE_META_PIXEL_ID, VITE_LINKEDIN_PARTNER_ID) — inutile de demander un
 * consentement pour des traceurs qui n'existent pas encore (dev, previews
 * sans variable). Le choix est mémorisé dans localStorage (13 mois pour un accord, 6 mois pour un refus) ; aucun des trois
 * n'est chargé avant acceptation explicite, jamais par défaut. Le lien « Gérer mes cookies » des pieds de page le rouvre :
 * revenir sur son choix est aussi simple que de le faire.
 */
export default function CookieConsentBanner() {
  const { t } = useTranslation();
  const location = useLocation();
  const [consentement, setConsentement] = useState<ChoixCookies | null>(() => lireChoixCookies());
  // Bandeau rouvert par « Gérer mes cookies » : il se montre même si un choix est déjà enregistré.
  const [rouvert, setRouvert] = useState(false);

  useEffect(() => {
    const rouvrir = () => setRouvert(true);
    window.addEventListener(EVENEMENT_ROUVRIR_CHOIX, rouvrir);
    return () => window.removeEventListener(EVENEMENT_ROUVRIR_CHOIX, rouvrir);
  }, []);

  useEffect(() => {
    if (consentement === "accepted") {
      loadGoogleAnalytics();
      loadMetaPixel();
    }
  }, [consentement]);

  // Les trois traceurs ne mesurent que le site public (voir estPagePublique) : à chaque page, GA4 et Meta ajustent leur
  // interrupteur, et LinkedIn, qui n'en a pas, n'est chargé que sur une page publique.
  useEffect(() => {
    if (consentement === "accepted") {
      trackPageView(location.pathname);
      trackMetaPageView(location.pathname);
      loadLinkedInInsightTag(location.pathname);
    }
  }, [consentement, location.pathname]);

  if (!unTraceurEstConfigure() || (consentement !== null && !rouvert)) return null;

  function repondre(choix: ChoixCookies) {
    const retrait = consentement === "accepted" && choix === "rejected";
    enregistrerChoixCookies(choix);
    setConsentement(choix);
    setRouvert(false);
    if (retrait) {
      // Les scripts déjà chargés ne se déchargent pas : on efface leurs cookies et on repart d'une page sans eux.
      effacerCookiesTraceurs();
      window.location.reload();
    }
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-slate-900 text-slate-100 border-t border-slate-700 px-4 py-4 sm:px-6">
      <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center gap-3 sm:gap-4">
        <p className="text-xs text-slate-300 flex-1 text-center sm:text-left">
          {t("cookieConsent.message")}{" "}
          <Link to="/confidentialite" className="underline hover:text-white">
            {t("cookieConsent.privacyLink")}
          </Link>
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => repondre("rejected")}
            className="cursor-pointer border border-slate-500 px-4 py-2 text-xs font-semibold text-slate-200 transition-colors hover:bg-slate-800"
          >
            {t("cookieConsent.reject")}
          </button>
          <button
            type="button"
            onClick={() => repondre("accepted")}
            className="cursor-pointer border border-white bg-white px-4 py-2 text-xs font-semibold text-ink-900 transition-colors hover:bg-slate-100"
          >
            {t("cookieConsent.accept")}
          </button>
        </div>
      </div>
    </div>
  );
}
