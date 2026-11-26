import { Check, ClipboardCopy, FileText } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage, isRequestCancelled } from "../../api/client";
import Bulle from "../../components/Bulle";
import DecompteCrg from "../../components/DecompteCrg";
import DocumentModal from "../../components/DocumentModal";
import EtatReversementCrg from "../../components/EtatReversementCrg";
import ReversementsSection from "../../components/ReversementsSection";
import SelecteurPeriodeCrg from "../../components/SelecteurPeriodeCrg";
import { Skeleton, StatCardSkeleton } from "../../components/Skeleton";
import { useCurrency } from "../../context/currency";
import type { CrgSynthesis } from "../../types";
import { resumeCrg } from "../../utils/resumeCrg";

/**
 * CRG (Compte-Rendu de Gestion) mensuel du propriétaire connecté (Espace
 * propriétaire) — même contenu que CrgPage.tsx côté gestionnaire (décompte,
 * détail par bien, export HTML), scopé automatiquement à "/crg/mine" plutôt
 * qu'à un :ownerId choisi, plus les coordonnées bancaires du propriétaire
 * (à qui le net sera reversé), absentes côté gestionnaire pour ne pas
 * ré-afficher une donnée qu'il a lui-même saisie sur la fiche propriétaire.
 */
export default function OwnerCrgPage() {
  const { t, i18n } = useTranslation();
  const { formatMoney } = useCurrency();
  const now = new Date();
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const [year, setYear] = useState<number>(now.getFullYear());
  const [crg, setCrg] = useState<CrgSynthesis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showExport, setShowExport] = useState(false);
  const [showAnnual, setShowAnnual] = useState(false);
  const [copie, setCopie] = useState<"resume" | null>(null);

  const loadData = useCallback((selectedMonth: number, selectedYear: number, signal?: AbortSignal) => {
    setLoading(true);
    api
      .get<CrgSynthesis>("/crg/mine", { params: { month: selectedMonth, year: selectedYear }, signal })
      .then((res) => {
        setCrg(res.data);
        setError(null);
        setLoading(false);
      })
      .catch((err) => {
        if (isRequestCancelled(err)) return;
        setError(apiErrorMessage(err));
        setLoading(false);
      });
  }, []);

  // Sans AbortController, changer vite de mois/année pouvait afficher le CRG
  // d'une mauvaise période si une réponse arrivait après une autre plus
  // récente — même schéma que MessagesPage.tsx.
  useEffect(() => {
    const controller = new AbortController();
    loadData(month, year, controller.signal);
    return () => controller.abort();
  }, [loadData, month, year]);

  const periode = new Date(year, month - 1, 1).toLocaleDateString(i18n.language, { month: "long", year: "numeric" });

  async function copier(quoi: "resume") {
    if (!crg) return;
    const texte = resumeCrg(
      crg,
      periode,
      {
        titre: t("owner.crg.title"),
        loyers: t("owner.crg.stats.totalLoyers"),
        charges: t("owner.crg.stats.totalCharges"),
        commission: t("owner.crg.stats.totalCommission"),
        net: t("owner.crg.stats.totalNet"),
      },
      formatMoney
    );
    try {
      await navigator.clipboard.writeText(texte);
      setCopie(quoi);
      setTimeout(() => setCopie((actuel) => (actuel === quoi ? null : actuel)), 1800);
    } catch {
      // Presse-papiers indisponible : l'export HTML reste disponible.
    }
  }

  if (error) {
    return (
      <div className="border border-rose-200 bg-rose-50 p-6 text-rose-700">
        <p className="text-sm">{error}</p>
        <button
          onClick={() => loadData(month, year)}
          className="mt-4 cursor-pointer bg-rose-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-rose-700"
        >
          {t("common.actions.retry")}
        </button>
      </div>
    );
  }

  if (loading || !crg) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{t("owner.crg.title")}</h1>
          <p className="mt-1 max-w-xl text-sm text-slate-600">{t("owner.crg.subtitle")}</p>
        </div>
        <EtatReversementCrg crg={crg} />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4 border border-slate-300 bg-white p-4">
        <SelecteurPeriodeCrg month={month} year={year} onChange={(m, a) => { setMonth(m); setYear(a); }} idPrefixe="owner-crg" ns="owner.crg" />
        <div className="flex flex-wrap items-center gap-2">
          <Bulle texte={t("owner.tips.crgExport")}>
            <button
              onClick={() => setShowExport(true)}
              className="flex cursor-pointer items-center gap-1.5 bg-ink-900 px-3.5 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-orange-700"
            >
              <FileText size={13} aria-hidden="true" /> {t("owner.crg.exportHtml")}
            </button>
          </Bulle>
          <button
            onClick={() => setShowAnnual(true)}
            className="flex cursor-pointer items-center gap-1.5 border border-slate-400 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-800 transition-colors hover:border-ink-900"
          >
            <FileText size={13} aria-hidden="true" /> {t("owner.crg.exportAnnual", { year })}
          </button>
          <button
            onClick={() => copier("resume")}
            className="flex cursor-pointer items-center gap-1.5 border border-slate-400 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-800 transition-colors hover:border-ink-900"
          >
            {copie === "resume" ? <Check size={13} aria-hidden="true" /> : <ClipboardCopy size={13} aria-hidden="true" />}
            {copie === "resume" ? t("common.crgReleve.copied") : t("common.crgReleve.copySummary")}
          </button>
        </div>
      </div>

      <DecompteCrg crg={crg} ns="owner.crg" periode={periode} />

      <ReversementsSection crg={crg} />

      {showExport && (
        <DocumentModal
          title={t("owner.crg.title")}
          docUrl={`/crg/mine/export?month=${month}&year=${year}`}
          onClose={() => setShowExport(false)}
        />
      )}

      {showAnnual && (
        <DocumentModal
          title={t("owner.crg.annualTitle", { year })}
          docUrl={`/crg/mine/annual/export?year=${year}`}
          onClose={() => setShowAnnual(false)}
        />
      )}
    </div>
  );
}
