import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../api/client";
import SectionReglage from "./SectionReglage";

interface UsageMois {
  /** « AAAA-MM » */
  mois: string;
  parType: { avis_echeance: number; echeance_proche: number; relance_impaye: number };
  envoyes: number;
  echecs: number;
  coutEstimeUsd: number;
}

interface UsageWhatsapp {
  inclus: boolean;
  configure: boolean;
  tarifUsd: number;
  mois: UsageMois[];
}

/** Réponse bien formée ? (Une réponse inattendue ne doit jamais casser la fiche de l'agence.) */
function estUsage(valeur: unknown): valeur is UsageWhatsapp {
  const v = valeur as Partial<UsageWhatsapp> | null | undefined;
  return Boolean(v) && Array.isArray(v?.mois) && typeof v?.tarifUsd === "number";
}

/**
 * Consommation WhatsApp d'une agence dans la fiche de l'administration : messages que l'application a envoyés pour elle,
 * par mois et par type, et ce que cela coûte (estimation, voir backend/src/services/whatsappUsage.service.ts). Meta facture
 * chaque message modèle délivré à la plateforme : ce tableau dit quelle agence produit la facture.
 */
export default function SectionWhatsapp({ managerId, numero }: { managerId: string; numero: string }) {
  const { t, i18n } = useTranslation();
  const [usage, setUsage] = useState<UsageWhatsapp | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let vivant = true;
    api
      .get(`/admin/managers/${managerId}/whatsapp-usage`)
      .then((res) => {
        if (!vivant) return;
        if (estUsage(res.data)) setUsage(res.data);
        else setErreur(t("admin.managerDetail.whatsapp.unavailable"));
      })
      .catch((err) => {
        if (vivant) setErreur(apiErrorMessage(err));
      });
    return () => {
      vivant = false;
    };
    // Rechargée avec la fiche, pas à chaque changement de langue.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [managerId]);

  const dollars = (valeur: number) => new Intl.NumberFormat(i18n.language, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 3 }).format(valeur);
  const libelleMois = (mois: string) => new Date(`${mois}-01T00:00:00Z`).toLocaleDateString(i18n.language, { month: "short", year: "numeric", timeZone: "UTC" });
  const courant = usage?.mois[0];
  const total = usage ? usage.mois.reduce((somme, m) => somme + m.envoyes, 0) : 0;

  return (
    <SectionReglage id="whatsapp" numero={numero} titre={t("admin.managerDetail.whatsapp.title")}>
      {erreur && (
        <p role="alert" className="text-xs text-rose-800">
          {erreur}
        </p>
      )}
      {!usage && !erreur && <p className="text-xs text-slate-600">{t("admin.managerDetail.whatsapp.loading")}</p>}
      {usage && courant && (
        <>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span
              className={`inline-block border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${
                usage.inclus ? "border-ink-900 bg-white text-ink-900" : "border-slate-300 bg-slate-50 text-slate-700"
              }`}
            >
              {usage.inclus ? t("admin.managerDetail.whatsapp.included") : t("admin.managerDetail.whatsapp.notIncluded")}
            </span>
            <span className="font-mono font-semibold tabular-nums text-ink-900">
              {t("admin.managerDetail.whatsapp.thisMonth", { count: courant.envoyes, cost: dollars(courant.coutEstimeUsd) })}
            </span>
          </p>
          {!usage.configure && <p className="mt-2 text-xs text-orange-800">{t("admin.managerDetail.whatsapp.notConfigured")}</p>}

          <div className="relative mt-4 overflow-x-auto border border-slate-300">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left">
                  <th scope="col" className="px-2.5 py-2.5 font-semibold">{t("admin.managerDetail.whatsapp.columns.month")}</th>
                  <th scope="col" className="hidden px-2.5 py-2.5 text-right font-semibold sm:table-cell">{t("admin.managerDetail.whatsapp.columns.avis_echeance")}</th>
                  <th scope="col" className="hidden px-2.5 py-2.5 text-right font-semibold sm:table-cell">{t("admin.managerDetail.whatsapp.columns.echeance_proche")}</th>
                  <th scope="col" className="hidden px-2.5 py-2.5 text-right font-semibold sm:table-cell">{t("admin.managerDetail.whatsapp.columns.relance_impaye")}</th>
                  <th scope="col" className="px-2.5 py-2.5 text-right font-semibold">{t("admin.managerDetail.whatsapp.columns.total")}</th>
                  <th scope="col" className="px-2.5 py-2.5 text-right font-semibold">{t("admin.managerDetail.whatsapp.columns.failures")}</th>
                  <th scope="col" className="px-2.5 py-2.5 text-right font-semibold">{t("admin.managerDetail.whatsapp.columns.cost")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-800">
                {usage.mois.map((m) => (
                  <tr key={m.mois}>
                    <th scope="row" className="whitespace-nowrap px-2.5 py-2.5 text-left font-medium capitalize">{libelleMois(m.mois)}</th>
                    <td className="hidden px-2.5 py-2.5 text-right font-mono tabular-nums sm:table-cell">{m.parType.avis_echeance}</td>
                    <td className="hidden px-2.5 py-2.5 text-right font-mono tabular-nums sm:table-cell">{m.parType.echeance_proche}</td>
                    <td className="hidden px-2.5 py-2.5 text-right font-mono tabular-nums sm:table-cell">{m.parType.relance_impaye}</td>
                    <td className="px-2.5 py-2.5 text-right font-mono font-semibold tabular-nums">{m.envoyes}</td>
                    <td className={`px-2.5 py-2.5 text-right font-mono tabular-nums ${m.echecs > 0 ? "font-semibold text-rose-700" : ""}`}>{m.echecs}</td>
                    <td className="whitespace-nowrap px-2.5 py-2.5 text-right font-mono tabular-nums">{dollars(m.coutEstimeUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {total === 0 && <p className="mt-3 text-xs text-slate-600">{t("admin.managerDetail.whatsapp.empty")}</p>}
          <p className="mt-3 text-xs text-slate-600">{t("admin.managerDetail.whatsapp.note", { rate: dollars(usage.tarifUsd) })}</p>
        </>
      )}
    </SectionReglage>
  );
}
