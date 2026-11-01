import { Mail } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api, apiErrorMessage } from "../api/client";
import AuthLayout from "../components/AuthLayout";
import ChampAuth from "../components/ChampAuth";
import Seo from "../components/Seo";

const BOUTON_PRINCIPAL =
  "flex w-full cursor-pointer items-center justify-center gap-2 bg-ink-900 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-orange-700 disabled:opacity-60";
const MESSAGE_ERREUR = "border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800";
/** Délai avant de pouvoir redemander un lien : évite de saturer la boîte du destinataire d'un double clic nerveux. */
const DELAI_RENVOI_SECONDES = 30;

export default function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  // Secondes restantes avant de pouvoir renvoyer le lien ; 0 = renvoi possible.
  const [attente, setAttente] = useState(0);
  const [renvoye, setRenvoye] = useState(false);

  useEffect(() => {
    if (attente <= 0) return;
    const minuteur = setTimeout(() => setAttente((s) => s - 1), 1000);
    return () => clearTimeout(minuteur);
  }, [attente]);

  async function demander() {
    setError(null);
    setLoading(true);
    try {
      // La réponse est volontairement générique côté serveur (existence de
      // l'email jamais révélée) — on affiche donc toujours le même message
      // de succès, que l'adresse soit inscrite ou non.
      await api.post("/auth/forgot-password", { email });
      setSent(true);
      setAttente(DELAI_RENVOI_SECONDES);
      return true;
    } catch (err) {
      setError(apiErrorMessage(err));
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setRenvoye(false);
    await demander();
  }

  async function renvoyer() {
    setRenvoye(false);
    if (await demander()) setRenvoye(true);
  }

  return (
    <AuthLayout page="forgotPassword" retour={t("auth.forgotPassword.backToLogin")} retourVers="/login">
      <Seo title={`${t("seo.forgotPassword.title")} | ${t("common.appName")}`} description={t("seo.forgotPassword.description")} canonical="/mot-de-passe-oublie" />

      {sent ? (
        <div>
          <div className="flex size-12 items-center justify-center border border-slate-300 bg-slate-50 text-ink-900">
            <Mail size={22} aria-hidden="true" />
          </div>
          <h1 className="mt-4 text-xl font-bold text-slate-900">{t("auth.forgotPassword.sentTitle")}</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{t("auth.forgotPassword.sentSubtitle")}</p>

          {/* L'adresse saisie, pour repérer une faute de frappe sans recommencer. */}
          <p className="mt-5 border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-xs text-ink-900 shadow-[inset_4px_0_0_var(--color-ink-900)]">
            {t("auth.forgotPassword.sentTo", { email })}
          </p>

          {error && (
            <p role="alert" className={`mt-4 ${MESSAGE_ERREUR}`}>
              {error}
            </p>
          )}
          {renvoye && !error && <p className="mt-4 font-mono text-[11px] text-slate-700">{t("auth.forgotPassword.resent")}</p>}

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-dashed border-slate-300 pt-4 text-xs">
            <button
              type="button"
              onClick={renvoyer}
              disabled={attente > 0 || loading}
              className="cursor-pointer border-b border-ink-900/40 pb-0.5 font-semibold text-ink-900 transition-colors hover:border-orange-700 hover:text-orange-700 disabled:cursor-default disabled:border-transparent disabled:text-slate-500 disabled:hover:text-slate-500"
            >
              {attente > 0 ? t("auth.forgotPassword.resendIn", { count: attente }) : t("auth.forgotPassword.resend")}
            </button>
            <button
              type="button"
              onClick={() => {
                setSent(false);
                setError(null);
                setRenvoye(false);
              }}
              className="cursor-pointer font-semibold text-ink-900 transition-colors hover:text-orange-700"
            >
              {t("auth.forgotPassword.changeAddress")}
            </button>
          </div>

          <Link to="/login" className={`mt-6 ${BOUTON_PRINCIPAL}`}>
            {t("auth.forgotPassword.backToLoginButton")}
          </Link>
        </div>
      ) : (
        <>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-orange-700">{t("auth.cartouche.forgotPassword")}</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">{t("auth.forgotPassword.title")}</h1>
          <p className="mt-1.5 text-sm text-slate-600">{t("auth.forgotPassword.subtitle")}</p>

          <form onSubmit={handleSubmit} className="mt-7 space-y-4">
            <ChampAuth
              id="forgot-password-email"
              label={t("auth.login.email")}
              icone={Mail}
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("auth.login.emailPlaceholder")}
            />

            {error && (
              <p role="alert" className={MESSAGE_ERREUR}>
                {error}
              </p>
            )}

            <button type="submit" disabled={loading} className={BOUTON_PRINCIPAL}>
              {loading && <span className="size-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
              {loading ? t("auth.forgotPassword.submitting") : t("auth.forgotPassword.submit")}
            </button>
          </form>
        </>
      )}
    </AuthLayout>
  );
}
