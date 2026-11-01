import { Check, Circle, Eye, EyeOff, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, apiErrorMessage } from "../api/client";
import AuthLayout from "../components/AuthLayout";
import ChampAuth from "../components/ChampAuth";
import IndicateurForce from "../components/IndicateurForce";
import Seo from "../components/Seo";

const BOUTON_PRINCIPAL =
  "flex w-full cursor-pointer items-center justify-center gap-2 bg-ink-900 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-orange-700 disabled:opacity-60";
const MESSAGE_ERREUR = "border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800";
/** Délai avant la redirection vers la connexion une fois le mot de passe changé. */
const DELAI_REDIRECTION_MS = 2500;

export default function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // La redirection part d'un effet (et non d'un minuteur lancé dans le gestionnaire) : quitter la page l'annule.
  useEffect(() => {
    if (!done) return;
    const minuteur = setTimeout(() => navigate("/login"), DELAI_REDIRECTION_MS);
    return () => clearTimeout(minuteur);
  }, [done, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError(t("auth.resetPassword.mismatchError"));
      return;
    }
    if (password.length < 8) {
      setError(t("auth.resetPassword.tooShortError"));
      return;
    }

    setLoading(true);
    try {
      await api.post("/auth/reset-password", { token, password });
      setDone(true);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout page="resetPassword" retour={t("auth.forgotPassword.backToLogin")} retourVers="/login">
      <Seo title={`${t("seo.resetPassword.title")} | ${t("common.appName")}`} noindex />

      {!token ? (
        <div>
          <h1 className="sr-only">{t("auth.resetPassword.title")}</h1>
          <p className="border border-red-300 bg-red-50 px-3 py-3 text-sm text-red-800">{t("auth.resetPassword.missingToken")}</p>
          <Link to="/mot-de-passe-oublie" className={`mt-6 ${BOUTON_PRINCIPAL}`}>
            {t("auth.resetPassword.requestNewLink")}
          </Link>
        </div>
      ) : done ? (
        <div>
          <div className="flex size-12 items-center justify-center border border-slate-300 bg-slate-50 text-ink-900">
            <Lock size={22} aria-hidden="true" />
          </div>
          <h1 className="mt-4 text-xl font-bold text-slate-900">{t("auth.resetPassword.doneTitle")}</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{t("auth.resetPassword.doneSubtitle")}</p>
          {/* Le temps qu'il reste avant la redirection, en barre qui se remplit. */}
          <div aria-hidden="true" className="mt-5 h-1.5 bg-slate-200">
            <div className="h-full bg-ink-900 motion-safe:animate-[remplir_2.5s_linear_forwards]" />
          </div>
          <Link to="/login" className={`mt-6 ${BOUTON_PRINCIPAL}`}>
            {t("auth.resetPassword.loginNow")}
          </Link>
        </div>
      ) : (
        <>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-orange-700">{t("auth.cartouche.resetPassword")}</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">{t("auth.resetPassword.title")}</h1>
          <p className="mt-1.5 text-sm text-slate-600">{t("auth.resetPassword.subtitle")}</p>

          <form onSubmit={handleSubmit} className="mt-7 space-y-4">
            <ChampAuth
              id="reset-password-new"
              label={t("auth.resetPassword.newPassword")}
              icone={Lock}
              type={showPassword ? "text" : "password"}
              required
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("auth.login.passwordPlaceholder")}
              droite={
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? t("auth.login.hidePassword") : t("auth.login.showPassword")}
                  className="flex h-6 w-6 cursor-pointer items-center justify-center text-slate-500 transition-colors hover:text-ink-900"
                >
                  {showPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                </button>
              }
              aide={
                <>
                  <p className="mt-1.5 text-[11px] text-slate-600">{t("auth.register.passwordHint")}</p>
                  <IndicateurForce motDePasse={password} />
                </>
              }
            />

            <ChampAuth
              id="reset-password-confirm"
              label={t("auth.resetPassword.confirmPassword")}
              icone={Lock}
              type={showPassword ? "text" : "password"}
              required
              maxLength={128}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={t("auth.login.passwordPlaceholder")}
              aide={
                confirmPassword !== "" && (
                  <p className={`mt-1.5 flex items-center gap-1.5 font-mono text-[11px] ${confirmPassword === password ? "text-ink-900" : "text-orange-700"}`}>
                    {confirmPassword === password ? <Check size={12} aria-hidden="true" /> : <Circle size={9} aria-hidden="true" />}
                    {confirmPassword === password ? t("auth.register.match") : t("auth.register.noMatch")}
                  </p>
                )
              }
            />

            {error && (
              <p role="alert" className={MESSAGE_ERREUR}>
                {error}
              </p>
            )}

            <button type="submit" disabled={loading} className={BOUTON_PRINCIPAL}>
              {loading && <span className="size-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
              {loading ? t("auth.resetPassword.submitting") : t("auth.resetPassword.submit")}
            </button>
          </form>
        </>
      )}
    </AuthLayout>
  );
}
