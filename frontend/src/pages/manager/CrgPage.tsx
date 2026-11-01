import { Check, ClipboardCopy, FileText } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, apiErrorMessage } from "../../api/client";
import DecompteCrg from "../../components/DecompteCrg";
import DocumentModal from "../../components/DocumentModal";
import EtatReversementCrg from "../../components/EtatReversementCrg";
import ReversementsSection from "../../components/ReversementsSection";
import SelecteurPeriodeCrg from "../../components/SelecteurPeriodeCrg";
import { Skeleton, StatCardSkeleton } from "../../components/Skeleton";
import { useCurrency } from "../../context/currency";
import type { CrgSynthesis } from "../../types";
import { resumeCrg } from "../../utils/resumeCrg";
import Bulle from "../../components/Bulle";

/**
 * CRG (Compte-Rendu de Gestion) mensuel d'UN propriétaire, côté gestionnaire
 * — accessible depuis un lien "CRG" sur la fiche du propriétaire
 * (OwnersPage.tsx). Contrairement à FiscalPage.tsx (toute l'agence, annuel),
 * cette page est scopée à un seul propriétaire (:ownerId) et mensuelle, avec
 * en plus la commission d'agence et le net à reverser.
 */
export default function CrgPage() {
  const { t, i18n } = useTranslation();
  const { formatMoney } = useCurrency();
  const { ownerId } = useParams<{ ownerId: string }>();
  const now = new Date();
  // Mois et année repris de l'adresse (lien « Reverser » de la page des propriétaires), sinon le mois en cours.
  const [params] = useSearchParams();
  const moisDemande = Number(params.get("month"));
  const anneeDemandee = Number(params.get("year"));
  const [month, setMonth] = useState<number>(moisDemande >= 1 && moisDemande <= 12 ? moisDemande : now.getMonth() + 1);
  const [year, setYear] = useState<number>(anneeDemandee >= 2000 && anneeDemandee <= 2100 ? anneeDemandee : now.getFullYear());
  const [crg, setCrg] = useState<CrgSynthesis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showExport, setShowExport] = useState(false);
  const [showAnnual, setShowAnnual] = useState(false);
  const [copie, setCopie] = useState(false);

  const loadData = useCallback(
    (selectedMonth: number, selectedYear: number) => {
      if (!ownerId) return;
      setLoading(true);
      api
        .get<CrgSynthesis>(`/crg/${ownerId}`, { params: { month: selectedMonth, year: selectedYear } })
        .then((res) => {
          setCrg(res.data);
          setError(null);
        })
        .catch((err) => setError(apiErrorMessage(err)))
        .finally(() => setLoading(false));
    },
    [ownerId]
  );

  useEffect(() => {
    loadData(month, year);
  }, [loadData, month, year]);

  const periode = new Date(year, month - 1, 1).toLocaleDateString(i18n.language, { month: "long", year: "numeric" });

  async function copierResume() {
    if (!crg) return;
    const texte = resumeCrg(
      crg,
      periode,
      {
        titre: t("manager.crg.title"),
        loyers: t("manager.crg.stats.totalLoyers"),
        charges: t("manager.crg.stats.totalCharges"),
        commission: t("manager.crg.stats.totalCommission"),
        net: t("manager.crg.stats.totalNet"),
      },
      formatMoney
    );
    try {
      await navigator.clipboard.writeText(texte);
      setCopie(true);
      setTimeout(() => setCopie(false), 1800);
    } catch {
      // Presse-papiers indisponible : l'export HTML reste disponible.
    }
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Link to="/proprietaires" className="inline-block border-b border-ink-900/40 pb-0.5 text-xs font-semibold text-ink-900 hover:border-orange-700 hover:text-orange-700">
          {t("manager.crg.backToOwners")}
        </Link>
        <div className="border border-red-200 bg-red-50 p-6 text-red-700">
          <h3 className="mb-1 text-base font-bold">{t("manager.crg.errorTitle")}</h3>
          <p className="text-sm">{error}</p>
          <button
            onClick={() => loadData(month, year)}
            className="mt-4 cursor-pointer bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700"
          >
            {t("common.actions.retry")}
          </button>
        </div>
      </div>
    );
  }

  if (loading || !crg) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">{t("manager.crg.title")}</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <StatCardSkeleton key={i} />
          ))}
        </div>
        <Skeleton className="h-[240px] w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link to="/proprietaires" className="inline-block border-b border-ink-900/40 pb-0.5 text-xs font-semibold text-ink-900 hover:border-orange-700 hover:text-orange-700">
        {t("manager.crg.backToOwners")}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">{t("manager.crg.title")}</h2>
          <p className="mt-1 text-sm text-slate-600">{t("manager.crg.subtitle", { ownerName: crg.ownerName })}</p>
        </div>
        <EtatReversementCrg crg={crg} />
      </div>

      {/* Le mois à consulter, et ce qu'on peut en tirer : export, relevé de l'année, texte à coller dans un message. */}
      <div className="flex flex-wrap items-end justify-between gap-4 border border-slate-300 bg-white p-4">
        <SelecteurPeriodeCrg month={month} year={year} onChange={(m, a) => { setMonth(m); setYear(a); }} idPrefixe="crg" ns="manager.crg" />
        <div className="flex flex-wrap items-center gap-2">
          <Bulle texte={t("manager.tips.crgExport")}>
            <button
              onClick={() => setShowExport(true)}
              className="flex cursor-pointer items-center gap-1.5 bg-ink-900 px-3.5 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-orange-700"
            >
              <FileText size={13} aria-hidden="true" /> {t("manager.crg.exportHtml")}
            </button>
          </Bulle>
          <button
            onClick={() => setShowAnnual(true)}
            className="flex cursor-pointer items-center gap-1.5 border border-slate-400 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-800 transition-colors hover:border-ink-900"
          >
            <FileText size={13} aria-hidden="true" /> {t("manager.crg.exportAnnual", { year })}
          </button>
          <button
            onClick={copierResume}
            className="flex cursor-pointer items-center gap-1.5 border border-slate-400 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-800 transition-colors hover:border-ink-900"
          >
            {copie ? <Check size={13} aria-hidden="true" /> : <ClipboardCopy size={13} aria-hidden="true" />}
            {copie ? t("common.crgReleve.copied") : t("common.crgReleve.copySummary")}
          </button>
        </div>
      </div>

      <DecompteCrg crg={crg} ns="manager.crg" periode={periode} />

      {ownerId && <ReversementsSection crg={crg} edition={{ ownerId, onChange: () => loadData(month, year) }} />}

      {showExport && ownerId && (
        <DocumentModal
          title={t("manager.crg.title") + " - " + crg.ownerName}
          docUrl={`/crg/${ownerId}/export?month=${month}&year=${year}`}
          onClose={() => setShowExport(false)}
        />
      )}

      {showAnnual && ownerId && (
        <DocumentModal
          title={t("manager.crg.annualTitle", { year }) + " - " + crg.ownerName}
          docUrl={`/crg/${ownerId}/annual/export?year=${year}`}
          onClose={() => setShowAnnual(false)}
        />
      )}
    </div>
  );
}
