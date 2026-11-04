import { CheckCircle2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../api/client";
import SectionReglage from "./SectionReglage";

interface ComptePaiement {
  configure: boolean;
  enabled: boolean;
  mode: "test" | "live";
  currency: string;
  tokenLast4: string;
  /** La plateforme sait-elle chiffrer des identifiants ? Sinon la fonction n'est pas encore ouverte. */
  disponible: boolean;
}

/** Réponse bien formée ? (Une réponse inattendue ne doit jamais casser les réglages de l'agence.) */
function estCompte(valeur: unknown): valeur is ComptePaiement {
  const v = valeur as Partial<ComptePaiement> | null | undefined;
  return Boolean(v) && typeof v?.configure === "boolean" && typeof v?.enabled === "boolean" && typeof v?.disponible === "boolean";
}

const CHAMP = "w-full border border-slate-400 bg-white px-3.5 py-2 text-sm text-slate-900";
const ETIQUETTE = "mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600";
const BOUTON_TRAIT =
  "cursor-pointer border border-slate-400 bg-white px-4 py-2.5 text-xs font-semibold text-slate-800 transition-colors hover:border-ink-900 hover:bg-slate-100 disabled:opacity-60";
const BOUTON_ROSE = "cursor-pointer border border-rose-400 bg-white px-4 py-2.5 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-50 disabled:opacity-60";

const FORMULAIRE_VIDE = { masterKey: "", privateKey: "", token: "", mode: "test" as "test" | "live", currency: "XOF" };

/**
 * Compte PayDunya de l'agence : les locataires paient leur loyer par Mobile Money ou par carte directement sur CE
 * compte, jamais sur celui de la plateforme (voir backend/src/services/comptePaiementAgence.service.ts). Les
 * identifiants sont chiffrés côté serveur et ne reviennent jamais à l'écran : on affiche seulement la fin du jeton.
 * Réservé au propriétaire de l'agence : un collaborateur n'en voit que l'état.
 */
export default function SectionPaiementEnLigne({ numero, lectureSeule }: { numero: string; lectureSeule: boolean }) {
  const { t } = useTranslation();
  const [compte, setCompte] = useState<ComptePaiement | null>(null);
  const [form, setForm] = useState(FORMULAIRE_VIDE);
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  // Remplacer des identifiants déjà enregistrés se fait par une nouvelle saisie, pas en les modifiant : on ne les affiche jamais.
  const [saisie, setSaisie] = useState(false);

  function appliquer(brut: unknown) {
    if (!estCompte(brut)) {
      setErreur(t("manager.agencySettings.onlinePayment.unavailableResponse"));
      return;
    }
    setCompte(brut);
    if (brut.configure) setForm((f) => ({ ...f, mode: brut.mode, currency: brut.currency }));
  }

  useEffect(() => {
    let vivant = true;
    api
      .get("/agency/payment-account")
      .then((res) => {
        if (vivant) appliquer(res.data);
      })
      .catch((err) => {
        if (vivant) setErreur(apiErrorMessage(err));
      });
    return () => {
      vivant = false;
    };
    // Chargée avec la page, pas à chaque changement de langue.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function enregistrer(e: FormEvent) {
    e.preventDefault();
    setErreur(null);
    setInfo(null);
    setEnvoi(true);
    try {
      const res = await api.put("/agency/payment-account", { ...form, enabled: true });
      appliquer(res.data);
      setForm((f) => ({ ...f, masterKey: "", privateKey: "", token: "" }));
      setSaisie(false);
      setInfo(t("manager.agencySettings.onlinePayment.saved"));
    } catch (err) {
      setErreur(apiErrorMessage(err));
    } finally {
      setEnvoi(false);
    }
  }

  async function basculer(enabled: boolean) {
    setErreur(null);
    setInfo(null);
    setEnvoi(true);
    try {
      const res = await api.patch("/agency/payment-account", { enabled });
      appliquer(res.data);
      setInfo(t(enabled ? "manager.agencySettings.onlinePayment.resumed" : "manager.agencySettings.onlinePayment.suspended"));
    } catch (err) {
      setErreur(apiErrorMessage(err));
    } finally {
      setEnvoi(false);
    }
  }

  async function supprimer() {
    if (!window.confirm(t("manager.agencySettings.onlinePayment.confirmRemove"))) return;
    setErreur(null);
    setInfo(null);
    setEnvoi(true);
    try {
      await api.delete("/agency/payment-account");
      setCompte((c) => (c ? { ...c, configure: false, enabled: false, tokenLast4: "" } : c));
      setForm(FORMULAIRE_VIDE);
      setSaisie(false);
      setInfo(t("manager.agencySettings.onlinePayment.removed"));
    } catch (err) {
      setErreur(apiErrorMessage(err));
    } finally {
      setEnvoi(false);
    }
  }

  const montrerFormulaire = !lectureSeule && compte?.disponible && (!compte.configure || saisie);

  return (
    <SectionReglage id="agency-paiement" numero={numero} titre={t("manager.agencySettings.onlinePayment.title")}>
      <p className="text-sm text-slate-600">{t("manager.agencySettings.onlinePayment.intro")}</p>

      {erreur && (
        <p role="alert" className="mt-3 text-xs text-rose-800">
          {erreur}
        </p>
      )}
      {info && (
        <p role="status" className="mt-3 flex items-center gap-2 text-xs text-ink-900">
          <CheckCircle2 size={14} aria-hidden="true" /> {info}
        </p>
      )}
      {!compte && !erreur && <p className="mt-3 text-xs text-slate-600">{t("manager.agencySettings.onlinePayment.loading")}</p>}

      {compte && !compte.disponible && <p className="mt-3 text-xs text-orange-800">{t("manager.agencySettings.onlinePayment.notAvailable")}</p>}

      {compte && compte.configure && (
        <div className="mt-4 space-y-3">
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span
              className={`inline-block border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${
                compte.enabled ? "border-ink-900 bg-white text-ink-900" : "border-slate-300 bg-slate-50 text-slate-700"
              }`}
            >
              {compte.enabled ? t("manager.agencySettings.onlinePayment.statusOn") : t("manager.agencySettings.onlinePayment.statusOff")}
            </span>
            <span className="font-mono tabular-nums text-slate-800">
              {t("manager.agencySettings.onlinePayment.account", {
                mode: t(`manager.agencySettings.onlinePayment.modes.${compte.mode}`),
                currency: compte.currency,
                last4: compte.tokenLast4,
              })}
            </span>
          </p>
          {compte.mode === "test" && <p className="text-xs text-slate-600">{t("manager.agencySettings.onlinePayment.testNote")}</p>}
          {!lectureSeule && (
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={envoi} onClick={() => basculer(!compte.enabled)} className={BOUTON_TRAIT}>
                {compte.enabled ? t("manager.agencySettings.onlinePayment.suspend") : t("manager.agencySettings.onlinePayment.resume")}
              </button>
              {compte.disponible && !saisie && (
                <button type="button" disabled={envoi} onClick={() => setSaisie(true)} className={BOUTON_TRAIT}>
                  {t("manager.agencySettings.onlinePayment.replace")}
                </button>
              )}
              <button type="button" disabled={envoi} onClick={supprimer} className={BOUTON_ROSE}>
                {t("manager.agencySettings.onlinePayment.remove")}
              </button>
            </div>
          )}
        </div>
      )}

      {lectureSeule && <p className="mt-3 text-xs text-slate-600">{t("manager.agencySettings.onlinePayment.ownerOnly")}</p>}

      {montrerFormulaire && (
        <form onSubmit={enregistrer} className="mt-4 space-y-4" autoComplete="off">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="pay-master" className={ETIQUETTE}>
                {t("manager.agencySettings.onlinePayment.fields.masterKey")}
              </label>
              <input id="pay-master" type="password" required minLength={8} maxLength={200} autoComplete="off" value={form.masterKey} onChange={(e) => setForm({ ...form, masterKey: e.target.value })} className={CHAMP} />
            </div>
            <div>
              <label htmlFor="pay-private" className={ETIQUETTE}>
                {t("manager.agencySettings.onlinePayment.fields.privateKey")}
              </label>
              <input id="pay-private" type="password" required minLength={8} maxLength={200} autoComplete="off" value={form.privateKey} onChange={(e) => setForm({ ...form, privateKey: e.target.value })} className={CHAMP} />
            </div>
            <div>
              <label htmlFor="pay-token" className={ETIQUETTE}>
                {t("manager.agencySettings.onlinePayment.fields.token")}
              </label>
              <input id="pay-token" type="password" required minLength={8} maxLength={200} autoComplete="off" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} className={CHAMP} />
            </div>
            <div>
              <label htmlFor="pay-currency" className={ETIQUETTE}>
                {t("manager.agencySettings.onlinePayment.fields.currency")}
              </label>
              <input id="pay-currency" required minLength={3} maxLength={3} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} className={CHAMP} />
            </div>
            <div>
              <label htmlFor="pay-mode" className={ETIQUETTE}>
                {t("manager.agencySettings.onlinePayment.fields.mode")}
              </label>
              <select id="pay-mode" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as "test" | "live" })} className={CHAMP}>
                <option value="test">{t("manager.agencySettings.onlinePayment.modes.test")}</option>
                <option value="live">{t("manager.agencySettings.onlinePayment.modes.live")}</option>
              </select>
            </div>
          </div>
          <p className="text-xs text-slate-600">{t("manager.agencySettings.onlinePayment.secretsNote")}</p>
          <p className="text-xs text-slate-600">{t("manager.agencySettings.onlinePayment.currencyHint")}</p>
          {form.mode === "live" && <p className="text-xs text-orange-800">{t("manager.agencySettings.onlinePayment.liveWarning")}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={envoi}
              className="cursor-pointer border border-ink-900 bg-ink-900 px-6 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-brand-600 disabled:opacity-60"
            >
              {envoi ? t("manager.agencySettings.onlinePayment.saving") : t("manager.agencySettings.onlinePayment.save")}
            </button>
            {compte?.configure && (
              <button type="button" disabled={envoi} onClick={() => setSaisie(false)} className={BOUTON_TRAIT}>
                {t("common.actions.cancel")}
              </button>
            )}
          </div>
        </form>
      )}

      <p className="mt-4 text-xs text-slate-600">{t("manager.agencySettings.onlinePayment.note")}</p>
    </SectionReglage>
  );
}
