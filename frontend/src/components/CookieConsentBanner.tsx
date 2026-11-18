import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { loadGoogleAnalytics, trackPageView } from "../utils/analytics";
import {
  audienceEstConfiguree,
  choixDepuisFinalites,
  type ChoixCookies,
  effacerCookiesTraceurs,
  enregistrerChoixCookies,
  EVENEMENT_ROUVRIR_CHOIX,
  finalitesAutorisees,
  lireChoixCookies,
  publiciteEstConfiguree,
  unTraceurEstConfigure,
} from "../utils/consentementCookies";
import { loadLinkedInInsightTag } from "../utils/linkedinInsight";
import { loadMetaPixel, trackMetaPageView } from "../utils/metaPixel";

/**
 * Bandeau de consentement RGPD/CNIL pour la mesure d'audience (GA4) et les
 * pixels de reciblage publicitaire (Meta, LinkedIn), à choisir FINALITÉ PAR FINALITÉ : « Tout refuser », « Tout accepter » ou
 * « Personnaliser » (une case par finalité, décochée). Ne s'affiche que si au
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
  // Le détail « Personnaliser » : une case par finalité, qui part du choix en cours (rien de coché tant qu'il n'y en a pas).
  const [detail, setDetail] = useState(false);
  const [cases, setCases] = useState(() => finalitesAutorisees(lireChoixCookies()));
  const autorise = finalitesAutorisees(consentement);
  // Deux finalités à distinguer seulement si les deux existent : avec une seule, « Tout accepter » et « Tout refuser » suffisent.
  const deuxFinalites = audienceEstConfiguree() && publiciteEstConfiguree();

  useEffect(() => {
    const rouvrir = () => {
      setCases(finalitesAutorisees(consentement));
      setDetail(false);
      setRouvert(true);
    };
    window.addEventListener(EVENEMENT_ROUVRIR_CHOIX, rouvrir);
    return () => window.removeEventListener(EVENEMENT_ROUVRIR_CHOIX, rouvrir);
  }, [consentement]);

  // Chaque traceur ne se charge que pour SA finalité : Google pour la mesure d'audience, Meta et LinkedIn pour la publicité.
  useEffect(() => {
    if (autorise.audience) loadGoogleAnalytics();
    if (autorise.publicite) loadMetaPixel();
  }, [autorise.audience, autorise.publicite]);

  // Les trois traceurs ne mesurent que le site public (voir estPagePublique) : à chaque page, GA4 et Meta ajustent leur
  // interrupteur, et LinkedIn, qui n'en a pas, n'est chargé que sur une page publique.
  useEffect(() => {
    if (autorise.audience) trackPageView(location.pathname);
    if (autorise.publicite) {
      trackMetaPageView(location.pathname);
      loadLinkedInInsightTag(location.pathname);
    }
  }, [autorise.audience, autorise.publicite, location.pathname]);

  if (!unTraceurEstConfigure() || (consentement !== null && !rouvert)) return null;

  function repondre(choix: ChoixCookies) {
    const apres = finalitesAutorisees(choix);
    // Retirer UNE finalité suffit : ses scripts, déjà chargés, ne se déchargent pas.
    const retrait = (autorise.audience && !apres.audience) || (autorise.publicite && !apres.publicite);
    enregistrerChoixCookies(choix);
    setConsentement(choix);
    setCases(apres);
    setRouvert(false);
    setDetail(false);
    if (retrait) {
      // Les scripts déjà chargés ne se déchargent pas : on efface leurs cookies et on repart d'une page sans eux.
      effacerCookiesTraceurs();
      window.location.reload();
    }
  }

  // « Tout refuser » et « Tout accepter » ont le même aspect : refuser n'est pas plus discret qu'accepter.
  const boutonEgal = "cursor-pointer border border-white bg-white px-4 py-2 text-xs font-semibold text-ink-900 transition-colors hover:bg-slate-100";
  const boutonSecondaire = "cursor-pointer border border-slate-500 px-4 py-2 text-xs font-semibold text-slate-200 transition-colors hover:bg-slate-800";

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 max-h-[90svh] overflow-y-auto bg-slate-900 text-slate-100 border-t border-slate-700 px-4 py-4 sm:px-6">
      <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center gap-3 sm:gap-4">
        <p className="text-xs text-slate-300 flex-1 text-center sm:text-left">
          {t("cookieConsent.message")}{" "}
          <Link to="/confidentialite" className="underline hover:text-white">
            {t("cookieConsent.privacyLink")}
          </Link>
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2 shrink-0">
          <button type="button" onClick={() => repondre("rejected")} className={boutonEgal}>
            {t("cookieConsent.reject")}
          </button>
          {deuxFinalites && (
            <button type="button" onClick={() => setDetail((ouvert) => !ouvert)} aria-expanded={detail} className={boutonSecondaire}>
              {t("cookieConsent.customize")}
            </button>
          )}
          <button type="button" onClick={() => repondre("accepted")} className={boutonEgal}>
            {t("cookieConsent.accept")}
          </button>
        </div>
      </div>

      {deuxFinalites && detail && (
        <div className="max-w-4xl mx-auto mt-4 border-t border-slate-700 pt-4">
          <fieldset className="space-y-3">
            <legend className="sr-only">{t("cookieConsent.purposes")}</legend>
            <label className="flex cursor-pointer items-start gap-3 text-xs">
              <input
                type="checkbox"
                checked={cases.audience}
                onChange={(e) => setCases((avant) => ({ ...avant, audience: e.target.checked }))}
                className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-white"
              />
              <span>
                <span className="block font-semibold text-white">{t("cookieConsent.audienceTitle")}</span>
                <span className="block text-slate-300">{t("cookieConsent.audienceHint")}</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 text-xs">
              <input
                type="checkbox"
                checked={cases.publicite}
                onChange={(e) => setCases((avant) => ({ ...avant, publicite: e.target.checked }))}
                className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-white"
              />
              <span>
                <span className="block font-semibold text-white">{t("cookieConsent.adsTitle")}</span>
                <span className="block text-slate-300">{t("cookieConsent.adsHint")}</span>
              </span>
            </label>
          </fieldset>
          <div className="mt-4 flex justify-end">
            <button type="button" onClick={() => repondre(choixDepuisFinalites(cases))} className={boutonEgal}>
              {t("cookieConsent.save")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
