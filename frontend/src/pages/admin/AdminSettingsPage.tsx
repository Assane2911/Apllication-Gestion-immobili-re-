import { CheckCircle2, CircleAlert, ShieldCheck, ShieldOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../../api/client";
import SectionReglage from "../../components/SectionReglage";
import TwoFactorDisableModal from "../../components/TwoFactorDisableModal";
import TwoFactorSetupModal from "../../components/TwoFactorSetupModal";
import { useAuth } from "../../context/auth";
import type { PlatformSettings } from "../../types";
import { bicValide, compacter, grouperIban, ibanValide } from "../../utils/iban";

export default function AdminSettingsPage() {
  const { t } = useTranslation();
  const { user, refreshUser } = useAuth();
  const [showTwoFactorSetup, setShowTwoFactorSetup] = useState(false);
  const [showTwoFactorDisable, setShowTwoFactorDisable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [form, setForm] = useState({ iban: "", bic: "" });
  // Ce que le serveur détient : sert à dire s'il reste des modifications à enregistrer.
  const [enregistre, setEnregistre] = useState({ iban: "", bic: "" });

  useEffect(() => {
    // Même correctif que les paramètres d'agence : un chargement échoué
    // affichait un RIB vide, qu'un enregistrement aurait écrasé. Celui-ci est
    // le compte sur lequel les gestionnaires virent leurs abonnements.
    api
      .get<PlatformSettings>("/admin/settings")
      .then((res) => {
        const charge = { iban: res.data.iban || "", bic: res.data.bic || "" };
        setForm(charge);
        setEnregistre(charge);
        setLoadError(null);
      })
      .catch((err) => setLoadError(apiErrorMessage(err)));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSuccess(false);
    setError(null);
    try {
      await api.put<PlatformSettings>("/admin/settings", form);
      setEnregistre(form);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 4000);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const modifie = form.iban !== enregistre.iban || form.bic !== enregistre.bic;
  const ibanSaisi = compacter(form.iban) !== "";
  const bicSaisi = compacter(form.bic) !== "";
  const ibanOk = ibanSaisi && ibanValide(form.iban);
  const bicOk = bicSaisi && bicValide(form.bic);
  const champ = "w-full border border-slate-400 bg-white px-3.5 py-2 font-mono text-sm text-slate-900 focus:border-ink-900 focus:outline-none focus:ring-2 focus:ring-ink-900/20";

  /** Mention sous un champ : un contrôle de forme seulement, qui n'empêche jamais d'enregistrer. */
  function verdict(saisi: boolean, ok: boolean, valide: string, invalide: string) {
    if (!saisi) return null;
    return (
      <p className={`mt-1.5 flex items-center gap-1.5 font-mono text-[11px] ${ok ? "text-emerald-800" : "text-orange-700"}`}>
        {ok ? <CheckCircle2 size={12} aria-hidden="true" /> : <CircleAlert size={12} aria-hidden="true" />}
        {ok ? valide : invalide}
      </p>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">{t("admin.settings.title")}</h2>
        <p className="mt-1 text-sm text-slate-600">{t("admin.settings.subtitle")}</p>
      </div>

      {loadError ? (
        // Le formulaire n'est PAS rendu tant que l'état initial est inconnu :
        // c'est ce qui empêche d'enregistrer du vide par-dessus des données
        // qu'on n'a simplement pas réussi à lire.
        <div className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p>{loadError}</p>
          <button type="button" onClick={() => window.location.reload()} className="mt-2 cursor-pointer text-xs font-semibold underline">
            {t("common.actions.retry")}
          </button>
        </div>
      ) : (
        <SectionReglage id="coordonnees" numero="01" titre={t("admin.settings.sections.bank")}>
          {success && (
            <div role="status" className="mb-5 flex items-center gap-2 border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <CheckCircle2 size={15} aria-hidden="true" /> {t("admin.settings.success")}
            </div>
          )}

          {error && (
            <div role="alert" className="mb-5 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-[1fr_17rem]">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label htmlFor="platform-iban" className="mb-1 block font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-700">
                  {t("admin.settings.fields.iban")}
                </label>
                <input
                  id="platform-iban"
                  value={form.iban}
                  onChange={(e) => setForm({ ...form, iban: e.target.value })}
                  placeholder={t("admin.settings.fields.ibanPlaceholder")}
                  autoComplete="off"
                  spellCheck={false}
                  className={champ}
                />
                {verdict(ibanSaisi, ibanOk, t("admin.settings.check.ibanValid"), t("admin.settings.check.ibanInvalid"))}
              </div>

              <div>
                <label htmlFor="platform-bic" className="mb-1 block font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-700">
                  {t("admin.settings.fields.bic")}
                </label>
                <input
                  id="platform-bic"
                  value={form.bic}
                  onChange={(e) => setForm({ ...form, bic: e.target.value })}
                  placeholder={t("admin.settings.fields.bicPlaceholder")}
                  autoComplete="off"
                  spellCheck={false}
                  className={champ}
                />
                {verdict(bicSaisi, bicOk, t("admin.settings.check.bicValid"), t("admin.settings.check.bicInvalid"))}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
                <p className={`font-mono text-[11px] uppercase tracking-wider ${modifie ? "font-semibold text-orange-700" : "text-slate-500"}`}>
                  {modifie ? t("admin.settings.unsaved") : t("admin.settings.upToDate")}
                </p>
                <button
                  type="submit"
                  disabled={saving}
                  className="cursor-pointer bg-ink-900 px-6 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-orange-700 disabled:opacity-60"
                >
                  {saving ? t("admin.settings.saving") : t("admin.settings.save")}
                </button>
              </div>
            </form>

            {/* Ce que lit le gestionnaire qui choisit de payer par virement : à relire avant d'enregistrer. */}
            <aside aria-label={t("admin.settings.preview.title")} className="self-start border border-slate-300 bg-slate-50">
              <p className="border-b border-slate-300 px-4 py-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                {t("admin.settings.preview.title")}
              </p>
              {ibanSaisi || bicSaisi ? (
                <dl className="space-y-3 p-4 text-xs">
                  <div>
                    <dt className="font-mono text-[10px] uppercase tracking-wider text-slate-600">{t("admin.settings.preview.iban")}</dt>
                    <dd className="mt-0.5 break-words font-mono text-sm font-semibold tabular-nums text-ink-900">{grouperIban(form.iban) || "—"}</dd>
                  </div>
                  <div>
                    <dt className="font-mono text-[10px] uppercase tracking-wider text-slate-600">{t("admin.settings.preview.bic")}</dt>
                    <dd className="mt-0.5 font-mono text-sm font-semibold text-ink-900">{compacter(form.bic) || "—"}</dd>
                  </div>
                  <p className="border-t border-dashed border-slate-300 pt-3 text-slate-600">{t("admin.settings.preview.note")}</p>
                </dl>
              ) : (
                <p className="p-4 text-xs text-slate-600">{t("admin.settings.preview.empty")}</p>
              )}
            </aside>
          </div>
        </SectionReglage>
      )}

      {/*
        Le compte administrateur est le plus puissant de la plateforme : il confirme les virements et suspend ou
        supprime des agences. Il doit pouvoir être protégé par un second facteur, comme n'importe quel compte de
        gestionnaire. Hors du bloc ci-dessus : l'échec du chargement des coordonnées bancaires ne doit pas
        priver l'administrateur de cette protection.
      */}
      <SectionReglage id="securite" numero="02" titre={t("admin.settings.twoFactor.title")}>
        <p className="max-w-prose text-sm text-slate-600">{t("admin.settings.twoFactor.description")}</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {user?.twoFactorEnabled ? (
            <>
              <span className="inline-flex items-center gap-1.5 border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-900">
                <ShieldCheck size={14} aria-hidden="true" /> {t("admin.settings.twoFactor.enabled")}
              </span>
              <button
                type="button"
                onClick={() => setShowTwoFactorDisable(true)}
                className="cursor-pointer border border-red-300 px-4 py-2.5 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50"
              >
                {t("admin.settings.twoFactor.disableButton")}
              </button>
            </>
          ) : (
            <>
              <span className="inline-flex items-center gap-1.5 border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-orange-900">
                <ShieldOff size={14} aria-hidden="true" /> {t("admin.settings.twoFactor.disabled")}
              </span>
              <button
                type="button"
                onClick={() => setShowTwoFactorSetup(true)}
                className="cursor-pointer bg-ink-900 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-orange-700"
              >
                {t("admin.settings.twoFactor.enableButton")}
              </button>
            </>
          )}
        </div>
      </SectionReglage>

      {showTwoFactorSetup && (
        <TwoFactorSetupModal
          onSuccess={() => {
            setShowTwoFactorSetup(false);
            refreshUser();
          }}
          onClose={() => setShowTwoFactorSetup(false)}
        />
      )}
      {showTwoFactorDisable && (
        <TwoFactorDisableModal
          onSuccess={() => {
            setShowTwoFactorDisable(false);
            refreshUser();
          }}
          onClose={() => setShowTwoFactorDisable(false)}
        />
      )}
    </div>
  );
}
