import { useTranslation } from "react-i18next";
import { rouvrirChoixCookies, unTraceurEstConfigure } from "../utils/consentementCookies";

/**
 * « Gérer mes cookies » : rouvre le bandeau de consentement, pour accepter après un refus ou retirer un accord. Absent tant
 * qu'aucun traceur n'est configuré (dev, aperçus) : il n'y a alors rien à gérer.
 */
export default function LienGererCookies() {
  const { t } = useTranslation();
  if (!unTraceurEstConfigure()) return null;
  return (
    <button type="button" onClick={rouvrirChoixCookies} className="mt-2 cursor-pointer text-xs font-semibold text-ink-900 underline underline-offset-2 hover:text-orange-700">
      {t("cookieConsent.manage")}
    </button>
  );
}
