import { useTranslation } from "react-i18next";
import { COMPANY } from "../legal/companyInfo";
import PiedDeSite from "./PiedDeSite";

/** Pied de page des pages de la vitrine : le pied de site commun, avec les pages légales. */
export default function PiedVitrine() {
  const { t } = useTranslation();
  return (
    <PiedDeSite
      accroche={t("vitrine.footerTagline")}
      liens={[
        { to: "/landing", libelle: t("vitrine.footerHome") },
        { to: "/mentions-legales", libelle: t("vitrine.footerLegal") },
        { to: "/cgu", libelle: t("vitrine.footerTerms") },
        { to: "/confidentialite", libelle: t("vitrine.footerPrivacy") },
      ]}
      mentions={
        <p>
          © 2026 {COMPANY.tradeName}. {COMPANY.legalStatus}.
        </p>
      }
    />
  );
}
