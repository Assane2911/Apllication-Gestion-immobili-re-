import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api, apiErrorMessage } from "../api/client";

interface UsageMois {
  /** « AAAA-MM » */
  mois: string;
  envoyes: number;
  echecs: number;
  coutEstimeUsd: number;
}

interface UsageAgence extends UsageMois {
  managerId: string;
  nom: string;
}

interface UsagePlateforme {
  configure: boolean;
  tarifUsd: number;
  mois: UsageMois[];
  moisChoisi: string;
  agences: UsageAgence[];
}

/** Réponse bien formée ? (Une réponse inattendue ne doit jamais casser le tableau de bord.) */
function estUsage(valeur: unknown): valeur is UsagePlateforme {
  const v = valeur as Partial<UsagePlateforme> | null | undefined;
  return Boolean(v) && Array.isArray(v?.mois) && Array.isArray(v?.agences) && typeof v?.moisChoisi === "string" && typeof v?.tarifUsd === "number";
}

/**
 * Vue d'ensemble WhatsApp de la plateforme pour l'administrateur : le total mois par mois, de quoi rapprocher la facture de
 * Meta, et pour un mois la part de chaque agence (avec un lien vers sa fiche). Estimation : voir
 * backend/src/services/whatsappUsage.service.ts.
 */
export default function WhatsappPlateforme() {
  const { t, i18n } = useTranslation();
  const [usage, setUsage] = useState<UsagePlateforme | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  // Mois détaillé par agence ; absent = le mois courant (le serveur le choisit).
  const [mois, setMois] = useState<string | undefined>(undefined);

  useEffect(() => {
    let vivant = true;
    api
      .get("/admin/whatsapp-usage", mois ? { params: { mois } } : undefined)
      .then((res) => {
        if (!vivant) return;
        if (estUsage(res.data)) {
          setUsage(res.data);
          setErreur(null);
        } else setErreur(t("admin.dashboard.whatsapp.unavailable"));
      })
      .catch((err) => {
        if (vivant) setErreur(apiErrorMessage(err));
      });
    return () => {
      vivant = false;
    };
    // Rechargée au changement de mois, pas à celui de la langue.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [mois]);

  const dollars = (valeur: number) => new Intl.NumberFormat(i18n.language, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 3 }).format(valeur);
  const libelleMois = (m: string, long = false) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString(i18n.language, { month: long ? "long" : "short", year: "numeric", timeZone: "UTC" });
  const cellule = "px-2.5 py-2.5 text-right font-mono tabular-nums";

  if (erreur) {
    return (
      <p role="alert" className="text-xs text-rose-800">
        {erreur}
      </p>
    );
  }
  if (!usage) return <p className="text-xs text-slate-600">{t("admin.dashboard.whatsapp.loading")}</p>;

  const courant = usage.mois[0];
  const totalPeriode = usage.mois.reduce((somme, m) => somme + m.envoyes, 0);

  return (
    <div>
      <p className="font-mono text-xs font-semibold tabular-nums text-ink-900">
        {t("admin.dashboard.whatsapp.thisMonth", { count: courant.envoyes, cost: dollars(courant.coutEstimeUsd) })}
      </p>
      {!usage.configure && <p className="mt-2 text-xs text-orange-800">{t("admin.dashboard.whatsapp.notConfigured")}</p>}

      <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h4 className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-700">{t("admin.dashboard.whatsapp.byMonth")}</h4>
          <div className="relative overflow-x-auto border border-slate-300">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left">
                  <th scope="col" className="px-2.5 py-2.5 font-semibold">{t("admin.dashboard.whatsapp.columns.month")}</th>
                  <th scope="col" className="px-2.5 py-2.5 text-right font-semibold">{t("admin.dashboard.whatsapp.columns.messages")}</th>
                  <th scope="col" className="px-2.5 py-2.5 text-right font-semibold">{t("admin.dashboard.whatsapp.columns.failures")}</th>
                  <th scope="col" className="px-2.5 py-2.5 text-right font-semibold">{t("admin.dashboard.whatsapp.columns.cost")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-800">
                {usage.mois.map((m) => (
                  <tr key={m.mois} className={m.mois === usage.moisChoisi ? "bg-slate-50" : undefined}>
                    <th scope="row" className="whitespace-nowrap px-2.5 py-2.5 text-left font-medium capitalize">{libelleMois(m.mois)}</th>
                    <td className={`${cellule} font-semibold`}>{m.envoyes}</td>
                    <td className={`${cellule} ${m.echecs > 0 ? "font-semibold text-rose-700" : ""}`}>{m.echecs}</td>
                    <td className={`${cellule} whitespace-nowrap`}>{dollars(m.coutEstimeUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-700">{t("admin.dashboard.whatsapp.byAgency")}</h4>
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <span>{t("admin.dashboard.whatsapp.month")}</span>
              <select
                value={usage.moisChoisi}
                onChange={(e) => setMois(e.target.value)}
                className="border border-slate-300 bg-white px-2 py-1.5 text-xs capitalize text-slate-900"
              >
                {usage.mois.map((m) => (
                  <option key={m.mois} value={m.mois}>
                    {libelleMois(m.mois, true)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {usage.agences.length === 0 ? (
            <p className="border border-slate-300 px-3 py-6 text-center text-xs text-slate-600">
              {t("admin.dashboard.whatsapp.noAgency", { month: libelleMois(usage.moisChoisi, true) })}
            </p>
          ) : (
            <div className="relative overflow-x-auto border border-slate-300">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left">
                    <th scope="col" className="px-2.5 py-2.5 font-semibold">{t("admin.dashboard.whatsapp.columns.agency")}</th>
                    <th scope="col" className="px-2.5 py-2.5 text-right font-semibold">{t("admin.dashboard.whatsapp.columns.messages")}</th>
                    <th scope="col" className="hidden px-2.5 py-2.5 text-right font-semibold sm:table-cell">{t("admin.dashboard.whatsapp.columns.failures")}</th>
                    <th scope="col" className="px-2.5 py-2.5 text-right font-semibold">{t("admin.dashboard.whatsapp.columns.cost")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-slate-800">
                  {usage.agences.map((a) => (
                    <tr key={a.managerId}>
                      <th scope="row" className="px-2.5 py-2.5 text-left font-medium">
                        <Link to={`/admin/gestionnaires/${a.managerId}`} className="wrap-break-word border-b border-ink-900/40 text-ink-900 hover:border-orange-700 hover:text-orange-700">
                          {a.nom}
                        </Link>
                      </th>
                      <td className={`${cellule} font-semibold`}>{a.envoyes}</td>
                      <td className={`${cellule} hidden sm:table-cell ${a.echecs > 0 ? "font-semibold text-rose-700" : ""}`}>{a.echecs}</td>
                      <td className={`${cellule} whitespace-nowrap`}>{dollars(a.coutEstimeUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {totalPeriode === 0 && <p className="mt-3 text-xs text-slate-600">{t("admin.dashboard.whatsapp.empty")}</p>}
      <p className="mt-3 text-xs text-slate-600">{t("admin.dashboard.whatsapp.note", { rate: dollars(usage.tarifUsd) })}</p>
    </div>
  );
}
