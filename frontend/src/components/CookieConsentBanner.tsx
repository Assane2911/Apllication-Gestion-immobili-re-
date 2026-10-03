import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { isAnalyticsConfigured, loadGoogleAnalytics, trackPageView } from "../utils/analytics";

const STORAGE_KEY = "cookie_consent";
type Consentement = "accepted" | "rejected";

/**
 * Bandeau de consentement RGPD/CNIL pour Google Analytics (GA4). Ne s'affiche
 * que si un ID de mesure est configuré (VITE_GA_MEASUREMENT_ID) — inutile
 * de demander un consentement pour un traceur qui n'existe pas encore (dev,
 * previews sans la variable). Le choix est mémorisé dans localStorage ; GA4
 * n'est chargé qu'après acceptation explicite, jamais par défaut.
 */
export default function CookieConsentBanner() {
  const { t } = useTranslation();
  const location = useLocation();
  const [consentement, setConsentement] = useState<Consentement | null>(() => {
    return (localStorage.getItem(STORAGE_KEY) as Consentement | null) ?? null;
  });

  useEffect(() => {
    if (consentement === "accepted") loadGoogleAnalytics();
  }, [consentement]);

  useEffect(() => {
    if (consentement === "accepted") trackPageView(location.pathname);
  }, [consentement, location.pathname]);

  if (!isAnalyticsConfigured() || consentement !== null) return null;

  function repondre(choix: Consentement) {
    localStorage.setItem(STORAGE_KEY, choix);
    setConsentement(choix);
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
            className="text-xs font-semibold px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800"
          >
            {t("cookieConsent.reject")}
          </button>
          <button
            type="button"
            onClick={() => repondre("accepted")}
            className="text-xs font-semibold px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white"
          >
            {t("cookieConsent.accept")}
          </button>
        </div>
      </div>
    </div>
  );
}
