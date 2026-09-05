import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { apiErrorMessage } from "../api/client";
import LanguageSwitcher from "../components/LanguageSwitcher";
import Reveal from "../components/Reveal";
import { useAuth } from "../context/AuthContext";

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

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0">
      <path d="M4 12.5 9.5 18 20 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function RegisterPage() {
  const { t } = useTranslation();
  const { register } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

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

    setLoading(true);
    try {
      await register(email, password);
      setSent(true);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2 bg-slate-950">
      {/* Panneau de gauche : image de marque (masqué sur mobile) */}
      <div className="hidden lg:flex relative flex-col justify-between overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-brand-950 p-12 xl:p-16">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-24 -left-16 w-96 h-96 bg-brand-600/20 rounded-full blur-3xl animate-float-slow" />
          <div className="absolute bottom-0 right-0 w-80 h-80 bg-purple-600/20 rounded-full blur-3xl animate-float-delay" />
        </div>

        <Reveal className="relative flex items-center gap-3">
          <img src="/app-icon.png" alt="Logo" className="w-9 h-9 rounded-xl shadow" />
          <span className="font-bold text-lg tracking-tight text-white">{t("common.appName")}</span>
        </Reveal>

        <Reveal delay={100} className="relative max-w-md">
          <h1 className="text-3xl xl:text-4xl font-extrabold text-white leading-tight">
            {t("auth.register.panel.title")}
          </h1>
          <p className="mt-4 text-sm text-slate-400 leading-relaxed">{t("auth.register.panel.subtitle")}</p>

          <ul className="mt-8 space-y-3.5">
            {highlights.map((item, i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-slate-300">
                <span className="mt-0.5 w-5 h-5 rounded-full bg-emerald-500/15 text-emerald-400 flex items-center justify-center">
                  <CheckIcon />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal delay={200} className="relative inline-flex items-center gap-2 text-xs text-brand-300 bg-brand-950/60 border border-brand-500/20 rounded-full px-4 py-2 w-fit">
          <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
          {t("auth.register.panel.trialNote")}
        </Reveal>
      </div>

      {/* Panneau de droite : formulaire */}
      <div className="flex flex-col items-center justify-center px-6 py-12 relative">
        <div className="absolute top-6 left-6 right-6 flex items-center justify-between">
          <Link
            to="/landing"
            className="text-xs font-medium text-slate-500 hover:text-slate-300 transition-colors"
          >
            {t("auth.register.backToHome")}
          </Link>
          <LanguageSwitcher />
        </div>

        <Reveal className="w-full max-w-sm">
          <div className="lg:hidden flex items-center justify-center gap-3 mb-8">
            <img src="/app-icon.png" alt="Logo" className="w-9 h-9 rounded-xl shadow" />
            <span className="font-bold text-lg tracking-tight text-white">{t("common.appName")}</span>
          </div>

          {sent ? (
            <div className="text-center">
              <div className="mx-auto w-12 h-12 rounded-full bg-emerald-500/15 text-emerald-400 flex items-center justify-center mb-4">
                <MailIcon />
              </div>
              <h2 className="text-xl font-bold text-white">{t("auth.register.sentTitle")}</h2>
              <p className="text-sm text-slate-400 mt-2 leading-relaxed">{t("auth.register.sentSubtitle")}</p>
              <Link
                to="/login"
                className="mt-6 inline-block w-full bg-brand-600 hover:bg-brand-500 text-white rounded-xl py-2.5 text-sm font-semibold shadow-lg shadow-brand-600/30 transition-all hover:scale-[1.02]"
              >
                {t("auth.register.loginLink")}
              </Link>
            </div>
          ) : (
            <>
              <h2 className="text-2xl font-bold text-white text-center">{t("auth.register.title")}</h2>
              <p className="text-sm text-slate-400 text-center mt-1.5">{t("auth.register.subtitle")}</p>

              <form onSubmit={handleSubmit} className="mt-8 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">{t("auth.register.email")}</label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500">
                      <MailIcon />
                    </span>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-900 text-slate-100 pl-10 pr-3.5 py-2.5 text-sm placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
                      placeholder={t("auth.register.emailPlaceholder")}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">{t("auth.register.password")}</label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500">
                      <LockIcon />
                    </span>
                    <input
                      type={showPassword ? "text" : "password"}
                      required
                      minLength={8}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-900 text-slate-100 pl-10 pr-10 py-2.5 text-sm placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
                      placeholder={t("auth.register.passwordPlaceholder")}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? t("auth.login.hidePassword") : t("auth.login.showPassword")}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                    >
                      <EyeIcon off={showPassword} />
                    </button>
                  </div>
                  <p className="mt-1.5 text-[11px] text-slate-600">{t("auth.register.passwordHint")}</p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">
                    {t("auth.register.confirmPassword")}
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500">
                      <LockIcon />
                    </span>
                    <input
                      type={showPassword ? "text" : "password"}
                      required
                      minLength={8}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-900 text-slate-100 pl-10 pr-3.5 py-2.5 text-sm placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
                      placeholder={t("auth.register.passwordPlaceholder")}
                    />
                  </div>
                </div>

                {error && (
                  <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-60 text-white rounded-xl py-2.5 text-sm font-semibold shadow-lg shadow-brand-600/30 transition-all hover:scale-[1.02]"
                >
                  {loading && <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                  {loading ? t("auth.register.submitting") : t("auth.register.submit")}
                </button>
              </form>

              <p className="mt-5 text-[11px] text-slate-500 text-center leading-relaxed">
                {t("auth.register.legalPrefix")}{" "}
                <Link to="/cgu" className="text-brand-400 hover:text-brand-300 transition-colors">
                  {t("auth.register.legalTerms")}
                </Link>{" "}
                {t("auth.register.legalAnd")}{" "}
                <Link to="/confidentialite" className="text-brand-400 hover:text-brand-300 transition-colors">
                  {t("auth.register.legalPrivacy")}
                </Link>
                {t("auth.register.legalSuffix")}
              </p>

              <p className="mt-6 text-center text-xs text-slate-500">
                {t("auth.register.alreadyHaveAccount")}{" "}
                <Link to="/login" className="font-medium text-brand-400 hover:text-brand-300 transition-colors">
                  {t("auth.register.loginLink")}
                </Link>
              </p>
            </>
          )}
        </Reveal>
      </div>
    </div>
  );
}
