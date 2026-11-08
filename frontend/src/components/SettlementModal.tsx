import { FileText } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage, isRequestCancelled } from "../api/client";
import { useCurrency } from "../context/CurrencyContext";
import type { Contract, LeaseSettlement, SettlementLastMonthMode, SettlementPreview } from "../types";
import CadreModale from "./CadreModale";
import DocumentModal from "./DocumentModal";
import { AIDE, AVIS, BOUTON_ANNULER, BOUTON_PLEIN, BOUTON_TRAIT, CHAMP, ERREUR, ETIQUETTE, INFO } from "./styleFormulaire";

interface SettlementModalProps {
  contract: Contract;
  /** Appelé après toute modification, pour recharger la liste des baux. */
  onChange: () => void;
  onClose: () => void;
}

const jourIso = (valeur: string) => new Date(valeur).toISOString().slice(0, 10);
const dateCourte = (valeur: string, langue: string) => new Date(valeur).toLocaleDateString(langue, { timeZone: "UTC" });
const MODES: SettlementLastMonthMode[] = ["FULL", "PRORATA"];

/**
 * Solde de tout compte d'un bail. L'écran montre d'abord le calcul (rien n'est enregistré), puis l'émission le fige : le
 * document peut alors être imprimé ou envoyé par e-mail au locataire (PDF joint), et marqué « soldé » une fois la somme
 * restituée ou perçue. Le solde est signé : positif, à restituer au locataire ; négatif, le reste qu'il doit.
 */
export default function SettlementModal({ contract, onChange, onClose }: SettlementModalProps) {
  const { t, i18n } = useTranslation();
  const { formatMoney } = useCurrency();
  const [mode, setMode] = useState<SettlementLastMonthMode>("FULL");
  const [exitDate, setExitDate] = useState("");
  const [sendEmail, setSendEmail] = useState(false);
  const [apercu, setApercu] = useState<SettlementPreview | null>(null);
  const [soldes, setSoldes] = useState<LeaseSettlement[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [resultat, setResultat] = useState<string | null>(null);
  const [document, setDocument] = useState<LeaseSettlement | null>(null);

  const chargerSoldes = useCallback(async () => {
    try {
      const { data } = await api.get<LeaseSettlement[]>(`/contracts/${contract.id}/settlements`);
      setSoldes(data);
    } catch (err) {
      setLoadError(apiErrorMessage(err));
    }
  }, [contract.id]);

  useEffect(() => {
    chargerSoldes();
  }, [chargerSoldes]);

  // Le calcul suit le mode du dernier mois et la date de sortie ; une réponse tardive d'un ancien choix est écartée.
  useEffect(() => {
    const controller = new AbortController();
    setLoadError(null);
    api
      .get<SettlementPreview>(`/contracts/${contract.id}/settlement/preview`, {
        params: { lastMonth: mode, ...(exitDate ? { exitDate } : {}) },
        signal: controller.signal,
      })
      .then(({ data }) => setApercu(data))
      .catch((err) => {
        if (isRequestCancelled(err)) return;
        setLoadError(apiErrorMessage(err));
      });
    return () => controller.abort();
  }, [contract.id, mode, exitDate]);

  async function emettre() {
    setSaving(true);
    setError(null);
    setResultat(null);
    try {
      const { data } = await api.post<LeaseSettlement>(`/contracts/${contract.id}/settlements`, {
        lastMonthMode: mode,
        ...(exitDate ? { exitDate } : {}),
        sendEmail,
      });
      setResultat(
        !sendEmail
          ? t("components.settlementModal.issued")
          : data.emailEnvoye
            ? t("components.settlementModal.issuedAndSent")
            : t("components.settlementModal.issuedNotSent")
      );
      await chargerSoldes();
      onChange();
      setDocument(data);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function regler(solde: LeaseSettlement) {
    setSaving(true);
    setError(null);
    try {
      await api.post(`/contracts/${contract.id}/settlements/${solde.id}/settle`);
      await chargerSoldes();
      onChange();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const monnaie = (montant: number, devise: string) => formatMoney(montant, devise);
  const libelleSolde = (balance: number, devise: string) =>
    balance > 0
      ? t("components.settlementModal.balanceToRefund", { amount: monnaie(balance, devise) })
      : balance < 0
        ? t("components.settlementModal.balanceDue", { amount: monnaie(-balance, devise) })
        : t("components.settlementModal.balanceZero");
  const mois = (m: number, a: number) => new Date(Date.UTC(a, m - 1, 1)).toLocaleDateString(i18n.language, { month: "long", year: "numeric", timeZone: "UTC" });
  const LIGNE = "flex flex-wrap justify-between gap-x-4 gap-y-0.5 border-b border-slate-200 py-1.5 text-sm";

  return (
    <>
      <CadreModale
        titre={t("components.settlementModal.title")}
        titreId="settlement-title"
        sousTitre={t("components.settlementModal.subtitle", {
          property: contract.property?.title ?? "",
          tenant: contract.tenant ? `${contract.tenant.firstName} ${contract.tenant.lastName}` : "",
        })}
        onClose={onClose}
        fermable={!saving}
        largeur="xl"
      >
        <div className="space-y-4">
          <p className={INFO}>{t("components.settlementModal.disclaimer")}</p>

          {loadError && (
            <p role="alert" className={ERREUR}>
              {loadError}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="settlement-last-month" className={ETIQUETTE}>
                {t("components.settlementModal.lastMonth")}
              </label>
              <select id="settlement-last-month" value={mode} onChange={(e) => setMode(e.target.value as SettlementLastMonthMode)} className={CHAMP}>
                {MODES.map((m) => (
                  <option key={m} value={m}>
                    {t(`components.settlementModal.mode.${m}`)}
                  </option>
                ))}
              </select>
              <p className={AIDE}>{t("components.settlementModal.lastMonthHint")}</p>
            </div>
            <div>
              <label htmlFor="settlement-exit" className={ETIQUETTE}>
                {t("components.settlementModal.exitDate")}
              </label>
              <input
                id="settlement-exit"
                type="date"
                value={exitDate || (apercu ? jourIso(apercu.exitDate) : "")}
                onChange={(e) => setExitDate(e.target.value)}
                className={CHAMP}
              />
              <p className={AIDE}>{t("components.settlementModal.exitDateHint")}</p>
            </div>
          </div>

          {!apercu && !loadError && <p className="text-sm text-slate-600">{t("components.settlementModal.loading")}</p>}

          {apercu && (
            <section aria-label={t("components.settlementModal.calcTitle")} className="space-y-3 border border-slate-300 p-4">
              <h4 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-900">{t("components.settlementModal.calcTitle")}</h4>
              <dl>
                <div className={LIGNE}>
                  <dt className="text-slate-600">{t("components.settlementModal.deposit")}</dt>
                  <dd className="font-semibold text-slate-900">{monnaie(apercu.depositAmount, apercu.currency)}</dd>
                </div>
                {apercu.deductions.map((d, i) => (
                  <div key={`${d.label}-${i}`} className={LIGNE}>
                    <dt className="text-slate-600">{t("components.settlementModal.deduction", { label: d.label })}</dt>
                    <dd className="font-semibold text-slate-900">− {monnaie(d.amount, apercu.currency)}</dd>
                  </div>
                ))}
                {apercu.depositRefunded > 0 && (
                  <div className={LIGNE}>
                    <dt className="text-slate-600">{t("components.settlementModal.alreadyRefunded")}</dt>
                    <dd className="font-semibold text-slate-900">− {monnaie(apercu.depositRefunded, apercu.currency)}</dd>
                  </div>
                )}
                <div className={LIGNE}>
                  <dt className="text-slate-600">{t("components.settlementModal.unpaid")}</dt>
                  <dd className="font-semibold text-slate-900">− {monnaie(apercu.unpaidTotal, apercu.currency)}</dd>
                </div>
                {apercu.creditTotal > 0 && (
                  <div className={LIGNE}>
                    <dt className="text-slate-600">{t("components.settlementModal.credit")}</dt>
                    <dd className="font-semibold text-slate-900">+ {monnaie(apercu.creditTotal, apercu.currency)}</dd>
                  </div>
                )}
                <div className="flex flex-wrap justify-between gap-x-4 pt-2 text-sm">
                  <dt className="font-semibold text-ink-900">{t("components.settlementModal.balance")}</dt>
                  <dd className={`font-semibold ${apercu.balance < 0 ? "text-rose-700" : "text-ink-900"}`}>{libelleSolde(apercu.balance, apercu.currency)}</dd>
                </div>
              </dl>

              {apercu.lignes.some((l) => l.due > 0 || l.credit > 0) && (
                <ul className="space-y-0.5 text-xs text-slate-600">
                  {apercu.lignes
                    .filter((l) => l.due > 0 || l.credit > 0)
                    .map((l) => (
                      <li key={`${l.periodYear}-${l.periodMonth}`}>
                        {l.due > 0
                          ? t("components.settlementModal.lineDue", { month: mois(l.periodMonth, l.periodYear), amount: monnaie(l.due, apercu.currency) })
                          : t("components.settlementModal.lineCredit", { month: mois(l.periodMonth, l.periodYear), amount: monnaie(l.credit, apercu.currency) })}
                      </li>
                    ))}
                </ul>
              )}

              {!apercu.restitutionEnregistree && (
                <p role="note" className={AVIS}>
                  {t("components.settlementModal.depositNotRefunded")}
                </p>
              )}
              {!apercu.etatDesLieuxDeSortie && (
                <p role="note" className={AVIS}>
                  {t("components.settlementModal.noExitInspection")}
                </p>
              )}
              {apercu.facturesApresSortie > 0 && (
                <p role="note" className={AVIS}>
                  {t("components.settlementModal.invoicesAfterExit", { count: apercu.facturesApresSortie })}
                </p>
              )}
            </section>
          )}

          <label className="flex items-start gap-2 text-sm text-slate-800">
            <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} className="mt-1" />
            <span>
              {t("components.settlementModal.sendEmail")}
              <span className={`${AIDE} block`}>{t("components.settlementModal.sendEmailHint")}</span>
            </span>
          </label>

          {resultat && (
            <p role="status" className={INFO}>
              {resultat}
            </p>
          )}
          {error && (
            <p role="alert" className={ERREUR}>
              {error}
            </p>
          )}

          <div className="flex justify-end gap-3 border-t border-slate-300 pt-4">
            <button type="button" onClick={onClose} disabled={saving} className={BOUTON_ANNULER}>
              {t("common.actions.close")}
            </button>
            <button type="button" onClick={emettre} disabled={saving || !apercu} className={BOUTON_PLEIN}>
              {saving ? t("components.settlementModal.issuing") : t("components.settlementModal.issue")}
            </button>
          </div>

          {soldes && soldes.length > 0 && (
            <section aria-label={t("components.settlementModal.historyTitle")} className="border-t border-slate-300 pt-3">
              <h5 className={ETIQUETTE}>{t("components.settlementModal.historyTitle")}</h5>
              <ul className="space-y-2">
                {soldes.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 border border-slate-200 px-3 py-2 text-sm">
                    <span>
                      <span className="font-mono text-xs text-slate-600">{s.reference}</span>{" "}
                      <span className="text-slate-900">{libelleSolde(s.balance, s.currency)}</span>
                      <span className="block text-xs text-slate-600">
                        {t("components.settlementModal.historyLine", { date: dateCourte(s.createdAt, i18n.language) })}
                        {" · "}
                        {s.settledAt ? t("components.settlementModal.settledOn", { date: dateCourte(s.settledAt, i18n.language) }) : t("components.settlementModal.notSettled")}
                      </span>
                    </span>
                    <span className="flex gap-2">
                      <button type="button" onClick={() => setDocument(s)} className={BOUTON_TRAIT}>
                        <FileText size={13} aria-hidden="true" className="mr-1.5 inline" />
                        {t("components.settlementModal.viewDocument")}
                      </button>
                      {!s.settledAt && (
                        <button type="button" onClick={() => regler(s)} disabled={saving} className={BOUTON_TRAIT}>
                          {t("components.settlementModal.markSettled")}
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </CadreModale>

      {document && <DocumentModal title={t("components.settlementModal.docTitle", { reference: document.reference })} docUrl={`/documents/settlement/${document.id}`} onClose={() => setDocument(null)} />}
    </>
  );
}
