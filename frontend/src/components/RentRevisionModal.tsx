import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../api/client";
import { useCurrency } from "../context/currency";
import CadreModale from "./CadreModale";
import { AIDE, AVIS, BOUTON_ANNULER, BOUTON_PLEIN, CHAMP, ERREUR, ETIQUETTE, INFO } from "./styleFormulaire";

type Mode = "PERCENT" | "INDEX" | "AMOUNT";

interface Revision {
  id: string;
  previousRent: number;
  newRent: number;
  effectiveDate: string;
  method: Mode;
  percent: number | null;
  indexName: string | null;
  indexOld: number | null;
  indexNew: number | null;
  note: string | null;
  status: "PENDING" | "APPLIED" | "CANCELLED";
  tenantNotifiedAt: string | null;
}

interface RentRevisionModalProps {
  contractId: string;
  rent: number;
  currency?: string;
  /** Fin du bail (ISO) : on ne propose pas de mois au-delà. */
  endDate: string;
  /** Premier de mois proposé (rappel des baux à réviser) ; sinon le mois prochain. */
  dateSuggeree?: string;
  /** Ouvre l'avenant d'une révision (document à faire signer). */
  onOpenAvenant?: (revisionId: string) => void;
  onSuccess: () => void;
  onClose: () => void;
}

const arrondir = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Même calcul que le serveur (qui reste seul juge) : sert uniquement à afficher le nouveau loyer avant validation. */
export function apercuNouveauLoyer(loyer: number, mode: Mode, saisie: { percent: string; indexOld: string; indexNew: string; amount: string }): number | null {
  const nombre = (v: string) => (v.trim() === "" ? NaN : Number(v.replace(",", ".")));
  let nouveau: number;
  if (mode === "AMOUNT") nouveau = nombre(saisie.amount);
  else if (mode === "PERCENT") nouveau = loyer * (1 + nombre(saisie.percent) / 100);
  else {
    const ancien = nombre(saisie.indexOld);
    const recent = nombre(saisie.indexNew);
    nouveau = ancien > 0 && recent > 0 ? (loyer * recent) / ancien : NaN;
  }
  nouveau = arrondir(nouveau);
  return Number.isFinite(nouveau) && nouveau > 0 ? nouveau : null;
}

/** Les mois proposés : du mois en cours à la fin du bail, 24 au maximum, en premier de mois UTC (AAAA-MM-01). */
export function moisProposes(endDate: string, maintenant: Date = new Date()): string[] {
  const fin = new Date(endDate);
  const mois: string[] = [];
  for (let i = 0; i < 24; i++) {
    const d = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth() + i, 1));
    if (d > fin) break;
    mois.push(d.toISOString().slice(0, 10));
  }
  return mois;
}

/** Révision du loyer d'un bail actif : montant, pourcentage ou indice, à partir d'un premier de mois. */
export default function RentRevisionModal({ contractId, rent, currency, endDate, dateSuggeree, onOpenAvenant, onSuccess, onClose }: RentRevisionModalProps) {
  const { t, i18n } = useTranslation();
  const { formatMoney } = useCurrency();
  const mois = useMemo(() => moisProposes(endDate), [endDate]);

  const [mode, setMode] = useState<Mode>("PERCENT");
  const [saisie, setSaisie] = useState({ percent: "", indexOld: "", indexNew: "", amount: "" });
  const [indexName, setIndexName] = useState("");
  const suggestion = dateSuggeree?.slice(0, 10);
  const [effectiveDate, setEffectiveDate] = useState(suggestion && mois.includes(suggestion) ? suggestion : (mois[1] ?? mois[0] ?? ""));
  const [notifyTenant, setNotifyTenant] = useState(true);
  const [note, setNote] = useState("");
  const [historique, setHistorique] = useState<Revision[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const charger = useCallback(async () => {
    try {
      const { data } = await api.get<Revision[]>(`/contracts/${contractId}/rent-revisions`);
      setHistorique(data);
    } catch {
      setHistorique([]);
    }
  }, [contractId]);
  useEffect(() => {
    charger();
  }, [charger]);

  const nouveau = apercuNouveauLoyer(rent, mode, saisie);
  const ecart = nouveau === null ? null : arrondir(nouveau - rent);
  const programmee = historique.find((r) => r.status === "PENDING");
  const libelleMois = (iso: string) => new Date(iso).toLocaleDateString(i18n.language, { month: "long", year: "numeric", timeZone: "UTC" });
  const nombre = (v: string) => Number(v.replace(",", "."));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post(`/contracts/${contractId}/rent-revisions`, {
        mode,
        ...(mode === "AMOUNT" ? { newRent: nombre(saisie.amount) } : {}),
        ...(mode === "PERCENT" ? { percent: nombre(saisie.percent) } : {}),
        ...(mode === "INDEX" ? { indexOld: nombre(saisie.indexOld), indexNew: nombre(saisie.indexNew), indexName: indexName.trim() || null } : {}),
        effectiveDate,
        notifyTenant,
        note: note.trim() || null,
      });
      onSuccess();
    } catch (err) {
      setError(apiErrorMessage(err));
      setSaving(false);
    }
  }

  async function annuler(revision: Revision) {
    setError(null);
    try {
      await api.delete(`/contracts/${contractId}/rent-revisions/${revision.id}`);
      await charger();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  const champ = CHAMP;
  const etiquette = ETIQUETTE;

  return (
    <CadreModale
      titre={t("components.rentRevisionModal.title")}
      titreId="rent-revision-title"
      sousTitre={t("components.rentRevisionModal.current", { rent: formatMoney(rent, currency) })}
      onClose={onClose}
      fermable={!saving}
      largeur="lg"
    >
        {programmee ? (
          <div className={`${AVIS} !px-4 !py-3 text-sm`}>
            <p>
              {t("components.rentRevisionModal.pending", {
                from: formatMoney(programmee.previousRent, currency),
                to: formatMoney(programmee.newRent, currency),
                month: libelleMois(programmee.effectiveDate),
              })}
            </p>
            <button type="button" onClick={() => annuler(programmee)} className="mt-2 cursor-pointer text-xs font-semibold underline hover:text-orange-700">
              {t("components.rentRevisionModal.cancelPending")}
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div role="radiogroup" aria-label={t("components.rentRevisionModal.method")} className="flex flex-wrap gap-2">
              {(["PERCENT", "INDEX", "AMOUNT"] as const).map((valeur) => (
                <button
                  key={valeur}
                  type="button"
                  role="radio"
                  aria-checked={mode === valeur}
                  onClick={() => setMode(valeur)}
                  className={`cursor-pointer border px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors ${
                    mode === valeur ? "border-ink-900 bg-ink-900 text-white" : "border-slate-400 bg-white text-slate-800 hover:border-ink-900"
                  }`}
                >
                  {t(`components.rentRevisionModal.modes.${valeur}`)}
                </button>
              ))}
            </div>

            {mode === "PERCENT" && (
              <div>
                <label htmlFor="rr-percent" className={etiquette}>{t("components.rentRevisionModal.percent")}</label>
                <input id="rr-percent" inputMode="decimal" value={saisie.percent} onChange={(e) => setSaisie({ ...saisie, percent: e.target.value })} className={champ} placeholder="3" />
              </div>
            )}
            {mode === "INDEX" && (
              <div className="space-y-3">
                <div>
                  <label htmlFor="rr-index-name" className={etiquette}>{t("components.rentRevisionModal.indexName")}</label>
                  <input id="rr-index-name" value={indexName} onChange={(e) => setIndexName(e.target.value)} className={champ} placeholder="IRL" maxLength={60} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="rr-index-old" className={etiquette}>{t("components.rentRevisionModal.indexOld")}</label>
                    <input id="rr-index-old" inputMode="decimal" value={saisie.indexOld} onChange={(e) => setSaisie({ ...saisie, indexOld: e.target.value })} className={champ} />
                  </div>
                  <div>
                    <label htmlFor="rr-index-new" className={etiquette}>{t("components.rentRevisionModal.indexNew")}</label>
                    <input id="rr-index-new" inputMode="decimal" value={saisie.indexNew} onChange={(e) => setSaisie({ ...saisie, indexNew: e.target.value })} className={champ} />
                  </div>
                </div>
                <p className="text-xs text-slate-600">{t("components.rentRevisionModal.indexHint")}</p>
              </div>
            )}
            {mode === "AMOUNT" && (
              <div>
                <label htmlFor="rr-amount" className={etiquette}>{t("components.rentRevisionModal.amount")}</label>
                <input id="rr-amount" inputMode="decimal" value={saisie.amount} onChange={(e) => setSaisie({ ...saisie, amount: e.target.value })} className={champ} />
              </div>
            )}

            <p role="status" className={`${INFO} !px-4 !py-3 text-sm`}>
              {nouveau === null
                ? t("components.rentRevisionModal.previewEmpty")
                : t("components.rentRevisionModal.preview", { rent: formatMoney(nouveau, currency), diff: `${ecart! >= 0 ? "+" : "−"}${formatMoney(Math.abs(ecart!), currency)}` })}
              {nouveau !== null && ecart !== 0 && (
                <span className="mt-1 block font-mono text-xs text-slate-700">
                  {t("components.rentRevisionModal.annualImpact", { amount: `${ecart! >= 0 ? "+" : "−"}${formatMoney(Math.abs(arrondir(ecart! * 12)), currency)}` })}
                </span>
              )}
            </p>

            <div>
              <label htmlFor="rr-month" className={etiquette}>{t("components.rentRevisionModal.effective")}</label>
              <select id="rr-month" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className={champ}>
                {mois.map((m) => (
                  <option key={m} value={m}>{libelleMois(m)}</option>
                ))}
              </select>
              <p className={AIDE}>{t("components.rentRevisionModal.effectiveHint")}</p>
            </div>

            <div>
              <label htmlFor="rr-note" className={etiquette}>{t("components.rentRevisionModal.note")}</label>
              <textarea id="rr-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} className={champ} />
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-800">
              <input type="checkbox" checked={notifyTenant} onChange={(e) => setNotifyTenant(e.target.checked)} />
              {t("components.rentRevisionModal.notify")}
            </label>

            {error && (
              <p role="alert" className={ERREUR}>{error}</p>
            )}
            <div className="flex justify-end gap-3 border-t border-slate-300 pt-4">
              <button type="button" onClick={onClose} disabled={saving} className={BOUTON_ANNULER}>
                {t("common.actions.cancel")}
              </button>
              <button type="submit" disabled={saving || nouveau === null || !effectiveDate} className={BOUTON_PLEIN}>
                {saving ? t("components.rentRevisionModal.saving") : t("components.rentRevisionModal.save")}
              </button>
            </div>
          </form>
        )}
        {programmee && error && (
          <p role="alert" className={`mt-2 ${ERREUR}`}>{error}</p>
        )}

        {historique.length > 0 && (
          <div className="mt-5 border-t border-slate-300 pt-4">
            <h4 className={ETIQUETTE}>{t("components.rentRevisionModal.history")}</h4>
            <ul className="space-y-1.5">
              {historique.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-2 text-xs text-slate-800">
                  <span className="font-semibold">{libelleMois(r.effectiveDate)}</span>
                  <span>{formatMoney(r.previousRent, currency)} → {formatMoney(r.newRent, currency)}</span>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-slate-600">({t(`components.rentRevisionModal.status.${r.status}`)})</span>
                  {r.status !== "CANCELLED" && onOpenAvenant && (
                    <button type="button" onClick={() => onOpenAvenant(r.id)} className="cursor-pointer text-[11px] font-semibold text-ink-900 underline decoration-ink-900/40 hover:text-orange-700">
                      {t("components.rentRevisionModal.amendment")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
    </CadreModale>
  );
}
