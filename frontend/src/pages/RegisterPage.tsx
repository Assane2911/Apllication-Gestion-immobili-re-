import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import Logo from "../components/Logo";
import { apiErrorMessage } from "../api/client";
import GoogleSignInButton from "../components/GoogleSignInButton";
import { LangueEtTheme } from "../components/BoutonTheme";
import Reveal from "../components/Reveal";
import Seo from "../components/Seo";
import SelecteurPays from "../components/SelecteurPays";
import { useAuth } from "../context/auth";
import { isGoogleSignInEnabled } from "../utils/googleAuth";
import { homePathForRole } from "../utils/roleHome";

function MailIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
      <path d="M3.5 6.5 12 13 20.5 6.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M7.5 10.5V7a4.5 4.5 0 0 1 9 0v3.5" strokeLinecap="round" />
    </svg>
  );
}

function EyeIcon({ off }: { off: boolean }) {
  return off ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path
        d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.24 4.24M6.6 6.7C4.3 8.2 2.7 10.3 2 12c1.6 3.8 5.6 7 10 7 1.6 0 3.1-.4 4.4-1.1M9.9 4.2C10.6 4.1 11.3 4 12 4c4.4 0 8.4 3.2 10 7-.5 1.2-1.2 2.4-2.1 3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M2 12c1.6-3.8 5.6-7 10-7s8.4 3.2 10 7c-1.6 3.8-5.6 7-10 7s-8.4-3.2-10-7Z" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function GiftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3.5" y="9" width="17" height="11" rx="1.5" />
      <path d="M3.5 13.5h17M12 9v11M8 9a2.5 2.5 0 1 1 0-5c1.5 0 2.8 1.2 4 3 1.2-1.8 2.5-3 4-3a2.5 2.5 0 1 1 0 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0">
      <path d="M4 12.5 9.5 18 20 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function RegisterPage() {
  const { t, i18n } = useTranslation();
  const { user: utilisateur, register, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [email, setEmail] = useState("");
  // Pays de l'agence : vide tant qu'il n'est pas choisi, jamais deviné (pas de pays « par défaut » : il fixe les règles
  // de location appliquées et ne se change plus ensuite).
  const [country, setCountry] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  // Pré-rempli depuis un lien de parrainage partagé (?ref=CODE, voir
  // ReferralPage.tsx) mais toujours modifiable : rien n'empêche une personne
  // de saisir un autre code à la main.
  const [referralCode, setReferralCode] = useState(() => (searchParams.get("ref") ?? "").toUpperCase());
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);

  const highlights = t("auth.register.panel.highlights", { returnObjects: true }) as string[];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError(t("auth.register.mismatchError"));
      return;
    }
    if (password.length < 8) {
      setError(t("auth.register.tooShortError"));
      return;
    }
    if (!country) {
      setError(t("auth.register.countryRequiredError"));
      return;
    }

    setLoading(true);
    try {
      await register(email, password, country, referralCode);
      setSent(true);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleCredential(credential: string) {
    setError(null);
    setGoogleError(null);
    setGoogleLoading(true);
    try {
      const result = await loginWithGoogle(credential, referralCode.trim() || undefined);
      // Cas marginal : ce compte Google est déjà lié à un compte gestionnaire
      // existant (voir loginWithGoogle, auth.controller.ts) qui a depuis
      // activé la double authentification — la page d'inscription n'a pas de
      // formulaire pour ce second facteur, contrairement à LoginPage.
      if ("twoFactorRequired" in result) {
        navigate("/login");
        return;
      }
      navigate(homePathForRole(result.role), { replace: true });
    } catch (err) {
      setGoogleError(apiErrorMessage(err));
    } finally {
      setGoogleLoading(false);
    }
  }

  // Déjà connecté : revenir ici (bouton Retour, adresse saisie) réaffichait le formulaire alors que la session restait
  // ouverte, ce qui ressemblait à une déconnexion sans confirmation. On renvoie vers l'espace de l'utilisateur.
  if (utilisateur) return <Navigate to={homePathForRole(utilisateur.role)} replace />;

  return (
    <div className="relative isolate min-h-screen grid grid-cols-1 lg:grid-cols-2">
      <Seo title={`${t("seo.register.title")} | ${t("common.appName")}`} description={t("seo.register.description")} canonical="/inscription" />
      {/* Panneau de gauche : image de marque (masqué sur mobile) */}
      <aside className="hidden lg:flex relative flex-col justify-between overflow-hidden border-r border-slate-200/70 bg-white/55 backdrop-blur-sm dark:border-slate-800/70 dark:bg-slate-950/55 p-12 xl:p-16">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="bande-motif absolute inset-x-0 top-0 h-3.5" />
        </div>

        <Reveal className="relative flex items-center gap-3">
          <Logo />
          <span className="font-bold text-lg tracking-tight text-slate-900 dark:text-white">{t("common.appName")}</span>
        </Reveal>

        <Reveal delay={100} className="relative max-w-md">
          <p className="text-3xl xl:text-4xl font-extrabold text-slate-900 dark:text-white leading-tight xl:leading-10">
            {t("auth.register.panel.title")}
          </p>
          <p className="mt-4 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{t("auth.register.panel.subtitle")}</p>

          <ul className="mt-8 space-y-3.5">
            {highlights.map((item, i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-slate-700 dark:text-slate-300">
                <span className="mt-0.5 w-5 h-5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 flex items-center justify-center">
                  <CheckIcon />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal delay={200} className="relative inline-flex items-center gap-2 text-xs text-brand-700 dark:text-brand-300 bg-brand-50 dark:bg-brand-900/40 border border-brand-200 dark:border-brand-500/20 rounded-full px-4 py-2 w-fit">
          <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
          {t("auth.register.panel.trialNote")}
        </Reveal>
      </aside>

      {/* Panneau de droite : formulaire */}
      <main className="flex flex-col items-center justify-center px-6 pt-20 pb-12 lg:pt-12 relative">
        <div className="absolute top-6 left-6 right-6 flex items-center justify-between">
          <Link
            to="/landing"
            className="text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-300 transition-colors"
          >
            {t("auth.register.backToHome")}
          </Link>
          <LangueEtTheme />
        </div>

        <Reveal className="w-full max-w-sm">
          <div className="lg:hidden flex items-center justify-center gap-3 mb-8">
            <Logo />
            <span className="font-bold text-lg tracking-tight text-slate-900 dark:text-white">{t("common.appName")}</span>
          </div>

          {sent ? (
            <div className="text-center">
              <div className="mx-auto w-12 h-12 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 flex items-center justify-center mb-4">
                <MailIcon />
              </div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">{t("auth.register.sentTitle")}</h1>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-2 leading-relaxed">{t("auth.register.sentSubtitle")}</p>
              <Link
                to="/login"
                className="mt-6 inline-block w-full bg-brand-600 hover:bg-brand-700 text-white rounded-xl py-2.5 text-sm font-semibold shadow-lg shadow-brand-600/30 transition-all hover:scale-[1.02]"
              >
                {t("auth.register.loginLink")}
              </Link>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white text-center">{t("auth.register.title")}</h1>
              <p className="text-sm text-slate-600 dark:text-slate-400 text-center mt-1.5">{t("auth.register.subtitle")}</p>

              <form onSubmit={handleSubmit} className="mt-8 space-y-4">
                <div>
                  <label htmlFor="register-email" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">{t("auth.register.email")}</label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500">
                      <MailIcon />
                    </span>
                    <input
                      id="register-email"
                      type="email"
                      required
                      maxLength={254}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 pl-10 pr-3.5 py-2.5 text-sm placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-hidden focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
                      placeholder={t("auth.register.emailPlaceholder")}
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="register-password" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">{t("auth.register.password")}</label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500">
                      <LockIcon />
                    </span>
                    <input
                      id="register-password"
                      type={showPassword ? "text" : "password"}
                      required
                      minLength={8}
                      maxLength={128}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 pl-10 pr-10 py-2.5 text-sm placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-hidden focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
                      placeholder={t("auth.register.passwordPlaceholder")}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? t("auth.login.hidePassword") : t("auth.login.showPassword")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-slate-300 transition-colors"
                    >
                      <EyeIcon off={showPassword} />
                    </button>
                  </div>
                  <p className="mt-1.5 text-[11px] text-slate-600 dark:text-slate-400">{t("auth.register.passwordHint")}</p>
                </div>

                <div>
                  <label htmlFor="register-confirm-password" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                    {t("auth.register.confirmPassword")}
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500">
                      <LockIcon />
                    </span>
                    <input
                      id="register-confirm-password"
                      type={showPassword ? "text" : "password"}
                      required
                      minLength={8}
                      maxLength={128}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 pl-10 pr-3.5 py-2.5 text-sm placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-hidden focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
                      placeholder={t("auth.register.passwordPlaceholder")}
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="register-country" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">{t("auth.register.country")}</label>
                  <SelecteurPays
                    id="register-country"
                    value={country}
                    onChange={setCountry}
                    placeholder={t("auth.register.countryPlaceholder")}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500"
                  />
                  <p className="mt-1.5 text-[11px] text-slate-600 dark:text-slate-400">{t("auth.register.countryHint")}</p>
                </div>

                <div>
                  <label htmlFor="register-referral-code" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                    {t("auth.register.referralCode")}
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500">
                      <GiftIcon />
                    </span>
                    <input
                      id="register-referral-code"
                      type="text"
                      maxLength={64}
                      value={referralCode}
                      onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                      className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 pl-10 pr-3.5 py-2.5 text-sm placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-hidden focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors uppercase"
                      placeholder={t("auth.register.referralCodePlaceholder")}
                    />
                  </div>
                </div>

                {error && (
                  <p role="alert" className="text-xs text-red-700 dark:text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={loading || googleLoading}
                  className="w-full flex items-center justify-center gap-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white rounded-xl py-2.5 text-sm font-semibold shadow-lg shadow-brand-600/30 transition-all hover:scale-[1.02]"
                >
                  {loading && <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                  {loading ? t("auth.register.submitting") : t("auth.register.submit")}
                </button>
              </form>

              {isGoogleSignInEnabled() && (
                <div className="mt-5">
                  <div className="flex items-center gap-3">
                    <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
                    <span className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-600">{t("auth.google.orDivider")}</span>
                    <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
                  </div>
                  <div className="mt-4">
                    <GoogleSignInButton
                      onCredential={handleGoogleCredential}
                      onError={() => setGoogleError(t("auth.google.error"))}
                      locale={i18n.language}
                    />
                  </div>
                  {googleLoading && <p className="mt-3 text-center text-xs text-slate-600 dark:text-slate-400">{t("auth.register.submitting")}</p>}
                  {googleError && (
                    <p role="alert" className="mt-3 text-xs text-red-700 dark:text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                      {googleError}
                    </p>
                  )}
                </div>
              )}

              <p className="mt-5 text-[11px] text-slate-600 dark:text-slate-400 text-center leading-relaxed">
                {t("auth.register.legalPrefix")}{" "}
                <Link to="/cgu" className="text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 transition-colors">
                  {t("auth.register.legalTerms")}
                </Link>{" "}
                {t("auth.register.legalAnd")}{" "}
                <Link to="/confidentialite" className="text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 transition-colors">
                  {t("auth.register.legalPrivacy")}
                </Link>
                {t("auth.register.legalSuffix")}
              </p>

              <p className="mt-6 text-center text-xs text-slate-600 dark:text-slate-400">
                {t("auth.register.alreadyHaveAccount")}{" "}
                <Link to="/login" className="font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 transition-colors">
                  {t("auth.register.loginLink")}
                </Link>
              </p>
            </>
          )}
        </Reveal>
      </main>
    </div>
  );
}
