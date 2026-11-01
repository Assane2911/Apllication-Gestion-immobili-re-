import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Eye, EyeOff, Lock, Mail, TriangleAlert } from "lucide-react";
import { api, apiErrorCode, apiErrorMessage } from "../api/client";
import AuthLayout from "../components/AuthLayout";
import ChampAuth from "../components/ChampAuth";
import GoogleSignInButton from "../components/GoogleSignInButton";
import Seo from "../components/Seo";
import { useAuth } from "../context/auth";
import { homePathForRole } from "../utils/roleHome";
import { isGoogleSignInEnabled } from "../utils/googleAuth";

const CLE_EMAIL_MEMORISE = "immo.email-memorise";

/** Adresse mémorisée à la dernière connexion (si l'utilisateur l'a demandé). Le stockage peut être indisponible : on s'en passe. */
function emailMemorise(): string {
  try {
    return localStorage.getItem(CLE_EMAIL_MEMORISE) ?? "";
  } catch {
    return "";
  }
}

function memoriserEmail(email: string | null) {
  try {
    if (email) localStorage.setItem(CLE_EMAIL_MEMORISE, email);
    else localStorage.removeItem(CLE_EMAIL_MEMORISE);
  } catch {
    // Stockage indisponible (navigation privée) : la connexion n'en dépend pas.
  }
}

const BOUTON_PRINCIPAL =
  "flex w-full cursor-pointer items-center justify-center gap-2 bg-ink-900 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-orange-700 disabled:opacity-60";
const MESSAGE_ERREUR = "border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800";

export default function LoginPage() {
  const { t, i18n } = useTranslation();
  const { user: utilisateur, login, loginWithGoogle, verifyTwoFactor } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState(emailMemorise);
  // Coché d'office quand une adresse a déjà été mémorisée : décocher puis se connecter l'oublie.
  const [souvenir, setSouvenir] = useState(() => emailMemorise() !== "");
  // Verr. Maj. actif pendant la saisie du mot de passe : la cause la plus courante d'un « mot de passe incorrect ».
  const [majActive, setMajActive] = useState(false);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  // Arrivée depuis l'intercepteur d'api/client.ts après une suspension de compte.
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(() =>
    searchParams.get("suspended")
      ? t("auth.login.suspended")
      : searchParams.get("inactif")
        ? t("auth.login.inactive")
        : null
  );
  // Arrivée après une déconnexion demandée par l'utilisateur (useConfirmationDeconnexion) : un simple accusé de
  // réception, pas une erreur, qui disparaît dès qu'il commence une nouvelle connexion.
  const [deconnecte, setDeconnecte] = useState(() => searchParams.get("deconnecte") === "1");
  const [loading, setLoading] = useState<"form" | "google" | "2fa" | null>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">("idle");
  // Non-null uniquement pendant la deuxième étape (code TOTP ou de secours),
  // après que login()/loginWithGoogle() ait renvoyé `twoFactorRequired`.
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState("");

  async function doLogin(loginEmail: string, loginPassword: string, source: "form") {
    setError(null);
    setDeconnecte(false);
    setUnverifiedEmail(null);
    setResendState("idle");
    setLoading(source);
    try {
      const result = await login(loginEmail, loginPassword);
      // L'adresse est mémorisée dès que le mot de passe est accepté (même si un second facteur reste à saisir).
      memoriserEmail(souvenir ? loginEmail.trim() : null);
      if ("twoFactorRequired" in result) {
        setPendingToken(result.pendingToken);
        return;
      }
      navigate(homePathForRole(result.role), { replace: true });
    } catch (err) {
      setError(apiErrorMessage(err));
      if (apiErrorCode(err) === "EMAIL_NOT_VERIFIED") {
        setUnverifiedEmail(loginEmail);
      }
    } finally {
      setLoading(null);
    }
  }

  async function handleTwoFactorSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pendingToken) return;
    setError(null);
    setLoading("2fa");
    try {
      const user = await verifyTwoFactor(pendingToken, twoFactorCode.trim());
      navigate(homePathForRole(user.role), { replace: true });
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(null);
    }
  }

  async function handleResendVerification() {
    if (!unverifiedEmail) return;
    setResendState("sending");
    try {
      await api.post("/auth/resend-verification", { email: unverifiedEmail });
      setResendState("sent");
    } catch {
      setResendState("idle");
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    doLogin(email, password, "form");
  }

  async function handleGoogleCredential(credential: string) {
    setError(null);
    setGoogleError(null);
    setLoading("google");
    try {
      const result = await loginWithGoogle(credential);
      if ("twoFactorRequired" in result) {
        setPendingToken(result.pendingToken);
        return;
      }
      navigate(homePathForRole(result.role), { replace: true });
    } catch (err) {
      setGoogleError(apiErrorMessage(err));
    } finally {
      setLoading(null);
    }
  }

  // Déjà connecté : revenir ici (bouton Retour, adresse saisie) réaffichait le formulaire alors que la session restait
  // ouverte, ce qui ressemblait à une déconnexion sans confirmation. On renvoie vers l'espace de l'utilisateur.
  if (utilisateur) return <Navigate to={homePathForRole(utilisateur.role)} replace />;

  return (
    <AuthLayout page="login" retour={t("auth.login.backToHome")}>
      <Seo title={`${t("seo.login.title")} | ${t("common.appName")}`} description={t("seo.login.description")} canonical="/login" />

      {pendingToken ? (
        <>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-orange-700">{t("auth.login.step", { current: 2, total: 2 })}</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">{t("auth.twoFactor.title")}</h1>
          <p className="mt-1.5 text-sm text-slate-600">{t("auth.twoFactor.subtitle")}</p>

          <form onSubmit={handleTwoFactorSubmit} className="mt-7 space-y-4">
            <ChampAuth
              id="login-2fa-code"
              label={t("auth.twoFactor.codeLabel")}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              required
              value={twoFactorCode}
              onChange={(e) => setTwoFactorCode(e.target.value)}
              placeholder={t("auth.twoFactor.codePlaceholder")}
              aide={<p className="mt-1.5 text-xs text-slate-600">{t("auth.twoFactor.backupCodeHint")}</p>}
            />

            {error && (
              <p role="alert" className={MESSAGE_ERREUR}>
                {error}
              </p>
            )}

            <button type="submit" disabled={loading !== null} className={BOUTON_PRINCIPAL}>
              {loading === "2fa" && <span className="size-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
              {loading === "2fa" ? t("auth.twoFactor.submitting") : t("auth.twoFactor.submit")}
            </button>

            <button
              type="button"
              onClick={() => {
                setPendingToken(null);
                setTwoFactorCode("");
                setError(null);
              }}
              className="w-full cursor-pointer text-center text-xs font-semibold text-ink-900 transition-colors hover:text-orange-700"
            >
              {t("auth.twoFactor.back")}
            </button>
          </form>
        </>
      ) : (
        <>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-orange-700">{t("auth.cartouche.login")}</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">{t("auth.login.title")}</h1>
          <p className="mt-1.5 text-sm text-slate-600">{t("auth.login.subtitle")}</p>

          {deconnecte && (
            <p role="status" className="mt-5 border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
              {t("auth.login.loggedOut")}
            </p>
          )}

          <form onSubmit={handleSubmit} className="mt-7 space-y-4">
            <ChampAuth
              id="login-email"
              label={t("auth.login.email")}
              icone={Mail}
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("auth.login.emailPlaceholder")}
            />

            <ChampAuth
              id="login-password"
              label={t("auth.login.password")}
              icone={Lock}
              type={showPassword ? "text" : "password"}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyUp={(e) => setMajActive(e.getModifierState("CapsLock"))}
              onBlur={() => setMajActive(false)}
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
                  {majActive && (
                    <p className="mt-1.5 flex items-center gap-1.5 font-mono text-[11px] font-semibold text-orange-700">
                      <TriangleAlert size={12} aria-hidden="true" />
                      {t("auth.login.capsLock")}
                    </p>
                  )}
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700">
                      <input type="checkbox" checked={souvenir} onChange={(e) => setSouvenir(e.target.checked)} className="size-3.5" />
                      {t("auth.login.rememberEmail")}
                    </label>
                    <Link to="/mot-de-passe-oublie" className="text-xs font-semibold text-ink-900 transition-colors hover:text-orange-700">
                      {t("auth.login.forgotPasswordLink")}
                    </Link>
                  </div>
                </>
              }
            />

            {error && (
              <p role="alert" className={MESSAGE_ERREUR}>
                {error}
              </p>
            )}

            {unverifiedEmail && (
              <button
                type="button"
                onClick={handleResendVerification}
                disabled={resendState !== "idle"}
                className="w-full cursor-pointer border border-ink-900 py-2 text-center text-xs font-semibold text-ink-900 transition-colors hover:bg-slate-50 disabled:opacity-60"
              >
                {resendState === "sending"
                  ? t("auth.login.resendVerificationSending")
                  : resendState === "sent"
                    ? t("auth.login.resendVerificationSent")
                    : t("auth.login.resendVerificationButton")}
              </button>
            )}

            <button type="submit" disabled={loading !== null} className={BOUTON_PRINCIPAL}>
              {loading === "form" && <span className="size-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
              {loading === "form" ? t("auth.login.submitting") : t("auth.login.submit")}
            </button>
          </form>

          {isGoogleSignInEnabled() && (
            <div className="mt-5">
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-slate-300" />
                <span className="font-mono text-[11px] uppercase tracking-wider text-slate-600">{t("auth.google.orDivider")}</span>
                <div className="h-px flex-1 bg-slate-300" />
              </div>
              <div className="mt-4">
                <GoogleSignInButton
                  onCredential={handleGoogleCredential}
                  onError={() => setGoogleError(t("auth.google.error"))}
                  locale={i18n.language}
                />
              </div>
              {googleError && (
                <p role="alert" className={`mt-3 ${MESSAGE_ERREUR}`}>
                  {googleError}
                </p>
              )}
            </div>
          )}
        </>
      )}

      {!pendingToken && (
        <p className="mt-6 border-t border-dashed border-slate-300 pt-5 text-center text-xs text-slate-700">
          {t("auth.login.noAccountText")}{" "}
          <Link to="/inscription" className="border-b border-ink-900/40 pb-0.5 font-semibold text-ink-900 transition-colors hover:border-orange-700 hover:text-orange-700">
            {t("auth.login.registerLink")}
          </Link>
        </p>
      )}
    </AuthLayout>
  );
}
